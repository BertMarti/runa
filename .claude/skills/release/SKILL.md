---
name: release
description: Publica una versión de RUNA (semver), con CHANGELOG, etiqueta e imagen Docker. Úsala cuando el usuario pida «sacar versión» o «release».
---

# Publicar una versión

1. Ejecuta la skill `security-check` completa.
2. Decide la versión (semver): cambios en el protocolo que rompen enlaces = mayor; funciones = menor; arreglos = parche.
3. Actualiza `version` en `package.json`, `apps/server/package.json` y `apps/web/package.json` (`npm version <x.y.z> --workspaces --include-workspace-root --no-git-tag-version`).
4. Mueve «Sin publicar» de `CHANGELOG.md` a `[x.y.z] - AAAA-MM-DD` y añade el enlace de comparación.
5. Actualiza `MEMORY.md` (estado) y marca el hito en `PLAN.md`.
6. Commit `chore(release): vx.y.z`, etiqueta `vx.y.z`, `git push --follow-tags`.
7. `gh release create vx.y.z --notes-from-tag` o con las notas del CHANGELOG. El workflow `docker.yml` publica la imagen `ghcr.io/bertmarti/runa:x.y.z` y `cli-release.yml` sube los binarios de la CLI, `SHA256SUMS` y su atestación. Si `cli-release.yml` llegó antes y dejó un **borrador**, publícalo con `gh release edit vx.y.z --draft=false --notes-file …`.
8. Comprueba que los workflows de la etiqueta terminan en verde.
