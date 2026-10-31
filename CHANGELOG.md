# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [Semantic Versioning](https://semver.org/lang/es/).

## [Sin publicar]

## [0.6.0] - 2026-10-31

### Añadido

- **CLI `runa`** en Go ([cli/README.md](cli/README.md)): `send`, `open`, `burn`, `request`, `reply` y `pickup` desde la terminal, compatibles con la web en los dos sentidos (un enlace de la CLI se abre en la web y al revés). Cifra en local solo con la biblioteca estándar de Go; contraseñas y enlaces por la terminal sin eco; adjuntos con nombre seguro, permisos 0600 y sin sobrescribir. Binarios estáticos para Linux, macOS y Windows (amd64 y arm64) en cada versión, con `SHA256SUMS` y atestación de procedencia.
- **Métricas para Prometheus** (`/api/metrics`), desactivadas por defecto y solo con `METRICS_TOKEN`: secretos y peticiones vivos, espacio usado y tope, y respuestas por patrón de ruta y código. Sin ids, IP ni tamaños.

### Seguridad

- Modelo de amenazas: entradas C1-C11 para la CLI (historial del shell, `ps`, *scrollback*, secuencias de escape en la terminal, escritura de adjuntos, contraseñas que NFC cambiaría, cadena de suministro de los binarios).
- Compatibilidad CLI ⇄ web comprobada byte a byte con vectores (`cli/testdata/`) y en vivo contra el servidor real en el CI.
- Auditoría independiente de la CLI: ningún hallazgo alto ni medio; tres bajos corregidos con tests (CL1-CL3: nombres de adjunto con controles C1, carpeta de destino sin permiso de escritura, aviso cuando `PUBLIC_URL` es otro origen). CodeQL también analiza el código Go.

## [0.5.0] - 2026-10-28

### Añadido

- **Tema claro «Alba»** y selector en la cabecera (automático, claro u oscuro). En automático sigue al sistema solo con CSS, sin destellos al cargar. Contraste AA comprobado.
- **Instalable**: manifest e iconos (también *maskable* y para iOS), para añadir RUNA a la pantalla de inicio.
- Capturas del README nuevas, también de «Pedir un secreto» y del tema claro.

### Cambiado

- Los ~90 colores fijos del CSS pasan a variables (canales RGB por tema); los gradientes del sello se toman por clase, sin estilos en línea.

### Seguridad

- Sin service worker a propósito: no aporta nada sin conexión y obligaría a permitir una política de Trusted Types. La CSP sigue con `trusted-types 'none'`.

## [0.4.0] - 2026-10-27

### Añadido

