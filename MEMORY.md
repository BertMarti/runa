# MEMORY.md · RUNA
Última actualización: 2026-10-28 por lead (v0.5.0)

Memoria compartida entre agentes: estado, decisiones y trampas conocidas. Lo estable (reglas, comandos, estructura) está en [AGENTS.md](AGENTS.md); la hoja de ruta, en [PLAN.md](PLAN.md).

## Estado actual

### v0.1.0 «Primera runa» — publicada
- Protocolo v1, API, almacén, web ES/EN, Docker, CI y documentación. Ver CHANGELOG `[0.1.0]`.
- Tests: servidor 50, web 59 (protocolo 26 + interfaz 33). `npm run check` en verde.
- **Auditoría independiente** (Claude Fable 5.1, solo lectura, 2026-10-24): 1 hallazgo medio, 4 bajos y 9 informativos. Todos corregidos o documentados; ver «Auditoría v0.1.0» abajo.
- Probado en Chromium real, con la CSP y los Trusted Types de producción: crear con contraseña, contraseña incorrecta (403 y «quedan 4 intentos», no gasta la lectura), revelar (borra el `#` de la barra), reabrir (404 «ya no existe»), 390 px de ancho. Consola sin errores salvo el 403 esperado.
- Capturas del README: `scripts/capture.mjs` (CDP, 2x). Banner: `scripts/brand/banner.html` → `scripts/brand/render.mjs`.

## Decisiones (y por qué)

- **`node:sqlite` y no `better-sqlite3`**. La v13 de better-sqlite3 compila con node-gyp (sin binarios precompilados) y npm 11 bloquea su script de instalación (`allowScripts`). El SQLite integrado en Node 24 elimina el código nativo y los scripts de instalación; la imagen es igual en amd64 y arm64.
- **Node 24 mínimo**. Node 20 está fuera de soporte desde abril de 2026; vitest 5 y better-sqlite3 13 ya exigen 22+. El Node del host del autor es el 20: por eso existe `./dk.sh` (ejecuta en `node:24-bookworm-slim`).
- **Token de acceso derivado** (HKDF `runa/v1/auth`) y verificador SHA-256 en el servidor: el id solo no permite quemar el secreto; la contraseña no se puede atacar sin conexión.
- **`salt` derivada de K** (no aleatoria aparte): K es única por secreto, así no hay que guardarla ni enviarla.
- **`unlock()` deriva una sola vez**. PBKDF2 (600 000 iteraciones) se ejecutaba 2-3 veces por apertura; `sealSecret` devuelve también el token para «Destruir ahora» sin rederivar.
- **Runas dibujadas en SVG** (`components/runes.tsx`) y no con glifos Unicode: Android y otros sistemas no tienen fuente rúnica, y así no hace falta otra fuente.
- **Descarga del adjunto con URL de blob efímera** creada en el clic y revocada al momento (no una URL viva en el estado).
- **Router por valor del `#`**: un enlace nuevo pegado en la misma pestaña reinicia la pantalla; quitar la clave con `replaceState` no. Solo se guarda un contador, nunca la clave en una `key` de React.
- **Puerto 8484** en `compose.yaml`: el 8080 lo suelen ocupar otros servicios autoalojados (p. ej. Pi-hole).
- **Grype (`anchore/scan-action`)** para escanear la imagen y subir el SARIF a GitHub Security. Como toda action, va fijada por SHA: una etiqueta movida no cambia lo que se ejecuta.
- **Dependencias de la web en `devDependencies`**: Vite las empaqueta; así `npm prune --omit=dev` las deja fuera de la imagen.

## Auditoría v0.1.0 (Fable) y qué se hizo

| ID | Gravedad | Hallazgo | Resolución |
|---|---|---|---|
| F1 | media | Con solo el id, 5 tokens falsos agotaban los intentos y destruían el secreto; además 403/404 revelaba si existía. | **Prueba de enlace** `HKDF(K, "runa/v1/link")`: sin ella, 404 y no cuenta. Tests en servidor y protocolo. |
| F2 | baja | `replaceState` no borra el historial global; la doc decía lo contrario. | Documentado (I4) y comentario corregido. |
| F3 | baja | `npm run check` fallaba por los scripts `.mjs` sin globals de Node. | ESLint con `globals.node` en `scripts/`. |
| F4 | baja | El límite global contaba los recursos estáticos: una oficina tras NAT podía quedarse sin página. | Límite solo para `/api`. |
| F5 | baja | Imágenes base por etiqueta; `npm ci` ejecutaba scripts (esbuild). | Digests fijados; `ignore-scripts` en `.npmrc`, CI y Docker; docs matizadas. |
| F6 | info | IPv6 podía rotar direcciones dentro de su /64. | Clave del límite por /64 (`rateLimitKey`). DoS volumétrico: fuera de alcance, documentado. |
| F7 | info | El servidor aceptaba cualquier tamaño de cifrado. | Solo bloque exacto + 28. |
| F8 | info | `safeFileName` no quitaba controles bidi ni de anchura cero. | Corregido con tests. |
| F9 | info | `/api` sin barra devolvía la SPA. | `API_PATH` con regex; test. |
| F10 | info | Los intentos fallidos no se reiniciaban tras un acierto. | Se reinician; test. |
| F11 | info | Montar una carpeta (no un volumen) fallaba sin pista. | Documentado `chown 65532`. |
| F12 | info | El código en `/app` era modificable por el proceso. | `--chown=root:root`. |
| F13 | info | HSTS con `preload` por defecto. | Sin `preload`; documentado. |
| F14 | info | Docs con detalles de la red personal del autor. | Recortados. |

