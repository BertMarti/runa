# AGENTS.md · RUNA

Instrucciones para cualquier agente de IA (Claude Code, OpenCode, Codex…) y para personas que contribuyan.

## Qué es

Web autoalojable para compartir secretos (texto y un archivo) **cifrados de extremo a extremo** que **se autodestruyen** al leerse o al caducar. El servidor solo guarda ruido cifrado: la clave viaja en el fragmento `#` del enlace.

## Tecnología

- **Node 24** (usa `node:sqlite`; no hay módulos nativos).
- **Servidor**: Fastify 5, `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/static`. TypeScript estricto.
- **Web**: React 19 + Vite 8 + TypeScript estricto. CSS propio, sin framework. Fuentes con `@fontsource` (nunca CDN).
- **Cripto**: solo Web Crypto API nativa (AES-256-GCM, HKDF, PBKDF2). **Prohibido** añadir librerías criptográficas.
- **CLI** (`cli/`): Go, solo biblioteca estándar (`crypto/hkdf`, `crypto/pbkdf2`, `crypto/ecdh`, AES-GCM) más `golang.org/x/term`. `go vet ./... && go test ./...` en `cli/`.
- **Tests**: Vitest (happy-dom en la web, `fastify.inject` en el servidor).
- **Calidad**: ESLint 10 + typescript-eslint, `tsc --noEmit`.

## Comandos

Si tu Node local es < 24, antepón `./dk.sh` (ejecuta el comando en un contenedor Node 24).

| Acción | Comando |
|---|---|
| Instalar | `npm ci` |
| Desarrollo | `npm run dev` (API en :8080, web en :5173 con proxy) |
| Todo el control de calidad | `npm run check` (lint + tipos + tests) |
| Tests | `npm test` |
| Build | `npm run build` |
| Producción local | `npm run build && npm start` |
| Docker | `docker compose up -d --build` |

## Estructura

- `apps/server/src/app.ts` rutas, esquemas, cabeceras, límites. `store.ts` SQLite. `config.ts` entorno. `limits.ts` límites.
- `apps/web/src/crypto/` **protocolo v1** (ver `docs/PROTOCOLO.md`). Cualquier cambio aquí exige actualizar el documento y los tests.
- `apps/web/src/screens/` pantallas; `components/` piezas; `i18n/` textos ES/EN.
- `cli/` CLI en Go. `internal/protocol/` es la traducción del protocolo: cualquier cambio en `apps/web/src/crypto/` exige regenerar los vectores de `cli/testdata/` (ver `cli/README.md`) y que ambos lados sigan abriéndolos.
- `docs/` protocolo, modelo de amenazas, arquitectura, despliegue.

## Reglas de seguridad (bloqueantes en revisión)

1. **Nunca** enviar al servidor la clave `K`, la contraseña, `kEnc` ni el texto en claro. El fragmento `#` no se lee fuera de `parseFragment`.
2. **Nunca** `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `dangerouslySetInnerHTML`, `eval`, `new Function` (ESLint lo bloquea; la CSP exige Trusted Types).
3. **Nunca** recursos externos (CDN, fuentes, analítica). La CSP es `'self'`.
4. **Nunca** `GET` con efectos: abrir y destruir son `POST`.
5. **Nunca** registrar IP, ids, tokens ni cuerpos. El serializador de `app.ts` solo deja método y patrón de ruta.
6. **Nunca** guardar secretos, claves o fragmentos en `localStorage`, `sessionStorage`, consola ni URL con `?`.
7. Las descargas de adjuntos usan siempre `application/octet-stream` y `safeFileName`.
8. Todo SQL es una sentencia preparada.
9. Los límites de `apps/server/src/limits.ts`, `apps/web/src/crypto/limits.ts` y `cli/internal/protocol/limits.go` deben coincidir (lo comprueban `compat-go.test.ts` y `compat_test.go`).
10. Cada dependencia nueva se justifica en el PR; preferir la plataforma (Web Crypto, `node:sqlite`, `fetch`).
11. Las actions de GitHub se fijan por **SHA** con el número de versión en un comentario.
12. Cualquier regla nueva de seguridad llega con un test que falla si se quita.

## Diseño: «runas bajo la aurora»

Oscuro, místico y preciso. Fondo casi negro azulado, aurora sutil verde azulado → violeta, tarjetas de cristal con filete de 1 px, runas del futhark antiguo como motivo. **Cinzel** para la marca y los titulares, **Inter** para la interfaz, **JetBrains Mono** para enlaces y cifrados. Contraste AA, `prefers-reduced-motion` respetado, 320 px sin desbordes, objetivos táctiles de 44 px.

## Roles de agentes

| Rol | Qué hace | Definición |
|---|---|---|
| **lead** | Planifica (PLAN.md), parte en issues, revisa PRs, mantiene MEMORY.md. | — |
| **builder** | Implementa un issue en su rama, con tests. | — |
| **security-auditor** | Revisa cada PR contra las reglas de arriba y `docs/MODELO_DE_AMENAZAS.md`. Solo lectura. | `.claude/agents/security-auditor.md`, `.opencode/agent/security-auditor.md` |
| **docs** | Mantiene README (usuario, sin tecnicismos), `docs/` y CHANGELOG. | `.opencode/agent/docs.md` |

Skills de Claude Code: `/security-check` (lista de comprobación antes de un PR) y `/release` (publicar versión).

## Flujo de trabajo

1. Un issue por tarea. Rama `agent/<rol>/<nº>-<tema>`.
2. `npm run check` en verde antes de abrir el PR.
3. El PR describe qué cambia, cómo se probó y su impacto en seguridad.
4. `security-auditor` revisa; el lead fusiona.
5. Actualiza `MEMORY.md` (estado y decisiones) y `CHANGELOG.md`.
6. No subir nunca `.env`, bases de datos, capturas con datos reales ni tokens.
