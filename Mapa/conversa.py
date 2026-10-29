"""Conversa por voz com o Segundo Cérebro.

A pergunta falada vai para uma sessão do Claude Code que fica aberta (sessao.py: stream-json, só leitura — Read, Grep,
Glob) e devolve uma resposta curta, para ser falada. Usa o login do Claude que já está neste Mac — não precisa de chave de
API. A resposta é falada com a voz do ElevenLabs configurada em ~/.config/segundo-cerebro/elevenlabs.env (a voz não muda:
decisão do usuário em 2026-10-28, qualidade acima de rapidez).

Junto com a pergunta vai o que o servidor já consegue buscar sozinho (notas prováveis pelo índice do mapa, painel Hoje);
o aviso que o Claude escreve antes de pesquisar ("Um instante, senhor…") é falado na hora (áudio em cache em voz/avisos/);
cada nota que ele lê é avisada à página (SSE) e pulsa no mapa; "bom dia" vira o resumo do dia; pedidos de ação (inbox,
tarefa, decisão, nota) viram uma proposta "Confirma, senhor?" e só rodam, por operacoes.py, depois do "confirma".
A persona fica em persona.md (editável).

Opções em ~/.config/segundo-cerebro/elevenlabs.env (todas opcionais):
  SC_IA_MODELO=sonnet                      modelo do Claude (sonnet, haiku, opus)
  SC_IA_ESFORCO=low                        raciocínio (low é mais rápido; medium/high pensam mais)
  SC_CLAUDE=/caminho/do/claude             se o Claude Code não for encontrado sozinho
  SC_FERRAMENTAS_EXTRA=mcp__x,mcp__y       conectores MCP permitidos na conversa (só consulta; hooks/trava.py barra o resto)
  SC_AQUECER=0                             não abrir a sessão do Claude ao iniciar o app
  SC_CONVERSA_SIMULADA=1                   sem Claude: respostas de mentira para testes e demonstração
  ELEVENLABS_MODELO_RESPOSTA=...           modelo de voz só para as respostas (padrão: ELEVENLABS_MODELO)
"""
import base64
import difflib
import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import unicodedata
import urllib.error
from datetime import datetime

import gerar_mapa
from gerar_mapa import nome_dono
import operacoes as op
import sessao as sess
from cofre import ErroCofre

AQUI = os.path.dirname(os.path.abspath(__file__))
ARQ_PERSONA = os.path.join(AQUI, "persona.md")   # editável; sem ele, vale PERSONA_PADRAO
PERSONA_PADRAO = """Você é o JARVIS do Segundo Cérebro de {nome}: a voz do mapa 3D do vault Obsidian em que você está \
(a pasta atual). {nome} fala com você por voz e a sua resposta será lida em voz alta.
Regras:
- Português do Brasil, tom do Jarvis: calmo, preciso, educado, levemente espirituoso. Vá direto ao ponto. Trate-o por \
"senhor" sem exagero (uma vez numa resposta curta).
- Resposta para ser FALADA: no máximo 3 frases curtas (até 60 palavras). Nada de markdown, listas, emojis, links, \
caminhos de arquivo ou nomes de pasta. Ao apresentar um projeto, cliente ou sistema, até 6 frases com fatos das notas.
- Escreva para o OUVIDO: frases curtas e conversadas; sem sites, siglas, versões, nomes de tecnologia, aspas ou parênteses. \
No máximo um número, por extenso.
- Se precisar ler ou procurar algo no vault, escreva PRIMEIRO uma frase curta de aviso (até dez palavras, sem resultado) e \
só depois use as ferramentas; pergunta simples, responda direto, sem aviso.
- Perguntas sobre coisas dele: consulte o vault antes (INDEX em 00 - CENTRAL/INDEX.md; abra só o necessário). Não invente. \
A fala é transcrita e erra nomes próprios: associe ao nome mais parecido da lista de nomes do vault.
- Você só lê. Quando ele pedir para FAZER algo (anotar na inbox, criar tarefa, marcar tarefa feita, registrar decisão, \
criar nota), não faça: diga em uma frase o que vai fazer, termine com "Confirma, senhor?" e acrescente uma última linha \
não falada: ACAO: tipo {"campo": "valor"} — tipos: inbox {"texto"}, tarefa {"titulo","alvo","prioridade"}, \
tarefa_feita {"nota","texto"}, decisao {"titulo","decisao","contexto","projeto"}, nota {"titulo","tipo","cliente"}.
- Se a resposta se apoiou em notas específicas, termine com uma última linha separada, exatamente assim:
NOTAS: Nome exato da nota | Outro nome
(até 5 notas, nome do arquivo sem .md). Essa linha não é falada. Sem notas, omita a linha."""


def persona_texto():
    """A persona do Jarvis: persona.md (editável pelo usuário) ou o texto padrão acima. {nome} vira o nome do dono."""
    try:
        with open(ARQ_PERSONA, encoding="utf-8") as f:
            t = f.read().strip()
        if len(t) > 200:
            return t.replace("{nome}", nome_dono())
    except OSError:
        pass
    return PERSONA_PADRAO.replace("{nome}", nome_dono())


PERSONA = PERSONA_PADRAO

FERRAMENTAS = "Read,Grep,Glob"
ESQUECER_APOS = 15 * 60   # parado por 15 min: a próxima pergunta abre uma conversa nova


