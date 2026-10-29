#!/usr/bin/env python3
"""Servidor local do Segundo Cérebro: serve o holomapa com os dados atuais do vault e a API de leitura/escrita.

Uso:  python3 servidor.py [--porta 47321] [--abrir]
      (o app "Segundo Cérebro" inicia este servidor sozinho; ao fechar o app, ele para)
Só escuta em 127.0.0.1 e toda chamada à API exige o token embutido na página — outro site aberto
no navegador não consegue ler nem alterar o vault.
"""
import argparse
import json
import os
import re
import secrets
import subprocess
import sys
import threading
import time
import traceback
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import gerar_mapa  # noqa: E402
import conversa  # noqa: E402
import operacoes as op  # noqa: E402
import roteiro  # noqa: E402
import sessao  # noqa: E402
from cofre import Cofre, ErroCofre  # noqa: E402

VERSAO = "2.0"
MODELO = os.path.join(AQUI, "mapa3d.template.html")
CDN_THREE = "https://cdn.jsdelivr.net/npm/three@0.160.0/"
VENDOR = os.path.join(AQUI, "vendor")
ESSENCIAIS = ["three/build/three.module.js", "three/examples/jsm/controls/OrbitControls.js",
              "three/examples/jsm/postprocessing/EffectComposer.js", "three/examples/jsm/postprocessing/UnrealBloomPass.js",
              "three/examples/jsm/renderers/CSS2DRenderer.js"]
TIPOS_ESTATICOS = {".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2",
                   ".mp3": "audio/mpeg", ".png": "image/png"}


class Estado:
    """Dados do mapa e índices, recalculados só quando algum .md do vault muda."""

    def __init__(self, cofre, token):
        self.cofre, self.token = cofre, token
        self.trava = threading.Lock()
        self.assin = self.dados = self.notas = self._busca = self._back = None

    def atual(self):
        with self.trava:
            assin = self.cofre.assinatura()
            if assin != self.assin:
                dados, notas, _ = gerar_mapa.construir_dados(self.cofre.raiz, rede_voz=False)
                self.assin, self.dados, self.notas, self._busca, self._back = assin, dados, notas, None, None
            return self.dados, self.notas, self.assin

    def busca(self):
        _, notas, _ = self.atual()
        with self.trava:
            if self._busca is None:
                self._busca = op.indice_busca(self.cofre, notas)
            return self._busca

    def backlinks(self):
        self.atual()
        with self.trava:
            if self._back is None:
                self._back = op.backlinks(self.cofre)
            return self._back


def vendor_ok():
    return all(os.path.exists(os.path.join(VENDOR, p)) for p in ESSENCIAIS)


def pagina(estado):
    dados, notas, assin = estado.atual()
    config = {"api": "/api", "token": estado.token, "assinatura": assin, "escrita": True, "versao": VERSAO,
              "vault": estado.cofre.raiz, "local3d": vendor_ok()}
    html = gerar_mapa.montar_html(MODELO, dados, config)
    if vendor_ok():
        html = html.replace(CDN_THREE, "/vendor/three/")
    if os.path.exists(os.path.join(VENDOR, "fontes", "fontes.css")):
        html = re.sub(r'https://fonts\.googleapis\.com/css2\?[^"]+', "/vendor/fontes/fontes.css", html)
        html = re.sub(r'<link rel="preconnect"[^>]+>\n?', "", html)
    return html


