#!/usr/bin/env python3
"""Gera o Mapa do Segundo Cérebro (HTML) a partir das notas do vault.

Uso: python3 "99 - SISTEMA/Mapa/gerar_mapa.py"  (de qualquer pasta)
Saída: "Mapa do Segundo Cérebro.html" (3D) e "Mapa do Segundo Cérebro (2D).html", nesta pasta.
Só lê as notas; não altera nada no vault. O servidor (servidor.py) usa construir_dados() e montar_html().
"""
import hashlib
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

AQUI = os.path.dirname(os.path.abspath(__file__))
VAULT = os.path.abspath(os.path.join(AQUI, "..", ".."))
SAIDAS = [  # (modelo, arquivo gerado)
    ("mapa3d.template.html", "Mapa do Segundo Cérebro.html"),
    ("mapa2d.template.html", "Mapa do Segundo Cérebro (2D).html"),
]
PASTA_UI = os.path.join(AQUI, "ui")
TAREFA = re.compile(r"^\s*[-*] \[([ xX])\] ", re.M)

# Ajustes opcionais de agrupamento (edite se quiser):
#   FUNDIR = marcas/clientes que orbitam outro sistema, ex.: {"Marca Filha": "Cliente Principal"}
#   PASTA_CLUSTER = subpasta de 20 - CLIENTES E MARCAS que representa outro cliente, ex.: {"Ecossistema X": "Cliente X"}
#   NOME_CLUSTER = nome exibido no mapa para um sistema, ex.: {"Cliente X": "Cliente X · Produtos"}
FUNDIR = {}
PASTA_CLUSTER = {}
NOME_CLUSTER = {
    "Avulsos": "Projetos avulsos",
}
GERAL = "Núcleo"
AVULSOS = "Avulsos"

# Voz da narração (ElevenLabs). A chave fica fora do vault; sem ela, o mapa usa as vozes do Mac.
CONFIG_VOZ = os.environ.get("SC_VOZ_CONFIG") or os.path.expanduser("~/.config/segundo-cerebro/elevenlabs.env")
PASTA_VOZ = os.path.join(AQUI, "voz")
# Áudios que já vieram prontos com o kit (frases fixas do sistema), indexados pelo texto: valem para qualquer voz
# configurada e poupam créditos. Para usar só a sua voz, apague a pasta voz/pre-gravados.
PASTA_PRE_GRAVADOS = os.path.join(PASTA_VOZ, "pre-gravados")
NOME_PADRAO = "Roberto"   # dono do vault; mude com SC_NOME em elevenlabs.env (ou na variável de ambiente)
API_VOZ = "https://api.elevenlabs.io/v1"

WIKI = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]")


def frontmatter(texto):
    m = re.match(r"---\n(.*?)\n---\n?", texto, re.S)
    if not m:
        return {}, texto
    fm = {}
    for linha in m.group(1).splitlines():
        if ":" in linha and not linha.startswith((" ", "-")):
            k, v = linha.split(":", 1)
            fm[k.strip()] = v.strip()
    return fm, texto[m.end():]


def alvos(valor):
    return [a.strip() for a, _ in WIKI.findall(valor or "")]


def limpar(md):
    md = WIKI.sub(lambda m: m.group(2) or m.group(1).split("/")[-1], md)
    md = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", md)
    md = re.sub(r"^\s*>\s?(\[![a-z]+\][+-]?)?", "", md, flags=re.M)
    md = re.sub(r"\*\*|__|`|~~|(?<!\w)\*(?!\s)|(?<!\s)\*(?!\w)", "", md)
    md = re.sub(r"^\s*[-*]\s+", "", md, flags=re.M)
    md = re.sub(r"\s+", " ", md)
    return md.strip()


