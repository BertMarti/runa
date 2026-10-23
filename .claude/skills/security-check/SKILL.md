---
name: security-check
description: Lista de comprobación de seguridad de RUNA antes de abrir o fusionar un PR. Úsala siempre que cambies apps/, Dockerfile, compose.yaml o .github/.
---

# Comprobación de seguridad de RUNA

Ejecuta en orden y no declares el trabajo terminado si algo falla.

1. `npm run check` (o `./dk.sh npm run check` si tu Node es < 24): lint, tipos y tests en verde.
2. `grep -rnE "innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML|eval\(|new Function" apps/*/src` → vacío.
3. `grep -rnE "localStorage|sessionStorage" apps/web/src` → solo la preferencia de idioma.
4. `grep -rn "location.hash" apps/web/src` → solo para pasarlo a `parseFragment`.
5. `git diff main...HEAD -- apps/server/src/app.ts` → la CSP no gana `unsafe-*` ni orígenes externos; ninguna ruta nueva sin `schema`.
6. `npm audit --omit=dev --audit-level=high` → sin vulnerabilidades altas.
7. Si cambian límites: `apps/server/src/limits.ts` y `apps/web/src/crypto/limits.ts` coinciden.
8. Si cambia el protocolo: `docs/PROTOCOLO.md` actualizado y tests nuevos en `apps/web/test/crypto.test.ts`.
9. Si hay dependencias nuevas: justificación en el PR y sin scripts de instalación (`npm install-scripts ls`).
10. Lanza el subagente `security-auditor` sobre el diff y resuelve lo que encuentre.
