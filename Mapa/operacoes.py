"""Operações do Segundo Cérebro sobre o vault: notas, decisões, tarefas, projetos, processos, links e busca.

Segue as regras do vault (00 - CENTRAL/REGRAS-DE-MEMORIA.md):
- decisão nova → nota em 70 - DECISÕES + link na nota do projeto + linha em Decisões Recentes
  (+ Padrões Travados quando travada); a substituída ganha status: substituida e estado: arquivo;
- tarefa → checkbox na seção Pendências da nota (o mesmo modelo que o Obsidian já usa);
- arquivar → status + estado: arquivo; nada é apagado (excluir = Lixeira).
"""
import os
import re
from collections import Counter, defaultdict
from datetime import datetime

import gerar_mapa
from cofre import (TAREFA, WIKI, ErroCofre, achar_secao, anexar_na_secao, fm_aplicar, fm_dict, hash_texto, hoje, ler_arquivo,
                   passos, referencias, sem_acento, separar, tarefas, texto_secao, wikilink)

FINAIS = {"substituida", "rejeitada", "arquivado", "concluido", "historico"}
EMOJI = {"vigente": "🟢", "parcial": "🟡", "em-validacao": "🟡", "necessita-validacao": "❓", "substituida": "⚪", "rejeitada": "⛔"}
CENTRAL_PENDENCIAS = "Pendências"
INBOX = "Inbox"


def _txt(v):
    return (v or "").strip() if isinstance(v, str) else ""


def _lista(v):
    if isinstance(v, str):
        v = [v]
    return [x.strip() for x in (v or []) if isinstance(x, str) and x.strip()]


def _tags(v):
    if isinstance(v, str):
        v = re.split(r"[,\s]+", v)
    saida = []
    for t in v or []:
        t = re.sub(r"[^\wÀ-ÿ/\-]", "", str(t).strip().lstrip("#").lower())
        if t and t not in saida:
            saida.append(t)
    return saida


def _linhas(texto):
    return [l.rstrip() for l in _txt(texto).split("\n")] if _txt(texto) else []


def _resultado(rel, h, nome, estrutura=True, **extra):
    r = {"ok": True, "id": nome, "rel": rel, "hash": h, "estrutura": estrutura}
    r.update(extra)
    return r


def _limpar_placeholders(texto):
    """Campos do modelo que ficaram com [[ ]] viram vazios (convenção dos modelos)."""
    abre, fm, fecha, corpo = separar(texto)
    if fm is None:
        return texto
    mud = {k: "" for k, v in fm_dict(fm).items() if v.replace(" ", "") in ('"[[]]"', '["[[]]"]')}
    return fm_aplicar(texto, mud) if mud else texto


def _existente(cofre, nome):
    return cofre.existe(nome) if (nome or "").strip() else False


# ---------------------------------------------------------------- notas

def modelo_corpo(cofre, tipo, titulo):
    """Corpo do modelo oficial (sem frontmatter e sem o título #), para pré-preencher o editor."""
    if tipo not in ("conhecimento", "sop", "prompt", "pessoa"):
        return ""
    curto, _ = cofre.nome_final(tipo, titulo or "Título")
    corpo = separar(cofre.modelo(tipo, curto))[3]
    return re.sub(r"^\s*#\s+[^\n]*\n+", "", corpo.lstrip("\n"), count=1).rstrip() + "\n"


def criar_nota(cofre, p):
    tipo = p.get("tipo") or "conhecimento"
    if tipo == "captura":
        return capturar(cofre, p)
    if tipo == "decisao":
        return criar_decisao(cofre, p)
    if tipo in ("projeto", "cliente"):
        return criar_projeto(cofre, p)
    if tipo not in ("conhecimento", "sop", "prompt", "pessoa"):
        raise ErroCofre("validacao", f"Tipo de nota desconhecido: {tipo}", 422, {"campo": "tipo"})
    base = {"conhecimento": "conhecimento", "sop": "sop", "prompt": "prompt", "pessoa": "pessoa"}[tipo]
    fm = {"tags": [base] + [t for t in _tags(p.get("tags")) if t != base]}
    projeto, cliente = _txt(p.get("projeto")), _txt(p.get("cliente"))
    for nome in (projeto, cliente):
        if nome and not _existente(cofre, nome):
            raise ErroCofre("validacao", f"O sistema/projeto “{nome}” não existe mais.", 422, {"campo": "sistema"})
    if tipo == "prompt":
        fm["projeto"] = [wikilink(projeto)] if projeto else []
        fm["ferramenta"] = _txt(p.get("ferramenta")) or "Claude Code"
        fm["versao"] = _txt(p.get("versao")) or "v1"
    elif tipo == "pessoa":
        fm["organizacao"] = wikilink(cliente) if cliente else ""
    else:
        if projeto:
            fm["projeto"] = wikilink(projeto)
        if cliente:
            fm["cliente"] = wikilink(cliente)
    rel, h, nome = cofre.criar(tipo, p.get("titulo"), corpo=p.get("corpo"), fm=fm)
    texto = ler_arquivo(cofre.absoluto(rel))
    limpo = _limpar_placeholders(texto)
    if limpo != texto:
        h = cofre.gravar(rel, limpo, h)
    return _resultado(rel, h, nome)


