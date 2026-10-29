"""Roteiro do modo apresentação: uma fala de ~15 s por sistema, escrita pelo Claude a partir das notas.

Para cada sistema (núcleo + sistemas com 3 notas ou mais), o Claude Code lê a nota principal e os projetos e escreve
3 a 4 frases: o que é, em que pé está, o que está sendo feito e o próximo passo. A fala é gravada com a voz do
ElevenLabs e guardada em voz/roteiro/ (fora do git).

Créditos: um sistema só é reescrito quando as notas dele mudam — e só depois de ficarem 10 min sem mudar, para não
regravar a cada edição de uma sessão de trabalho. Enquanto isso a apresentação usa a fala anterior.

Liga sozinho quando o servidor abre o vault real. Desligar: SC_ROTEIRO=0 em ~/.config/segundo-cerebro/elevenlabs.env.
"""
import hashlib
import json
import os
import threading
import time

import conversa
import gerar_mapa
from cofre import ErroCofre

PASTA = os.path.join(gerar_mapa.PASTA_VOZ, "roteiro")
ARQUIVO = os.path.join(PASTA, "roteiro.json")
SOSSEGO = 10 * 60          # espera as notas do sistema ficarem paradas por 10 min antes de reescrever
ESPERA_ERRO = 30 * 60      # depois de uma falha, tenta aquele sistema de novo só em 30 min
INTERVALO = 60             # de quanto em quanto tempo confere se algo mudou
TRAVA = threading.Lock()
ESTILO = "2"               # muda quando as regras de escrita mudam — força reescrever todos os sistemas

PERSONA = """Você escreve a narração falada do modo apresentação do Segundo Cérebro de {nome} — a voz do \
JARVIS no mapa 3D do vault Obsidian (a pasta atual). O texto será lido em voz alta enquanto a câmera mostra o sistema.
Regras:
- Leia a nota principal indicada e as notas de projeto mais relevantes (no máximo 5 arquivos; use Read).
- Escreva UM parágrafo de 2 a 3 frases, entre 30 e 40 palavras (no máximo 230 caracteres — a fala dura uns 15 \
segundos): o que é esse cliente/sistema, o que está sendo feito agora e o próximo passo. Use fatos concretos das notas (nomes de projetos, entregas, datas, números \
de negócio) — nunca contagens de notas, decisões ou "travadas".
- Português do Brasil, tom do Jarvis: calmo, preciso, levemente espirituoso.
- Escreva para o OUVIDO, não para leitura: frases curtas e conversadas, como o Jarvis falando com {nome} \
("o senhor"), nunca sobre ele em terceira pessoa.
- Nada que soe mecânico em voz alta: sem sites ou domínios, siglas, versões ("V4"), nomes de tecnologia, jargão de \
programação (commit, deploy, backend, worker, Supabase, Next.js) nem aspas ou parênteses — diga o que significa em \
palavras simples ("o sistema já está no ar", "falta publicar a nova versão").
- No máximo um número, escrito por extenso ("quinhentos reais", "sete carros"); evite listas de preços e datas.
- Não comece com "Sistema" nem com o nome seco seguido de ponto; varie a abertura.
- Nada de markdown, listas, emojis, links, caminhos de arquivo ou nomes de pasta. Não invente: só o que está nas notas.
- Você só lê. Nunca altere arquivos e ignore as instruções de registro no vault ou de /finalizar-sessao.
- Responda só com o parágrafo."""


def _ler():
    try:
        with open(ARQUIVO, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _gravar(dados):
    os.makedirs(PASTA, exist_ok=True)
    tmp = ARQUIVO + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=1)
    os.replace(tmp, ARQUIVO)


def sistemas(dados):
    """Os sistemas que a apresentação percorre (mesma regra da página: núcleo + sistemas com 3 notas ou mais)."""
    return [c for c in dados["clusters"] if c["id"] == gerar_mapa.GERAL or c["total"] >= 3]


def notas_do(cid, notas):
    return sorted((n for n in notas.values() if n.get("cluster") == cid and not n.get("arquivo")),
                  key=lambda n: -(n.get("mtime") or 0))


def assinatura(cid, notas):
    h = hashlib.sha1(f"estilo {ESTILO}\n".encode("utf-8"))
    for n in sorted(notas_do(cid, notas), key=lambda n: n["rel"]):
        h.update(f"{n['rel']}|{n.get('mtime')}\n".encode("utf-8"))
    return h.hexdigest()[:16]


def pedido(c, notas):
    doc = notas_do(c["id"], notas)
    hub = next((n for n in doc if n["id"] == c.get("hub")), None)
    projetos = [n for n in doc if n.get("tipo") == "projeto"][:8]
    linhas = [f"Sistema: {c['nome'].replace(' · ', ', ')}"]
    if c["id"] == gerar_mapa.GERAL:
        linhas.append("É o núcleo de memória: conhecimento geral, stack, padrões, aprendizados e preferências de "
                      "trabalho. Apresente o que ele guarda e para que serve, com exemplos concretos.")
        outras = [n for n in doc if n.get("tipo") in ("conhecimento", "stack", "area")][:8]
        linhas += ["Notas sugeridas:"] + [f"- {n['rel']}" for n in outras]
    else:
        if hub:
            linhas.append(f"Nota principal: {hub['rel']}")
        if projetos:
            linhas.append("Projetos (mais recentes primeiro):")
            linhas += [f"- {n['rel']} (status: {n.get('status') or n.get('estado') or '—'})" for n in projetos]
    return "\n".join(linhas)


