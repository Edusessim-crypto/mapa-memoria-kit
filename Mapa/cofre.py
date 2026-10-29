"""Leitura e escrita segura do vault para a interface do Segundo Cérebro.

Regras:
- Só arquivos .md dentro do vault; nunca .obsidian/, .git/ nem 99 - SISTEMA/ (modelos e o próprio mapa).
- Escrita atômica (arquivo temporário oculto + os.replace) e checagem de conflito pelo hash do que foi lido.
- Notas novas nascem dos modelos oficiais de 99 - SISTEMA/Templates.
- Nome de nota nunca muda por aqui (renomear quebraria os [[links]]; isso é feito no Obsidian).
- Nada é apagado: "excluir" move o arquivo para a Lixeira do Mac.
Compatível com o Python 3.9 do macOS (/usr/bin/python3).
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
import unicodedata
from datetime import datetime

PASTAS = {
    "conhecimento": "40 - CONHECIMENTO",
    "sop": "50 - RECURSOS/SOPs",
    "prompt": "50 - RECURSOS/Prompts",
    "pessoa": "60 - PESSOAS",
    "projeto": "10 - PROJETOS",
    "cliente": "20 - CLIENTES E MARCAS",
    "decisao": "70 - DECISÕES",
}
MODELOS = {"conhecimento": "Conhecimento", "sop": "SOP", "prompt": "Prompt", "pessoa": "Pessoa",
           "projeto": "Projeto", "cliente": "Cliente", "decisao": "Decisão"}
PREFIXO = {"sop": "SOP — ", "prompt": "Prompt — ", "decisao": "Decisão — "}
PROIBIDOS = set(':|?*"<>\\/[]#^')
SEM_ESCRITA = ("99 - SISTEMA",)
FM = re.compile(r"^(---\n)(.*?)(\n---)(\n?)", re.S)
WIKI = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]")
TAREFA = re.compile(r"^(\s*)([-*]) \[([ xX])\] (.*)$")
URL = re.compile(r"https?://[^\s)\]>`'\"|]+")
LINK_MD = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")
CAMINHO = re.compile(r"(?<![\w/.])((?:~|/Users/[^/\s`]+)/[^\s`'\"|)]+)")
CERCA = re.compile(r"^\s*(```|~~~)")


class ErroCofre(Exception):
    def __init__(self, codigo, mensagem, status=400, extra=None):
        super().__init__(mensagem)
        self.codigo, self.mensagem, self.status, self.extra = codigo, mensagem, status, extra or {}


def hash_texto(texto):
    return hashlib.sha1(texto.encode("utf-8")).hexdigest()


def sem_acento(s):
    return unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()


def hoje():
    return datetime.now().strftime("%Y-%m-%d")


def ler_arquivo(caminho):
    with open(caminho, encoding="utf-8") as f:
        return f.read()


# ---------------------------------------------------------------- frontmatter

def separar(texto):
    """(abre, fm, fecha, corpo) preservando exatamente o texto; fm None quando não há frontmatter."""
    m = FM.match(texto)
    if not m:
        return None, None, None, texto
    return m.group(1), m.group(2), m.group(3) + m.group(4), texto[m.end():]


def fm_dict(fm_texto):
    fm = {}
    for linha in (fm_texto or "").splitlines():
        if ":" in linha and not linha.startswith((" ", "-")):
            k, v = linha.split(":", 1)
            fm[k.strip()] = v.strip()
    return fm


def fm_valor(v):
    """Formata um valor no estilo do vault (listas inline, wikilinks entre aspas, datas sem aspas)."""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(fm_valor(x) for x in v) + "]"
    s = re.sub(r"\s+", " ", str(v)).strip()
    if not s:
        return ""
    arriscado = (s[0] in "[]{}#&*!|>'\"%@,`?-" or ": " in s or " #" in s or s.endswith(":") or "[[" in s
                 or s.lower() in ("true", "false", "null", "yes", "no", "~"))
    return json.dumps(s, ensure_ascii=False) if arriscado else s


def fm_aplicar(texto, mudancas):
    """Troca/insere/remove chaves do frontmatter mexendo só nessas linhas. mudancas: {chave: valor | None}."""
    abre, fm_texto, fecha, corpo = separar(texto)
    if fm_texto is None:
        abre, fm_texto, fecha = "---\n", "", "\n---\n"
        corpo = "\n" + corpo if corpo and not corpo.startswith("\n") else corpo
    linhas = fm_texto.split("\n") if fm_texto else []
    for chave, valor in mudancas.items():
        idx = next((i for i, l in enumerate(linhas) if re.match(r"^" + re.escape(chave) + r"\s*:", l)), None)
        if valor is None:
            if idx is not None:
                del linhas[idx]
            continue
        nova = f"{chave}: {fm_valor(valor)}".rstrip()
        if idx is None:
            linhas.append(nova)
        else:
            linhas[idx] = nova
    return abre + "\n".join(linhas) + fecha + corpo


def wikilink(nome):
    return f"[[{nome}]]"


def alvos(valor):
    return [a.strip() for a, _ in WIKI.findall(valor or "")]


# ---------------------------------------------------------------- corpo: seções, tarefas, links

def linhas_fora_de_codigo(linhas, inicio=0):
    """Índices das linhas que não estão dentro de blocos de código."""
    dentro, cerca = False, None
    for i in range(inicio, len(linhas)):
        m = CERCA.match(linhas[i])
        if m:
            if not dentro:
                dentro, cerca = True, m.group(1)
                continue
            if linhas[i].strip().startswith(cerca):
                dentro, cerca = False, None
                continue
        if not dentro:
            yield i


def inicio_corpo(texto):
    abre, fm, fecha, corpo = separar(texto)
    return 0 if fm is None else (abre + fm + fecha).count("\n")


def secoes(texto):
    """[{titulo, nivel, linha, fim}] dos cabeçalhos ## e ### (linhas do arquivo inteiro)."""
    linhas = texto.split("\n")
    cab = []
    for i in linhas_fora_de_codigo(linhas, inicio_corpo(texto)):
        m = re.match(r"^(#{1,6})\s+(.+?)\s*#*\s*$", linhas[i])
        if m:
            cab.append({"titulo": m.group(2).strip(), "nivel": len(m.group(1)), "linha": i})
    for k, c in enumerate(cab):
        c["fim"] = next((d["linha"] for d in cab[k + 1:] if d["nivel"] <= c["nivel"]), len(linhas))
    return cab


