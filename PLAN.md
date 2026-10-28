# PLAN.md · RUNA

Hoja de ruta viva. Cada versión es un hito de GitHub; cada tarea, un issue con su rama `agent/<rol>/<nº>-<tema>` y su PR.

## Visión

Compartir una contraseña, una clave API o un archivo sensible debería ser **tan fácil como mandar un enlace** y **tan seguro como no mandarlo**. RUNA cifra en el navegador, guarda solo ruido cifrado y lo destruye al leerse.

## Principios (no negociables)

1. **Conocimiento cero**: el servidor nunca recibe ni puede derivar la clave ni el contenido.
2. **Nada sin pulsar**: abrir un enlace no consume el secreto; hay que pulsar «Revelar».
3. **Menos es más seguro**: cada dependencia nueva se justifica en el PR.
4. **Seguro por defecto**: la configuración por defecto es la más segura.
5. **Probado**: toda regla de seguridad tiene un test que falla si se quita.

## v0.1.0 «Primera runa» — ✅ hecha

- [x] Protocolo v1: AES-256-GCM + HKDF + PBKDF2, token de acceso, relleno ([docs/PROTOCOLO.md](docs/PROTOCOLO.md)).
- [x] API Fastify: crear, abrir (descuenta vistas), destruir; 404 indistinguibles.
- [x] Almacén `node:sqlite` con transacciones, `secure_delete` y purga.
- [x] Cabeceras: CSP estricta + Trusted Types, COOP/COEP/CORP, no-referrer, Permissions-Policy.
- [x] Límites: por IP, por tamaño, tope global; 5 intentos de contraseña.
- [x] Web: crear, resultado con QR, revelar, adjuntos, contraseña opcional, ES/EN.
- [x] Docker distroless, compose endurecido, CI (lint, tipos, tests, audit, gitleaks), CodeQL, Grype, Scorecard, Dependabot.
- [x] Modelo de amenazas STRIDE.

## v0.2.0 «Puente» — ✅ hecha

- [x] Leer desde fuera, crear solo desde casa (`CREATE_FROM`, `PUBLIC_URL`, `/api/config`) para publicar RUNA por un túnel.
- [x] Integración con ARIA (módulo `modulos/runa/`).

## v0.3.0 «Revisión externa» — ✅ hecha

- [x] `TRUST_CF_FROM`: `Cf-Connecting-IP` solo desde conectores declarados (R1).
- [x] Cuota de bytes por cliente y hora, y caducidad máxima de 1 día para secretos grandes (R2).
- [x] `trusted-types 'none'` (R3) y aviso cuando falta HTTPS (R4).

## v0.4.0 «Mensajero» — ✅ hecha

- [x] **Petición de secreto**: un enlace para que *otra persona* me envíe un secreto cifrado con mi clave pública (X25519).
- [x] Tests end-to-end con Playwright en el CI (crear → revelar → 404; pedir → enviar → recoger).

## v0.5.0 «Alba» — ✅ hecha

- [x] **Tema claro** («Alba») y selector automático / claro / oscuro; los colores fijos del CSS pasan a variables.
- [x] **Instalable** (manifest e iconos), **sin service worker**: RUNA necesita el servidor para todo, así que no
      aportaría modo sin conexión, y registrarlo obligaría a abrir una política de Trusted Types (`trusted-types 'none'`).
- [x] Capturas del README por script, también de «Pedir un secreto» y del tema claro.

## v0.6.0 «Forja» — más adelante

- [ ] Vídeo corto para el README generado por script.

- [ ] **CLI** `runa send < fichero` / `runa open <enlace>` en Go, compatible con el protocolo v1.
- [x] Integración con **ARIA** (adelantada): módulo `modulos/runa/` con el protocolo en Python, herramientas `runa_compartir` y `runa_generar`, mosaico y aviso de caída. Compatibilidad comprobada en los dos sentidos (`apps/web/test/compat-python.test.ts`).
- [ ] Argon2id (protocolo v2) cuando esté disponible en Web Crypto, o vía WASM auditado.
- [ ] Métricas sin datos personales (número de secretos activos) para Prometheus.
- [ ] Despliegue de demostración pública con límites estrictos.

## Ideas sin priorizar

- Varios archivos por secreto (zip en el cliente).
- Notificación opcional al emisor cuando se lee (webhook firmado, sin datos del lector).
- Traducciones adicionales (catalán, gallego, euskera, portugués).

## Cómo se trabaja

Ver [AGENTS.md](AGENTS.md) (reglas, roles y comandos) y [MEMORY.md](MEMORY.md) (estado y decisiones).
