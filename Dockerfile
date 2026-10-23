# syntax=docker/dockerfile:1.7

# ---------- 1. Compilación ----------
# Imágenes fijadas por digest (Dependabot las actualiza): una etiqueta movida no cambia el build.
FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS build
WORKDIR /src
ENV npm_config_fund=false npm_config_audit=false

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# Sin scripts de instalación: ninguna dependencia ejecuta código al instalarse.
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build \
 && npm prune --omit=dev \
 && mkdir -p /out/data

# ---------- 2. Ejecución: distroless, sin shell ni gestor de paquetes ----------
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:cb606325b7ec4af55462cb0b424a53b452a5b4a894ffe841fcf1048d216fb9f8
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data \
    PUBLIC_DIR=/app/web

# El código pertenece a root: el proceso (nonroot) puede leerlo pero no modificarlo,
# aunque se arranque sin --read-only.
COPY --from=build --chown=root:root /src/node_modules ./node_modules
COPY --from=build --chown=root:root /src/apps/server/dist ./server
COPY --from=build --chown=root:root /src/apps/server/package.json ./server/package.json
COPY --from=build --chown=root:root /src/apps/web/dist ./web
# El volumen hereda este propietario: sin esto se crearía como root y nonroot no podría escribir.
COPY --from=build --chown=nonroot:nonroot /out/data /data

USER nonroot
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/nodejs/bin/node", "server/healthcheck.js"]

# node:sqlite aún avisa de que es «experimental» en algunas versiones de Node 24.
CMD ["--disable-warning=ExperimentalWarning", "server/server.js"]