class Handler(BaseHTTPRequestHandler):
    server_version = "SegundoCerebro/" + VERSAO
    protocol_version = "HTTP/1.1"

    def log_message(self, formato, *args):  # silencioso; erros e escritas vão para o stdout
        pass

    # ------------------------------------------------ respostas
    def _enviar(self, status, corpo, tipo):
        dados = corpo if isinstance(corpo, bytes) else corpo.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(dados)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(dados)

    def _json(self, status, obj):
        self._enviar(status, json.dumps(obj, ensure_ascii=False), "application/json; charset=utf-8")

    def _erro(self, e):
        if isinstance(e, ErroCofre):
            corpo = {"erro": e.mensagem, "codigo": e.codigo}
            corpo.update(e.extra)
            return self._json(e.status, corpo)
        traceback.print_exc()
        return self._json(500, {"erro": f"Erro interno do servidor: {e}", "codigo": "interno"})

    # ------------------------------------------------ segurança
    def _autorizado(self, api):
        porta = self.server.server_address[1]
        locais = {f"127.0.0.1:{porta}", f"localhost:{porta}"}
        if self.headers.get("Host", "") not in locais:
            return False
        origem = self.headers.get("Origin")
        if origem and origem not in {"http://" + h for h in locais}:
            return False
        if api and not secrets.compare_digest(self.headers.get("X-SC-Token", ""), self.server.estado.token):
            return False
        return True

    def _corpo(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 4 * 1024 * 1024:
            raise ErroCofre("validacao", "Conteúdo grande demais.", 413)
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            raise ErroCofre("validacao", "Envie JSON.", 415)
        try:
            dados = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
        except ValueError:
            raise ErroCofre("validacao", "JSON inválido.", 400)
        if not isinstance(dados, dict):
            raise ErroCofre("validacao", "JSON inválido.", 400)
        return dados

    # ------------------------------------------------ rotas
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        rota, q = url.path, {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items()}
        api = rota.startswith("/api/")
        if not self._autorizado(api):
            return self._json(403, {"erro": "Acesso negado.", "codigo": "permissao"})
        estado = self.server.estado
        try:
            if rota in ("/", "/index.html"):
                return self._enviar(200, pagina(estado), "text/html; charset=utf-8")
            if urllib.parse.unquote(rota).endswith("(2D).html"):
                modelo2d = os.path.join(AQUI, "mapa2d.template.html")
                return self._enviar(200, gerar_mapa.montar_html(modelo2d, estado.atual()[0]), "text/html; charset=utf-8")
            if rota == "/favicon.ico":
                return self._enviar(204, b"", "image/x-icon")
            if rota.startswith(("/voz/", "/vendor/")):
                return self._estatico(rota)
            if not api:
                return self._json(404, {"erro": "Não encontrado.", "codigo": "nao_encontrado"})
            nome = rota[5:]
            cofre = estado.cofre
            if nome == "saude":
                dados, _, assin = estado.atual()
                return self._json(200, {"ok": True, "assinatura": assin, "gerado": dados["gerado"], "versao": VERSAO,
                                        "conversa": conversa.estado_conversa(), "telas": self.server.eventos.quantos()})
            if nome == "eventos":        # Server-Sent Events: aviso falado, notas sendo lidas (conversa.perguntar → sessao.Eventos)
                return self._eventos()
            if nome == "conversa/estado":
                return self._json(200, conversa.estado_conversa())
            if nome == "dados":
                dados, _, assin = estado.atual()
                return self._json(200, {"assinatura": assin, "dados": dados})
            if nome == "indice":
                return self._json(200, {"assinatura": estado.atual()[2], "notas": estado.busca()})
            if nome == "nota":
                nota = cofre.ler(q.get("id", ""))
                _, notas, _ = estado.atual()
                n = notas.get(nota["id"])
                nota.update(backlinks=estado.backlinks().get(nota["id"].lower(), []),
                            tipo=n["tipo"] if n else ("inbox" if nota["rel"].startswith("80 ") else "central"),
                            cluster=n["cluster"] if n else None)
                return self._json(200, nota)
            if nome == "boasvindas":   # saudação de abertura na voz do Jarvis (conversa.boas_vindas)
                return self._json(200, conversa.boas_vindas(estado))
            if nome == "hoje":      # painel "Hoje": pendências urgentes e últimas notas (git)
                dados, notas, _ = estado.atual()
                return self._json(200, op.painel_hoje(cofre, dados, notas))
            if nome == "roteiro":   # falas do modo apresentação escritas pelo Claude (ver roteiro.py)
                return self._json(200, {"itens": roteiro.publico()})
            if nome == "modelo":
                return self._json(200, {"corpo": op.modelo_corpo(cofre, q.get("tipo", ""), q.get("titulo", ""))})
            if nome == "sistema":
                dados, notas, _ = estado.atual()
                return self._json(200, op.agregado_sistema(cofre, dados, notas, q.get("id", "")))
            if nome == "processo":
                return self._json(200, op.processo(cofre, q.get("id", "")))
            if nome == "historico":
                return self._json(200, {"versoes": cofre.historico(cofre.rel_de(q.get("id", "")))})
            if nome == "versao":
                texto = cofre.versao(cofre.rel_de(q.get("id", "")), q.get("commit", ""))
                return self._json(200 if texto else 404, {"texto": texto})
            return self._json(404, {"erro": "Rota desconhecida.", "codigo": "nao_encontrado"})
        except Exception as e:  # noqa: BLE001
            return self._erro(e)

    def _eventos(self):
        """Fluxo SSE (a página lê com fetch + ReadableStream, porque EventSource não manda o token)."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        q = self.server.eventos.assinar()
        try:
            self.wfile.write(b": pronto\n\n")
            self.wfile.flush()
            while True:
                try:
                    ev = q.get(timeout=15)
                    dados = "data: " + json.dumps(ev, ensure_ascii=False) + "\n\n"
                except Exception:  # noqa: BLE001  (fila vazia: mantém a conexão viva)
                    dados = ": ping\n\n"
                self.wfile.write(dados.encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            self.server.eventos.sair(q)
            self.close_connection = True

    def _estatico(self, rota):
        base = os.path.join(AQUI, "voz") if rota.startswith("/voz/") else VENDOR
        rel = urllib.parse.unquote(rota.split("/", 2)[2])
        caminho = os.path.realpath(os.path.join(base, rel))
        ext = os.path.splitext(caminho)[1]
        if not caminho.startswith(os.path.realpath(base) + os.sep) or ext not in TIPOS_ESTATICOS or not os.path.isfile(caminho):
            return self._json(404, {"erro": "Não encontrado.", "codigo": "nao_encontrado"})
        with open(caminho, "rb") as f:
            return self._enviar(200, f.read(), TIPOS_ESTATICOS[ext])

    ESCRITAS = {
        ("POST", "nota"): op.criar_nota, ("PUT", "nota"): op.editar_nota,
        ("POST", "nota/arquivar"): op.arquivar, ("POST", "nota/excluir"): op.excluir,
        ("POST", "decisao"): op.criar_decisao, ("POST", "projeto"): op.criar_projeto,
        ("POST", "tarefa"): op.criar_tarefa, ("POST", "tarefa/alternar"): op.alternar_tarefa,
        ("POST", "processo/execucao"): op.registrar_execucao, ("POST", "vinculo"): op.vincular,
        ("POST", "inbox"): op.capturar, ("POST", "prompt/duplicar"): op.duplicar_prompt,
    }

    def _escrever(self):
        rota = urllib.parse.urlsplit(self.path).path
        if not rota.startswith("/api/") or not self._autorizado(True):
            return self._json(403, {"erro": "Acesso negado.", "codigo": "permissao"})
        nome, estado = rota[5:], self.server.estado
        try:
            p = self._corpo()
            if (self.command, nome) == ("POST", "revelar"):
                return self._json(200, revelar(p.get("caminho", "")))
            if (self.command, nome) == ("POST", "conversa"):   # pergunta livre por voz → sessão do Claude lendo o vault
                r = conversa.perguntar(estado, p.get("texto", ""), eventos=self.server.eventos, pedido=p.get("pedido"))
                if r.get("escrita"):                            # ação por voz executada: a página recarrega os dados
                    print(f"ESCRITA por voz ({r.get('acao')}) → {r['escrita'].get('rel') or r['escrita'].get('id')}", flush=True)
                    r["assinatura"] = estado.atual()[2]
                return self._json(200, r)
            if (self.command, nome) == ("POST", "conversa/interromper"):   # ele começou a falar: o Claude para
                return self._json(200, conversa.interromper())
            if (self.command, nome) == ("POST", "conversa/nova"):          # Shift+J / "nova conversa": o Claude esquece
                return self._json(200, conversa.nova_conversa())
            if (self.command, nome) == ("POST", "falar"):      # resposta na voz do ElevenLabs (mp3)
                if os.path.realpath(estado.cofre.raiz) != os.path.realpath(gerar_mapa.VAULT):   # cópia/teste: não gasta créditos
                    raise ErroCofre("indisponivel", "Voz do Jarvis desligada em cópias do vault.", 503)
                if p.get("tempos"):                             # + tempos por frase (legenda sincronizada do Jarvis)
                    return self._json(200, conversa.falar_tempos(p.get("texto", "")))
                return self._enviar(200, conversa.falar(p.get("texto", "")), "audio/mpeg")
            funcao = self.ESCRITAS.get((self.command, nome))
            if not funcao:
                return self._json(404, {"erro": "Rota desconhecida.", "codigo": "nao_encontrado"})
            resultado = funcao(estado.cofre, p)
            print(f"ESCRITA {self.command} /{nome} → {resultado.get('rel') or resultado.get('id')}", flush=True)
            resultado["assinatura"] = estado.atual()[2]
            return self._json(200, resultado)
        except Exception as e:  # noqa: BLE001
            return self._erro(e)

    def do_POST(self):
        self._escrever()

    def do_PUT(self):
        self._escrever()


def revelar(caminho):
    """Mostra no Finder um arquivo ou pasta citado numa nota (só dentro da pasta do usuário)."""
    alvo = os.path.realpath(os.path.expanduser((caminho or "").strip()))
    casa = os.path.realpath(os.path.expanduser("~"))
    if not alvo.startswith(casa + os.sep) or not os.path.exists(alvo):
        raise ErroCofre("nao_encontrado", "Esse caminho não existe neste Mac.", 404)
    subprocess.run(["open", "-R", alvo], timeout=5, check=False)
    return {"ok": True, "caminho": alvo}


def encerrar_sessao():
    if conversa.SESSAO is not None:
        try:
            conversa.SESSAO.parar()   # o processo do Claude fecha junto com o servidor
        except Exception:  # noqa: BLE001
            pass


def vigiar_pai(pai):
    while True:
        time.sleep(2)
        try:
            os.kill(pai, 0)
        except OSError:
            encerrar_sessao()
            os._exit(0)


def main():
    ap = argparse.ArgumentParser(description="Servidor local do Segundo Cérebro")
    ap.add_argument("--porta", type=int, default=47321)
    ap.add_argument("--vault", default=gerar_mapa.VAULT)
    ap.add_argument("--lixeira", default=None, help="pasta usada como Lixeira (testes)")
    ap.add_argument("--abrir", action="store_true", help="abre o navegador")
    ap.add_argument("--pai", type=int, default=0, help="encerra quando este processo terminar")
    args = ap.parse_args()

    cofre = Cofre(args.vault, lixeira=args.lixeira)
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", args.porta), Handler)
    except OSError:
        srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    srv.daemon_threads = True
    srv.estado = Estado(cofre, secrets.token_urlsafe(24))
    srv.eventos = sessao.Eventos()
    srv.estado.atual()
    url = f"http://127.0.0.1:{srv.server_address[1]}/"
    print(f"PRONTO {url}", flush=True)
    print(f"vault: {cofre.raiz} · three.js {'local' if vendor_ok() else 'pela internet (CDN)'}", flush=True)
    # roteiro da apresentação: só no vault real (testes e cópias não gastam Claude nem ElevenLabs)
    if os.path.realpath(cofre.raiz) == os.path.realpath(gerar_mapa.VAULT) and roteiro.iniciar(srv.estado):
        print("roteiro da apresentação: ligado", flush=True)
    # sessão do Claude aberta já na largada (só no vault real): a primeira pergunta por voz sai mais rápido
    threading.Thread(target=conversa.aquecer, args=(srv.estado,), daemon=True).start()
    if args.pai:
        threading.Thread(target=vigiar_pai, args=(args.pai,), daemon=True).start()
    if args.abrir:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        encerrar_sessao()


if __name__ == "__main__":
    main()