def resumo(corpo, tipo):
    linhas = corpo.splitlines()
    if tipo == "decisao":
        for i, l in enumerate(linhas):
            if l.strip().lower().startswith("## decisão"):
                bloco = []
                for l2 in linhas[i + 1:]:
                    if l2.startswith("## "):
                        break
                    if l2.strip() and not l2.lstrip().startswith("|"):
                        bloco.append(l2)
                txt = limpar(" ".join(bloco))
                if txt:
                    return txt[:320]
    m = re.search(r"^> \[!summary\][^\n]*\n((?:>.*\n?)+)", corpo, re.M)
    if m and limpar(m.group(1)):
        return limpar(m.group(1))[:320]
    m = re.search(r"^## (Visão geral|Quem é|Ideia central|Decisão)\s*\n+(.+?)(?=\n## |\Z)", corpo, re.M | re.S)
    if m:
        bloco = [l for l in m.group(2).splitlines() if l.strip() and not l.lstrip().startswith(("|", "#"))]
        if bloco and len(limpar(" ".join(bloco[:4]))) > 25:
            return limpar(" ".join(bloco[:4]))[:320]
    for bloco in re.split(r"\n\s*\n", corpo):
        b = bloco.strip()
        if not b or b.startswith(("#", "|", "<!--", "---", "> [!")) or b.startswith("🔒 **TRAVADO"):
            continue
        txt = limpar(b)
        if len(txt) > 25:
            return txt[:320]
    return ""


def tipo_de(rel, fm):
    pasta = rel.split("/")[0]
    if pasta.startswith("10 "):
        return "projeto"
    if pasta.startswith("20 "):
        return "cliente" if fm.get("type") in ("cliente", "marca") else "marca"
    if pasta.startswith("30 "):
        return "area"
    if pasta.startswith("40 "):
        return "conhecimento"
    if pasta.startswith("45 "):
        return "stack"
    if pasta.startswith("50 "):
        if "/SOPs/" in rel:
            return "processo"
        if "/Prompts/" in rel:
            return "prompt"
        return "recurso"
    if pasta.startswith("60 "):
        return "pessoa"
    if pasta.startswith("70 "):
        return "decisao"
    if pasta.startswith("90 "):
        return fm.get("type", "projeto") if fm.get("type") in ("projeto", "decisao") else "recurso"
    return None


