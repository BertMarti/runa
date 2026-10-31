# Modelo de amenazas

Análisis con la metodología **STRIDE**. Cada amenaza indica su mitigación y dónde está en el código o en la configuración.

## Activos

1. **Contenido de los secretos** (texto y archivos).
2. **Clave del enlace** `K` y la contraseña opcional.
3. **Disponibilidad** del servicio y de cada secreto hasta que lo lea su destinatario.
4. **Privacidad** de quien usa el servicio (IP, hábitos).

## Actores

| Actor | Capacidades supuestas |
|---|---|
| Atacante en la red | Observa y altera el tráfico si no hay TLS. |
| Servidor curioso o comprometido | Lee la base de datos, los registros y la memoria del proceso. |
| Tercero que ve el enlace | Bots de previsualización (Slack, WhatsApp), historial del navegador, alguien mirando la pantalla. |
| Abusador | Automatiza peticiones para llenar el disco o adivinar contraseñas. |
| Cadena de suministro | Paquete npm o action de GitHub comprometidos. |

## STRIDE

| # | Amenaza | Mitigación | Dónde |
|---|---|---|---|
| S1 | **Suplantación**: alguien con el id (proxy, bot, historial) intenta abrir, quemar o agotar los intentos | Dos pruebas derivadas de `K`: sin la de enlace, 404 y no cuenta; sin la de contraseña, cuenta el intento. Comparación en tiempo constante. | `store.ts` `open`/`burn`, test «con solo el id…» |
| T1 | **Manipulación** del cifrado en el servidor | AES-GCM autenticado + AAD; cualquier bit cambiado hace fallar el descifrado. | `protocol.ts`, test «detecta cualquier alteración» |
| T2 | El servidor sirve JavaScript malicioso | Fuera del modelo de un servicio web (también afecta a Bitwarden Web, Proton, etc.). Se mitiga **autoalojando** la imagen firmada con procedencia SLSA y SBOM, y con código abierto auditable. | `docker.yml` |
| R1 | **Repudio** | No aplicable: el servicio es anónimo a propósito. | — |
| I1 | **Divulgación**: el servidor lee el contenido | Cifrado en el cliente; la clave viaja en el fragmento `#`, que el navegador no envía. | `PROTOCOLO.md` |
| I2 | El tamaño del cifrado revela la longitud | Relleno a bloques fijos (1 KiB … 4 MiB); el servidor rechaza cualquier tamaño que no sea un bloque exacto. | `envelope.ts`, `app.ts` `VALID_SIZES` |
| I3 | Un bot de previsualización abre el secreto | La página **no** llama a la API al cargar: hay que pulsar «Revelar». | `RevealScreen` |
| I4 | La clave queda a la vista o en el historial | Tras revelar, `history.replaceState` borra el fragmento de la **barra de direcciones**. **Limitación**: el historial global del navegador conserva la URL original con el `#`; quien use después ese mismo perfil podría recuperarla, aunque solo le sirve si quedan lecturas. Por eso lo recomendable es 1 lectura. | `RevealScreen` |
| I5 | Fuga por `Referer` | `Referrer-Policy: no-referrer` (y el fragmento nunca va en el `Referer`). | `app.ts` (helmet) |
| I6 | Restos de secretos borrados en disco | `PRAGMA secure_delete = ON` + `wal_checkpoint(TRUNCATE)` periódico. | `store.ts` |
| I7 | Registros con datos sensibles | El registro solo guarda método, patrón de ruta y código: sin IP, sin id, sin cuerpo. | `app.ts` `logSerializers` |
| I7b | Las métricas filtran actividad | Desactivadas por defecto; con `METRICS_TOKEN`, solo recuentos agregados y patrones de ruta (sin ids, IP ni tamaños), token obligatorio comparado en tiempo constante. Riesgo aceptado: quien tiene el token ve *cuándo* hay actividad, como en los registros del proxy. | `metrics.ts`, tests «métricas para Prometheus» |
| I8 | XSS que robe secretos o claves | CSP estricta sin `unsafe-inline` ni `unsafe-eval`, **Trusted Types** obligatorios y `trusted-types 'none'` (nadie, ni una dependencia, puede crear una política), React escapa el texto, ESLint prohíbe `innerHTML` y `dangerouslySetInnerHTML`. | `app.ts`, `eslint.config.js` |
| I9 | Un adjunto HTML se ejecuta en nuestro origen, o un nombre engañoso (`factura<U+202E>fdp.exe`) | La descarga usa siempre `application/octet-stream`; el nombre se sanea (rutas, control, bidireccionales, anchura cero, puntos finales). | `envelope.ts` `safeFileName`, `RevealScreen` |
| I10 | Clickjacking | `frame-ancestors 'none'` + `X-Frame-Options: DENY`. | `app.ts` |
| D0 | Usar una instancia publicada como alojamiento gratuito de secretos o archivos (con el dominio de quien la publica) | `CREATE_FROM`: crear solo desde redes de confianza; por el túnel, 403 aunque se falsifique `X-Forwarded-For` (gana la IP de más a la derecha que no es de confianza) o `TRUST_PROXY` esté mal puesto (cuentan las cabeceras de Cloudflare). | `app.ts` `canCreate`, pruebas «despliegue tras un túnel» |
| D1 | Llenar el disco | Tamaño máximo por secreto, tope global (`MAX_STORAGE_MB`, responde 507), **cuota por cliente** (`CREATE_QUOTA_MB`, 64 MB/h, 429), caducidad máxima de 7 días y de **1 día para secretos de más de 1 MiB**, y purga cada minuto. | `app.ts`, `quota.ts`, `server.ts`, tests «cuotas» |
| D2 | Inundar de peticiones | Límite por IP (por /64 en IPv6): 20 creaciones/min, 30 aperturas/min, 120 peticiones a la API/min. La web estática no cuenta, para no dejar sin página a una oficina tras una sola IP. La IP la da `Cf-Connecting-IP` **solo** si la conexión viene de un conector declarado en `TRUST_CF_FROM`; detrás de otro proxy esa cabecera no se cree (la escribiría el cliente). | `app.ts` (rate-limit, `rateLimitKey`, `clientIp`), test R1 |
| D3 | Cuerpos gigantes o JSON malicioso | `bodyLimit` por ruta, esquema JSON estricto (`additionalProperties: false`, sin coerción de tipos). | `app.ts` |
| E1 | Escalada o persistencia dentro del contenedor | Imagen **distroless** sin shell, usuario `nonroot`, código propiedad de root (no modificable por el proceso), sistema de archivos de solo lectura, `cap_drop: ALL`, `no-new-privileges`, límites de memoria y procesos. | `Dockerfile`, `compose.yaml` |
| E2 | Inyección SQL | Solo sentencias preparadas; ningún SQL construido con texto del usuario. | `store.ts` |
| SC1 | Dependencia comprometida | Pocas dependencias y **cero módulos nativos** en producción (SQLite integrado en Node 24). **Ningún script de instalación se ejecuta** en desarrollo, CI ni Docker (`.npmrc` `ignore-scripts=true`, `npm ci --ignore-scripts`). `npm audit` en CI, Dependabot con 7 días de espera, revisión de dependencias en cada PR. Imágenes base fijadas por digest. | `.npmrc`, `ci.yml`, `Dockerfile`, `dependabot.yml` |
| SC2 | Action de GitHub comprometida | Todas las actions **fijadas por SHA**, token con permisos mínimos, `persist-credentials: false`, OpenSSF Scorecard. | `.github/workflows/` |
| SC3 | Secretos subidos al repositorio | gitleaks en cada push y PR. | `ci.yml` |

