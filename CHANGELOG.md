# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [Semantic Versioning](https://semver.org/lang/es/).

## [Sin publicar]

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

[Sin publicar]: https://github.com/BertMarti/runa/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/BertMarti/runa/releases/tag/v0.1.0