def textos_narracao(clusters, nos=()):
    """Frases faladas (modo apresentação e respostas dos comandos de voz) — a página usa estes mesmos textos."""
    def plural(n, um, varios):
        return f"{n} {um if n == 1 else varios}"
    narr = {}
    for c in clusters:
        if c["id"] == GERAL:
            narr[c["id"]] = f"Núcleo de memória. {c['total']} notas gerais de conhecimento."
        elif c["total"] >= 3:
            t = c["tipos"]
            narr[c["id"]] = (f"Sistema {c['nome'].replace(' · ', ', ')}. "
                             f"{plural(t.get('projeto', 0), 'projeto', 'projetos')}, "
                             f"{plural(t.get('decisao', 0), 'decisão', 'decisões')}.")
    narr["__fim"] = "Apresentação concluída."
    narr["__teste"] = f"Olá, {nome_dono()}. Segundo Cérebro online. {len(clusters)} sistemas em órbita."
    # respostas dos comandos de voz (ui/70-voz.js)
    for c in clusters:
        narr[f"__abrir:{c['id']}"] = ("Abrindo o núcleo de memória." if c["id"] == GERAL
                                     else f"Abrindo o sistema {c['nome'].replace(' · ', ', ')}.")
    travadas = sum(1 for n in nos if n.get("travado") and n.get("tipo") == "decisao" and not n.get("arquivo"))
    narr.update({
        "__cmd_travadas": f"Mostrando as {travadas} decisões travadas.",
        "__cmd_visao": "Visão geral.",
        "__cmd_apres": "Iniciando a apresentação.",
        "__cmd_apres_fim": "Apresentação encerrada.",
        "__cmd_busca": "Buscando.",
        "__cmd_nota": "Abrindo a nota.",
        "__cmd_ws": "Abrindo o painel do sistema.",
        "__cmd_fechar": "Pronto.",
        "__cmd_ok": "Feito.",
        "__cmd_zoom_in": "Aproximando.",
        "__cmd_zoom_out": "Afastando.",
        "__cmd_pausa": "Movimento pausado.",
        "__cmd_retoma": "Movimento retomado.",
        "__cmd_nao_entendi": "Não entendi. Diga ajuda para ouvir os comandos.",
        "__cmd_ajuda": ("Você pode pedir: abrir um sistema ou uma nota, buscar, mostrar as decisões travadas, "
                        "modo apresentação, visão geral, aproximar, afastar, pausar, esconder ou mostrar categorias, "
                        "e ligar ou desligar o som."),
    })
    # conversa (ui/70-voz.js): falas enquanto o Claude pesquisa — saudação na 1ª pergunta, variações depois,
    # o sistema citado na pergunta e, se demorar, frases de espera
    for i, t in enumerate(FALAS_SAUDACAO["manha"] + FALAS_SAUDACAO["tarde"] + FALAS_SAUDACAO["noite"]):
        narr[f"__saud_{('manha', 'tarde', 'noite')[i // 3]}_{i % 3 + 1}"] = t
    for i, t in enumerate(FALAS_PENSANDO, 1):
        narr[f"__pensa_{i}"] = t
    for i, t in enumerate(FALAS_ESPERA, 1):
        narr[f"__espera_{i}"] = t
    for c in clusters:
        narr[f"__pesq:{c['id']}"] = ("Acessando o núcleo de memória." if c["id"] == GERAL
                                    else f"Acessando o sistema {c['nome'].split(' · ')[0]}.")
    return narr


FALAS_SAUDACAO = {
    "manha": ["Bom dia, senhor. Sistemas online. Vou verificar isso para você.",
              "Bom dia. Já estou acessando o Segundo Cérebro, um instante.",
              "Bom dia, senhor. Deixe-me consultar os seus registros."],
    "tarde": ["Boa tarde, senhor. Um instante, estou acessando os seus arquivos.",
              "Boa tarde. Sistemas prontos. Já estou pesquisando.",
              "Boa tarde, senhor. Deixe comigo, vou levantar isso agora."],
    "noite": ["Boa noite, senhor. Vou consultar o núcleo de memória.",
              "Boa noite. Trabalhando até tarde, como sempre. Já estou verificando.",
              "Boa noite, senhor. Um momento, estou cruzando as informações."],
}
FALAS_PENSANDO = ["Um instante, senhor.", "Verificando.", "Consultando os registros.",
                  "Deixe-me ver o que temos sobre isso.", "Cruzando projetos e decisões, um momento.",
                  "Acessando o núcleo de memória.", "Certo. Já estou pesquisando.", "Boa pergunta. Só um segundo.",
                  "Entendido. Levantando os dados.", "Analisando as notas relacionadas.",
                  "Pesquisando no Segundo Cérebro.", "Um momento, estou checando os detalhes."]
FALAS_ESPERA = ["Ainda estou analisando, quase lá.", "Encontrei algumas notas, estou organizando a resposta.",
                "Só mais um instante, senhor.", "Cruzando as últimas referências.", "Quase pronto.",
                "Conferindo os detalhes para não lhe passar nada errado."]


def nome_dono():
    """Primeiro nome do dono do vault (SC_NOME na config ou no ambiente); é como o Jarvis chama a pessoa."""
    return (os.environ.get("SC_NOME") or ler_config_voz().get("SC_NOME") or NOME_PADRAO).strip() or NOME_PADRAO


