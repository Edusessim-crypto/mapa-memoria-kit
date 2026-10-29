"""Sessão persistente do Claude Code para a conversa por voz do Mapa (stream-json).

Um processo `claude -p --input-format stream-json --output-format stream-json` fica aberto e recebe uma pergunta
por vez. Em relação ao `claude -p` de uma pergunta só (conversa.rodar_claude, ainda usado pela saudação e pelo
roteiro), a sessão aberta:
  - paga o custo de abertura uma vez (CLAUDE.md global, o do vault e o INDEX do hook de início);
  - lembra da conversa de verdade (contexto do próprio Claude, não a conversa colada no prompt);
  - entrega a resposta assim que o texto termina (`end_turn`), antes de o Claude fechar a rodada;
  - avisa cada ferramenta usada (que nota está sendo lida) e o texto escrito antes da primeira ferramenta
    (o "aviso rápido", falado enquanto ele pesquisa);
  - pode ser interrompida (control_request interrupt), sem perder o fio da conversa.

Os eventos chegam por `ao_evento(dict)`: {tipo: 'aviso', texto} · {tipo: 'lendo', rotulo, notas: [ids]} ·
{tipo: 'cedo', texto}. Nada aqui gasta ElevenLabs; quem fala é conversa.py.
Protocolo conferido com o Claude Code 2.1.312 (2026-10-28): eventos system/init, stream_event (message_start,
content_block_start, message_delta com stop_reason), assistant (blocos text/tool_use), user (tool_result e
"[Request interrupted by user]"), result (success | error_during_execution).
"""
import json
import os
import queue
import re
import subprocess
import threading
import time
import uuid

AQUI = os.path.dirname(os.path.abspath(__file__))
PASTA_ESTADO = os.path.join(AQUI, ".estado")   # logs e cache fora do git (ver .gitignore)
INTERNAS = {"ToolSearch", "TodoWrite", "BashOutput", "KillShell", "ListMcpResourcesTool", "ReadMcpResourceTool"}


class Eventos:
    """Fila de eventos que a página recebe por Server-Sent Events (servidor.py → /api/eventos)."""

    def __init__(self):
        self.ouvintes, self.trava = [], threading.Lock()

    def emitir(self, evento):
        with self.trava:
            filas = list(self.ouvintes)
        for q in filas:
            q.put(evento)

    def assinar(self):
        q = queue.Queue()
        with self.trava:
            self.ouvintes.append(q)
        return q

    def sair(self, q):
        with self.trava:
            if q in self.ouvintes:
                self.ouvintes.remove(q)

    def quantos(self):
        with self.trava:
            return len(self.ouvintes)


def rotulo_ferramenta(nome, entrada, vault):
    """O que mostrar na tela para uma ferramenta: {rotulo, notas: [nomes de nota sem .md]}."""
    entrada = entrada or {}
    if nome in INTERNAS:
        return None
    raiz = os.path.realpath(vault) if vault else ""

    def nota_de(caminho):
        if not caminho:
            return None
        real = os.path.realpath(os.path.expanduser(str(caminho)))
        if raiz and not real.startswith(raiz + os.sep):
            return None
        return os.path.basename(real)[:-3] if real.endswith(".md") else None

    def pasta_de(caminho):
        if not caminho:
            return ""
        real = os.path.realpath(os.path.expanduser(str(caminho)))
        rel = real[len(raiz) + 1:] if raiz and real.startswith(raiz + os.sep) else os.path.basename(real)
        return rel.split(os.sep)[0] if rel else ""

    if nome == "Read":
        n = nota_de(entrada.get("file_path"))
        return {"rotulo": f"Lendo {n}" if n else "Lendo o vault", "notas": [n] if n else []}
    if nome == "Grep":
        padrao, pasta = str(entrada.get("pattern") or "")[:40], pasta_de(entrada.get("path"))
        return {"rotulo": f"Procurando “{padrao}”" + (f" em {pasta}" if pasta else ""), "notas": []}
    if nome == "Glob":
        return {"rotulo": "Listando notas", "notas": []}
    if nome.startswith("mcp__"):
        partes = nome.split("__")
        servidor = partes[1].replace("claude_ai_", "").replace("_", " ") if len(partes) > 1 else "conector"
        return {"rotulo": f"Consultando {servidor}", "notas": []}
    return {"rotulo": nome, "notas": []}