def localizar_claude():
    cfg = gerar_mapa.ler_config_voz()
    for c in (os.environ.get("SC_CLAUDE"), cfg.get("SC_CLAUDE"), shutil.which("claude"),
              os.path.expanduser("~/.local/bin/claude"), os.path.expanduser("~/.claude/local/claude")):
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    # o Claude Code que vem com a extensão do VS Code / Cursor (a mais nova)
    achados = [p for d in ("~/.vscode/extensions", "~/.cursor/extensions")
               for p in glob.glob(os.path.expanduser(d) + "/anthropic.claude-code-*/resources/native-binary/claude")
               if os.access(p, os.X_OK)]

    def versao(p):
        m = re.search(r"claude-code-(\d+(?:\.\d+)*)", p)
        return tuple(int(x) for x in m.group(1).split(".")) if m else ()
    return max(achados, key=versao) if achados else None


def limpar_fala(texto):
    t = re.sub(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", lambda m: m.group(2) or m.group(1), texto or "")
    t = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", t)
    t = re.sub(r"(?m)^\s*(#+|[-*•]|\d+[.)])\s+", "", t)
    t = re.sub(r"[*_`#>]+", "", t)
    return re.sub(r"\s+", " ", t).strip()


def separar_notas(bruto, notas):
    linhas = (bruto or "").strip().splitlines()
    nomes = []
    while linhas and re.match(r"^\W*NOTAS\W*:", linhas[-1].strip(), re.I):
        nomes += re.split(r"\s*[|;]\s*", linhas.pop().split(":", 1)[1])
    while linhas and not linhas[-1].strip():
        linhas.pop()
    por_nome = {k.lower(): k for k in notas}
    ids = []
    for n in nomes:
        n = re.sub(r"\.md$", "", n.strip(" []*`\"'").split("/")[-1]).strip()
        k = por_nome.get(n.lower())
        if k and k not in ids:
            ids.append(k)
    return limpar_fala("\n".join(linhas)), ids[:5]


def _compacto(s):
    s = unicodedata.normalize("NFD", (s or "").lower()).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", s)


def nomes_vault(estado):
    """Sistemas, clientes e projetos — o vocabulário que a transcrição costuma errar."""
    dados, notas, _ = estado.atual()
    nomes = set()
    for c in dados["clusters"]:
        nomes.add(c["id"])
        nomes.update(p.strip() for p in re.split(r" · |, ", c["nome"]))
    for k, n in notas.items():
        if n.get("tipo") in ("projeto", "cliente"):
            nomes.update((k, k.split(" — ")[0]))
    return sorted(x for x in nomes if 3 <= len(x) <= 60)


def parecidos(texto, nomes):
    """Trechos da fala que parecem um nome do vault escrito diferente ("cliente xis" → Cliente X)."""
    palavras, achados = texto.split(), {}
    for nome in nomes:
        cn = _compacto(nome)
        if len(cn) < 4:
            continue
        for i in range(len(palavras)):
            for j in range(i + 1, min(i + 4, len(palavras)) + 1):
                trecho = " ".join(palavras[i:j]).strip(".,!?;:")
                ct = _compacto(trecho)
                if len(ct) < 4 or ct == cn:
                    continue
                r = difflib.SequenceMatcher(None, ct, cn).ratio()
                if r >= 0.8 and r > achados.get(nome, (0, ""))[0]:
                    achados[nome] = (r, trecho)
    melhores = sorted(achados.items(), key=lambda x: -x[1][0])[:6]
    return [f'"{t}" → {n}' for n, (_, t) in melhores]


def rodar_claude(claude, prompt, persona, pasta, modelo, esforco, timeout=150, rotulo="CONVERSA"):
    """Roda o Claude Code (`claude -p`) só com leitura (Read, Grep, Glob) na pasta do vault e devolve o texto."""
    # sem as variáveis de uma sessão do Claude Code em volta (testes rodando de dentro dele)
    env = {k: v for k, v in os.environ.items() if not k.startswith(("CLAUDECODE", "CLAUDE_CODE_"))}
    env["ENABLE_CLAUDEAI_MCP_SERVERS"] = "false"
    cmd = [claude, "-p", "--output-format", "json", "--model", modelo, "--effort", esforco, "--tools", FERRAMENTAS,
           "--allowedTools", FERRAMENTAS, "--strict-mcp-config", "--no-session-persistence",
           "--append-system-prompt", persona]
    try:
        r = subprocess.run(cmd, input=prompt, capture_output=True, text=True, cwd=pasta, env=env, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise ErroCofre("tempo", "A resposta demorou demais. Tente uma pergunta mais direta.", 504)
    try:
        saida = json.loads(r.stdout)
    except ValueError:
        print(rotulo, "falhou:", (r.stderr or r.stdout or "")[-800:], flush=True)
        raise ErroCofre("ia", "Não consegui falar com o Claude agora.", 502)
    if saida.get("is_error"):
        print(rotulo, "erro:", str(saida.get("result"))[:500], flush=True)
        raise ErroCofre("ia", "O Claude não respondeu: " + str(saida.get("result") or "")[:160], 502)
    return saida.get("result", "")


# ---------------------------------------------------------------- conversa por voz (sessão persistente, ver sessao.py)
SESSAO, TRAVA_SESSAO = None, threading.Lock()
PENDENTE = {"acao": None, "quando": 0.0}      # ação proposta pelo Jarvis à espera do "confirma"
PENDENTE_EXPIRA = 150                          # segundos; depois disso a proposta cai
PASTA_AVISOS = os.path.join(gerar_mapa.PASTA_VOZ, "avisos")
PARADAS = set(("o a os as de da do das dos e em no na nos nas um uma para pra por com sem que qual quais como quando onde "
               "quem meu minha meus minhas seu sua isso essa esse este esta aquele aquela jarvis senhor sobre tem tenho esta "
               "foi ser ter faz fazer pode poderia consegue me nos ele ela eles elas voce vc mais menos muito pouco ainda hoje "
               "ontem amanha agora entao tambem porque pois mesmo coisa coisas tudo nada algo alguma algum qualquer sistema "
               "nota notas projeto cliente status fala conta diz explica resume mostra abre lista").split())
RE_HOJE = re.compile(r"\b(hoje|pendenc\w*|urgent\w*|agenda|prioridades?|o que (eu )?(tenho|preciso|devo)|resumo do dia|"
                     r"briefing|bom dia|boa tarde|boa noite|novidades?|atrasad\w*)\b")
RE_BOM_DIA = re.compile(r"^(e ai |ei |ok |oi |ola )?(jarvis[,!. ]*)?(bom dia|boa tarde|boa noite)[!.,]?\s*(jarvis|senhor)?[!.]?$")
RE_RESUMO = re.compile(r"\b(resumo do (meu )?dia|briefing( do dia)?|o que (eu )?tenho (pra|para) hoje|como (esta|ta) (o )?meu dia|"
                       r"novidades( do dia)?|me atualiza|me poe a par|o que rolou)\b")


def _cfg():
    return gerar_mapa.ler_config_voz()


def _opcao(cfg, chave, padrao=""):
    return os.environ.get(chave) or cfg.get(chave) or padrao


def vault_real(estado):
    return os.path.realpath(estado.cofre.raiz) == os.path.realpath(gerar_mapa.VAULT)


def _log(estado, registro):
    """Log por pedido em .estado/conversa.jsonl, só no vault real (testes e cópias não sujam o log)."""
    if vault_real(estado):
        sess.registrar(registro)


def sessao_de(estado):
    """A sessão do Claude desta instância do servidor (criada na primeira pergunta ou no aquecimento)."""
    global SESSAO
    with TRAVA_SESSAO:
        if SESSAO is None:
            cfg = _cfg()
            if _opcao(cfg, "SC_CONVERSA_SIMULADA") == "1":
                nomes = sorted(n for n, v in estado.atual()[1].items() if v.get("tipo") in ("projeto", "cliente"))
                SESSAO = sess.SessaoSimulada(nomes)
            else:
                claude = localizar_claude()
                if not claude:
                    raise ErroCofre("indisponivel", "Não encontrei o Claude Code neste Mac.", 503)
                extras = [x.strip() for x in _opcao(cfg, "SC_FERRAMENTAS_EXTRA").split(",") if x.strip()]
                hook = f'"{sys.executable}" "{os.path.join(AQUI, "hooks", "trava.py")}"' if extras else None
                persona = persona_texto() + "\n\n## Nomes do vault (sistemas, clientes, projetos)\n" + ", ".join(nomes_vault(estado))
                SESSAO = sess.SessaoClaude(claude, estado.cofre.raiz, modelo=_opcao(cfg, "SC_IA_MODELO", "sonnet"),
                                           esforco=_opcao(cfg, "SC_IA_ESFORCO", "low"), persona=persona, extras=extras,
                                           hook=hook, esquecer_apos=ESQUECER_APOS)
        return SESSAO


def estado_conversa():
    s = SESSAO
    return {"sessao": bool(s and s.vivo()), "ocupada": bool(s and s.ocupada()), "turnos": getattr(s, "turnos", 0),
            "custo_usd": round(getattr(s, "custo_total", 0.0), 4), "acao_pendente": (PENDENTE["acao"] or {}).get("tipo")}


def nova_conversa():
    """O Claude esquece a conversa (tecla N ou "nova conversa")."""
    PENDENTE.update(acao=None)
    if SESSAO is not None:
        SESSAO.reiniciar()
    return {"ok": True}


def interromper():
    """Ele começou a falar no meio da resposta: o Claude para na hora."""
    return {"interrompeu": bool(SESSAO is not None and SESSAO.interromper())}


def aquecer(estado):
    """Ao abrir o app: sobe a sessão e manda uma mensagem vazia, para a primeira pergunta sair rápido (só no vault real)."""
    if not vault_real(estado) or _opcao(_cfg(), "SC_AQUECER") == "0":
        return
    try:
        s = sessao_de(estado)
        if isinstance(s, sess.SessaoClaude) and not s.vivo():
            r = s.perguntar("(Mensagem automática de abertura do app. Não use ferramentas. Responda só: Pronto.)", limite=90)
            print("SESSÃO aquecida:", (r.get("texto") or r.get("erro") or "")[:60], flush=True)
    except Exception as e:  # noqa: BLE001
        print("SESSÃO: não aqueceu —", e, flush=True)


# --------------------------------------------------------------- pré-busca: o que já dá para mandar junto com a pergunta
def _termos(texto):
    return [w for w in _sem_acento(re.sub(r"[^\w\s]", " ", texto or "")).split() if len(w) >= 4 and w not in PARADAS]


def relevantes(estado, texto, n=5):
    """As notas que mais batem com as palavras da pergunta (índice de texto do mapa), com um trecho cada."""
    termos = _termos(texto)
    if not termos:
        return []
    pont = []
    for doc in estado.busca():
        nome, corpo = _sem_acento(doc["id"]), _sem_acento(doc.get("t") or "")
        s, achou = 0, None
        for t in termos:
            if t in nome:
                s += 3
            k = corpo.find(t)
            if k >= 0:
                s += 1
                if achou is None:
                    achou = k
        if s >= 2 or (s and len(termos) == 1):
            trecho = ""
            if achou is not None:
                orig = doc.get("t") or ""
                i = max(0, min(achou, len(orig)) - 60)
                trecho = re.sub(r"\s+", " ", orig[i:i + 170]).strip()
            pont.append((s, doc["id"], doc.get("tipo") or "", trecho))
    pont.sort(key=lambda x: (-x[0], x[1]))
    return [f"- {nome} ({tipo}): …{trecho}…" if trecho else f"- {nome} ({tipo})" for _, nome, tipo, trecho in pont[:n]]


def resumo_hoje(estado, maximo=8):
    """Resumo em texto do painel Hoje (pendências, últimas notas, projetos ativos), para o Claude não precisar buscar."""
    try:
        dados, notas, _ = estado.atual()
        h = op.painel_hoje(estado.cofre, dados, notas)
    except Exception:  # noqa: BLE001
        return ""
    linhas = [f"Pendências abertas na Central: {h['total_pendencias']}"]
    for p in h["pendencias"][:maximo]:
        linhas.append(f"- [{p['secao'] or 'Outros'}] {p['texto'][:140]}")
    if h["recentes"]:
        linhas.append("Notas tocadas por último: " + "; ".join(f"{r['id']} ({r['data'][:10]})" for r in h["recentes"][:6]))
    if h["projetos_ativos"]:
        linhas.append(f"Projetos ativos ({len(h['projetos_ativos'])}): " + ", ".join(h["projetos_ativos"][:10]))
    return "\n".join(linhas)


def montar_prompt(estado, texto):
    nomes = nomes_vault(estado)
    partes = []
    dicas = parecidos(texto, nomes)
    if dicas:
        partes.append("Provável nome do vault nesta fala: " + "; ".join(dicas))
    rel = relevantes(estado, texto)
    if rel:
        partes.append("Notas provavelmente relevantes (índice do mapa; abra só o que precisar):\n" + "\n".join(rel))
    if RE_HOJE.search(_sem_acento(texto)):
        h = resumo_hoje(estado)
        if h:
            partes.append("Dados já buscados (painel Hoje, direto do vault):\n" + h)
    partes.append(f"{nome_dono()} disse (fala transcrita automaticamente, pode ter erros de reconhecimento): {texto}")
    return "\n\n".join(partes)


# --------------------------------------------------------------- aviso rápido falado (áudio em cache, mesma voz)
def audio_aviso(texto):
    """Áudio do aviso ("Um instante, senhor…") na voz do Jarvis, guardado em voz/avisos/ (os avisos se repetem)."""
    texto = limpar_fala(texto)[:200]
    nome = hashlib.sha1(texto.encode("utf-8")).hexdigest()[:16]
    os.makedirs(PASTA_AVISOS, exist_ok=True)
    meta, mp3 = os.path.join(PASTA_AVISOS, nome + ".json"), os.path.join(PASTA_AVISOS, nome + ".mp3")
    if os.path.exists(meta) and os.path.exists(mp3):
        with open(meta, encoding="utf-8") as f:
            return json.load(f)
    r = falar_tempos(texto)
    if not r.get("audio_base64"):
        raise ErroCofre("voz", "Sem áudio para o aviso.", 502)
    with open(mp3, "wb") as f:
        f.write(base64.b64decode(r["audio_base64"]))
    d = {"audio": f"voz/avisos/{nome}.mp3", "frases": r["frases"], "duracao": r["duracao"]}
    with open(meta, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False)
    # guarda os 80 avisos mais recentes
    todos = sorted((os.path.getmtime(os.path.join(PASTA_AVISOS, a)), a) for a in os.listdir(PASTA_AVISOS) if a.endswith(".json"))
    for _, a in todos[:-80]:
        for ext in (".json", ".mp3"):
            try:
                os.remove(os.path.join(PASTA_AVISOS, a[:-5] + ext))
            except OSError:
                pass
    return d


def _emitir_aviso(estado, texto, emitir):
    ev = {"tipo": "aviso", "texto": texto}
    if vault_real(estado):
        try:
            ev.update(audio_aviso(texto))
        except Exception as e:  # noqa: BLE001
            print("AVISO: voz indisponível —", e, flush=True)
    emitir(ev)


# --------------------------------------------------------------- ações por voz (depois do "confirma")
def executar_acao(estado, acao):
    """Executa a ação proposta pelo Jarvis pelas mesmas funções da interface (operacoes.py). Devolve (frase, resultado)."""
    cofre, tipo, d = estado.cofre, acao.get("tipo"), acao.get("dados") or {}
    txt = lambda k: re.sub(r"\s+", " ", str(d.get(k) or "")).strip()  # noqa: E731
    if tipo == "inbox":
        r = op.capturar(cofre, {"texto": txt("texto") or txt("titulo")})
        return "Feito, senhor. Anotei na Inbox.", r
    if tipo == "tarefa":
        r = op.criar_tarefa(cofre, {"titulo": txt("titulo"), "alvo": txt("alvo") or None, "prioridade": txt("prioridade") or None,
                                    "descricao": txt("descricao") or None})
        onde = "nas Pendências" if r.get("id") == op.CENTRAL_PENDENCIAS else f"em {r.get('id')}"
        return f"Feito, senhor. Tarefa anotada {onde}.", r
    if tipo == "tarefa_feita":
        nota = cofre.ler(txt("nota"))
        alvo = _sem_acento(txt("texto"))
        abertas = [t for t in nota["tarefas"] if not t["feito"]]
        if not abertas:
            raise ErroCofre("nao_encontrado", "Essa nota não tem tarefa aberta.", 404)
        melhor = max(abertas, key=lambda t: difflib.SequenceMatcher(None, _sem_acento(t["texto"]), alvo).ratio())
        if difflib.SequenceMatcher(None, _sem_acento(melhor["texto"]), alvo).ratio() < .55:
            raise ErroCofre("nao_encontrado", "Não achei essa tarefa aberta na nota.", 404)
        r = op.alternar_tarefa(cofre, {"id": nota["id"], "linha": melhor["linha"], "bruto": melhor["bruto"], "feito": True})
        return "Feito, senhor. Tarefa marcada como concluída.", r
    if tipo == "decisao":
        p = {"titulo": txt("titulo"), "decisao": txt("decisao") or txt("titulo"), "contexto": txt("contexto") or None,
             "fonte": f"Dito por voz ao Jarvis em {datetime.now():%Y-%m-%d}", "evidencia": "FATO (dito por voz ao Jarvis)"}
        ref = txt("projeto") or txt("cliente")
        if ref and op._existente(cofre, ref):
            tipo_ref = (estado.atual()[1].get(ref) or {}).get("tipo")
            p["clientes" if tipo_ref == "cliente" else "projetos"] = [ref]
        r = op.criar_decisao(cofre, p)
        return "Feito, senhor. Decisão registrada e ligada aos hubs.", r
    if tipo == "nota":
        r = op.criar_nota(cofre, {"tipo": txt("tipo") or "conhecimento", "titulo": txt("titulo"), "cliente": txt("cliente") or None})
        return "Feito, senhor. Nota criada.", r
    raise ErroCofre("validacao", "Não sei fazer essa ação por voz.", 422)


def eh_resumo_do_dia(texto):
    t = _sem_acento(texto).strip(" .!?")
    return bool(RE_BOM_DIA.match(t) or RE_RESUMO.search(t))


def resumo_do_dia(estado, texto, emitir, registro):
    """"Bom dia" ou "resumo do dia": briefing falado com o painel Hoje, escrito pelo Claude e guardado por dia."""
    hoje = datetime.now().strftime("%Y-%m-%d")
    arq = os.path.join(sess.PASTA_ESTADO, f"resumo-{hoje}.json")
    real = vault_real(estado)   # cópias e testes não leem nem gravam o cache do dia
    fresco = bool(re.search(r"\b(de novo|atualiza|novo|fresco|outra vez)\b", _sem_acento(texto)))
    if real and not fresco and os.path.exists(arq):
        try:
            with open(arq, encoding="utf-8") as f:
                d = json.load(f)
            return {"resposta": d["texto"], "notas": d.get("notas") or [], "resumo": True, "cache": True}
        except (OSError, ValueError, KeyError):
            pass
    threading.Thread(target=_emitir_aviso, args=(estado, "Um instante, senhor. Montando o resumo do dia.", emitir), daemon=True).start()
    agora = datetime.now()
    prompt = (f"[resumo do dia] Agora: {DIAS[agora.weekday()]}, {agora.day} de {MESES[agora.month - 1]}, "
              f"{agora.hour:02d}:{agora.minute:02d}.\n{resumo_hoje(estado, maximo=10)}\n\n{nome_dono()} disse: {texto}\n"
              "Faça o briefing do dia só com esses dados (quatro a seis frases), cumprimentando conforme a hora. "
              "Termine com a linha NOTAS citando até três notas que valem abrir (nomes exatos da lista), se houver.")
    r = sessao_de(estado).perguntar(prompt, limite=120)
    if r.get("interrompido"):
        raise ErroCofre("interrompido", "Interrompido.", 409)
    if r.get("erro") or not (r.get("texto") or "").strip():
        raise ErroCofre("ia", r.get("erro") or "O Claude devolveu uma resposta vazia.", 502)
    resposta, ids = separar_notas(sess.separar_acao(r["texto"])[0], estado.atual()[1])
    if real:
        try:
            os.makedirs(sess.PASTA_ESTADO, exist_ok=True)
            with open(arq, "w", encoding="utf-8") as f:
                json.dump({"texto": resposta, "notas": ids, "quando": int(time.time())}, f, ensure_ascii=False)
        except OSError:
            pass
    _log(estado, dict(registro, tipo="resumo", resposta=resposta, marcas=r.get("marcas")))
    return {"resposta": resposta, "notas": ids, "resumo": True}


def perguntar(estado, texto, eventos=None, pedido=None):
    """Pergunta livre por voz. Devolve {resposta, notas, acao?, escrita?, resumo?, segundos}. Os eventos do caminho
    (aviso falado, notas sendo lidas) saem por `eventos` (SSE) com o `pedido` da página."""
    texto = re.sub(r"\s+", " ", texto or "").strip()[:600]
    if not texto:
        raise ErroCofre("validacao", "Não ouvi a pergunta.", 400)

    def emitir(ev):
        if eventos is not None:
            eventos.emitir(dict(ev, pedido=pedido))
    inicio = time.time()
    registro = {"evento": "pergunta", "texto": texto, "pedido": pedido}
    # 1) ele está respondendo a uma ação proposta ("Confirma, senhor?")
    acao = PENDENTE["acao"] if PENDENTE["acao"] and time.time() - PENDENTE["quando"] < PENDENTE_EXPIRA else None
    if acao and sess.eh_confirmacao(texto):
        PENDENTE.update(acao=None)
        try:
            frase, r = executar_acao(estado, acao)
        except ErroCofre as e:
            frase, r = f"Não consegui, senhor. {e.mensagem}", None
        _log(estado, dict(registro, tipo="acao", acao=acao, ok=r is not None, total_s=round(time.time() - inicio, 2)))
        print(f"AÇÃO {acao.get('tipo')} → {'ok' if r else 'falhou'}: {frase}", flush=True)
        notas = [r["id"]] if r and r.get("id") in estado.atual()[1] else []
        return {"resposta": frase, "notas": notas, "escrita": r, "acao": acao.get("tipo"), "segundos": round(time.time() - inicio, 1)}
    if acao and sess.eh_negacao(texto):
        PENDENTE.update(acao=None)
        return {"resposta": "Cancelado, senhor.", "notas": [], "segundos": 0}
    PENDENTE.update(acao=None)
    # 2) "bom dia" / "resumo do dia"
    if eh_resumo_do_dia(texto):
        return resumo_do_dia(estado, texto, emitir, registro)
    # 3) a pergunta, com o que já dá para mandar junto
    prompt = montar_prompt(estado, texto)
    s = sessao_de(estado)

    def ao_evento(ev):
        if ev.get("tipo") == "aviso" and ev.get("texto"):
            threading.Thread(target=_emitir_aviso, args=(estado, ev["texto"], emitir), daemon=True).start()
        elif ev.get("tipo") == "lendo":
            emitir(ev)
    r = s.perguntar(prompt, ao_evento=ao_evento)
    registro.update(marcas=r.get("marcas"), ferramentas=r.get("ferramentas"), lidas=r.get("lidas"), aviso=r.get("aviso"),
                    total_s=round(time.time() - inicio, 2))
    if r.get("interrompido"):
        _log(estado, dict(registro, interrompido=True))
        raise ErroCofre("interrompido", "Interrompido.", 409)
    if r.get("erro") or not (r.get("texto") or "").strip():
        _log(estado, dict(registro, erro=r.get("erro") or "vazia"))
        raise ErroCofre("ia", r.get("erro") or "O Claude devolveu uma resposta vazia.", 502)
    sem_acao, acao = sess.separar_acao(r["texto"])
    resposta, ids = separar_notas(sem_acao, estado.atual()[1])
    if not resposta:
        raise ErroCofre("ia", "O Claude devolveu uma resposta vazia.", 502)
    if acao:
        PENDENTE.update(acao=acao, quando=time.time())
        if "confirma" not in _sem_acento(resposta[-70:]):
            resposta = resposta.rstrip(" .!?") + ". Confirma, senhor?"
    registro.update(resposta=resposta, notas=ids, acao=acao)
    _log(estado, registro)
    print(f"CONVERSA {registro['total_s']} s · {len(resposta)} car. · notas {len(ids)} · ferramentas {len(r.get('ferramentas') or [])}"
          + (f" · ação {acao['tipo']}" if acao else "") + (" · cedo" if r.get("cedo") else ""), flush=True)
    return {"resposta": resposta, "notas": ids, "acao": acao["tipo"] if acao else None, "lidas": r.get("lidas") or [],
            "segundos": round(time.time() - inicio, 1)}

def falar(texto):
    """Áudio (mp3) da resposta na voz do ElevenLabs. Não guarda em cache: cada resposta é única."""
    texto = limpar_fala(texto)[:900]
    cfg = gerar_mapa.ler_config_voz()
    chave, voz = cfg.get("ELEVENLABS_API_KEY", ""), cfg.get("ELEVENLABS_VOZ", "")
    modelo = cfg.get("ELEVENLABS_MODELO_RESPOSTA") or cfg.get("ELEVENLABS_MODELO") or "eleven_multilingual_v2"
    if not texto or not chave or not voz:
        raise ErroCofre("indisponivel", "Voz do ElevenLabs não configurada.", 503)
    corpo = {"text": texto, "model_id": modelo,
             "voice_settings": {"stability": 0.5, "similarity_boost": 0.8, "style": 0.15, "use_speaker_boost": True}}
    try:
        voz_id, _ = gerar_mapa._resolver_voz(chave, voz)
        return gerar_mapa._api(f"{gerar_mapa.API_VOZ}/text-to-speech/{voz_id}?output_format=mp3_44100_128",
                               chave, corpo, "audio/mpeg")
    except urllib.error.HTTPError as e:
        raise ErroCofre("voz", "ElevenLabs: " + gerar_mapa._erro_api(e), 502)
    except Exception as e:  # noqa: BLE001
        raise ErroCofre("voz", f"ElevenLabs indisponível: {e}", 502)


def _frases_com_tempo(chars, ini, fim):
    """Agrupa os caracteres alinhados pelo ElevenLabs em frases: [{t, fim, texto}] (segundos)."""
    frases, atual, t0, t1 = [], [], None, None

    def fechar():
        nonlocal atual, t0, t1
        texto = "".join(atual).strip()
        if texto:
            frases.append({"t": round(t0 or 0.0, 3), "fim": round(t1 or (t0 or 0.0), 3), "texto": texto})
        atual, t0, t1 = [], None, None
    n = min(len(chars), len(ini), len(fim))
    for i in range(n):
        c = chars[i]
        if t0 is None and not c.isspace():
            t0 = ini[i]
        atual.append(c)
        t1 = fim[i]
        proximo = chars[i + 1] if i + 1 < n else " "
        fim_frase = c in ".!?…;" and proximo.isspace()
        longa = c == "," and proximo.isspace() and len(atual) >= 110
        if fim_frase or longa:
            fechar()
    fechar()
    return frases


def falar_tempos(texto):
    """Áudio (base64) + tempos por frase, para a legenda sincronizada do Jarvis (endpoint with-timestamps)."""
    texto = limpar_fala(texto)[:900]
    cfg = gerar_mapa.ler_config_voz()
    chave, voz = cfg.get("ELEVENLABS_API_KEY", ""), cfg.get("ELEVENLABS_VOZ", "")
    modelo = cfg.get("ELEVENLABS_MODELO_RESPOSTA") or cfg.get("ELEVENLABS_MODELO") or "eleven_multilingual_v2"
    if not texto or not chave or not voz:
        raise ErroCofre("indisponivel", "Voz do ElevenLabs não configurada.", 503)
    corpo = {"text": texto, "model_id": modelo,
             "voice_settings": {"stability": 0.5, "similarity_boost": 0.8, "style": 0.15, "use_speaker_boost": True}}
    try:
        voz_id, _ = gerar_mapa._resolver_voz(chave, voz)
        bruto = gerar_mapa._api(f"{gerar_mapa.API_VOZ}/text-to-speech/{voz_id}/with-timestamps?output_format=mp3_44100_128",
                                chave, corpo, "application/json")
        d = json.loads(bruto.decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise ErroCofre("voz", "ElevenLabs: " + gerar_mapa._erro_api(e), 502)
    except Exception as e:  # noqa: BLE001
        raise ErroCofre("voz", f"ElevenLabs indisponível: {e}", 502)
    al = d.get("alignment") or d.get("normalized_alignment") or {}
    fim = al.get("character_end_times_seconds") or []
    frases = _frases_com_tempo(al.get("characters") or [], al.get("character_start_times_seconds") or [], fim)
    return {"audio_base64": d.get("audio_base64", ""), "texto": texto, "frases": frases,
            "duracao": round(fim[-1], 3) if fim else None}


# ---------------------------------------------------------------- boas-vindas ao abrir o app
PERSONA_SAUDACAO = """Você é o JARVIS do Segundo Cérebro de {nome} — a voz do mapa 3D do vault dessa pessoa. {nome} acabou \
de abrir o sistema e você vai cumprimentá-la. A fala será lida em voz alta.
Regras:
- Uma ou duas frases, entre 12 e 32 palavras (no máximo 170 caracteres). Português do Brasil.
- Tom do Jarvis: calmo, preciso, educado, levemente espirituoso; trate-o por "senhor". Escreva para o OUVIDO, \
como quem fala com ele, nunca sobre ele.
- Use o contexto abaixo para a saudação soar pessoal, como um assistente que acompanha a rotina dele: comente UMA \
coisa concreta (a hora tardia ou cedo, o fim de semana, o que ele estava fazendo na última sessão, algo pendente, \
quanto tempo faz) — sem listar tudo e sem parecer relatório.
- Varie: não repita as saudações já usadas nem a mesma estrutura delas.
- Nada de markdown, emojis, aspas, parênteses, siglas, nomes de tecnologia, sites, caminhos ou nomes de pasta. \
Números só por extenso, e no máximo um.
- Não leia arquivos: tudo o que precisa está no contexto. Responda só com a fala."""

MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro",
         "novembro", "dezembro"]
DIAS = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo"]
PASTA_SAUDACOES = os.path.join(gerar_mapa.PASTA_VOZ, "saudacoes")
ARQ_SAUDACOES = os.path.join(PASTA_SAUDACOES, "saudacoes.json")
TRAVA_SAUDACAO = threading.Lock()
# reserva quando o Claude não responde: variações por período, com o mesmo tom
SAUDACOES_RESERVA = {
    "madrugada": ["Boa madrugada, senhor. A essa hora só nós dois acordados. Sistemas prontos.",
                  "Madrugada adentro, senhor. Estou aqui, com tudo carregado."],
    "manhã": ["Bom dia, senhor. Sistemas online e o mapa inteiro à sua disposição.",
              "Bom dia. Começando cedo hoje, senhor. O Segundo Cérebro está pronto."],
    "tarde": ["Boa tarde, senhor. Tudo em ordem por aqui; o mapa está atualizado.",
              "Boa tarde. Sistemas prontos, senhor. Por onde começamos?"],
    "noite": ["Boa noite, senhor. Trabalhando até tarde, como sempre. Estou à disposição.",
              "Boa noite. O dia rende mais a esta hora, não é, senhor? Tudo carregado."],
}


def _periodo(h):
    return "madrugada" if h < 5 else "manhã" if h < 12 else "tarde" if h < 18 else "noite"


def _sem_acento(t):
    return "".join(c for c in unicodedata.normalize("NFD", t or "") if unicodedata.category(c) != "Mn").lower()


def _ler_saudacoes():
    try:
        with open(ARQ_SAUDACOES, encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return {}


def _gravar_saudacoes(dados):
    os.makedirs(PASTA_SAUDACOES, exist_ok=True)
    with open(ARQ_SAUDACOES, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=1)


def _ha_quanto(data_txt, agora):
    try:
        d = datetime.strptime(data_txt[:16], "%Y-%m-%d %H:%M")
    except ValueError:
        return ""
    seg = (agora - d).total_seconds()
    if seg < 3600:
        return "há menos de uma hora"
    if seg < 86400:
        return f"há {int(seg // 3600)} horas"
    dias = int(seg // 86400)
    return "ontem" if dias == 1 else f"há {dias} dias"


def _contexto_saudacao(estado, agora, cache):
    cofre = estado.cofre
    linhas = [f"Agora: {DIAS[agora.weekday()]}, {agora.day} de {MESES[agora.month - 1]}, "
              f"{agora.hour:02d}:{agora.minute:02d} ({_periodo(agora.hour)})"]
    try:
        commits = cofre.log_git()
        if commits:
            c = commits[0]
            linhas.append(f"Última sessão registrada: {c['msg']} — em {c['data']} ({_ha_quanto(c['data'], agora)})")
            hoje = agora.strftime("%Y-%m-%d")
            n_hoje = sum(1 for x in commits if x["data"].startswith(hoje))
            linhas.append(f"Sessões registradas hoje: {n_hoje}")
    except Exception:  # noqa: BLE001
        pass
    try:
        nota = cofre.ler("Pendências")
        urg = [t for t in nota["tarefas"] if not t["feito"] and ("urgente" in _sem_acento(t["secao"]) or "🔴" in t["secao"])]
        linhas.append(f"Pendências urgentes abertas: {len(urg)}" + (f" (uma delas: {urg[0]['texto'][:100]})" if urg else ""))
    except Exception:  # noqa: BLE001
        pass
    try:
        dados, _, _ = estado.atual()
        ativos = [n for n in dados["nos"] if n["tipo"] == "projeto" and n["status"] == "ativo" and not n["arquivo"]]
        ativos.sort(key=lambda n: n.get("atualizado") or "", reverse=True)
        linhas.append(f"Projetos ativos: {len(ativos)}" + (f"; o mais recente: {ativos[0]['id']}" if ativos else ""))
    except Exception:  # noqa: BLE001
        pass
    usadas = [v["texto"] for v in list(cache.values())[-6:] if v.get("texto")]
    if usadas:
        linhas.append("Saudações já usadas (não repita): " + " | ".join(usadas))
    return "\n".join(linhas)


def _escrever_saudacao(estado, agora, cache):
    claude = localizar_claude()
    if not claude:
        raise ErroCofre("indisponivel", "Claude Code não encontrado.", 503)
    cfg = gerar_mapa.ler_config_voz()
    modelo = cfg.get("SC_SAUDACAO_MODELO") or cfg.get("SC_IA_MODELO") or "sonnet"
    bruto = rodar_claude(claude, _contexto_saudacao(estado, agora, cache), PERSONA_SAUDACAO.replace("{nome}", nome_dono()),
                         estado.cofre.raiz, modelo,
                         "low", timeout=70, rotulo="SAUDAÇÃO")
    texto = limpar_fala(bruto)
    if len(texto) < 15:
        raise ErroCofre("ia", "Saudação vazia.", 502)
    if len(texto) > 220:
        corte = max(texto.rfind(". ", 0, 220), texto.rfind("! ", 0, 220), texto.rfind("? ", 0, 220))
        texto = texto[:corte + 1] if corte > 60 else texto[:220]
    return texto


def _saudacao_reserva(agora, cache):
    opcoes = SAUDACOES_RESERVA[_periodo(agora.hour)]
    usadas = {v.get("texto") for v in cache.values()}
    livres = [t for t in opcoes if t not in usadas] or opcoes
    return livres[int(time.time()) % len(livres)]


def boas_vindas(estado):
    """Saudação de abertura: escrita pelo Claude com o contexto do momento e falada na voz do Jarvis.
    Uma por período do dia (cache em voz/saudacoes/). Em cópias do vault (testes) nada é gerado nem gasto."""
    agora = datetime.now()
    chave = f"{agora:%Y-%m-%d}/{_periodo(agora.hour)}"
    real = os.path.realpath(estado.cofre.raiz) == os.path.realpath(gerar_mapa.VAULT)
    with TRAVA_SAUDACAO:
        cache = _ler_saudacoes()
        item = cache.get(chave)
        if item and (not item.get("audio") or os.path.exists(os.path.join(gerar_mapa.PASTA_VOZ, item["audio"][len("voz/"):]))):
            return dict(item, chave=chave, origem="cache")
        texto, origem = None, "reserva"
        if real:
            try:
                texto, origem = _escrever_saudacao(estado, agora, cache), "claude"
            except Exception as e:  # noqa: BLE001
                print("SAUDAÇÃO: Claude não respondeu —", e, flush=True)
        if not texto:
            texto = _saudacao_reserva(agora, cache)
        item = {"texto": texto, "audio": None, "frases": None, "duracao": None, "quando": int(time.time())}
        if real:
            try:
                r = falar_tempos(texto)
                if r.get("audio_base64"):
                    nome = hashlib.sha1(r["texto"].encode("utf-8")).hexdigest()[:16] + ".mp3"
                    os.makedirs(PASTA_SAUDACOES, exist_ok=True)
                    with open(os.path.join(PASTA_SAUDACOES, nome), "wb") as f:
                        f.write(base64.b64decode(r["audio_base64"]))
                    item.update(texto=r["texto"], audio=f"voz/saudacoes/{nome}", frases=r["frases"], duracao=r["duracao"])
            except Exception as e:  # noqa: BLE001
                print("SAUDAÇÃO: voz indisponível —", e, flush=True)
            cache[chave] = item
            # guarda as últimas 40; apaga os áudios que saíram
            chaves = sorted(cache, key=lambda k: cache[k].get("quando", 0))
            for k in chaves[:-40]:
                a = cache.pop(k).get("audio")
                if a:
                    try:
                        os.remove(os.path.join(gerar_mapa.PASTA_VOZ, a[len("voz/"):]))
                    except OSError:
                        pass
            _gravar_saudacoes(cache)
        print(f"SAUDAÇÃO ({origem}): {texto}", flush=True)
        return dict(item, chave=chave, origem=origem)