def pre_gravados():
    """{texto: 'voz/pre-gravados/arquivo.mp3'} dos áudios que vieram com o kit e ainda existem."""
    try:
        with open(os.path.join(PASTA_PRE_GRAVADOS, "pre-gravados.json"), encoding="utf-8") as f:
            itens = json.load(f)
    except (OSError, ValueError):
        return {}
    return {t: f"voz/pre-gravados/{a}" for t, a in itens.items() if os.path.exists(os.path.join(PASTA_PRE_GRAVADOS, a))}


def ler_config_voz():
    cfg = {}
    if os.path.exists(CONFIG_VOZ):
        for linha in open(CONFIG_VOZ, encoding="utf-8"):
            linha = linha.strip()
            if linha and not linha.startswith("#") and "=" in linha:
                k, v = linha.split("=", 1)
                cfg[k.strip()] = v.strip().strip('"').strip("'")
    return cfg


def _api(url, chave, corpo=None, aceitar="application/json"):
    dados = json.dumps(corpo).encode("utf-8") if corpo is not None else None
    req = urllib.request.Request(url, data=dados, method="POST" if dados else "GET",
                                 headers={"xi-api-key": chave, "Content-Type": "application/json", "Accept": aceitar})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read()


def _erro_api(e):
    try:
        corpo = json.loads(e.read().decode("utf-8"))
        d = corpo.get("detail", corpo)
        if isinstance(d, dict):
            return f"{d.get('status', '')} {d.get('message', '')}".strip()
        return str(d)[:240]
    except Exception:
        return str(e)


def _resolver_voz(chave, voz):
    if re.fullmatch(r"[A-Za-z0-9]{20}", voz):
        return voz, voz
    lista = json.loads(_api(f"{API_VOZ}/voices", chave)).get("voices", [])
    alvo = voz.lower()
    for v in lista:
        nome = v.get("name", "")
        if nome.lower() == alvo or nome.lower().startswith(alvo + " "):
            return v["voice_id"], nome
    nomes = ", ".join(v.get("name", "").split(" - ")[0] for v in lista[:25])
    raise ValueError(f'voz "{voz}" não está em "My Voices" da sua conta. Disponíveis: {nomes}')


