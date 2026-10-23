#!/usr/bin/env sh
# Ejecuta un comando dentro de Node 24 (el Node local puede ser más antiguo).
exec docker run --rm -i -u "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
  -v "$(pwd)":/app -w /app ${DK_PORTS:-} node:24-bookworm-slim "$@"
