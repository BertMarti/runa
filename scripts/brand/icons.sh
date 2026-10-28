#!/usr/bin/env sh
# Iconos de la app instalable a partir del favicon (requiere rsvg-convert). Uso: sh scripts/brand/icons.sh
set -eu
pub=apps/web/public
rsvg-convert -w 192 -h 192 "$pub/favicon.svg" -o "$pub/icon-192.png"
rsvg-convert -w 512 -h 512 "$pub/favicon.svg" -o "$pub/icon-512.png"
rsvg-convert -w 512 -h 512 scripts/brand/icon-maskable.svg -o "$pub/icon-maskable-512.png"
rsvg-convert -w 180 -h 180 scripts/brand/icon-maskable.svg -o "$pub/apple-touch-icon.png"
echo "iconos generados en $pub"
