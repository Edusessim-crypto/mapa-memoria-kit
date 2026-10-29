#!/usr/bin/env python3
"""Testes do backend (cofre, operações, conversa simulada e servidor) — rodam numa CÓPIA temporária do vault.

Uso: python3 "99 - SISTEMA/Mapa/testes/teste_backend.py"
Nada no vault real é alterado: tudo acontece numa pasta temporária que é apagada no fim.

Base da cópia (a primeira que existir): a variável SC_VAULT_TESTE, a pasta "Vault modelo" do kit (quando o Mapa
ainda está dentro do kit) ou o próprio vault (quando o Mapa está instalado em <vault>/99 - SISTEMA/Mapa).
Sobre a base entram as notas fictícias de testes/fixture (Padaria Aurora, Oficina Rodas).
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

MAPA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURE = os.path.join(MAPA, "testes", "fixture")
sys.path.insert(0, MAPA)
import conversa  # noqa: E402
import gerar_mapa  # noqa: E402
import operacoes as op  # noqa: E402
import servidor  # noqa: E402
import sessao as sess  # noqa: E402
from cofre import Cofre, ErroCofre, fm_aplicar, fm_dict, hash_texto, separar  # noqa: E402

PROJETO = "Padaria Aurora — Site Oficial"
PROJETO2 = "Padaria Aurora — Cardápio Digital"
CLIENTE = "Padaria Aurora"
CLIENTE2 = "Oficina Rodas"
SOP = "SOP — Publicar site estático"
PROMPT = "Prompt — Análise de comentários"
DECISAO_VELHA = "Decisão — Agendamento da Padaria Aurora pelo WhatsApp"
CONHECIMENTO = "Banco de dados — lições e armadilhas"


def vault_base():
    for c in (os.environ.get("SC_VAULT_TESTE"), os.path.join(MAPA, "..", "Vault modelo"), os.path.join(MAPA, "..", "..")):
        if c and os.path.isfile(os.path.join(c, "00 - CENTRAL", "INDEX.md")):
            return os.path.abspath(c)
    raise SystemExit("Não achei um vault para copiar (SC_VAULT_TESTE, ../Vault modelo ou ../..).")


def copiar_vault():
    destino = tempfile.mkdtemp(prefix="sc-teste-")
    vault = os.path.join(destino, "Segundo Cérebro")
    shutil.copytree(vault_base(), vault, ignore=lambda d, nomes: [n for n in nomes if (n == "Mapa" and d.endswith("99 - SISTEMA")) or n == ".git"])
    # notas fictícias por cima da base
    for dp, _, fn in os.walk(FIXTURE):
        for f in fn:
            if f.endswith(".md"):
                rel = os.path.relpath(os.path.join(dp, f), FIXTURE)
                os.makedirs(os.path.dirname(os.path.join(vault, rel)), exist_ok=True)
                shutil.copy2(os.path.join(dp, f), os.path.join(vault, rel))
    # seções que as operações esperam encontrar nas notas centrais
    _garantir_secao(os.path.join(vault, "00 - CENTRAL", "Padrões Travados.md"), f"## {CLIENTE}", "")
    _garantir_secao(os.path.join(vault, "00 - CENTRAL", "Pendências.md"), f"## {CLIENTE}", f"- [ ] **Revisar o cardápio** → [[{PROJETO2}]]")
    # histórico git (painel Hoje e atividade do sistema); sem git instalado, os testes só pulam essa parte
    if shutil.which("git"):
        env = dict(os.environ, GIT_AUTHOR_NAME="teste", GIT_AUTHOR_EMAIL="teste@exemplo.com",
                   GIT_COMMITTER_NAME="teste", GIT_COMMITTER_EMAIL="teste@exemplo.com")
        for cmd in (["git", "init", "-q"], ["git", "add", "-A"], ["git", "commit", "-q", "-m", "Base dos testes"]):
            subprocess.run(cmd, cwd=vault, env=env, check=False, capture_output=True)
    return destino, vault


def _garantir_secao(caminho, titulo, linha):
    with open(caminho, encoding="utf-8") as f:
        t = f.read()
    if titulo + "\n" in t or t.endswith(titulo):
        return
    with open(caminho, "w", encoding="utf-8") as f:
        f.write(t.rstrip("\n") + f"\n\n{titulo}\n" + (linha + "\n" if linha else ""))


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp, cls.vault = copiar_vault()
        cls.lixeira = os.path.join(cls.tmp, "Lixeira")
        cls.cofre = Cofre(cls.vault, lixeira=cls.lixeira)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def texto(self, nome):
        with open(self.cofre.absoluto(self.cofre.rel_de(nome)), encoding="utf-8") as f:
            return f.read()


class TesteLeitura(Base):
    def test_frontmatter_sem_mudanca_preserva_tudo(self):
        for chave, rel in list(self.cofre.indice().items()):
            with open(self.cofre.absoluto(rel), encoding="utf-8") as f:
                t = f.read()
            self.assertEqual(fm_aplicar(t, {}), t if separar(t)[1] is not None else fm_aplicar(t, {}), rel)

    def test_trocar_um_campo_muda_so_uma_linha(self):
        t = self.texto(PROJETO)
        novo = fm_aplicar(t, {"status": "pausado"})
        dif = [(a, b) for a, b in zip(t.split("\n"), novo.split("\n")) if a != b]
        self.assertEqual(dif, [("status: ativo", "status: pausado")])

    def test_ler_nota_com_tarefas_e_referencias(self):
        n = self.cofre.ler(PROJETO)
        self.assertTrue(n["tarefas"])
        self.assertTrue(any(r["alvo"].startswith("https://github.com") for r in n["referencias"]))
        self.assertTrue(any(r["tipo"] == "caminho" for r in n["referencias"]))
        self.assertEqual(n["hash"], hash_texto(n["texto"]))

    def test_passos_de_sop(self):
        p = op.processo(self.cofre, SOP)
        self.assertGreaterEqual(len(p["passos"]), 8)
        self.assertTrue(all(x["secao"] for x in p["passos"]))

    def test_seguranca_de_caminho(self):
        with self.assertRaises(ErroCofre):
            self.cofre.absoluto("../fora.md")
        with self.assertRaises(ErroCofre):
            self.cofre.absoluto("99 - SISTEMA/Templates/Modelo de SOP.md", escrever=True)
        with self.assertRaises(ErroCofre):
            self.cofre.absoluto(".obsidian/app.md")

    def test_nome_do_dono_configuravel(self):
        antes = os.environ.get("SC_NOME")
        try:
            os.environ["SC_NOME"] = "Teste"
            dados, _, _ = gerar_mapa.construir_dados(self.vault, rede_voz=False)
            self.assertEqual(dados["dono"], "Teste")
            self.assertTrue(dados["narracao"]["__teste"]["texto"].startswith("Olá, Teste."))
            html = gerar_mapa.montar_html(os.path.join(MAPA, "mapa3d.template.html"), dados)
            self.assertIn("// TESTE", html)
            self.assertNotIn("__DONO__", html)
        finally:
            if antes is None:
                os.environ.pop("SC_NOME", None)
            else:
                os.environ["SC_NOME"] = antes

    def test_audios_pre_gravados_valem_para_qualquer_voz(self):
        pre = gerar_mapa.pre_gravados()
        if not pre:
            self.skipTest("sem voz/pre-gravados nesta cópia")
        audios, _, _ = gerar_mapa.gerar_vozes({"__cmd_ok": "Feito.", "__x": "Frase que não existe em lugar nenhum."}, rede=False)
        if not gerar_mapa.ler_config_voz().get("ELEVENLABS_API_KEY"):
            self.assertEqual(audios, {})   # sem voz configurada, o mapa usa as vozes do Mac
        else:
            self.assertEqual(audios.get("__cmd_ok"), pre["Feito."])
            self.assertNotIn("__x", audios)

    def test_agregado_e_busca(self):
        dados, notas, _ = gerar_mapa.construir_dados(self.vault, rede_voz=False)
        ag = op.agregado_sistema(self.cofre, dados, notas, CLIENTE)
        self.assertTrue(ag["decisoes"] and ag["tarefas"] and ag["arquivos"] and ag["conexoes"])
        self.assertTrue(any(p["id"].startswith("SOP — Onboarding") for p in ag["processos"]))
        if shutil.which("git"):
            self.assertTrue(ag["atividade"], "histórico do git deveria existir na cópia")
        busca = op.indice_busca(self.cofre, notas)
        ids = {b["id"] for b in busca}
        self.assertIn("Pendências", ids)
        self.assertIn(CLIENTE, ids)
        self.assertFalse(any(b["rel"].startswith("99 - SISTEMA") for b in busca))


class TesteEscrita(Base):
    def test_01_criar_nota_entra_no_sistema(self):
        corpo = op.modelo_corpo(self.cofre, "conhecimento", "Teste de nota")
        self.assertIn("## Ideia central", corpo)
        r = op.criar_nota(self.cofre, {"tipo": "conhecimento", "titulo": "Teste de nota da interface",
                                       "corpo": corpo.replace("## Ideia central\n", "## Ideia central\nTexto real.\n"),
                                       "cliente": CLIENTE, "tags": "#teste, padaria"})
        t = self.texto(r["id"])
        fm = fm_dict(separar(t)[1])
        self.assertEqual(fm["cliente"], f'"[[{CLIENTE}]]"')
        self.assertEqual(fm["tags"], "[conhecimento, teste, padaria]")
        self.assertIn("# Teste de nota da interface\n", t)
        self.assertIn("Texto real.", t)
        dados, notas, _ = gerar_mapa.construir_dados(self.vault, rede_voz=False)
        self.assertEqual(notas["Teste de nota da interface"]["cluster"], CLIENTE)

    def test_02_nome_duplicado_e_invalido(self):
        with self.assertRaises(ErroCofre) as e:
            op.criar_nota(self.cofre, {"tipo": "conhecimento", "titulo": "aprendizados"})
        self.assertEqual(e.exception.codigo, "duplicado")
        with self.assertRaises(ErroCofre) as e:
            op.criar_nota(self.cofre, {"tipo": "conhecimento", "titulo": "A: B"})
        self.assertEqual(e.exception.codigo, "validacao")

    def test_03_editar_com_conflito(self):
        n = self.cofre.ler(CONHECIMENTO)
        r = op.editar_nota(self.cofre, {"id": n["id"], "base": n["hash"], "corpo": n["corpo"] + "\nLinha nova.\n"})
        self.assertNotEqual(r["hash"], n["hash"])
        with self.assertRaises(ErroCofre) as e:
            op.editar_nota(self.cofre, {"id": n["id"], "base": n["hash"], "corpo": "sobrescrever"})
        self.assertEqual(e.exception.codigo, "conflito")
        self.assertIn("Linha nova.", e.exception.extra["atual"])

    def test_04_decisao_completa_atualiza_hubs(self):
        antes_recentes = self.texto("Decisões Recentes")
        r = op.criar_decisao(self.cofre, {
            "titulo": "Teste da interface trava o formato", "projetos": [PROJETO], "clientes": [CLIENTE],
            "status": "vigente", "travado": True, "decisao": "Usar o formato X.", "contexto": "Precisávamos decidir.",
            "porque": "Funciona melhor.", "alternativas": "- Formato Y", "impactos": "Muda o site.",
            "proximos": "- Ajustar o site\n- Avisar o cliente", "como_aplicar": "Aplicar em tudo.", "nao_fazer": "Não usar Y.",
            "fonte": "Pedido explícito no teste", "substitui": DECISAO_VELHA})
        self.assertEqual(r["avisos"], [])
        t = self.texto(r["id"])
        for trecho in ("## Decisão\nUsar o formato X.", "## Porquê\nFunciona melhor.", "- [ ] Ajustar o site",
                       "🔒 **TRAVADO**", "> Pedido explícito no teste", f"- [[{PROJETO}]]"):
            self.assertIn(trecho, t)
        self.assertLess(t.index("## Próximos passos"), t.index("## Como aplicar"))
        self.assertIn("[[Decisão — Teste da interface trava o formato]]", self.texto(PROJETO))
        rec = self.texto("Decisões Recentes")
        self.assertIn("🟢 🔒 | [[Decisão — Teste da interface trava o formato]]", rec)
        self.assertEqual(len(rec.split("\n")), len(antes_recentes.split("\n")) + 1)
        total = len([n for n in os.listdir(os.path.join(self.vault, "70 - DECISÕES")) if n.endswith(".md")])
        self.assertRegex(rec, rf"\b{total} decisões registradas")
        self.assertIn("→ [[Decisão — Teste da interface trava o formato]]", self.texto("Padrões Travados"))
        velha = fm_dict(separar(self.texto(DECISAO_VELHA))[1])
        self.assertEqual((velha["status"], velha["estado"]), ("substituida", "arquivo"))
        self.assertIn("Teste da interface", velha["substituida_por"])

    def test_04b_decisao_nao_travada_nao_conta_como_travada(self):
        r = op.criar_decisao(self.cofre, {"titulo": "Teste sem trava", "decisao": "Algo decidido.", "hubs": False})
        t = self.texto(r["id"])
        self.assertNotIn("🔒", t)
        dados, notas, _ = gerar_mapa.construir_dados(self.vault, rede_voz=False)
        self.assertFalse(notas[r["id"]]["travado"])

    def test_05_projeto_e_sistema(self):
        novo = f"{CLIENTE} — Projeto de Teste"
        r = op.criar_projeto(self.cofre, {"tipo": "projeto", "nome": novo, "cliente": CLIENTE,
                                          "status": "ativo", "categoria": "site", "objetivo": "Testar.", "descricao": "Descrição."})
        self.assertEqual(r["hubs"], [CLIENTE])
        self.assertIn(f"[[{novo}]]", self.texto(CLIENTE))
        t = self.texto(novo)
        self.assertIn("## Visão geral\nDescrição.", t)
        self.assertIn(f'cliente: "[[{CLIENTE}]]"', t)
        op.criar_projeto(self.cofre, {"tipo": "cliente", "nome": "Cliente Teste Interface", "descricao": "Quem é."})
        dados, notas, _ = gerar_mapa.construir_dados(self.vault, rede_voz=False)
        self.assertIn("Cliente Teste Interface", [c["id"] for c in dados["clusters"]])
        self.assertEqual(notas[novo]["cluster"], CLIENTE)
        with self.assertRaises(ErroCofre):
            op.criar_projeto(self.cofre, {"tipo": "projeto", "nome": CLIENTE.lower()})

    def test_06_tarefas(self):
        op.criar_tarefa(self.cofre, {"alvo": PROJETO2, "titulo": "Revisar logo", "descricao": "conferir arquivo oficial",
                                     "prioridade": "alta", "prazo": "2026-10-20", "checklist": ["baixar", "trocar"],
                                     "relacionadas": [CLIENTE]})
        t = self.texto(PROJETO2)
        self.assertIn(f"- [ ] 🔴 **Revisar logo** — conferir arquivo oficial 📅 2026-10-20 → [[{CLIENTE}]]\n  - [ ] baixar\n  - [ ] trocar", t)
        n = self.cofre.ler(PROJETO2)
        tf = next(x for x in n["tarefas"] if "Revisar logo" in x["texto"])
        self.assertEqual(tf["secao"], "Pendências")
        op.alternar_tarefa(self.cofre, {"id": PROJETO2, "linha": tf["linha"], "bruto": tf["bruto"], "feito": True})
        self.assertIn("- [x] 🔴 **Revisar logo**", self.texto(PROJETO2))
        with self.assertRaises(ErroCofre):
            op.alternar_tarefa(self.cofre, {"id": PROJETO2, "linha": tf["linha"], "bruto": tf["bruto"], "feito": True})
        op.criar_tarefa(self.cofre, {"alvo": "Pendências", "secao": PROJETO2, "titulo": "Central"})
        self.assertIn("- [ ] **Central**", self.texto("Pendências"))

    def test_07_execucao_vinculo_inbox(self):
        op.registrar_execucao(self.cofre, {"id": SOP, "feitos": 7, "total": 9, "obs": "faltou o domínio"})
        self.assertRegex(self.texto(SOP), r"## Execuções\n- \d{4}-\d\d-\d\d \d\d:\d\d — 7/9 etapas concluídas — faltou o domínio")
        self.assertEqual(op.processo(self.cofre, SOP)["execucoes"][0].split(" — ")[1], "7/9 etapas concluídas")
        op.vincular(self.cofre, {"id": PROJETO2, "titulo": "Demo", "alvo": "https://exemplo.com/demo", "categoria": "Deploy"})
        t = self.texto(PROJETO2)
        secao = t.split("## Arquivos relacionados\n", 1)[1].split("\n## ", 1)[0]
        self.assertTrue(secao.rstrip().endswith("- [Demo](https://exemplo.com/demo) — Deploy"), secao)
        with self.assertRaises(ErroCofre):
            op.vincular(self.cofre, {"id": PROJETO2, "titulo": "Demo", "alvo": "https://exemplo.com/demo"})
        with self.assertRaises(ErroCofre):
            op.vincular(self.cofre, {"id": PROJETO2, "titulo": "x", "alvo": "javascript:alert(1)"})
        op.capturar(self.cofre, {"texto": "Ideia solta", "cliente": CLIENTE})
        self.assertRegex(self.texto("Inbox"), rf"- \[ \] Ideia solta \(\d\d/\d\d\) → \[\[{CLIENTE}\]\]")

    def test_08_prompt_arquivar_excluir(self):
        r = op.duplicar_prompt(self.cofre, {"id": PROMPT})
        t = self.texto(r["id"])
        fm = fm_dict(separar(t)[1])
        self.assertEqual(fm["versao"], "v2")
        self.assertIn(f"duplicado de [[{PROMPT}]]", t)
        n = self.cofre.ler(r["id"])
        op.arquivar(self.cofre, {"id": r["id"], "base": n["hash"], "status": "substituida"})
        self.assertEqual(fm_dict(separar(self.texto(r["id"]))[1])["estado"], "arquivo")
        n = self.cofre.ler(r["id"])
        res = op.excluir(self.cofre, {"id": r["id"], "base": n["hash"]})
        self.assertTrue(os.path.exists(res["lixeira"]))
        self.assertFalse(self.cofre.existe(r["id"]))


class TesteConversa(Base):
    """Conversa por voz com a sessão simulada (sessao.SessaoSimulada): pré-busca, eventos, ações com confirmação."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        os.environ["SC_CONVERSA_SIMULADA"] = "1"
        conversa.SESSAO = None
        conversa.PENDENTE.update(acao=None)
        cls.estado = servidor.Estado(cls.cofre, "token-teste")

    @classmethod
    def tearDownClass(cls):
        os.environ.pop("SC_CONVERSA_SIMULADA", None)
        conversa.SESSAO = None
        super().tearDownClass()

    def test_prebusca_relevantes_e_hoje(self):
        rel = conversa.relevantes(self.estado, f"qual o status do site da {CLIENTE}?")
        self.assertTrue(rel and CLIENTE in rel[0], rel)
        self.assertIn("Pendências abertas", conversa.resumo_hoje(self.estado))
        p = conversa.montar_prompt(self.estado, "o que tenho pra hoje?")
        self.assertIn("Dados já buscados", p)
        self.assertIn(f"{gerar_mapa.nome_dono()} disse", p)
        self.assertNotIn("Dados já buscados", conversa.montar_prompt(self.estado, f"quem é o dono da {CLIENTE}?"))

    def test_persona_usa_o_nome_configurado(self):
        self.assertIn(gerar_mapa.nome_dono(), conversa.persona_texto())
        self.assertNotIn("{nome}", conversa.persona_texto())

    def test_acao_confirmacao_e_resumo(self):
        texto, acao = sess.separar_acao('Vou anotar. Confirma, senhor?\nNOTAS: Inbox\nACAO: inbox {"texto": "ligar"}')
        self.assertEqual((texto, acao), ("Vou anotar. Confirma, senhor?\nNOTAS: Inbox", {"tipo": "inbox", "dados": {"texto": "ligar"}}))
        self.assertEqual(sess.separar_acao("Só uma resposta.")[1], None)
        self.assertTrue(sess.eh_confirmacao("Jarvis, pode confirmar") and sess.eh_confirmacao("sim"))
        self.assertFalse(sess.eh_confirmacao("não, cancela") or sess.eh_confirmacao("sim, mas antes me explica o que muda nisso tudo aí"))
        self.assertTrue(sess.eh_negacao("não") and sess.eh_negacao("cancela isso"))
        self.assertTrue(conversa.eh_resumo_do_dia("Bom dia, Jarvis!") and conversa.eh_resumo_do_dia("jarvis me atualiza"))
        self.assertFalse(conversa.eh_resumo_do_dia(f"bom dia pra quem? qual o status da {CLIENTE}"))

    def test_rotulo_ferramenta(self):
        r = sess.rotulo_ferramenta("Read", {"file_path": os.path.join(self.vault, "10 - PROJETOS", PROJETO + ".md")}, self.vault)
        self.assertEqual(r, {"rotulo": f"Lendo {PROJETO}", "notas": [PROJETO]})
        self.assertEqual(sess.rotulo_ferramenta("Read", {"file_path": "/etc/hosts"}, self.vault)["notas"], [])
        self.assertIn("70 - DECISÕES", sess.rotulo_ferramenta("Grep", {"pattern": "x", "path": os.path.join(self.vault, "70 - DECISÕES")}, self.vault)["rotulo"])
        self.assertIsNone(sess.rotulo_ferramenta("TodoWrite", {}, self.vault))

    def test_pergunta_com_eventos(self):
        evs = []

        class Ev:
            def emitir(self, e):
                evs.append(e)
        r = conversa.perguntar(self.estado, f"qual o status da {CLIENTE}?", eventos=Ev(), pedido=3)
        time.sleep(.3)
        self.assertTrue(r["resposta"].startswith("Senhor"))
        self.assertTrue(r["notas"] and r["notas"][0] in self.estado.atual()[1])
        self.assertEqual(evs[0]["tipo"], "aviso")
        self.assertTrue(evs[1:] and all(e["tipo"] == "lendo" and e["notas"] for e in evs[1:]))
        self.assertTrue(all(e["pedido"] == 3 for e in evs))
        self.assertNotIn("audio", evs[0])   # em cópia do vault não há áudio: só o texto do aviso

    def test_acao_por_voz_inbox_tarefa_e_cancelar(self):
        conversa.PENDENTE.update(acao={"tipo": "inbox", "dados": {"texto": "ligar para o fornecedor amanhã"}}, quando=time.time())
        r = conversa.perguntar(self.estado, "confirma")
        self.assertEqual((r["acao"], r["resposta"]), ("inbox", "Feito, senhor. Anotei na Inbox."))
        self.assertIn("ligar para o fornecedor amanhã", self.texto("Inbox"))
        nota = self.cofre.ler(PROJETO)
        aberta = next(t for t in nota["tarefas"] if not t["feito"])
        conversa.PENDENTE.update(acao={"tipo": "tarefa_feita", "dados": {"nota": nota["id"], "texto": aberta["texto"][:45]}}, quando=time.time())
        r = conversa.perguntar(self.estado, "pode")
        self.assertEqual(r["escrita"]["linha"], aberta["linha"])
        self.assertTrue(self.cofre.ler(nota["id"])["tarefas"][[t["linha"] for t in nota["tarefas"]].index(aberta["linha"])]["feito"])
        conversa.PENDENTE.update(acao={"tipo": "inbox", "dados": {"texto": "x"}}, quando=time.time())
        self.assertEqual(conversa.perguntar(self.estado, "não, cancela")["resposta"], "Cancelado, senhor.")
        self.assertIsNone(conversa.PENDENTE["acao"])
        conversa.PENDENTE.update(acao={"tipo": "inbox", "dados": {"texto": "y"}}, quando=time.time())
        r = conversa.perguntar(self.estado, f"qual o status da {CLIENTE}?")   # outra pergunta descarta a proposta
        self.assertIsNone(r["acao"])
        self.assertIsNone(conversa.PENDENTE["acao"])
        self.assertEqual(conversa.nova_conversa(), {"ok": True})
        self.assertEqual(conversa.interromper(), {"interrompeu": False})