## Pedir un secreto (v0.4.0)

| # | Amenaza | Mitigación | Dónde |
|---|---|---|---|
| Q1 | Quien intercepta el **enlace de envío** lee lo que se envía | El enlace solo lleva la clave pública X25519; descifrar exige la privada, que va únicamente en el enlace de recogida. | `request.ts`, test «otra petición no puede abrirlo» |
| Q2 | Quien conoce solo el id rellena, recoge o cancela | Pruebas derivadas de cada clave (`sendProof`, `openProof`); sin ellas, 404 y nada cambia. | `store.ts`, tests «sin la prueba correcta…» |
| Q3 | Rellenar dos veces (sustituir lo enviado) | Solo una vez: después, 409. | `fillRequest`, tests |
| Q4 | Usar las peticiones como alojamiento abierto (también con `CREATE_FROM`) | Rellenar exige una petición creada por alguien autorizado, una sola vez, con los mismos tamaños, cuota por cliente y tope de almacenamiento; contenidos grandes caducan en 1 día. | `app.ts` |
| Q5 | Claves públicas maliciosas (orden pequeño) | Web Crypto rechaza el secreto compartido nulo; la sal liga `E ‖ A`. | `request.ts`, test |
| Q6 | La clave privada queda a la vista | Va solo en el fragmento; la página no llama a la API al cargar y la borra de la barra al recoger o cancelar. No se guarda en almacenamiento. | `RequestScreens.tsx`, pruebas e2e |
| Q7 | Alguien con el enlace de envío lo rellena antes que la persona correcta | Riesgo aceptado: el enlace de envío debe llegar por un canal fiable. Quien envía ve «ya recibió un secreto» si llega tarde. | `docs/PROTOCOLO.md` |
| Q8 | Quien tiene el enlace de envío sabe si ya se recogió (409 antes, 404 después) y cuándo caduca la petición | Riesgo aceptado: es información sobre su propio envío, y a cambio recibe el aviso de Q7. Con solo el id no se aprende nada. | `app.ts` |
| Q9 | Oráculo del disco o gasto de cuota ajena rellenando con ids inventados | La prueba se comprueba **antes** que el espacio y la cuota (`peekFill`): sin ella, 404 y nada cambia. | `app.ts`, tests «auditoría (P1)» |
| Q10 | Crear miles de peticiones vacías | Límite de 20 por minuto e IP, purga al caducar y cada petición viva cuenta 256 B en el tope de almacenamiento. | `store.ts` `REQUEST_ROW_BYTES` |

