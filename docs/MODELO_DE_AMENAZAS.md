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
