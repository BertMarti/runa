# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [Semantic Versioning](https://semver.org/lang/es/).

## [Sin publicar]

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

[Sin publicar]: https://github.com/BertMarti/runa/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/BertMarti/runa/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/BertMarti/runa/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/BertMarti/runa/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/BertMarti/runa/releases/tag/v0.1.0