def chave_secao(titulo):
    return re.sub(r"[^a-z0-9 ]", "", sem_acento(titulo)).strip()


def achar_secao(texto, titulos, nivel=2):
    alvo = {chave_secao(t) for t in titulos}
    for s in secoes(texto):
        if s["nivel"] == nivel and chave_secao(s["titulo"]) in alvo:
            return s
    return None


def texto_secao(texto, titulos, nivel=2):
    s = achar_secao(texto, titulos, nivel)
    if not s:
        return ""
    return "\n".join(texto.split("\n")[s["linha"] + 1:s["fim"]]).strip()


def anexar_na_secao(texto, titulo, novas, nivel=2, antes_de=None):
    """Acrescenta linhas no fim do conteúdo da seção (cria a seção se faltar).
    Substitui marcadores vazios do modelo ("- [ ]", "-", "—")."""
    linhas = texto.split("\n")
    s = achar_secao(texto, [titulo], nivel)
    if not s:
        bloco = ["#" * nivel + " " + titulo] + novas + [""]
        destino = achar_secao(texto, antes_de, nivel) if antes_de else None
        if destino:
            linhas[destino["linha"]:destino["linha"]] = bloco
        else:
            while linhas and not linhas[-1].strip():
                linhas.pop()
            linhas += [""] + bloco
        return "\n".join(linhas)
    ini, fim = s["linha"] + 1, s["fim"]
    # subseções (###) ficam depois do conteúdo direto da seção
    sub = next((x["linha"] for x in secoes(texto) if ini <= x["linha"] < fim), fim)
    for i in range(ini, sub):
        if linhas[i].strip() in ("- [ ]", "-", "—", "- "):
            del linhas[i]
            sub -= 1
            fim -= 1
            break
    pos = sub
    while pos > ini and not linhas[pos - 1].strip():
        pos -= 1
    linhas[pos:pos] = novas
    if pos + len(novas) < len(linhas) and linhas[pos + len(novas)].strip().startswith("#"):
        linhas.insert(pos + len(novas), "")
    return "\n".join(linhas)