def gerar_vozes(narr, rede=True):
    """Gera (só o que falta) os áudios da narração com o ElevenLabs. Devolve {chave: caminho}, nome, status.
    Com rede=False (servidor), só aproveita os áudios que já estão em cache."""
    cfg = ler_config_voz()
    chave, voz = cfg.get("ELEVENLABS_API_KEY", ""), cfg.get("ELEVENLABS_VOZ", "")
    modelo = cfg.get("ELEVENLABS_MODELO") or "eleven_multilingual_v2"
    # voz configurada por ID (20 caracteres) não tem nome legível: mostra ELEVENLABS_VOZ_NOME ou "Jarvis"
    rotulo = cfg.get("ELEVENLABS_VOZ_NOME") or ("Jarvis" if re.fullmatch(r"[A-Za-z0-9]{20}", voz or "") else (voz or "").split(" - ")[0])
    if not chave or not voz:
        return {}, None, "voz ElevenLabs: não configurada (usando as vozes do Mac)"
    pre = pre_gravados()
    if not rede:
        arquivos = {k: hashlib.sha1(f"{voz}|{modelo}|{t}".encode("utf-8")).hexdigest()[:16] + ".mp3" for k, t in narr.items()}
        prontos = {k: f"voz/{a}" for k, a in arquivos.items() if os.path.exists(os.path.join(PASTA_VOZ, a))}
        for k, t in narr.items():
            if k not in prontos and t in pre:
                prontos[k] = pre[t]
        return prontos, rotulo, f"voz ElevenLabs ({rotulo}): {len(prontos)} áudios em cache"
    os.makedirs(PASTA_VOZ, exist_ok=True)
    # erro recente com esta mesma configuração: não tenta de novo por 12 h (o app abre rápido)
    marca_erro = os.path.join(PASTA_VOZ, ".ultimo-erro.json")
    assinatura = hashlib.sha1(f"{chave}|{voz}|{modelo}".encode("utf-8")).hexdigest()
    try:
        ultimo = json.load(open(marca_erro, encoding="utf-8"))
        if ultimo.get("assinatura") == assinatura and datetime.now().timestamp() - ultimo.get("quando", 0) < 12 * 3600:
            return {}, None, f"voz ElevenLabs: erro recente, não tentei de novo — {ultimo.get('erro')}"
    except Exception:
        pass
    arquivos = {k: hashlib.sha1(f"{voz}|{modelo}|{t}".encode("utf-8")).hexdigest()[:16] + ".mp3" for k, t in narr.items()}
    existe = lambda k: os.path.exists(os.path.join(PASTA_VOZ, arquivos[k])) or narr[k] in pre
    faltando = [k for k in narr if not existe(k)]
    nome = rotulo
    status = f"voz ElevenLabs ({rotulo}): {len(narr)} áudios em cache"
    if faltando:
        try:
            voz_id, achado = _resolver_voz(chave, voz)
            if achado != voz and not cfg.get("ELEVENLABS_VOZ_NOME"):
                nome = achado
        except urllib.error.HTTPError as e:
            faltando, status = [], f"voz ElevenLabs: erro ao consultar a voz — {_erro_api(e)}"
        except Exception as e:
            faltando, status = [], f"voz ElevenLabs: {e}"
    if faltando:
        def baixar(k):
            corpo = {"text": narr[k], "model_id": modelo,
                     "voice_settings": {"stability": 0.5, "similarity_boost": 0.8, "style": 0.15, "use_speaker_boost": True}}
            audio = _api(f"{API_VOZ}/text-to-speech/{voz_id}?output_format=mp3_44100_128", chave, corpo, "audio/mpeg")
            with open(os.path.join(PASTA_VOZ, arquivos[k]), "wb") as f:
                f.write(audio)
            return len(narr[k])
        erros, usados = [], 0
        try:  # a primeira frase sozinha: se a conta não puder usar a voz, para aqui
            usados += baixar(faltando[0])
            restantes = faltando[1:]
        except urllib.error.HTTPError as e:
            erros.append(_erro_api(e)); restantes = []
        except Exception as e:
            erros.append(str(e)); restantes = []
        with ThreadPoolExecutor(max_workers=2) as ex:
            for fut in [ex.submit(baixar, k) for k in restantes]:
                try:
                    usados += fut.result()
                except urllib.error.HTTPError as e:
                    erros.append(_erro_api(e))
                except Exception as e:
                    erros.append(str(e))
        if erros and not usados:
            json.dump({"assinatura": assinatura, "quando": datetime.now().timestamp(), "erro": erros[0]},
                      open(marca_erro, "w", encoding="utf-8"), ensure_ascii=False)
        novos = len(faltando) - len(erros) - (len(faltando) - 1 - len(restantes) if erros and not restantes else 0)
        status = f"voz ElevenLabs ({nome}): {max(0, novos)} áudios novos, ~{usados} créditos usados"
        if erros:
            status += f" — falhou: {erros[0]}"
    for f in os.listdir(PASTA_VOZ):
        if f.endswith(".mp3") and f not in set(arquivos.values()):
            os.remove(os.path.join(PASTA_VOZ, f))
    prontos = {k: (f"voz/{arquivos[k]}" if os.path.exists(os.path.join(PASTA_VOZ, arquivos[k])) else pre[narr[k]])
               for k in narr if existe(k)}
    return prontos, nome.split(" - ")[0], status


def contar_tarefas(corpo):
    """[abertas, feitas] — ignora checkboxes dentro de blocos de código."""
    abertas = feitas = 0
    cerca = None
    for linha in corpo.split("\n"):
        m = re.match(r"^\s*(```|~~~)", linha)
        if m:
            if cerca is None:
                cerca = m.group(1)
            elif linha.strip().startswith(cerca):
                cerca = None
            continue
        if cerca is None:
            t = TAREFA.match(linha)
            if t:
                if t.group(1) == " ":
                    abertas += 1
                else:
                    feitas += 1
    return [abertas, feitas]