def editar_nota(cofre, p):
    fm = p.get("fm") or None
    if fm:
        for k in list(fm):
            if not re.fullmatch(r"[a-z_]{1,30}", k):
                raise ErroCofre("validacao", f"Campo inválido: {k}", 422)
        if "tags" in fm:
            fm["tags"] = _tags(fm["tags"])
    corpo = p.get("corpo")
    if corpo is not None and not isinstance(corpo, str):
        raise ErroCofre("validacao", "Conteúdo inválido.", 422)
    antes = cofre.ler(p.get("id"))
    rel, h = cofre.editar(p.get("id"), p.get("base"), corpo=corpo, fm=fm)
    depois = cofre.ler(p.get("id"))
    return _resultado(rel, h, antes["id"], estrutura=set(antes["links"]) != set(depois["links"]) or bool(fm))


def arquivar(cofre, p):
    status = _txt(p.get("status")) or "arquivado"
    if not re.fullmatch(r"[a-z\-]{3,30}", status):
        raise ErroCofre("validacao", "Status inválido.", 422)
    rel, h = cofre.alterar(p.get("id"), lambda t: fm_aplicar(t, {"status": status, "estado": "arquivo"}), p.get("base"))
    return _resultado(rel, h, p.get("id"))


def excluir(cofre, p):
    rel, destino = cofre.mover_para_lixeira(p.get("id"), p.get("base"))
    return {"ok": True, "id": p.get("id"), "rel": rel, "lixeira": destino, "estrutura": True}


def capturar(cofre, p):
    texto = re.sub(r"\s+", " ", _txt(p.get("texto") or p.get("titulo") or p.get("corpo")))
    if not texto:
        raise ErroCofre("validacao", "Escreva o que quer capturar.", 422, {"campo": "titulo"})
    sistema = _txt(p.get("cliente") or p.get("projeto"))
    linha = f"- [ ] {texto} ({datetime.now().strftime('%d/%m')})" + (f" → {wikilink(sistema)}" if sistema else "")
    rel, h = cofre.alterar(INBOX, lambda t: anexar_na_secao(t, "Itens a classificar", [linha]))
    return _resultado(rel, h, INBOX, estrutura=False, mensagem="Capturado na Inbox — classifique depois.")


# ---------------------------------------------------------------- decisões