## Tras publicar (2026-10-24)

- El primer CI de la imagen falló **a propósito**: Grype encontró CVE altas con arreglo en `distroless/nodejs24-debian12` (Node 24.14, OpenSSL 3.0.18, glibc antiguos). Se cambió a `distroless/nodejs24-debian13` (Node 24.22): 0 vulnerabilidades con arreglo.
- Dependabot propuso Node 25 (no LTS), `@types/node` 26 y TypeScript 7 (incompatible con typescript-eslint). Se cerraron los PR y se ignoran esas versiones mayores en `dependabot.yml`.

## Integración con ARIA (2026-10-24)

- Módulo `modulos/runa/` en BertMarti/ARIA: PR #2 **fusionado y desplegado** el 2026-10-24 (suite de ARIA 1434/1434). Contenedores `aria-runa` (0.2.1) y `aria-runa-tls` (8485 solo en la LAN). `runa.<dominio>` publicado el 2026-10-24 desde el panel de Cloudflare (ruta del túnel `homelab` → `http://runa:8080`, CNAME automático, sin Access), con el usuario presente. Comprobado desde Internet: `createAllowed:false`, crear → 403; un secreto creado desde la red de ARIA se revela por el dominio y después da «ya no existe». Ojo: Pi-hole guarda las respuestas NXDOMAIN 30 min (SOA de Cloudflare), así que un nombre recién creado tarda en resolver en casa si se consultó antes. Protocolo v1 reimplementado en Python (`protocolo.py`, con `cryptography`).
- Compatibilidad en los dos sentidos: ARIA prueba vectores cifrados por esta web y RUNA prueba vectores cifrados por Python (`compat-python.test.ts`). **Cualquier cambio del protocolo rompe ambos: requiere protocolo v2 y actualizar los dos repos.**
- Despliegue en ARIA: `aria-runa` (sin puertos) + `aria-runa-tls` (Caddy en 8485 con la CA interna de ARIA y su `/internal/tls-ask`). La imagen de Caddy necesita `cap_add: NET_BIND_SERVICE` aunque escuche en un puerto alto: el binario lleva esa capacidad grabada y con `cap_drop: ALL` el kernel no lo ejecuta.
- Probado de extremo a extremo: código del módulo → RUNA real tras el Caddy del módulo → Chromium real revela el secreto → reabrir da 404.

## v0.2.0 «Puente» (2026-10-24)

- Motivo: el usuario accede a ARIA por un dominio con Cloudflare Tunnel + Access y quiere RUNA dentro. Leer debe ser público (quien recibe no tiene cuenta), crear no (evitar que cualquiera aloje secretos o archivos con su dominio).
- `CREATE_FROM` + `canCreate`: IP en la lista **y** sin cabeceras `Cf-Connecting-IP`/`Cf-Ray`. Diseño revisado con la sesión de ARIA: Fastify con `TRUST_PROXY` en CIDR ya toma la IP de más a la derecha que no es de confianza, pero las cabeceras de Cloudflare cubren un `TRUST_PROXY` mal puesto.
- `clientIp`: el límite por IP usa `Cf-Connecting-IP` solo si la conexión llega desde una red privada (el conector).
- 0.2.1: la comprobación de `CREATE_FROM` va en `onRequest` (antes de leer el cuerpo); la prueba de extremo a extremo con cuerpo no válido daba 400 en vez de 403.
- `PUBLIC_URL` + `GET /api/config` (`{publicUrl, createAllowed}`); la web valida que `publicUrl` sea https (o http en localhost).

## «Crear secreto» dentro de ARIA (2026-10-24)