class Turno:
    """Uma pergunta em andamento: acumula o texto, recebe os eventos e entrega o resultado uma vez só."""

    def __init__(self, ao_evento=None):
        self.fila = queue.Queue()
        self.entregue = False
        self.ao_evento = ao_evento
        self.texto = ""          # texto escrito desde a última ferramenta (resposta final em construção)
        self.aviso = None        # texto escrito antes da primeira ferramenta
        self.ferramentas = []    # [(nome, resumo)]
        self.lidas = []          # notas lidas, na ordem
        self.marcas = {"envio": time.time()}
        self.interrompido = False
        self.trava = threading.Lock()

    def marcar(self, nome):
        self.marcas.setdefault(nome, round(time.time() - self.marcas["envio"], 2))

    def evento(self, ev):
        if self.ao_evento:
            try:
                self.ao_evento(ev)
            except Exception:  # noqa: BLE001
                pass

    def entregar(self, resultado):
        with self.trava:
            if self.entregue:
                return
            self.entregue = True
        self.marcar("entrega_s")
        self.fila.put(resultado)


class SessaoClaude:
    """Um processo do Claude Code aberto, só leitura, que recebe uma pergunta por vez."""

    def __init__(self, claude, pasta, modelo="sonnet", esforco="low", persona="", ferramentas="Read,Grep,Glob",
                 extras=(), hook=None, esquecer_apos=15 * 60, max_turnos=40):
        self.claude, self.pasta, self.modelo, self.esforco, self.persona = claude, pasta, modelo, esforco, persona
        self.ferramentas, self.extras, self.hook = ferramentas, list(extras), hook
        self.esquecer_apos, self.max_turnos = esquecer_apos, max_turnos
        self.proc = None
        self.turno = None
        self.turnos = 0
        self.ultimo = 0.0
        self.trava = threading.Lock()        # uma pergunta por vez
        self.livre = threading.Event()       # o Claude fecha a rodada (result) um pouco depois da resposta
        self.livre.set()
        self.custo_total = 0.0

    # ------------------------------------------------------------------ processo
    def comando(self):
        permitidas = ",".join([self.ferramentas] + self.extras)
        cmd = [self.claude, "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
               "--include-partial-messages", "--model", self.modelo, "--effort", self.esforco,
               "--allowedTools", permitidas, "--no-session-persistence", "--append-system-prompt", self.persona]
        if self.extras:
            # conectores MCP: só o que estiver em SC_FERRAMENTAS_EXTRA, e a trava (hooks/trava.py) barra o que altera
            if self.hook:
                ajustes = {"hooks": {"PreToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": self.hook}]}]}}
                cmd += ["--settings", json.dumps(ajustes)]
        else:
            cmd += ["--tools", self.ferramentas, "--strict-mcp-config"]
        return cmd

    def ambiente(self):
        env = {k: v for k, v in os.environ.items() if not k.startswith(("CLAUDECODE", "CLAUDE_CODE_"))}
        if not self.extras:
            env["ENABLE_CLAUDEAI_MCP_SERVERS"] = "false"
        env["SC_VAULT"] = self.pasta
        return env

    def iniciar(self):
        os.makedirs(PASTA_ESTADO, exist_ok=True)
        self.parar()
        self.proc = subprocess.Popen(self.comando(), cwd=self.pasta, env=self.ambiente(), stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1, encoding="utf-8")
        self.turnos = 0
        self.livre.set()
        threading.Thread(target=self._ler_saida, args=(self.proc,), daemon=True).start()
        threading.Thread(target=self._ler_erros, args=(self.proc,), daemon=True).start()
        print(f"SESSÃO Claude aberta ({self.modelo}, pid {self.proc.pid})", flush=True)

    def parar(self):
        p, self.proc = self.proc, None
        if p and p.poll() is None:
            try:
                p.stdin.close()
            except OSError:
                pass
            p.terminate()
            try:
                p.wait(timeout=4)
            except subprocess.TimeoutExpired:
                p.kill()
        if self.turno and not self.turno.entregue:
            self.turno.entregar({"texto": "", "erro": "A sessão do Claude foi encerrada."})
        self.livre.set()

    def vivo(self):
        return self.proc is not None and self.proc.poll() is None

    def reiniciar(self):
        """Conversa nova: o Claude esquece o que foi dito."""
        self.parar()
        self.iniciar()

    def ocupada(self):
        return bool(self.turno and not self.turno.entregue)

    # ------------------------------------------------------------------ leitura do stream
    def _ler_erros(self, proc):
        try:
            with open(os.path.join(PASTA_ESTADO, "claude-erros.log"), "a", encoding="utf-8") as f:
                for linha in proc.stderr:
                    f.write(linha)
                    f.flush()
        except (OSError, ValueError):
            pass

    def _ler_saida(self, proc):
        for linha in proc.stdout:
            try:
                e = json.loads(linha)
            except ValueError:
                continue
            turno = self.turno
            tipo = e.get("type")
            try:
                if tipo == "stream_event":
                    ev = e.get("event") or {}
                    if ev.get("type") == "message_start" and turno:
                        turno.marcar("1a_mensagem_s")
                    elif ev.get("type") == "message_delta" and (ev.get("delta") or {}).get("stop_reason") == "end_turn":
                        # resposta final pronta: entrega já, sem esperar o Claude fechar a rodada
                        if turno and turno.texto.strip():
                            turno.evento({"tipo": "cedo", "texto": turno.texto.strip()})
                            turno.entregar({"texto": turno.texto.strip(), "cedo": True})
                elif tipo == "assistant" and turno:
                    for bloco in (e.get("message") or {}).get("content") or []:
                        if bloco.get("type") == "text":
                            turno.texto = (turno.texto + " " + (bloco.get("text") or "")).strip()
                        elif bloco.get("type") == "tool_use":
                            turno.marcar("ferramenta_s")
                            nome, entrada = bloco.get("name") or "", bloco.get("input") or {}
                            if turno.aviso is None and not turno.ferramentas:
                                # texto antes da primeira ferramenta = aviso rápido ("Um instante, senhor.")
                                turno.aviso = turno.texto.strip() or ""
                                if turno.aviso:
                                    turno.evento({"tipo": "aviso", "texto": turno.aviso})
                            turno.texto = ""
                            turno.ferramentas.append((nome, json.dumps(entrada, ensure_ascii=False)[:160]))
                            rot = rotulo_ferramenta(nome, entrada, self.pasta)
                            if rot:
                                for n in rot["notas"]:
                                    if n not in turno.lidas:
                                        turno.lidas.append(n)
                                turno.evento({"tipo": "lendo", "rotulo": rot["rotulo"], "notas": rot["notas"]})
                elif tipo == "user" and turno:
                    for bloco in (e.get("message") or {}).get("content") or []:
                        if bloco.get("type") == "text" and "interrupted" in str(bloco.get("text", "")).lower():
                            turno.interrompido = True
                elif tipo == "result":
                    custo = e.get("total_cost_usd")
                    if isinstance(custo, (int, float)):
                        self.custo_total += custo
                    if turno:
                        turno.marcas["custo_usd"] = round(custo, 5) if isinstance(custo, (int, float)) else None
                        turno.marcas["modelo"] = self.modelo
                        erro = e.get("is_error") and not turno.interrompido
                        texto = e.get("result") if isinstance(e.get("result"), str) else ""
                        turno.entregar({"texto": (texto or turno.texto).strip(), "erro": (texto or "O Claude não respondeu.") if erro else None,
                                        "interrompido": turno.interrompido})
                    self.livre.set()
            except Exception as erro:  # noqa: BLE001
                print("SESSÃO: evento ignorado —", erro, flush=True)
        # o processo fechou
        if self.turno and not self.turno.entregue:
            self.turno.entregar({"texto": "", "erro": "A sessão do Claude fechou."})
        self.livre.set()

    # ------------------------------------------------------------------ uso
    def perguntar(self, texto, ao_evento=None, limite=150):
        """Manda uma fala e espera o resultado: {texto, erro, interrompido, cedo, marcas, ferramentas, lidas, aviso}."""
        with self.trava:
            agora = time.time()
            if self.vivo() and ((self.ultimo and agora - self.ultimo > self.esquecer_apos) or self.turnos >= self.max_turnos):
                self.reiniciar()   # parado há muito tempo ou conversa longa demais: começa limpa
            if not self.vivo():
                self.iniciar()
            esperou = time.time()
            self.livre.wait(timeout=20)   # o Claude ainda fechando a rodada anterior
            turno = Turno(ao_evento)
            turno.marcas["esperou_rodada_s"] = round(time.time() - esperou, 2)
            self.turno = turno
            self.livre.clear()
            self.turnos += 1
            self.ultimo = time.time()
            msg = {"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": texto}]}}
            try:
                self.proc.stdin.write(json.dumps(msg, ensure_ascii=False) + "\n")
                self.proc.stdin.flush()
            except (BrokenPipeError, OSError, AttributeError):
                self.parar()
                return {"texto": "", "erro": "Não consegui falar com o Claude.", "marcas": turno.marcas}
            try:
                r = turno.fila.get(timeout=limite)
            except queue.Empty:
                self.parar()
                r = {"texto": "", "erro": "A resposta demorou demais. Tente uma pergunta mais direta."}
            r.update(marcas=turno.marcas, ferramentas=turno.ferramentas, lidas=turno.lidas, aviso=turno.aviso)
            return r

    def interromper(self):
        """A barra de comando no meio do trabalho: o Claude para na hora; a conversa continua."""
        turno = self.turno
        if not self.vivo() or not turno or turno.entregue:
            return False
        turno.interrompido = True
        try:
            msg = {"type": "control_request", "request_id": uuid.uuid4().hex[:8], "request": {"subtype": "interrupt"}}
            self.proc.stdin.write(json.dumps(msg) + "\n")
            self.proc.stdin.flush()
        except (BrokenPipeError, OSError):
            pass
        turno.entregar({"texto": "", "interrompido": True})
        return True