def criar_decisao(cofre, p):
    curto, nome = cofre.nome_final("decisao", p.get("titulo"))
    if not curto:
        raise ErroCofre("validacao", "Escreva a decisão em uma frase (vira o título).", 422, {"campo": "titulo"})
    cofre.validar_nome(nome)
    projetos, clientes = _lista(p.get("projetos")), _lista(p.get("clientes"))
    for x in projetos + clientes:
        if not _existente(cofre, x):
            raise ErroCofre("validacao", f"“{x}” não existe no vault.", 422, {"campo": "projeto"})
    status = _txt(p.get("status")) or "vigente"
    if status not in EMOJI:
        raise ErroCofre("validacao", "Status inválido.", 422, {"campo": "status"})
    data = _txt(p.get("data")) or hoje()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", data):
        raise ErroCofre("validacao", "Data inválida.", 422, {"campo": "data"})
    travado = bool(p.get("travado"))
    substitui = _txt(p.get("substitui"))
    if substitui and not _existente(cofre, substitui):
        raise ErroCofre("validacao", f"A decisão substituída “{substitui}” não existe.", 422, {"campo": "substitui"})
    if not _txt(p.get("decisao")):
        raise ErroCofre("validacao", "Descreva o que foi decidido.", 422, {"campo": "decisao"})

    texto = cofre.modelo("decisao", curto)
    fm = {"titulo": nome, "data": data, "projeto": [wikilink(x) for x in projetos], "cliente": [wikilink(x) for x in clientes],
          "status": status, "estado": "arquivo" if status in FINAIS else "ativo", "travado": travado,
          "evidencia": _txt(p.get("evidencia")) or "FATO", "fonte": _txt(p.get("fonte")),
          "substitui": wikilink(substitui) if substitui else "",
          "tags": ["decisao"] + [t for t in _tags([sem_acento(c).split(" ")[0] for c in clientes]) if t != "decisao"]}
    texto = fm_aplicar(texto, fm)
    # o comentário do modelo tem 🔒 — se ficasse numa decisão não travada, o mapa a contaria como travada
    if travado:
        texto = re.sub(r"<!--\s*Se aprovado definitivamente.*?-->", "🔒 **TRAVADO** — não alterar sem decisão explícita do usuário.", texto, flags=re.S)
    else:
        texto = re.sub(r"<!--\s*Se aprovado definitivamente.*?-->\n*", "", texto, flags=re.S)
    texto = texto.replace("> citação literal / onde foi dito\n", "")
    preencher = [("Decisão", p.get("decisao")), ("Contexto", p.get("contexto")),
                 ("Evidência", "> " + _txt(p.get("fonte")) if _txt(p.get("fonte")) else ""),
                 ("Como aplicar", p.get("como_aplicar")), ("Não fazer", p.get("nao_fazer"))]
    for secao, valor in preencher:
        if _linhas(valor):
            texto = anexar_na_secao(texto, secao, _linhas(valor))
    opcionais = [("Porquê", _linhas(p.get("porque"))), ("Alternativas consideradas", _linhas(p.get("alternativas"))),
                 ("Impactos", _linhas(p.get("impactos"))),
                 ("Próximos passos", ["- [ ] " + l.lstrip("-*• ").strip() for l in _linhas(p.get("proximos")) if l.strip(" -*•")])]
    for secao, linhas in opcionais:
        if linhas:
            texto = anexar_na_secao(texto, secao, linhas, antes_de=["Como aplicar", "Não fazer", "Relacionado"])
    relacionados = [f"- {wikilink(x)}" for x in projetos + clientes] + ([f"- Substitui {wikilink(substitui)}"] if substitui else [])
    if relacionados:
        texto = anexar_na_secao(texto, "Relacionado", relacionados)
    rel = os.path.join("70 - DECISÕES", nome + ".md")
    h = cofre.gravar(rel, _limpar_placeholders(texto), novo=True)

    hubs, avisos = [], []
    if p.get("hubs", True):
        for projeto in projetos:
            try:
                def ligar(t, nome=nome):
                    if wikilink(nome) in t:
                        return t
                    return anexar_na_secao(t, "Decisões importantes", [f"- {wikilink(nome)}"],
                                           antes_de=["🔒 Padrões travados", "Entregáveis", "Relacionado"])
                cofre.alterar(projeto, ligar)
                hubs.append(projeto)
            except ErroCofre as e:
                avisos.append(f"{projeto}: {e.mensagem}")
        try:
            cofre.alterar("Decisões Recentes", lambda t: _linha_decisoes_recentes(cofre, t, nome, data, status, travado, projetos or clientes))
            hubs.append("Decisões Recentes")
        except ErroCofre as e:
            avisos.append(f"Decisões Recentes: {e.mensagem}")
        if travado:
            alvo = next((c for c in clientes if c), None) or (projetos[0] if projetos else None)
            try:
                feito = []

                def travar(t):
                    s = None
                    for candidato in [alvo] + clientes + projetos:
                        s = candidato and achar_secao(t, [candidato])
                        if s:
                            break
                    if not s:
                        return t
                    feito.append(s["titulo"])
                    return anexar_na_secao(t, s["titulo"], [f"- 🔒 **{curto}** → {wikilink(nome)}"])
                cofre.alterar("Padrões Travados", travar)
                if feito:
                    hubs.append("Padrões Travados")
                else:
                    avisos.append("Padrões Travados: não há seção para esse cliente — cite a decisão lá manualmente.")
            except ErroCofre as e:
                avisos.append(f"Padrões Travados: {e.mensagem}")
    if substitui:
        try:
            cofre.alterar(substitui, lambda t: fm_aplicar(t, {"status": "substituida", "estado": "arquivo", "substituida_por": wikilink(nome)}))
            hubs.append(substitui)
        except ErroCofre as e:
            avisos.append(f"{substitui}: {e.mensagem}")
    return _resultado(rel, h, nome, hubs=hubs, avisos=avisos)


