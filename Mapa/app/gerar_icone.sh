#!/bin/bash
# Gera icone.icns a partir de icone.html (desenho em SVG), usando o Chrome sem janela.
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

"$CHROME" --headless=new --hide-scrollbars --window-size=1024,1024 --default-background-color=00000000 \
  --screenshot="$TMP/icone_1024.png" "file://$AQUI/icone.html" >/dev/null 2>&1

mkdir "$TMP/icone.iconset"
for s in 16 32 128 256 512; do
  sips -z "$s" "$s" "$TMP/icone_1024.png" --out "$TMP/icone.iconset/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z "$d" "$d" "$TMP/icone_1024.png" --out "$TMP/icone.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$TMP/icone.iconset" -o "$AQUI/icone.icns"
cp "$TMP/icone_1024.png" "$AQUI/icone_1024.png"
echo "Ícone gerado: $AQUI/icone.icns"