def tags_de(fm):
    bruto = (fm.get("tags") or "").strip()
    if bruto.startswith("[") and bruto.endswith("]"):
        bruto = bruto[1:-1]
    return [t.strip().strip('"').strip("'") for t in bruto.split(",") if t.strip().strip('"').strip("'")]


def ler_notas(vault=VAULT):
    """Lê as notas que entram no mapa (fora 00 - CENTRAL, 80 - INBOX e 99 - SISTEMA). Só leitura."""
    notas = {}
    for dp, dn, fn in os.walk(vault):
        dn[:] = [d for d in dn if not d.startswith(".") and d not in ("99 - SISTEMA", "80 - INBOX", "00 - CENTRAL")]
        for f in fn:
            if not f.endswith(".md"):
                continue
            caminho = os.path.join(dp, f)
            rel = os.path.relpath(caminho, vault)
            if "/" not in rel:
                continue  # AGENTS.md, CLAUDE.md
            texto = open(caminho, encoding="utf-8").read()
            fm, corpo = frontmatter(texto)
            tipo = tipo_de(rel, fm)
            if not tipo:
                continue
            nome = f[:-3]
            status = fm.get("status", "").strip('"')
            estado = fm.get("estado", "").strip('"')
            arquivado = estado == "arquivo" or rel.startswith("90 ") or status in ("substituida", "rejeitada", "arquivado")
            notas[nome] = {
                "id": nome,
                "rel": rel,
                "tipo": tipo,
                "status": status,
                "estado": estado,
                "arquivo": arquivado,
                "travado": fm.get("travado", "") == "true" or "🔒" in corpo[:400],
                "data": (fm.get("data") or fm.get("ultima_atualizacao") or fm.get("inicio") or "").strip('"'),
                "fm": fm,
                "links": {a.split("/")[-1].removesuffix(".md") for a, _ in WIKI.findall(corpo + " ".join(fm.values()))},
                "resumo": resumo(corpo, tipo),
                "corpo": corpo,
                "mtime": os.path.getmtime(caminho),
                "tarefas": contar_tarefas(corpo),
            }

    chave = {n.lower(): n for n in notas}
    for n in notas.values():
        n["links"] = {chave[l.lower()] for l in n["links"] if l.lower() in chave and chave[l.lower()] != n["id"]}
    return notas