def _linha_decisoes_recentes(cofre, texto, nome, data, status, travado, refs):
    if wikilink(nome) in texto:
        return texto
    linhas = texto.split("\n")
    cab = next((i for i, l in enumerate(linhas) if l.startswith("| Data |")), None)
    if cab is None or cab + 1 >= len(linhas) or not linhas[cab + 1].startswith("|---"):
        raise ErroCofre("formato", "tabela de decisões não encontrada", 409)
    selo = EMOJI.get(status, "🟢") + (" 🔒" if travado else "")
    linhas.insert(cab + 2, f"| {data} | {selo} | {wikilink(nome)} | {', '.join(wikilink(r) for r in refs) or '—'} |")
    novo = "\n".join(linhas)
    total = sum(1 for r in cofre.indice().values() if r.startswith("70 - DECISÕES/"))
    novo = re.sub(r"\b\d+ decisões registradas", f"{total} decisões registradas", novo, count=1)
    return fm_aplicar(novo, {"atualizado": hoje()})


# ---------------------------------------------------------------- projetos e sistemas

def criar_projeto(cofre, p):
    tipo = "cliente" if p.get("tipo") in ("cliente", "sistema") else "projeto"
    nome = re.sub(r"\s+", " ", _txt(p.get("nome") or p.get("titulo")))
    cofre.validar_nome(nome)
    status = _txt(p.get("status")) or ("ativo" if tipo == "cliente" else "planejamento")
    pai = _txt(p.get("cliente"))
    if pai and not _existente(cofre, pai):
        raise ErroCofre("validacao", f"O contexto pai “{pai}” não existe.", 422, {"campo": "cliente"})
    descricao, objetivo = _linhas(p.get("descricao")), _linhas(p.get("objetivo"))
    if tipo == "projeto":
        estado = "arquivo" if status in FINAIS else ("referencia" if status in ("pausado", "ideia", "desconhecido") else "ativo")
        fm = {"status": status, "estado": estado, "cliente": wikilink(pai) if pai else "", "marca": wikilink(pai) if pai else "",
              "categoria": _txt(p.get("categoria")), "inicio": hoje(), "ultima_atualizacao": hoje(),
              "tags": ["projeto"] + _tags([sem_acento(pai).split(" ")[0]] if pai else [])}
    else:
        fm = {"type": "cliente", "relacao": _txt(p.get("relacao")), "segmento": _txt(p.get("categoria") or p.get("segmento")),
              "status_relacao": status, "estado": "ativo" if status == "ativo" else "referencia", "tags": ["cliente"]}
    texto = fm_aplicar(cofre.modelo(tipo, nome), fm)
    if tipo == "projeto":
        if descricao:
            texto = anexar_na_secao(texto, "Visão geral", descricao)
        if objetivo:
            texto = anexar_na_secao(texto, "Objetivo", objetivo)
        texto = anexar_na_secao(texto, "Histórico", [f"| {hoje()} | Projeto criado |"])
    elif descricao or objetivo:
        texto = anexar_na_secao(texto, "Quem é", descricao + ([""] if descricao and objetivo else []) + objetivo)
    rel = os.path.join("10 - PROJETOS" if tipo == "projeto" else "20 - CLIENTES E MARCAS", nome + ".md")
    h = cofre.gravar(rel, _limpar_placeholders(texto), novo=True)
    hubs, avisos = [], []
    if tipo == "projeto" and pai and p.get("hubs", True):
        def ligar(t):
            if wikilink(nome) in t:
                return t
            s = achar_secao(t, ["Projetos"])
            if s:
                linhas = t.split("\n")
                ult = max((i for i in range(s["linha"] + 1, s["fim"]) if linhas[i].strip()), default=None)
                if ult is not None and "[[" in linhas[ult] and " · " in linhas[ult] and not linhas[ult].lstrip().startswith("-"):
                    linhas[ult] = linhas[ult].rstrip() + f" · {wikilink(nome)}"
                    return "\n".join(linhas)
            return anexar_na_secao(t, "Projetos", [f"- {wikilink(nome)}"])
        try:
            cofre.alterar(pai, ligar)
            hubs.append(pai)
        except ErroCofre as e:
            avisos.append(f"{pai}: {e.mensagem}")
    return _resultado(rel, h, nome, hubs=hubs, avisos=avisos,
                      mensagem="O INDEX e o Mapa de Projetos não mudam sozinhos — peça ao Claude para indexar (/criar-projeto).")


# ---------------------------------------------------------------- tarefas