### Auditoría independiente de las peticiones (v0.4.0)

Otro modelo (Fable) revisó el diseño y el código en solo lectura, sin ver estas conclusiones:

| ID | Gravedad | Hallazgo | Resolución |
|---|---|---|---|
| P1 | media | Al rellenar, el 507 y la cuota se evaluaban antes de la prueba: oráculo del disco y gasto de cuota ajena. | `peekFill` primero (Q9) y tests. |
| P2 | baja | Clave efímera exportable sin necesidad; bytes PKCS#8 vivos en el estado de la recogida. | Efímera no exportable; la recogida importa la clave una vez y pone sus bytes a cero (test). |
| P3 | baja | Tras recoger no había «Olvidar». | Botón «Olvidar y cerrar» (test). |
| P4 | info | Acuse de lectura para quien envía. | Documentado (Q8). |
| P5 | info | Las peticiones vacías no contaban en el almacenamiento. | 256 B por petición viva (Q10). |
| P6 | info | Docs: qué recibe el servidor y nivel de seguridad de X25519. | Corregido en PROTOCOLO. |

Comprobado por la auditoría: separación de dominios (info y AAD), sin reutilización de nonce, 7 puntos de orden
pequeño rechazados, PKCS#8 de formato fijo, transacciones sin carreras, ninguna llamada a la API al cargar,
fragmentos borrados tras usarse y respuestas validadas.

## CLI `runa` (v0.6.0)

La CLI ([cli/](../cli/README.md)) cambia el entorno: en lugar de una pestaña aislada del navegador, una terminal con
historial, otros procesos del mismo equipo y acceso al disco.