- Problema real (visto en los registros de aria-app): el usuario entra en ARIA por su dominio también desde casa, así que el mosaico lo llevaba al RUNA público, donde crear está prohibido.
- Solución (ARIA #3 y #4, fusionados y desplegados): el módulo sirve `/api/modulos/runa/crear` con sesión y CSP propia. La página cifra en el navegador (`modulos/runa/web/runa-cripto.mjs`, bytes idénticos a `protocolo.py`) y `POST /api/modulos/runa/secretos` reenvía solo el cifrado a RUNA por la red interna, con un límite de 10 por minuto por persona.
- Comprobado en producción en el Chrome del usuario: creado en ARIA → revelado por el dominio público desde Internet → 404 al reabrir.

## v0.3.0 «Revisión externa» (2026-10-25)

- Otra sesión («Revisión de repositorios GitHub») revisó en solo lectura; hallazgos R1-R4 corregidos con tests (ver MODELO_DE_AMENAZAS, «Revisión externa»).
- **`TRUST_CF_FROM`** (nuevo, vacío por defecto): `Cf-Connecting-IP` solo se cree desde esos conectores. ARIA debe añadirlo (`172.16.0.0/12`) al actualizar desde 0.2.1 y hacer que su `runa-tls` borre `Cf-Connecting-IP`. Se avisó a la sesión de ARIA.
- **Cuota** `CREATE_QUOTA_MB` (64 MB/h por cliente) y caducidad máxima de 1 día para secretos de más de 1 MiB (el módulo de ARIA que crea con 7 días y archivos grandes recibirá `ttl_too_long`).
- Comprobado: con `-p 127.0.0.1:8484:8080`, el contenedor ve la conexión desde `::ffff:172.17.0.1` (pasarela de Docker), no desde `127.0.0.1`.
- **Publicada** (2026-10-26): PR #3 fusionada, release v0.3.0 e imagen `ghcr.io/bertmarti/runa:0.3.0` (amd64 y arm64) comprobada en la Raspberry. Para ARIA quedó abierta la PR BertMarti/ARIA#5 (imagen 0.3.0, `TRUST_CF_FROM` y `header_up -Cf-Connecting-IP` en `runa-tls`), pendiente de que la sesión de ARIA la integre. El `docker-compose.override.yml` real de ARIA hay que cambiarlo a mano al desplegar.

## v0.4.0 «Mensajero» (2026-10-27)

- **Pedir un secreto** (X25519 + HKDF + AES-GCM, ver PROTOCOLO): tabla `requests` en el mismo SQLite (borrado seguro, purga, cuenta en `usedBytes`). Rellenar se permite fuera de `CREATE_FROM` (es para quien no está en casa); crear la petición, no. Pruebas: servidor (ciclo, 404 sin prueba, 409, caducidad recortada, túnel), web (cripto y pantallas) y e2e.
- **Playwright** 1.64.1 (`npm run e2e`): en local, con la imagen `mcr.microsoft.com/playwright:v1.64.1-noble` (trae Node 24 y Chromium arm64): `docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -v $PWD:/app -w /app --ipc=host mcr.microsoft.com/playwright:v1.64.1-noble npx playwright test` (antes `npm run build`).
- El tema claro se pospuso a v0.4.x: hay ~90 colores fijos en el CSS que antes hay que pasar a variables.

## v0.5.0 «Alba» (2026-10-28)

- **Tema claro**: tokens en `base.css` con canales RGB (`--teal-rgb`, `--well-rgb` para pozos, `--tint-rgb` para realces…). «Alba» se aplica con `@media (prefers-color-scheme: light)` sobre `:root:not([data-theme='dark'])` y con `:root[data-theme='light']` (bloque duplicado a propósito: sin JS al cargar en automático). `lib/theme.ts` guarda `runa.theme` en localStorage (preferencia, no secreto). Verde del tema claro `#0a715e` (AA también como enlace sobre el fondo; `#0b7a66` daba 4,44).
- Los `<stop>` del sello toman el color por clase (`stop-color` es CSS): nada de estilos en línea.
- **Instalable sin service worker** (decisión): registrar uno exige una política de Trusted Types y no aporta nada sin servidor.
- Iconos: `sh scripts/brand/icons.sh` (rsvg-convert). Capturas: `scripts/capture.mjs` (tema oscuro forzado salvo `captura-movil-claro.png`).

## Trampas conocidas

- En los tests con happy-dom llegaban eventos `hashchange` tras `history.replaceState` que reiniciaban la pantalla (en un navegador real `replaceState` no lanza ese evento). No confíes en el evento para saber si la persona cambió el enlace: compara el valor del `#`.
- `Page.captureScreenshot` con `clip` usa coordenadas de **página** (suma `scrollX/scrollY`).
- `@fastify/static` v10: en `setHeaders` el objeto es una respuesta de Fastify (`res.header`, no `res.setHeader`).
- `trustProxy` de Fastify no acepta números en sus tipos: solo `true` o una lista de IP/CIDR.
- `pkill -f patrón` dentro de un comando que contiene el patrón se mata a sí mismo.
- Playwright: volver a abrir la misma URL cambiando solo el `#` es una navegación dentro del documento y el enrutador no reinicia la pantalla (el `#` ya se borró). En las pruebas, pasar antes por `about:blank`. `getByLabel('Secreto')` necesita `exact: true`. Con `reducedMotion: 'reduce'` las etiquetas animadas quedan «estables».

## Pendiente inmediato

Ver PLAN.md (v0.6.0 «Forja»).