def criar_tarefa(cofre, p):
    titulo = re.sub(r"\s+", " ", _txt(p.get("titulo")))
    if not titulo:
        raise ErroCofre("validacao", "Diga o que precisa ser feito.", 422, {"campo": "titulo"})
    alvo = _txt(p.get("alvo")) or CENTRAL_PENDENCIAS
    if not _existente(cofre, alvo):
        raise ErroCofre("validacao", f"“{alvo}” não existe.", 422, {"campo": "alvo"})
    prazo = _txt(p.get("prazo"))
    if prazo and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", prazo):
        raise ErroCofre("validacao", "Prazo inválido.", 422, {"campo": "prazo"})
    rel_ok = [r for r in _lista(p.get("relacionadas")) if _existente(cofre, r)]
    marca = {"alta": "🔴 ", "baixa": "🔽 "}.get(p.get("prioridade"), "")
    descricao = re.sub(r"\s+", " ", _txt(p.get("descricao")))
    caixa = "x" if p.get("feito") else " "
    linha = (f"- [{caixa}] {marca}**{titulo}**" + (f" — {descricao}" if descricao else "")
             + (f" 📅 {prazo}" if prazo else "") + (" → " + " · ".join(wikilink(r) for r in rel_ok) if rel_ok else ""))
    sub = ["  - [ ] " + re.sub(r"\s+", " ", i.strip(" -*•[]")) for i in _lista(p.get("checklist")) if i.strip(" -*•[]")]
    secao = _txt(p.get("secao")) or ("Itens a classificar" if alvo == INBOX else "Pendências")
    if alvo == CENTRAL_PENDENCIAS and not _txt(p.get("secao")):
        secao = _txt(p.get("sistema")) or "Outros"
    rel, h = cofre.alterar(alvo, lambda t: anexar_na_secao(t, secao, [linha] + sub,
                                                           antes_de=["Decisões importantes", "🔒 Padrões travados", "Entregáveis"]))
    extra = {}
    if p.get("central") and alvo != CENTRAL_PENDENCIAS:
        sist = _txt(p.get("sistema")) or alvo
        cofre.alterar(CENTRAL_PENDENCIAS, lambda t: anexar_na_secao(t, sist, [f"- [ ] {marca}**{titulo}** → [[{alvo}#Pendências]]"]))
        extra["central"] = True
    return _resultado(rel, h, alvo, estrutura=bool(rel_ok), linha=linha, **extra)


def alternar_tarefa(cofre, p):
    feito, bruto = bool(p.get("feito")), p.get("bruto") or ""
    resultado = {}

    def trocar(texto):
        linhas = texto.split("\n")
        i = p.get("linha")
        if not (isinstance(i, int) and 0 <= i < len(linhas) and linhas[i] == bruto):
            achados = [k for k, l in enumerate(linhas) if l == bruto]
            if len(achados) != 1:
                raise ErroCofre("conflito", "Essa tarefa mudou fora daqui. Recarregue para ver a versão atual.", 409)
            i = achados[0]
        m = TAREFA.match(linhas[i])
        if not m:
            raise ErroCofre("conflito", "A linha não é mais uma tarefa.", 409)
        linhas[i] = f"{m.group(1)}{m.group(2)} [{'x' if feito else ' '}] {m.group(4)}"
        resultado.update(linha=i, bruto=linhas[i])
        return "\n".join(linhas)
    rel, h = cofre.alterar(p.get("id"), trocar)
    return _resultado(rel, h, p.get("id"), estrutura=False, **resultado)


# ---------------------------------------------------------------- processos, links, prompts

def registrar_execucao(cofre, p):
    feitos, total = int(p.get("feitos") or 0), int(p.get("total") or 0)
    if total <= 0 or not 0 <= feitos <= total:
        raise ErroCofre("validacao", "Progresso inválido.", 422)
    obs = re.sub(r"\s+", " ", _txt(p.get("obs")))
    linha = f"- {datetime.now().strftime('%Y-%m-%d %H:%M')} — {feitos}/{total} etapas concluídas" + (f" — {obs}" if obs else "")
    rel, h = cofre.alterar(p.get("id"), lambda t: anexar_na_secao(t, "Execuções", [linha]))
    return _resultado(rel, h, p.get("id"), estrutura=False, linha=linha)


