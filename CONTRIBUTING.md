# Cómo contribuir

¡Gracias! RUNA es pequeño a propósito: cada línea de código es superficie de ataque.

1. Abre un issue antes de un cambio grande.
2. Crea una rama desde `main`.
3. `npm ci` y `npm run check` en verde (si tu Node es < 24: `./dk.sh npm run check`).
4. Sigue las **reglas de seguridad** de [AGENTS.md](AGENTS.md#reglas-de-seguridad-bloqueantes-en-revisión). Son bloqueantes.
5. Commits con [Conventional Commits](https://www.conventionalcommits.org/es/) (`feat:`, `fix:`, `docs:`, `chore:`…).
6. En el PR: qué cambia, cómo lo probaste y su impacto en seguridad.

¿Has encontrado una vulnerabilidad? Lee [SECURITY.md](SECURITY.md): no la publiques en un issue.
