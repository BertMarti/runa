#!/usr/bin/env sh
# Pruebas de extremo a extremo de la CLI contra el servidor real (build de producción):
#   1. los escenarios de cli/internal/app (enviar → abrir → «no existe», contraseñas, adjuntos, pedir → responder → recoger…);
#   2. la interoperabilidad en vivo con el código de la web (apps/web/test/cli-interop.test.ts).
#
# Necesita Node 24 y Go. Uso: npm run build && scripts/cli-e2e.sh
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PORT=${RUNA_E2E_PORT:-8498}
DATA=$(mktemp -d)
BIN="$DATA/runa"
URL="http://127.0.0.1:$PORT"

cleanup() {
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$DATA"
}
trap cleanup EXIT INT TERM

(cd "$ROOT/cli" && CGO_ENABLED=0 go build -trimpath -o "$BIN" ./cmd/runa)

# Límites altos: las pruebas crean y abren muchos secretos en pocos segundos desde la misma IP.
PORT=$PORT HOST=127.0.0.1 DATA_DIR="$DATA/db" LOG_LEVEL=warn RATE_LIMIT_CREATE=1000 RATE_LIMIT_OPEN=1000 \
  node "$ROOT/apps/server/dist/server.js" &
SERVER_PID=$!

i=0
until node -e "fetch('$URL/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null; do
  i=$((i + 1))
  [ "$i" -gt 50 ] && { echo "el servidor no arranca" >&2; exit 1; }
  sleep 0.2
done

# Ojo: el límite global de la API (120 peticiones/min por IP) no se puede subir; las dos tandas juntas hacen
# menos de 100. Si se añaden muchos escenarios, habrá que separarlas más de un minuto.
(cd "$ROOT/apps/web" && RUNA_E2E_URL="$URL" RUNA_CLI="$BIN" npx vitest run test/cli-interop.test.ts)
(cd "$ROOT/cli" && RUNA_E2E_URL="$URL" go test -count=1 -run TestE2E -v ./internal/app)
echo "CLI e2e: todo en verde"