def vincular(cofre, p):
    alvo = _txt(p.get("alvo"))
    titulo = re.sub(r"\s+", " ", _txt(p.get("titulo"))) or alvo
    if re.match(r"^https?://\S+$", alvo):
        linha = f"- [{titulo.replace(']', ')')}]({alvo})"
    elif re.match(r"^(~|/)\S", alvo) and "\n" not in alvo:
        linha = f"- {titulo}: `{alvo}`"
    else:
        raise ErroCofre("validacao", "Informe um link (https://…) ou um caminho local (~/… ou /…).", 422, {"campo": "alvo"})
    for extra in (_txt(p.get("categoria")), re.sub(r"\s+", " ", _txt(p.get("descricao")))):
        if extra:
            linha += f" — {extra}"
    nota = cofre.ler(p.get("id"))
    if alvo in nota["texto"]:
        raise ErroCofre("duplicado", "Esse link já está nessa nota.", 409, {"campo": "alvo"})
    secao = "Arquivos relacionados" if (achar_secao(nota["texto"], ["Arquivos relacionados"]) or nota["rel"].startswith("10 ")) else "Referências"
    rel, h = cofre.alterar(p.get("id"), lambda t: anexar_na_secao(t, secao, [linha], antes_de=["Conhecimentos relacionados", "Aprendizados", "Histórico", "Relacionado"]))
    return _resultado(rel, h, p.get("id"), estrutura=False, linha=linha, secao=secao)


def duplicar_prompt(cofre, p):
    orig = cofre.ler(p.get("id"))
    if not orig["rel"].startswith("50 - RECURSOS/Prompts/"):
        raise ErroCofre("validacao", "Só prompts da biblioteca podem ser duplicados.", 422)
    versao = _txt(p.get("versao"))
    if not versao:
        m = re.match(r"v(\d+)", (orig["fm"].get("versao") or "v1").strip('"'))
        versao = f"v{int(m.group(1)) + 1}" if m else "v2"
    curto, nome = cofre.nome_final("prompt", _txt(p.get("titulo")) or re.sub(r"^Prompt — ", "", orig["id"]) + f" ({versao})")
    cofre.validar_nome(nome)
    texto = fm_aplicar(orig["texto"], {"titulo": nome, "versao": versao, "status": "vigente", "estado": "referencia",
                                        "data": hoje(), "fonte": f"duplicado de {wikilink(orig['id'])}",
                                        "substitui": wikilink(orig["id"]) if p.get("substituir") else None})
    texto = re.sub(r"^# .*$", f"# {nome}", texto, count=1, flags=re.M)
    texto = re.sub(r"^\| Versão \|[^\n]*$", f"| Versão | {versao} |", texto, count=1, flags=re.M)
    texto = re.sub(r"^\| Data \|[^\n]*$", f"| Data | {hoje()} |", texto, count=1, flags=re.M)
    texto = re.sub(r"^\| Status \|[^\n]*$", "| Status | 🟢 vigente |", texto, count=1, flags=re.M)
    texto = anexar_na_secao(texto, "Alterações / versões", [f"- {versao} ({hoje()}): duplicado de {wikilink(orig['id'])}"])
    rel = os.path.join(os.path.dirname(orig["rel"]), nome + ".md")
    h = cofre.gravar(rel, texto, novo=True)
    if p.get("substituir"):
        cofre.alterar(orig["id"], lambda t: fm_aplicar(t, {"status": "substituida", "estado": "arquivo", "substituida_por": wikilink(nome)}))
    return _resultado(rel, h, nome)


# ---------------------------------------------------------------- leitura agregada

def backlinks(cofre):
    """{nome em minúsculas: [notas que apontam para ela]} em todo o vault (menos 99 - SISTEMA)."""
    mapa = defaultdict(set)
    for chave, rel in cofre.indice().items():
        if rel.startswith("99 - SISTEMA"):
            continue
        try:
            texto = ler_arquivo(cofre.absoluto(rel))
        except Exception:
            continue
        origem = os.path.basename(rel)[:-3]
        for alvo, _ in WIKI.findall(texto):
            alvo = alvo.split("/")[-1].strip().lower()
            if alvo != chave:
                mapa[alvo].add(origem)
    return {k: sorted(v) for k, v in mapa.items()}


def texto_busca(corpo):
    t = gerar_mapa.limpar(corpo)
    t = re.sub(r"(?:^|\s)#{1,6}\s+", " ", t)
    t = re.sub(r"\s*:?-{3,}:?\s*", " ", t)
    t = re.sub(r"\s*\|\s*", " · ", t)
    return re.sub(r"(?:\s*·\s*){2,}", " · ", t).strip(" ·")[:40000]