- **Pedir un secreto**: genera un enlace de envío (para quien te tiene que mandar una contraseña o un archivo) y un enlace de recogida (solo para ti). Lo enviado se cifra en el navegador de quien envía con tu clave pública X25519; ni el servidor ni quien vea el enlace de envío pueden leerlo. Se rellena una sola vez y se recoge una sola vez. Ver [docs/PROTOCOLO.md](docs/PROTOCOLO.md#pedir-un-secreto).
- Pruebas de extremo a extremo con Playwright en el CI: crear → revelar → «ya no existe», y pedir → enviar desde otro navegador → recoger, con cualquier error de consola (CSP, Trusted Types) como fallo.

### Seguridad

- Modelo de amenazas: entradas Q1-Q10 para las peticiones.
- Auditoría independiente previa (1 media, 2 bajas, 3 informativas), todo corregido o documentado: al rellenar, la prueba se comprueba antes que el espacio y la cuota; la clave efímera no es exportable y la de recogida se pone a cero tras importarse; «Olvidar y cerrar» tras recoger; las peticiones vacías cuentan en el almacenamiento.

## [0.3.0] - 2026-10-25

### Cambiado (requiere acción si usas Cloudflare Tunnel)

- `Cf-Connecting-IP` solo se cree si la conexión llega de un conector declarado en la nueva variable `TRUST_CF_FROM` (vacía por defecto). Detrás de `cloudflared`, añade `TRUST_CF_FROM` con la red del conector; si no, todos los clientes del túnel compartirán un mismo límite de peticiones. Ver [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md).

### Seguridad

- Detrás de Caddy, nginx o Traefik, un cliente ya no puede inventarse `Cf-Connecting-IP` para esquivar los límites de peticiones.
- Cuota de bytes por cliente y hora (`CREATE_QUOTA_MB`, 64 MB por defecto): una sola IP ya no puede llenar el almacenamiento de todos.
- Los secretos de más de 1 MiB caducan como mucho en 1 día (el servidor responde `ttl_too_long`; la web solo ofrece caducidades válidas).
- CSP con `trusted-types 'none'`: nadie puede crear políticas de Trusted Types.

### Corregido

- La guía recomendaba `TRUST_PROXY: "127.0.0.1"`, pero con el puerto publicado la conexión llega desde la pasarela de Docker: ahora indica `172.16.0.0/12` y cómo borrar `Cf-Connecting-IP` en otros proxies.
- Por HTTP fuera de `localhost`, la web avisa de que necesita HTTPS en lugar de culpar al navegador.

## [0.2.1] - 2026-10-24

### Seguridad

- Con `CREATE_FROM`, crear desde fuera se rechaza en `onRequest`, antes de leer y validar el cuerpo: un cliente externo ya no puede hacer que el servidor reciba y procese hasta 5,6 MB por petición. Antes respondía 400 si el cuerpo no era válido (y 403 si lo era).

## [0.2.0] - 2026-10-24

### Añadido

- **Leer desde fuera, crear solo desde casa**: `CREATE_FROM` limita quién puede crear secretos (IP o CIDR). Todo
  lo que llega por Cloudflare cuenta como externo, aunque se falsifique `X-Forwarded-For` o `TRUST_PROXY` esté
  mal configurado.
- `PUBLIC_URL`: los enlaces que genera la web llevan el dominio público aunque el secreto se cree desde la LAN.
- `GET /api/config`: la web sabe si puede crear desde donde está y lo explica en vez de fallar.
- El límite de peticiones usa la IP real de cada cliente del túnel (`Cf-Connecting-IP` desde una red privada).
- Prueba de compatibilidad con la implementación en Python del módulo RUNA de ARIA (`apps/web/test/compat-python.test.ts`).

## [0.1.0] - 2026-10-24

### Añadido

- Creación de secretos de texto y un archivo (hasta 3 MiB) cifrados en el navegador con AES-256-GCM.
- Enlace con la clave en el fragmento `#`, código QR y botón para compartir.
- Caducidad (5 min, 1 h, 1 día, 7 días) y número de lecturas (1 a 10).
- Contraseña opcional (PBKDF2-SHA-256, 600 000 iteraciones) con 5 intentos.
- «Destruir ahora» para quien envía y para quien recibe.
- Interfaz en español e inglés.
- API Fastify con CSP estricta, Trusted Types, límites por IP y de almacenamiento.
- Almacén `node:sqlite` con borrado seguro.
- Imagen Docker distroless multiarquitectura, `compose.yaml` endurecido.
- CI: lint, tipos, tests, `npm audit`, gitleaks, CodeQL, Grype, OpenSSF Scorecard y Dependabot.
- Documentación: protocolo, modelo de amenazas STRIDE, arquitectura y despliegue.

### Seguridad (auditoría independiente previa a la publicación)

- Prueba de enlace derivada de la clave: quien solo conoce el id ya no puede agotar los intentos de contraseña, destruir el secreto ni saber si se leyó.
- El servidor solo acepta cifrados de tamaño de bloque exacto.
- Límite de peticiones solo en la API y agrupado por /64 en IPv6.
- Nombres de adjuntos sin controles bidireccionales ni de anchura cero.
- Los intentos fallidos se reinician tras un acierto.
- Ningún script de instalación de npm se ejecuta (`.npmrc`, CI y Docker); imágenes base fijadas por digest; código de la imagen propiedad de root.
- HSTS sin `preload` por defecto.

[Sin publicar]: https://github.com/BertMarti/runa/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/BertMarti/runa/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/BertMarti/runa/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/BertMarti/runa/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/BertMarti/runa/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/BertMarti/runa/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/BertMarti/runa/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/BertMarti/runa/releases/tag/v0.1.0
