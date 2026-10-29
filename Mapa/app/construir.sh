#!/bin/bash
# Compila o "Segundo Cérebro.app" (Swift + WKWebView) e instala em ~/Applications.
# Uso: bash construir.sh [pasta de destino]
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
MAPA="$(cd "$AQUI/.." && pwd)"
DESTINO="${1:-$HOME/Applications}"
NOME="Segundo Cérebro.app"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/$NOME/Contents/MacOS" "$TMP/$NOME/Contents/Resources" "$DESTINO"
swiftc -O "$AQUI/main.swift" -o "$TMP/$NOME/Contents/MacOS/SegundoCerebro" -framework Cocoa -framework WebKit -framework Speech -framework AVFoundation
sed "s|__PASTA__|$MAPA|" "$AQUI/Info.plist" > "$TMP/$NOME/Contents/Info.plist"
cp "$AQUI/icone.icns" "$TMP/$NOME/Contents/Resources/icone.icns"
codesign --force --deep --sign - "$TMP/$NOME" >/dev/null 2>&1

rm -rf "${DESTINO:?}/$NOME"
mv "$TMP/$NOME" "$DESTINO/$NOME"
touch "$DESTINO/$NOME"
echo "App instalado em: $DESTINO/$NOME"