def indice_busca(cofre, notas):
    """Texto de todas as notas (menos 99 - SISTEMA) para a busca global."""
    saida = []
    for chave, rel in sorted(cofre.indice().items()):
        if rel.startswith("99 - SISTEMA"):
            continue
        nome = os.path.basename(rel)[:-3]
        n = notas.get(nome)
        try:
            texto = ler_arquivo(cofre.absoluto(rel))
        except Exception:
            continue
        abre, fmt, fecha, corpo = separar(texto)
        fm = fm_dict(fmt)
        saida.append({
            "id": nome, "rel": rel, "tipo": n["tipo"] if n else ("inbox" if rel.startswith("80 ") else "central"),
            "cluster": n["cluster"] if n else None, "tags": gerar_mapa.tags_de(fm),
            "t": texto_busca(corpo),
            "refs": [{"alvo": r["alvo"], "rotulo": r["rotulo"], "tipo": r["tipo"], "secao": r["secao"]} for r in referencias(texto)],
        })
    return saida


def _secoes_decisao(texto):
    pega = lambda *t: texto_secao(texto, list(t))
    return {"decisao": pega("Decisão"), "contexto": pega("Contexto"), "porque": pega("Porquê", "Por quê", "Justificativa"),
            "evidencia": pega("Evidência"), "como_aplicar": pega("Como aplicar"), "nao_fazer": pega("Não fazer"),
            "alternativas": pega("Alternativas consideradas", "Alternativas"), "impactos": pega("Impactos", "Impacto"),
            "proximos": pega("Próximos passos")}


def _campo_negrito(corpo, rotulo):
    m = re.search(r"\*\*" + rotulo + r":?\*\*:?\s*(.+)", corpo)
    return m.group(1).strip() if m else ""


def processo(cofre, nome):
    nota = cofre.ler(nome)
    texto = nota["texto"]
    execucoes = [l[2:].strip() for l in texto_secao(texto, ["Execuções"]).split("\n") if l.startswith("- ")]
    return {
        "id": nota["id"], "rel": nota["rel"], "hash": nota["hash"], "status": nota["fm"].get("status", "").strip('"'),
        "origem": nota["fm"].get("origem", "").strip('"'), "quando": _campo_negrito(nota["corpo"], "Quando usar"),
        "requisitos": _campo_negrito(nota["corpo"], "Pré-requisitos"),
        "passos": nota["passos"], "checklist": [t for t in nota["tarefas"] if "execu" not in sem_acento(t["secao"])],
        "execucoes": execucoes[::-1], "links": nota["links"], "mtime": nota["mtime"],
    }


