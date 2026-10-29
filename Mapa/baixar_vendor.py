#!/usr/bin/env python3
"""Baixa uma cópia local do three.js (r160) e das fontes para o mapa abrir sem internet.

Uso: python3 "99 - SISTEMA/Mapa/baixar_vendor.py"   (uma vez; o servidor usa a cópia se ela existir)
Sem a pasta vendor/, o mapa continua carregando tudo pela internet (CDN), como antes.
"""
import os
import re
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
VENDOR = os.path.join(AQUI, "vendor")
CDN = "https://cdn.jsdelivr.net/npm/three@0.160.0/"
ENTRADAS = ["build/three.module.js", "examples/jsm/controls/OrbitControls.js",
            "examples/jsm/postprocessing/EffectComposer.js", "examples/jsm/postprocessing/RenderPass.js",
            "examples/jsm/postprocessing/UnrealBloomPass.js", "examples/jsm/postprocessing/OutputPass.js",
            "examples/jsm/postprocessing/ShaderPass.js", "examples/jsm/renderers/CSS2DRenderer.js"]
FONTES = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@300;400;500;600&display=swap"
NAVEGADOR = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"


def baixar(url):
    req = urllib.request.Request(url, headers={"User-Agent": NAVEGADOR})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def three():
    pendentes, feitos = list(ENTRADAS), set()
    while pendentes:
        rel = pendentes.pop()
        if rel in feitos:
            continue
        feitos.add(rel)
        conteudo = baixar(CDN + rel)
        destino = os.path.join(VENDOR, "three", rel)
        os.makedirs(os.path.dirname(destino), exist_ok=True)
        open(destino, "wb").write(conteudo)
        for imp in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]""", conteudo.decode("utf-8")):
            pendentes.append(os.path.normpath(os.path.join(os.path.dirname(rel), imp)))
    print(f"three.js: {len(feitos)} arquivos")


def fontes():
    css = baixar(FONTES).decode("utf-8")
    pasta = os.path.join(VENDOR, "fontes")
    os.makedirs(pasta, exist_ok=True)
    blocos, saida = re.split(r"(?=/\* [a-z\-]+ \*/)", css), []
    for bloco in blocos:
        sub = re.match(r"/\* ([a-z\-]+) \*/", bloco)
        if not sub or sub.group(1) not in ("latin", "latin-ext"):
            continue
        url = re.search(r"url\((https://[^)]+\.woff2)\)", bloco).group(1)
        familia = re.search(r"font-family: '([^']+)'", bloco).group(1).replace(" ", "")
        peso = re.search(r"font-weight: (\d+)", bloco).group(1)
        nome = f"{familia}-{peso}-{sub.group(1)}.woff2"
        open(os.path.join(pasta, nome), "wb").write(baixar(url))
        saida.append(bloco.replace(url, nome))
    open(os.path.join(pasta, "fontes.css"), "w", encoding="utf-8").write("".join(saida))
    print(f"fontes: {len(saida)} arquivos")


if __name__ == "__main__":
    three()
    fontes()