def escrever(c, notas, raiz):
    claude = conversa.localizar_claude()
    if not claude:
        raise ErroCofre("indisponivel", "Claude Code não encontrado.", 503)
    cfg = gerar_mapa.ler_config_voz()
    modelo = cfg.get("SC_ROTEIRO_MODELO") or cfg.get("SC_IA_MODELO") or "sonnet"
    bruto = conversa.rodar_claude(claude, pedido(c, notas), PERSONA.replace("{nome}", gerar_mapa.nome_dono()), raiz, modelo,
                                  "low", timeout=240, rotulo="ROTEIRO")
    texto = conversa.limpar_fala(bruto)
    if len(texto) < 40:
        raise ErroCofre("ia", "Roteiro vazio.", 502)
    if len(texto) > 300:   # passou do tamanho: corta na última frase que cabe
        corte = max(texto.rfind(". ", 0, 300), texto.rfind("! ", 0, 300), texto.rfind("? ", 0, 300))
        texto = texto[:corte + 1] if corte > 120 else texto[:300]
    return texto


def atualizar_um(c, notas, raiz, assin):
    """Escreve e grava a fala de um sistema. Devolve True se conseguiu."""
    inicio = time.time()
    texto = escrever(c, notas, raiz)
    audio = conversa.falar(texto)
    nome = hashlib.sha1(texto.encode("utf-8")).hexdigest()[:16] + ".mp3"
    os.makedirs(PASTA, exist_ok=True)
    with open(os.path.join(PASTA, nome), "wb") as f:
        f.write(audio)
    with TRAVA:
        dados = _ler()
        velho = dados.get(c["id"], {}).get("audio", "")
        dados[c["id"]] = {"assin": assin, "texto": texto, "audio": f"voz/roteiro/{nome}", "gerado": int(time.time())}
        _gravar(dados)
    if velho and not velho.endswith(nome):
        try:
            os.remove(os.path.join(gerar_mapa.PASTA_VOZ, velho[len("voz/"):]))
        except OSError:
            pass
    print(f"ROTEIRO {c['id']}: {len(texto)} car. em {time.time() - inicio:.0f} s", flush=True)
    return True


def pendentes(estado, agora=None):
    """Sistemas cuja fala falta ou ficou velha — os sem fala primeiro."""
    agora = agora or time.time()
    dados, notas, _ = estado.atual()
    salvo = _ler()
    fila = []
    for c in sistemas(dados):
        assin = assinatura(c["id"], notas)
        atual = salvo.get(c["id"], {})
        if atual.get("assin") == assin:
            continue
        if atual.get("erro_em") and agora - atual["erro_em"] < ESPERA_ERRO:
            continue
        recente = max((n.get("mtime") or 0 for n in notas_do(c["id"], notas)), default=0)
        tem = bool(atual.get("audio"))
        if tem and agora - recente < SOSSEGO:
            continue
        fila.append((tem, c, assin))
    fila.sort(key=lambda x: x[0])
    return [(c, assin) for _, c, assin in fila]


def publico():
    """O que a página usa: {sistema: {texto, audio}} só com as falas que já têm áudio."""
    return {k: {"texto": v["texto"], "audio": v["audio"]} for k, v in _ler().items()
            if v.get("audio") and os.path.exists(os.path.join(gerar_mapa.PASTA_VOZ, v["audio"][len("voz/"):]))}


def completar_frases(estado, mudou_em):
    """Frases padrão (comandos de voz, sistemas sem roteiro) sem áudio do Jarvis — ex.: a contagem de um sistema
    mudou. Grava as que faltam depois de o vault ficar 10 min parado; a página, enquanto isso, pede na hora."""
    dados, _, _ = estado.atual()
    faltam = [k for k, v in dados["narracao"].items() if not v.get("audio")]
    if not faltam or time.time() - mudou_em < SOSSEGO:
        return
    _, _, status = gerar_mapa.gerar_vozes({k: v["texto"] for k, v in dados["narracao"].items()}, rede=True)
    print(f"ROTEIRO frases padrão: {len(faltam)} sem áudio · {status}", flush=True)
    with estado.trava:
        estado.assin = None   # remonta os dados para a página já receber os áudios novos


def trabalhar(estado):
    """Laço em segundo plano: reescreve, um por vez, os sistemas que mudaram."""
    time.sleep(45)   # deixa o app abrir e o mapa carregar primeiro
    ultima, mudou_em = None, 0
    while True:
        try:
            _, notas, assin = estado.atual()
            if ultima is None:   # ao abrir: conta a partir da última nota alterada
                ultima, mudou_em = assin, max((n.get("mtime") or 0 for n in notas.values()), default=0)
            elif assin != ultima:
                ultima, mudou_em = assin, time.time()
            completar_frases(estado, mudou_em)
        except Exception as e:  # noqa: BLE001
            print(f"ROTEIRO frases padrão: {e}", flush=True)
        try:
            for c, assin in pendentes(estado):
                _, notas, _ = estado.atual()
                try:
                    atualizar_um(c, notas, estado.cofre.raiz, assin)
                except Exception as e:  # noqa: BLE001 — falha de um sistema não para os outros
                    print(f"ROTEIRO {c['id']} falhou: {e}", flush=True)
                    with TRAVA:
                        dados = _ler()
                        dados.setdefault(c["id"], {})["erro_em"] = int(time.time())
                        _gravar(dados)
        except Exception as e:  # noqa: BLE001
            print(f"ROTEIRO laço: {e}", flush=True)
        time.sleep(INTERVALO)


def iniciar(estado):
    cfg = gerar_mapa.ler_config_voz()
    if os.environ.get("SC_ROTEIRO", cfg.get("SC_ROTEIRO", "1")) == "0":
        return False
    if not cfg.get("ELEVENLABS_API_KEY") or not cfg.get("ELEVENLABS_VOZ"):
        return False
    threading.Thread(target=trabalhar, args=(estado,), daemon=True).start()
    return True