def agregado_sistema(cofre, dados, notas, sid):
    cl = next((c for c in dados["clusters"] if c["id"] == sid), None)
    if not cl:
        raise ErroCofre("nao_encontrado", f"Sistema não encontrado: {sid}", 404)
    membros = sorted([n for n in notas.values() if n["cluster"] == sid], key=lambda n: n["id"])
    ids = {n["id"] for n in membros}
    textos = {}

    def texto_de(nome):
        if nome not in textos:
            try:
                textos[nome] = ler_arquivo(cofre.absoluto(notas[nome]["rel"]))
            except Exception:
                textos[nome] = ""
        return textos[nome]

    citados = set().union(*(n["links"] for n in membros)) if membros else set()

    def ligados(tipo):
        """Do sistema + de outros sistemas ligados a ele (o link pode estar em qualquer um dos lados)."""
        dentro = [n for n in membros if n["tipo"] == tipo]
        fora = [n for n in notas.values() if n["tipo"] == tipo and n["id"] not in ids and ((n["links"] & ids) or n["id"] in citados)]
        return dentro, sorted(fora, key=lambda n: n["id"])

    decisoes = []
    dd, df = ligados("decisao")
    for n in dd + df:
        t = texto_de(n["id"])
        decisoes.append({
            "id": n["id"], "status": n["status"], "estado": n["estado"], "data": n["data"], "travado": n["travado"],
            "arquivo": n["arquivo"], "externa": n["id"] not in ids, "cluster": n["cluster"],
            "evidencia": n["fm"].get("evidencia", "").strip('"'), "fonte": n["fm"].get("fonte", "").strip('"'),
            "projetos": [a.split("/")[-1] for a in gerar_mapa.alvos(n["fm"].get("projeto"))],
            "substitui": [a.split("/")[-1] for a in gerar_mapa.alvos(n["fm"].get("substitui"))],
            "substituida_por": [a.split("/")[-1] for a in gerar_mapa.alvos(n["fm"].get("substituida_por") or n["fm"].get("substituido_por"))],
            "secoes": _secoes_decisao(t), "hash": hash_texto(t),
        })
    decisoes.sort(key=lambda d: (d["data"] or ""), reverse=True)

    processos = []
    pd, pf = ligados("processo")
    for n in pd + pf:
        try:
            proc = processo(cofre, n["id"])
        except ErroCofre:
            continue
        proc["externo"] = n["id"] not in ids
        processos.append(proc)

    lista_tarefas, arquivos = [], []
    for n in membros:
        t = texto_de(n["id"])
        for tf in tarefas(t):
            if "execu" in sem_acento(tf["secao"]) or n["tipo"] == "processo":
                continue
            tf.update(nota=n["id"], tipo=n["tipo"])
            lista_tarefas.append(tf)
        for r in referencias(t):
            r.update(nota=n["id"], tipo_nota=n["tipo"], data=n["data"])
            arquivos.append(r)

    rels = {notas[i]["rel"]: i for i in ids}
    atividade = []
    for c in cofre.log_git():
        tocadas = sorted({rels[a] for a in c["arquivos"] if a in rels})
        if tocadas:
            atividade.append({"hash": c["hash"], "data": c["data"], "msg": c["msg"], "notas": tocadas})
        if len(atividade) >= 15:
            break
    pendentes = [{"estado": x["estado"], "nota": rels[x["rel"]]} for x in cofre.pendentes_git() if x["rel"] in rels]

    conexoes = Counter()
    for a, b in dados["links"]:
        ca, cb = notas[a]["cluster"], notas[b]["cluster"]
        if ca == sid and cb != sid:
            conexoes[cb] += 1
        elif cb == sid and ca != sid:
            conexoes[ca] += 1

    hub_md = ""
    if cl.get("hub") and cl["hub"] in notas:
        corpo = notas[cl["hub"]]["corpo"]
        hub_md = texto_secao(texto_de(cl["hub"]), ["Quem é", "Visão geral"]) or re.sub(r"^\s*#\s+[^\n]*\n", "", corpo.strip(), count=1)[:1600]

    return {
        "id": sid, "nome": cl["nome"], "hub": cl.get("hub"), "hub_md": hub_md.strip(),
        "decisoes": decisoes, "processos": processos, "tarefas": lista_tarefas, "arquivos": arquivos,
        "atividade": atividade, "pendentes_git": pendentes,
        "conexoes": [{"id": k, "n": v} for k, v in conexoes.most_common()],
    }


def painel_hoje(cofre, dados, notas):
    """Painel "Hoje": pendências abertas de 00 - CENTRAL/Pendências.md (urgentes primeiro), últimas notas tocadas
    (git) e contagens reais. Nada é inventado: tudo vem do vault."""
    pend = []
    try:
        nota = cofre.ler("Pendências")
        ordem = []
        for t in nota["tarefas"]:
            if t["feito"]:
                continue
            sec = t["secao"] or ""
            s = sem_acento(sec)
            peso = 0 if ("urgente" in s or "🔴" in sec) else 1 if ("seguran" in s or "🔐" in sec) else 2
            ordem.append((peso, t["linha"], {"texto": t["texto"], "secao": sec, "linha": t["linha"]}))
        ordem.sort(key=lambda x: (x[0], x[1]))
        pend = [x[2] for x in ordem]
    except Exception:  # noqa: BLE001
        pend = []
    rels = {n["rel"]: i for i, n in notas.items()}
    atividade, vistas, recentes = [], set(), []
    for c in cofre.log_git():
        tocadas = sorted({rels[a] for a in c["arquivos"] if a in rels and not a.startswith(("99 ", "00 "))})
        if not tocadas:
            continue
        atividade.append({"hash": c["hash"], "data": c["data"], "msg": c["msg"], "notas": tocadas[:6], "total": len(tocadas)})
        for i in tocadas:
            if i not in vistas and len(recentes) < 10:
                vistas.add(i)
                n = notas[i]
                recentes.append({"id": i, "tipo": n["tipo"], "cluster": n["cluster"], "data": c["data"]})
        if len(atividade) >= 8:
            break
    nos = dados["nos"]
    ativos = [n["id"] for n in nos if n["tipo"] == "projeto" and n["status"] == "ativo" and not n["arquivo"]]
    return {"pendencias": pend[:40], "total_pendencias": len(pend), "atividade": atividade, "recentes": recentes,
            "projetos_ativos": sorted(ativos), "gerado": dados["gerado"]}