class SessaoSimulada:
    """Sessão de mentira para testes e demonstração (SC_CONVERSA_SIMULADA=1): emite aviso, leituras e uma resposta
    que cita notas, sem Claude e sem custo. As notas citadas vêm do próprio texto da pergunta quando possível."""

    def __init__(self, notas=(), atraso=0.35):
        self.notas, self.atraso = list(notas), atraso
        self.turno = None
        self.turnos = 0
        self.custo_total = 0.0
        self._interrompido = False

    def vivo(self):
        return True

    def iniciar(self):
        pass

    def parar(self):
        pass

    def reiniciar(self):
        self.turnos = 0

    def ocupada(self):
        return bool(self.turno)

    def perguntar(self, texto, ao_evento=None, limite=150):
        self.turno, self._interrompido = object(), False
        self.turnos += 1
        t0 = time.time()
        marcas = {"envio": t0}
        emitir = ao_evento or (lambda ev: None)
        citadas = [n for n in self.notas if n.lower() in texto.lower()][:2] or self.notas[:1]
        emitir({"tipo": "aviso", "texto": "Um instante, senhor. Vou conferir nas notas."})
        time.sleep(self.atraso)
        for n in citadas:
            if self._interrompido:
                break
            emitir({"tipo": "lendo", "rotulo": f"Lendo {n}", "notas": [n]})
            time.sleep(self.atraso)
        if self._interrompido:
            self.turno = None
            return {"texto": "", "interrompido": True, "marcas": marcas, "ferramentas": [], "lidas": citadas, "aviso": None}
        resposta = ("Senhor, conferi " + (" e ".join(citadas) if citadas else "o vault") + ". Está tudo em ordem por aqui, "
                    "sem pendência urgente nessa frente.")
        if citadas:
            resposta += "\nNOTAS: " + " | ".join(citadas)
        marcas["entrega_s"] = round(time.time() - t0, 2)
        self.turno = None
        return {"texto": resposta, "cedo": True, "marcas": marcas, "ferramentas": [("Read", n) for n in citadas], "lidas": citadas,
                "aviso": "Um instante, senhor. Vou conferir nas notas."}

    def interromper(self):
        if not self.turno:
            return False
        self._interrompido = True
        return True