def tarefas(texto):
    """Checkboxes do arquivo: [{linha, feito, texto, bruto, secao, nivel}]."""
    linhas = texto.split("\n")
    titulo, saida = "", []
    for i in linhas_fora_de_codigo(linhas, inicio_corpo(texto)):
        m = re.match(r"^#{1,6}\s+(.+)$", linhas[i])
        if m:
            titulo = m.group(1).strip()
            continue
        t = TAREFA.match(linhas[i])
        if t:
            saida.append({"linha": i, "feito": t.group(3) != " ", "texto": t.group(4).strip(), "bruto": linhas[i],
                          "secao": titulo, "nivel": len(t.group(1).replace("\t", "    ")) // 2})
    return saida


def referencias(texto):
    """Links externos e caminhos locais citados na nota: [{tipo, alvo, rotulo, secao, contexto}]."""
    linhas = texto.split("\n")
    titulo, saida, vistos = "", [], set()
    for i in linhas_fora_de_codigo(linhas, inicio_corpo(texto)):
        l = linhas[i]
        m = re.match(r"^#{1,6}\s+(.+)$", l)
        if m:
            titulo = m.group(1).strip()
            continue
        rotulos = {u: r for r, u in LINK_MD.findall(l)}
        contexto = re.sub(r"\s+", " ", WIKI.sub(lambda x: x.group(2) or x.group(1), l)).strip(" -*>")[:200]
        for u in URL.findall(l):
            u = u.rstrip(".,;:")
            if u not in vistos:
                vistos.add(u)
                saida.append({"tipo": "url", "alvo": u, "rotulo": rotulos.get(u, ""), "secao": titulo, "contexto": contexto})
        for c in CAMINHO.findall(l):
            c = c.rstrip(".,;:")
            if c not in vistos and len(c) > 3:
                vistos.add(c)
                saida.append({"tipo": "caminho", "alvo": c, "rotulo": "", "secao": titulo, "contexto": contexto})
    fm = fm_dict(separar(texto)[1])
    for campo in ("repositorio", "pasta_local", "deploy", "url"):
        v = (fm.get(campo) or "").strip().strip('"').strip("'")
        if not v or v in ("—", "-"):
            continue
        if v.startswith(("~", "/")):
            alvos_fm = [("caminho", v)]
        elif re.match(r"^https?://\S+$", v):
            alvos_fm = [("url", v)]
        else:  # texto livre ("site.vercel.app (Vercel) · dominio.com.br"): só os domínios viram link
            alvos_fm = [("url", "https://" + d) for d in re.findall(r"(?<![\w@/.-])((?:[a-z0-9-]+\.)+(?:app|com|br|dev|io|net|org|site|online))(?:\.br)?\b", v.lower())]
        for tipo, alvo in reversed(alvos_fm):
            if alvo not in vistos:
                vistos.add(alvo)
                saida.insert(0, {"tipo": tipo, "alvo": alvo, "rotulo": campo, "secao": "frontmatter", "contexto": v[:200]})
    return saida


def passos(texto):
    """Etapas numeradas (1. 2. 3.) agrupadas pela seção em que aparecem."""
    linhas = texto.split("\n")
    titulo, saida = "", []
    for i in linhas_fora_de_codigo(linhas, inicio_corpo(texto)):
        l = linhas[i]
        m = re.match(r"^#{1,6}\s+(.+)$", l)
        if m:
            titulo = m.group(1).strip()
            continue
        p = re.match(r"^\s{0,3}(\d+)[.)]\s+(.+)$", l)
        if p and p.group(2).strip():
            saida.append({"linha": i, "n": int(p.group(1)), "texto": p.group(2).strip(), "secao": titulo})
    return saida


# ---------------------------------------------------------------- o cofre

class Cofre:
    def __init__(self, raiz, lixeira=None):
        self.raiz = os.path.realpath(raiz)
        self.lixeira = lixeira or os.path.expanduser("~/.Trash")
        self.trava = threading.RLock()
        self._indice, self._assinatura, self._git = None, None, None

    # -------- índice de nomes
    def _varrer(self):
        for dp, dn, fn in os.walk(self.raiz):
            dn[:] = [d for d in dn if not d.startswith(".")]
            for f in fn:
                if f.endswith(".md") and not f.startswith("."):
                    yield os.path.join(dp, f)

    def assinatura(self):
        h = hashlib.sha1()
        for p in sorted(self._varrer()):
            try:
                st = os.stat(p)
            except OSError:
                continue
            h.update(f"{p}|{st.st_mtime_ns}|{st.st_size}\n".encode("utf-8"))
        return h.hexdigest()[:16]

    def indice(self):
        assin = self.assinatura()
        if self._indice is None or assin != self._assinatura:
            idx = {}
            for p in self._varrer():
                rel = unicodedata.normalize("NFC", os.path.relpath(p, self.raiz))
                if "/" in rel:  # AGENTS.md e CLAUDE.md da raiz ficam de fora
                    idx[os.path.basename(rel)[:-3].lower()] = rel
            self._indice, self._assinatura = idx, assin
        return self._indice

    def existe(self, nome):
        return unicodedata.normalize("NFC", nome.strip()).lower() in self.indice()

    def rel_de(self, nome):
        rel = self.indice().get(unicodedata.normalize("NFC", (nome or "").strip()).lower())
        if not rel:
            raise ErroCofre("nao_encontrado", f"Nota não encontrada: {nome}", 404)
        return rel

    def absoluto(self, rel, escrever=False):
        caminho = os.path.realpath(os.path.join(self.raiz, rel))
        if not caminho.startswith(self.raiz + os.sep) or not caminho.endswith(".md"):
            raise ErroCofre("permissao", "Caminho fora do vault.", 403)
        partes = os.path.relpath(caminho, self.raiz).split(os.sep)
        if any(p.startswith(".") for p in partes):
            raise ErroCofre("permissao", "Pastas ocultas não podem ser lidas nem alteradas.", 403)
        if escrever and partes[0] in SEM_ESCRITA:
            raise ErroCofre("permissao", "Arquivos de sistema (99 - SISTEMA) não são alterados pela interface.", 403)
        return caminho

    # -------- leitura
    def ler(self, nome):
        rel = self.rel_de(nome)
        caminho = self.absoluto(rel)
        texto = ler_arquivo(caminho)
        abre, fm_texto, fecha, corpo = separar(texto)
        return {
            "id": os.path.basename(rel)[:-3], "rel": rel, "texto": texto, "corpo": corpo,
            "fm": fm_dict(fm_texto), "hash": hash_texto(texto),
            "mtime": datetime.fromtimestamp(os.path.getmtime(caminho)).strftime("%Y-%m-%d %H:%M"),
            "tarefas": tarefas(texto), "secoes": [{k: s[k] for k in ("titulo", "nivel", "linha")} for s in secoes(texto)],
            "referencias": referencias(texto), "passos": passos(texto),
            "links": sorted({a.split("/")[-1] for a in alvos(texto)}),
            "editavel": rel.split("/")[0] not in SEM_ESCRITA,
        }

    def modelo(self, tipo, titulo):
        caminho = os.path.join(self.raiz, "99 - SISTEMA", "Templates", f"Modelo de {MODELOS[tipo]}.md")
        if os.path.exists(caminho):
            texto = ler_arquivo(caminho)
        else:
            texto = f"---\ntype: {tipo}\nestado: referencia\n---\n\n# {{{{title}}}}\n"
        return texto.replace("{{title}}", titulo).replace("{{date}}", hoje())

    # -------- escrita
    def validar_nome(self, nome):
        nome = re.sub(r"\s+", " ", (nome or "").strip())
        if not nome:
            raise ErroCofre("validacao", "Dê um título à nota.", 422, {"campo": "titulo"})
        if len(nome) > 150:
            raise ErroCofre("validacao", "Título longo demais (máx. 150 caracteres).", 422, {"campo": "titulo"})
        ruins = sorted({c for c in nome if c in PROIBIDOS})
        if ruins or nome.startswith("."):
            raise ErroCofre("validacao", "O título não pode ter " + " ".join(ruins or ["ponto no início"]) +
                            " (quebram o nome do arquivo ou os [[links]]).", 422, {"campo": "titulo"})
        if self.existe(nome):
            raise ErroCofre("duplicado", f"Já existe uma nota chamada “{nome}”. Abra a existente ou escolha outro título.",
                            409, {"campo": "titulo", "existente": nome})
        return nome

    def gravar(self, rel, texto, base=None, novo=False):
        caminho = self.absoluto(rel, escrever=True)
        with self.trava:
            if novo:
                if os.path.exists(caminho) or self.existe(os.path.basename(rel)[:-3]):
                    raise ErroCofre("duplicado", "Já existe uma nota com esse nome.", 409)
                os.makedirs(os.path.dirname(caminho), exist_ok=True)
            else:
                if not os.path.exists(caminho):
                    raise ErroCofre("nao_encontrado", "A nota não existe mais (foi movida ou apagada fora daqui).", 404)
                atual = ler_arquivo(caminho)
                if base and hash_texto(atual) != base:
                    raise ErroCofre("conflito", "A nota mudou fora daqui (Obsidian ou Claude) desde que você abriu.", 409,
                                    {"atual": atual, "hash": hash_texto(atual)})
            temp = os.path.join(os.path.dirname(caminho), "." + os.path.basename(caminho) + ".sc-tmp")
            with open(temp, "w", encoding="utf-8", newline="\n") as f:
                f.write(texto)
            os.replace(temp, caminho)
            self._indice = None
        return hash_texto(texto)

    def editar(self, nome, base, corpo=None, fm=None):
        def aplicar(texto):
            if corpo is not None:
                abre, fm_texto, fecha, _ = separar(texto)
                texto = (abre + fm_texto + fecha if fm_texto is not None else "") + corpo
            return fm_aplicar(texto, fm) if fm else texto
        return self.alterar(nome, aplicar, base)

    def alterar(self, nome, funcao, base=None):
        """Lê, aplica funcao(texto) -> texto e grava, tudo sob a mesma trava."""
        with self.trava:
            rel = self.rel_de(nome)
            texto = ler_arquivo(self.absoluto(rel))
            if base and hash_texto(texto) != base:
                raise ErroCofre("conflito", "A nota mudou fora daqui desde que você abriu.", 409,
                                {"atual": texto, "hash": hash_texto(texto)})
            novo = funcao(texto)
            if novo == texto:
                return rel, hash_texto(texto)
            return rel, self.gravar(rel, novo, hash_texto(texto))

    def nome_final(self, tipo, titulo):
        titulo = re.sub(r"\s+", " ", (titulo or "").strip())
        prefixo = PREFIXO.get(tipo, "")
        if prefixo and titulo.lower().startswith(prefixo.lower()):
            titulo = titulo[len(prefixo):].strip()
        return titulo, prefixo + titulo

    def criar(self, tipo, titulo, corpo=None, fm=None, pasta=None):
        """Cria a nota a partir do modelo oficial. corpo=None mantém o corpo do modelo."""
        if tipo not in PASTAS:
            raise ErroCofre("validacao", f"Tipo de nota desconhecido: {tipo}", 422)
        curto, nome = self.nome_final(tipo, titulo)
        if not curto:
            raise ErroCofre("validacao", "Dê um título à nota.", 422, {"campo": "titulo"})
        self.validar_nome(nome)
        rel = os.path.join(pasta or PASTAS[tipo], nome + ".md")
        texto = self.modelo(tipo, curto)
        if corpo is not None:
            abre, fm_texto, fecha, _ = separar(texto)
            corpo = corpo.strip("\n")
            if not re.match(r"^#\s", corpo):
                corpo = f"# {nome}\n\n" + corpo
            texto = abre + fm_texto + fecha + "\n" + corpo + "\n"
        if fm:
            texto = fm_aplicar(texto, fm)
        return rel, self.gravar(rel, texto, novo=True), nome

    def mover_para_lixeira(self, nome, base=None):
        with self.trava:
            rel = self.rel_de(nome)
            caminho = self.absoluto(rel, escrever=True)
            atual = ler_arquivo(caminho)
            if base and hash_texto(atual) != base:
                raise ErroCofre("conflito", "A nota mudou fora daqui desde que você abriu. Reabra antes de excluir.", 409)
            os.makedirs(self.lixeira, exist_ok=True)
            destino = os.path.join(self.lixeira, os.path.basename(caminho))
            if os.path.exists(destino):
                destino = os.path.join(self.lixeira, f"{nome} {datetime.now().strftime('%Y-%m-%d %H.%M.%S')}.md")
            shutil.move(caminho, destino)
            self._indice = None
            return rel, destino

    # -------- git (somente leitura)
    def _git_cmd(self, *args):
        try:
            r = subprocess.run(["git", "-C", self.raiz, "-c", "core.quotepath=off", *args],
                               capture_output=True, text=True, timeout=8)
            return r.stdout if r.returncode == 0 else ""
        except Exception:
            return ""

    def historico(self, rel, limite=20):
        saida = []
        for linha in self._git_cmd("log", "--follow", f"-{limite}", "--format=%h%x09%cI%x09%s", "--", rel).splitlines():
            partes = linha.split("\t", 2)
            if len(partes) == 3:
                saida.append({"hash": partes[0], "data": partes[1][:16].replace("T", " "), "msg": partes[2]})
        return saida

    def versao(self, rel, commit):
        if not re.fullmatch(r"[0-9a-f]{4,40}", commit or ""):
            raise ErroCofre("validacao", "Versão inválida.", 422)
        return self._git_cmd("show", f"{commit}:{rel}")

    def log_git(self):
        """[{hash, data, msg, arquivos}] — cache pelo HEAD."""
        head = self._git_cmd("rev-parse", "HEAD").strip()
        if self._git and self._git[0] == head:
            return self._git[1]
        commits, atual = [], None
        for linha in self._git_cmd("log", "-200", "--name-only", "--format=@@%h%x09%cI%x09%s").splitlines():
            if linha.startswith("@@"):
                h, d, m = (linha[2:].split("\t", 2) + ["", ""])[:3]
                atual = {"hash": h, "data": d[:16].replace("T", " "), "msg": m, "arquivos": []}
                commits.append(atual)
            elif linha.strip() and atual is not None:
                atual["arquivos"].append(linha.strip())
        self._git = (head, commits)
        return commits

    def pendentes_git(self):
        """Arquivos .md alterados e ainda não registrados no git."""
        saida = []
        for linha in self._git_cmd("status", "--porcelain", "--untracked-files=all").splitlines():
            caminho = linha[3:].strip().strip('"')
            if " -> " in caminho:
                caminho = caminho.split(" -> ")[-1]
            if caminho.endswith(".md"):
                saida.append({"estado": linha[:2].strip() or "?", "rel": caminho})
        return saida