class TesteServidor(Base):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        env = dict(os.environ, SC_CONVERSA_SIMULADA="1")
        cls.proc = subprocess.Popen([sys.executable, os.path.join(MAPA, "servidor.py"), "--porta", "0", "--vault", cls.vault,
                                     "--lixeira", cls.lixeira], stdout=subprocess.PIPE, text=True, env=env)
        linha = cls.proc.stdout.readline()
        cls.url = linha.split()[1]
        html = urllib.request.urlopen(cls.url).read().decode("utf-8")
        cls.token = re.search(r'"token": "([^"]+)"', html).group(1)
        cls.html = html

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(5)
        super().tearDownClass()

    def pedir(self, rota, corpo=None, metodo=None, token=True, cabecalhos=None):
        h = {"X-SC-Token": self.token} if token else {}
        if corpo is not None:
            h["Content-Type"] = "application/json"
        h.update(cabecalhos or {})
        req = urllib.request.Request(self.url + rota, data=json.dumps(corpo).encode() if corpo is not None else None,
                                     headers=h, method=metodo or ("POST" if corpo is not None else "GET"))
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def test_pagina_tem_dados_ui_e_config(self):
        self.assertIn('"escrita": true', self.html)
        self.assertNotIn("/*__DADOS__*/null", self.html)
        self.assertNotIn("/*__UI_JS__*/", self.html)
        self.assertNotIn("__DONO__", self.html)
        self.assertIn(f"// {gerar_mapa.nome_dono().upper()}", self.html)

    def test_token_host_origem(self):
        self.assertEqual(self.pedir("api/saude", token=False)[0], 403)
        self.assertEqual(self.pedir("api/saude")[0], 200)
        self.assertEqual(self.pedir("api/saude", cabecalhos={"Origin": "https://malicioso.example"})[0], 403)
        self.assertEqual(self.pedir("api/saude", cabecalhos={"Host": "evil.example"})[0], 403)
        st, r = self.pedir("api/inbox", {"texto": "x"}, cabecalhos={"Content-Type": "text/plain"})
        self.assertEqual(st, 415)

    def test_api_leitura_e_escrita(self):
        st, n = self.pedir("api/nota?id=" + urllib.request.quote(PROJETO))
        self.assertEqual(st, 200)
        self.assertTrue(n["backlinks"])
        st, s = self.pedir("api/sistema?id=" + urllib.request.quote(CLIENTE))
        self.assertEqual(st, 200)
        self.assertTrue(s["decisoes"])
        st, idx = self.pedir("api/indice")
        self.assertGreaterEqual(len(idx["notas"]), 10)
        st, r = self.pedir("api/nota", {"tipo": "conhecimento", "titulo": "Nota via HTTP", "cliente": CLIENTE2})
        self.assertEqual(st, 200, r)
        st, d = self.pedir("api/dados")
        self.assertIn("Nota via HTTP", [x["id"] for x in d["dados"]["nos"]])
        st, r = self.pedir("api/nota", {"tipo": "conhecimento", "titulo": "Nota via HTTP"})
        self.assertEqual((st, r["codigo"]), (409, "duplicado"))
        st, h = self.pedir("api/historico?id=" + urllib.request.quote("Pendências"))
        if shutil.which("git"):
            self.assertTrue(h["versoes"])

    def test_conversa_eventos_e_rotas(self):
        import threading
        recebidos = []

        def ouvir():
            req = urllib.request.Request(self.url + "api/eventos", headers={"X-SC-Token": self.token})
            with urllib.request.urlopen(req, timeout=20) as r:
                buf = b""
                while len(recebidos) < 2:
                    pedaco = r.read1(4096) if hasattr(r, "read1") else r.read(1)
                    if not pedaco:
                        break
                    buf += pedaco
                    while b"\n\n" in buf:
                        bloco, buf = buf.split(b"\n\n", 1)
                        for l in bloco.decode("utf-8").split("\n"):
                            if l.startswith("data:"):
                                recebidos.append(json.loads(l[5:]))
        th = threading.Thread(target=ouvir, daemon=True)
        th.start()
        time.sleep(.5)
        st, r = self.pedir("api/conversa", {"texto": f"qual o status da {CLIENTE}?", "pedido": 11})
        self.assertEqual(st, 200, r)
        self.assertTrue(r["resposta"] and r["notas"])
        th.join(5)
        self.assertEqual([e["tipo"] for e in recebidos[:2]], ["aviso", "lendo"])
        self.assertEqual(recebidos[0]["pedido"], 11)
        self.assertEqual(self.pedir("api/conversa/nova", {})[1], {"ok": True})
        self.assertEqual(self.pedir("api/conversa/interromper", {})[1], {"interrompeu": False})
        st, s = self.pedir("api/saude")
        self.assertIn("conversa", s)
        self.assertEqual(self.pedir("api/eventos", token=False)[0], 403)


if __name__ == "__main__":
    unittest.main(verbosity=2)
