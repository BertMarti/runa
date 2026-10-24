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
| I8 | XSS que robe secretos o claves | CSP estricta sin `unsafe-inline` ni `unsafe-eval`, **Trusted Types** obligatorios, React escapa el texto, ESLint prohíbe `innerHTML` y `dangerouslySetInnerHTML`. | `app.ts`, `eslint.config.js` |
| I9 | Un adjunto HTML se ejecuta en nuestro origen, o un nombre engañoso (`factura<U+202E>fdp.exe`) | La descarga usa siempre `application/octet-stream`; el nombre se sanea (rutas, control, bidireccionales, anchura cero, puntos finales). | `envelope.ts` `safeFileName`, `RevealScreen` |
| I10 | Clickjacking | `frame-ancestors 'none'` + `X-Frame-Options: DENY`. | `app.ts` |
| D0 | Usar una instancia publicada como alojamiento gratuito de secretos o archivos (con el dominio de quien la publica) | `CREATE_FROM`: crear solo desde redes de confianza; por el túnel, 403 aunque se falsifique `X-Forwarded-For` (gana la IP de más a la derecha que no es de confianza) o `TRUST_PROXY` esté mal puesto (cuentan las cabeceras de Cloudflare). | `app.ts` `canCreate`, pruebas «despliegue tras un túnel» |
| D1 | Llenar el disco | Tamaño máximo por secreto, tope global (`MAX_STORAGE_MB`, responde 507), caducidad máxima de 7 días y purga cada minuto. | `app.ts`, `server.ts` |
| D2 | Inundar de peticiones | Límite por IP (por /64 en IPv6): 20 creaciones/min, 30 aperturas/min, 120 peticiones a la API/min. La web estática no cuenta, para no dejar sin página a una oficina tras una sola IP. | `app.ts` (rate-limit, `rateLimitKey`) |
| D3 | Cuerpos gigantes o JSON malicioso | `bodyLimit` por ruta, esquema JSON estricto (`additionalProperties: false`, sin coerción de tipos). | `app.ts` |
| E1 | Escalada o persistencia dentro del contenedor | Imagen **distroless** sin shell, usuario `nonroot`, código propiedad de root (no modificable por el proceso), sistema de archivos de solo lectura, `cap_drop: ALL`, `no-new-privileges`, límites de memoria y procesos. | `Dockerfile`, `compose.yaml` |
| E2 | Inyección SQL | Solo sentencias preparadas; ningún SQL construido con texto del usuario. | `store.ts` |
| SC1 | Dependencia comprometida | Pocas dependencias y **cero módulos nativos** en producción (SQLite integrado en Node 24). **Ningún script de instalación se ejecuta** en desarrollo, CI ni Docker (`.npmrc` `ignore-scripts=true`, `npm ci --ignore-scripts`). `npm audit` en CI, Dependabot con 7 días de espera, revisión de dependencias en cada PR. Imágenes base fijadas por digest. | `.npmrc`, `ci.yml`, `Dockerfile`, `dependabot.yml` |
| SC2 | Action de GitHub comprometida | Todas las actions **fijadas por SHA**, token con permisos mínimos, `persist-credentials: false`, OpenSSF Scorecard. | `.github/workflows/` |
| SC3 | Secretos subidos al repositorio | gitleaks en cada push y PR. | `ci.yml` |

## Fuera de alcance (riesgos aceptados)

- **Dispositivo comprometido** del emisor o del receptor (malware, extensiones del navegador maliciosas).
- **Canal inseguro para el enlace**: si alguien intercepta el enlace *y* la contraseña, puede leer el secreto. Por eso se recomienda enviar la contraseña por **otro canal**.
- **Destinatario malintencionado**: puede copiar o fotografiar el secreto una vez revelado.
- **Metadatos de tiempo**: el servidor sabe *cuándo* se crea y se abre un secreto (no qué contiene ni quién lo abre).
- **Historial del navegador** del destinatario: conserva la URL con el `#` (ver I4).
- **Denegación de servicio volumétrica** desde muchas IP: los límites por IP no la frenan; corresponde al proxy o a la CDN.
