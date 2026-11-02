#!/bin/sh
# Genera docs/assets/demo.webp: servidor de producción + Playwright (contenedor oficial) + ffmpeg.
# Requisitos: Docker y ffmpeg con libwebp. Antes: ./dk.sh npm run build
set -eu
IMG=mcr.microsoft.com/playwright:v1.64.1-noble
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/app -w /app --ipc=host "$IMG" sh -c '
  rm -rf e2e/.demo-data
  PUBLIC_URL=https://runa.example PORT=8497 HOST=127.0.0.1 DATA_DIR=e2e/.demo-data LOG_LEVEL=warn node apps/server/dist/server.js & SRV=$!
  until node -e "fetch(\"http://127.0.0.1:8497/api/health\").then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; do sleep 0.3; done
  node scripts/demo.mjs http://127.0.0.1:8497 e2e/.demo
  kill $SRV; rm -rf e2e/.demo-data'
# 880 px de ancho (lo que ocupa en el README), 10 fps, en bucle.
ffmpeg -loglevel error -y -ss "$(cat e2e/.demo/inicio.txt)" -i e2e/.demo/demo.webm \
  -vf "fps=10,scale=880:-1:flags=lanczos" -c:v libwebp -lossless 0 -q:v 55 -compression_level 6 -loop 0 -an \
  docs/assets/demo.webp
rm -rf e2e/.demo
ls -l docs/assets/demo.webp