def registrar(registro, nome="conversa.jsonl"):
    """Log por pedido (tempos de cada etapa, ferramentas, custo), em .estado/, fora do git."""
    try:
        os.makedirs(PASTA_ESTADO, exist_ok=True)
        registro = dict(registro, quando=time.strftime("%Y-%m-%d %H:%M:%S"))
        with open(os.path.join(PASTA_ESTADO, nome), "a", encoding="utf-8") as f:
            f.write(json.dumps(registro, ensure_ascii=False, default=str) + "\n")
    except OSError:
        pass


# --------------------------------------------------------------------- ações por voz (linha ACAO: no fim da resposta)
RE_ACAO = re.compile(r"^\W*ACAO\W*:\s*([a-z_]+)\s*(\{.*\})?\s*$", re.I)


def separar_acao(texto):
    """Tira do texto a última linha `ACAO: tipo {json}` e devolve (texto_sem_a_linha, acao | None)."""
    linhas = (texto or "").rstrip().splitlines()
    acao = None
    while linhas:
        m = RE_ACAO.match(linhas[-1].strip())
        if not m:
            break
        linhas.pop()
        if acao is None:
            dados = {}
            if m.group(2):
                try:
                    dados = json.loads(m.group(2))
                except ValueError:
                    dados = {}
            acao = {"tipo": m.group(1).lower(), "dados": dados if isinstance(dados, dict) else {}}
    while linhas and not linhas[-1].strip():
        linhas.pop()
    return "\n".join(linhas), acao


AFIRMACOES = {"sim", "confirma", "confirmo", "confirmado", "pode", "manda", "isso", "ok", "okay", "fechado", "vai", "faz",
              "beleza", "claro", "positivo", "certo", "bora", "exato", "perfeito", "feito", "autorizado", "autorizo"}
NEGACOES = {"nao", "cancela", "cancelar", "deixa", "esquece", "para", "negativo", "melhor nao"}


def _palavras(texto):
    import unicodedata
    s = unicodedata.normalize("NFD", (texto or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9 ]", " ", re.sub(r"^(ok |ei |hey |oi )?(jarvis|jarbas|javis)[,.!]?\s*", "", s)).split()


def eh_confirmacao(texto):
    p = _palavras(texto)
    return 0 < len(p) <= 7 and p[0] in AFIRMACOES and not (set(p) & NEGACOES)


def eh_negacao(texto):
    p = _palavras(texto)
    return 0 < len(p) <= 7 and (p[0] in NEGACOES or " ".join(p[:2]) in NEGACOES)