def agrupar(notas, fm_decide=True):
    """Distribui as notas pelos sistemas (clusters) e devolve {id: cluster}. Preenche n["cluster"] e n["pai"]."""
    chave = {n.lower(): n for n in notas}

    # 1) Clusters-âncora: clientes e marcas
    cluster = {}
    for n in notas.values():
        if n["rel"].startswith("20 "):
            partes = n["rel"].split("/")
            base = partes[1] if len(partes) > 2 else n["id"]
            base = PASTA_CLUSTER.get(base, base)
            cluster[n["id"]] = FUNDIR.get(base, base)

    def cluster_de_ref(valor):
        for a in alvos(valor):
            a = chave.get(a.split("/")[-1].lower())
            if a and a in cluster:
                return cluster[a]
            if a and notas[a]["tipo"] == "pessoa":
                return a
        return None

    # 2) Projetos pelo cliente/marca do frontmatter
    for n in notas.values():
        if n["tipo"] == "projeto" or (n["rel"].startswith("90 ") and n["tipo"] == "projeto"):
            c = cluster_de_ref(n["fm"].get("cliente")) or cluster_de_ref(n["fm"].get("marca"))
            cluster[n["id"]] = c or AVULSOS
    # pessoas que viraram cliente (uma pessoa de 60 - PESSOAS citada como cliente de um projeto)
    for n in notas.values():
        if n["tipo"] == "pessoa" and n["id"] in cluster.values():
            cluster[n["id"]] = n["id"]

    # 3) Decisões pelo projeto/cliente do frontmatter
    for n in notas.values():
        if n["tipo"] == "decisao" and n["id"] not in cluster:
            for campo in ("projeto", "cliente"):
                for a in alvos(n["fm"].get(campo)):
                    a = chave.get(a.split("/")[-1].lower())
                    if a in cluster:
                        cluster[n["id"]] = cluster[a]
                        break
                if n["id"] in cluster:
                    break

    # 4) Demais notas: maioria dos links (senão, núcleo)
    for _ in range(2):
        for n in notas.values():
            if n["id"] in cluster and n["tipo"] != "decisao":
                continue
            if n["id"] in cluster:
                continue
            votos = Counter()
            for l in n["links"]:
                c = cluster.get(l)
                if c and c != AVULSOS:
                    votos[c] += 1
            for m in notas.values():
                if n["id"] in m["links"] and cluster.get(m["id"]) not in (None, AVULSOS):
                    votos[cluster[m["id"]]] += 1
            if votos:
                c, v = votos.most_common(1)[0]
                if v >= 2 and v / sum(votos.values()) >= 0.6:
                    cluster[n["id"]] = c

    # 5) Sem maioria de links: o projeto/cliente/marca do frontmatter decide
    #    (é como a interface grava o sistema de uma nota nova)
    if fm_decide:
        for n in notas.values():
            if n["id"] in cluster:
                continue
            for campo in ("projeto", "cliente", "marca"):
                c = None
                for a in alvos(n["fm"].get(campo)):
                    a = chave.get(a.split("/")[-1].lower())
                    if a in cluster and cluster[a] != AVULSOS:
                        c = cluster[a]
                        break
                if c:
                    cluster[n["id"]] = c
                    break

    for n in notas.values():
        cluster.setdefault(n["id"], GERAL)
        n["cluster"] = cluster[n["id"]]

    # pai (projeto) de cada nota externa, para agrupar no anel
    for n in notas.values():
        pai = None
        for a in alvos(n["fm"].get("projeto")):
            a = chave.get(a.split("/")[-1].lower())
            if a and notas[a]["tipo"] == "projeto" and notas[a]["cluster"] == n["cluster"]:
                pai = a
                break
        if not pai:
            for l in sorted(n["links"]):
                if notas[l]["tipo"] == "projeto" and notas[l]["cluster"] == n["cluster"]:
                    pai = l
                    break
        n["pai"] = pai
    return cluster