| # | Amenaza | Mitigación | Dónde |
|---|---|---|---|
| C1 | La contraseña queda en el **historial del shell** o la ve cualquiera con **`ps`** | No hay opción ni variable de entorno para la contraseña: solo se lee de la terminal (`/dev/tty`, `CONIN$` en Windows) sin eco, y si se pulsa Ctrl-C se restaura el eco. El texto del secreto tampoco se admite como argumento (`send` lo rechaza): va por la entrada estándar. | `internal/tty`, `internal/app` `cmdSend`, test «Uso» |
| C2 | El **enlace** (con la clave) queda en el historial o en `ps` al pasarlo como argumento | Todas las órdenes aceptan el enlace sin argumento: lo leen de la entrada estándar o lo piden a la terminal sin eco. Se documenta como la forma recomendada. **Riesgo aceptado** si se pasa como argumento. | `readLink`, `cli/README.md` |
| C3 | El enlace o el contenido quedan en el ***scrollback*** de la terminal, `tmux`/`screen` o el registro de una sesión SSH | `send` y `request` escriben solo los enlaces en la salida estándar, para poder redirigirlos (a `wl-copy` o a un archivo) sin verlos. **Riesgo aceptado**: lo que se muestra en pantalla queda en la pantalla. | `cli/README.md` |
| C4 | Un mensaje de error filtra la clave (p. ej., `url.Parse` o `net/http` repiten la URL completa) | El fragmento se separa a mano antes de analizar la URL y nunca se pasa a `net/url` ni a `net/http`; los errores de red se despojan de la URL; ningún mensaje incluye enlace, id, prueba ni contenido. Los tests comprueban que la salida de errores no contiene fragmentos ni textos, y que al servidor no le llegan. | `internal/link`, `internal/api` `networkError`, `scenarios_test.go` |
| C5 | El texto descifrado **inyecta secuencias de escape** en la terminal (cambiar el título, borrar la pantalla, esconder texto con `\r`, invertir con U+202E) | Si la salida es una terminal, los controles C0 (salvo `\t` y `\n`), DEL, C1 y los bidireccionales se muestran como `�` y se avisa; redirigido o con `--raw`, sale exacto. | `tty.ForDisplay`, test «secuencias de escape» |
| C6 | Un adjunto con nombre hostil **escribe fuera** de la carpeta (`../`, rutas absolutas, enlaces simbólicos), **sobrescribe** un archivo o usa un nombre de dispositivo de Windows | `safeFileName` (el mismo que la web, comprobado con vectores), escritura dentro de `os.Root` con `O_CREATE` + `O_EXCL` (no sigue enlaces simbólicos ni pisa nada: prueba `nombre (1).ext`…), permisos 0600, prefijo `_` para `CON`, `NUL`, `COM1`… y para nombres que empiezan por `-`. | `internal/app` `saveFile`, `localName`, test «adjunto» |
| C7 | Perder el secreto por un error local después de que el servidor lo haya borrado | La carpeta de destino se abre **antes** de pedir el secreto; si el adjunto no se puede guardar, el texto se muestra igualmente. | `openOutDir`, test «carpeta de destino» |
| C8 | La CLI deriva **otra clave** que la web para la misma contraseña (la web aplica NFC; la biblioteca estándar de Go no tiene NFC) | Las contraseñas con caracteres que NFC podría cambiar (marcas combinantes, jamos hangul, caracteres de compatibilidad; tabla generada desde Node) se **rechazan** con un mensaje claro, en vez de derivar una clave distinta y gastar un intento. | `internal/protocol/nfc.go`, test «contraseña NFD» |
| C9 | Servidor o red maliciosos: redirecciones a otro anfitrión, respuestas gigantes, conexiones colgadas, http en claro | Solo https (http únicamente en `localhost`, `127.0.0.1`, `[::1]`), TLS ≥ 1.2, ninguna redirección, tiempos máximos, cuerpos acotados a lo que permiten `limits.ts` y respuestas validadas como en la web. | `internal/api`, `internal/link`, `client_test.go` |
| C10 | Binario de la CLI manipulado (cadena de suministro) | Biblioteca estándar más `golang.org/x/term` (verificados por `go.sum`, Dependabot con 7 días de espera); binarios estáticos con `-trimpath`, `SHA256SUMS` y **atestación de procedencia** firmada (`gh attestation verify`). | `cli-release.yml` |
| C11 | Restos de claves en memoria | Las claves, contraseñas y PKCS#8 se ponen a cero tras usarse. **Limitación**: Go puede haber copiado datos (recolector de basura, la contraseña como `string` para `crypto/pbkdf2`, la clave AES expandida dentro de `crypto/aes`). | `protocol.Wipe` |

## Revisión externa (v0.3.0)

Otra sesión revisó el código en solo lectura buscando lo que no cubría la auditoría de la v0.1.0:

| ID | Gravedad | Hallazgo | Resolución |
|---|---|---|---|
| R1 | media | `Cf-Connecting-IP` se creía desde cualquier red privada: detrás de Caddy o nginx, un cliente se inventaba una IP por petición y esquivaba los límites. Además, la guía recomendaba `TRUST_PROXY: "127.0.0.1"`, pero dentro del contenedor la conexión llega desde la pasarela de Docker (comprobado), así que todos compartían un límite. | `TRUST_CF_FROM` explícito (vacío por defecto); guía corregida y `header_up -Cf-Connecting-IP` para otros proxies. Test R1. |
| R2 | media | Sin cuota de bytes, una IP llenaba 512 MB en ~6 min y dejaba el servicio sin espacio 7 días. | Cuota por cliente y hora (`CREATE_QUOTA_MB`) y caducidad máxima de 1 día para secretos de más de 1 MiB (servidor y web). Tests «cuotas» y `quota.test.ts`. |
| R3 | baja | Trusted Types obligatorios, pero se podía crear cualquier política. | `trusted-types 'none'`. Test de cabeceras. Por eso RUNA es instalable sin service worker (v0.5.0): registrarlo exigiría una política. |
| R4 | baja | Por HTTP fuera de `localhost` no hay Web Crypto y el error parecía culpa del navegador. | Aviso claro al cargar («RUNA necesita HTTPS»). Test. |

## Fuera de alcance (riesgos aceptados)

- **Dispositivo comprometido** del emisor o del receptor (malware, extensiones del navegador maliciosas).
- **Canal inseguro para el enlace**: si alguien intercepta el enlace *y* la contraseña, puede leer el secreto. Por eso se recomienda enviar la contraseña por **otro canal**.
- **Destinatario malintencionado**: puede copiar o fotografiar el secreto una vez revelado.
- **Metadatos de tiempo**: el servidor sabe *cuándo* se crea y se abre un secreto (no qué contiene ni quién lo abre).
- **Historial del navegador** del destinatario: conserva la URL con el `#` (ver I4).
- **Denegación de servicio volumétrica** desde muchas IP: los límites por IP no la frenan; corresponde al proxy o a la CDN.