def construir_dados(vault=VAULT, rede_voz=True, fm_decide=True):
    """Lê o vault e monta os dados do mapa. Devolve (dados, notas, status da voz)."""
    notas = ler_notas(vault)
    agrupar(notas, fm_decide)

    # hub de cada cluster
    clusters = {}
    contagem = defaultdict(Counter)
    for n in notas.values():
        contagem[n["cluster"]][n["tipo"]] += 1
    for c, cnt in contagem.items():
        hub = c if c in notas and notas[c]["cluster"] == c else None
        if c == AVULSOS:
            hub = None
        clusters[c] = {
            "id": c,
            "nome": NOME_CLUSTER.get(c, c),
            "hub": hub,
            "total": sum(cnt.values()),
            "tipos": dict(cnt),
            "ativo": any(notas[x]["estado"] == "ativo" and not notas[x]["arquivo"] for x in notas if notas[x]["cluster"] == c and notas[x]["tipo"] in ("projeto", "cliente")),
        }

    arestas = set()
    for n in notas.values():
        for l in n["links"]:
            arestas.add(tuple(sorted((n["id"], l))))

    saida_nos = []
    grau = Counter()
    for a, b in arestas:
        grau[a] += 1
        grau[b] += 1
    for n in notas.values():
        fm = n["fm"]
        refs = {k: alvos(fm.get(k)) for k in ("projeto", "cliente", "marca") if alvos(fm.get(k))}
        saida_nos.append({
            "id": n["id"],
            "tipo": n["tipo"],
            "cluster": n["cluster"],
            "pai": n["pai"],
            "status": n["status"],
            "estado": n["estado"],
            "arquivo": n["arquivo"],
            "travado": n["travado"],
            "data": n["data"],
            "resumo": n["resumo"],
            "grau": grau[n["id"]],
            "uri": "obsidian://open?path=" + urllib.parse.quote(os.path.join(vault, n["rel"])),
            "pasta": n["rel"].split("/")[0],
            # usados pela interface (inspector, workspace, busca)
            "rel": n["rel"],
            "mtime": datetime.fromtimestamp(n["mtime"]).strftime("%Y-%m-%d %H:%M"),
            "atualizado": (fm.get("ultima_atualizacao") or fm.get("atualizado") or fm.get("data") or "").strip('"'),
            "tags": tags_de(fm),
            "tarefas": n["tarefas"],
            "refs": refs,
        })

    dados = {
        "gerado": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "nos": sorted(saida_nos, key=lambda x: x["id"]),
        "links": [list(a) for a in sorted(arestas)],
        "clusters": sorted(clusters.values(), key=lambda c: -c["total"]),
        "geral": GERAL,
        "dono": nome_dono(),
    }
    narr = textos_narracao(dados["clusters"], dados["nos"])
    audios, nome_voz, status_voz = gerar_vozes(narr, rede=rede_voz)
    dados["narracao"] = {k: {"texto": txt, "audio": audios.get(k)} for k, txt in narr.items()}
    dados["vozExterna"] = nome_voz if audios else None
    return dados, notas, status_voz


def pacote_ui(extensao):
    """Junta os arquivos de ui/ em ordem alfabética; o JS vira um único escopo (os módulos se enxergam)."""
    if not os.path.isdir(PASTA_UI):
        return ""
    partes = []
    for nome in sorted(f for f in os.listdir(PASTA_UI) if f.endswith(extensao)):
        with open(os.path.join(PASTA_UI, nome), encoding="utf-8") as f:
            partes.append(f"/* ---- ui/{nome} ---- */\n" + f.read())
    if extensao == ".js" and partes:
        return "(function(){\n'use strict';\n" + "\n".join(partes) + "\n})();"
    return "\n".join(partes)


def montar_html(caminho_modelo, dados, config=None):
    """Injeta a interface (ui/) e os dados no modelo. config = conexão com o servidor local (None = só leitura)."""
    html = open(caminho_modelo, encoding="utf-8").read()
    for marca, extensao in (("/*__UI_CSS__*/", ".css"), ("/*__UI_JS__*/", ".js")):
        if marca in html:
            html = html.replace(marca, pacote_ui(extensao))
    html = html.replace("/*__CONFIG__*/null", json.dumps(config, ensure_ascii=False).replace("</", "<\\/"))
    html = html.replace("__DONO__", (dados.get("dono") or nome_dono()).upper().replace("<", "&lt;"))
    return html.replace("/*__DADOS__*/null", json.dumps(dados, ensure_ascii=False).replace("</", "<\\/"))


def main():
    dados, notas, status_voz = construir_dados()
    for modelo, saida in SAIDAS:
        caminho_modelo = os.path.join(AQUI, modelo)
        if not os.path.exists(caminho_modelo):
            continue
        open(os.path.join(AQUI, saida), "w", encoding="utf-8").write(montar_html(caminho_modelo, dados))
        print(f"{len(dados['nos'])} notas · {len(dados['links'])} conexões · {len(dados['clusters'])} clusters → {saida}")
    print(status_voz)
    for c in dados["clusters"]:
        print(f"  {c['total']:3d}  {c['nome']}  {dict(c['tipos'])}")


if __name__ == "__main__":
    main()
