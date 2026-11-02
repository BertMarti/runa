# Estabilidad y compatibilidad (1.x)

Desde la v1.0.0, RUNA sigue [Semantic Versioning](https://semver.org/lang/es/) con estas promesas concretas. Una
versión 1.y.z nunca rompe nada de lo que sigue; si algún día hace falta romperlo, será la 2.0.0 y se avisará en el
CHANGELOG con los pasos para actualizar.

## Lo que no cambia en 1.x

| Pieza | Promesa |
|---|---|
| **Enlaces** | Un enlace creado con cualquier 1.x (o con 0.4+) se abre en cualquier otra 1.x, desde la web y desde la CLI. |
| **Protocolo** | El [protocolo v1](PROTOCOLO.md) queda congelado: mismas derivaciones (`runa/v1/*`), mismo envoltorio y mismo AAD. Lo comprueban los vectores de `cli/testdata/` y `apps/web/test/compat-python.test.ts` (ARIA). Un protocolo nuevo (por ejemplo, Argon2id) llegará como **v2 junto al v1**: los enlaces v1 se seguirán abriendo. |
| **API** | `GET /api/health`, `GET /api/config`, `POST /api/secrets`, `POST /api/secrets/:id/open`, `POST /api/secrets/:id/burn`, `POST /api/requests`, `POST /api/requests/:id/fill`, `POST /api/requests/:id/open`, `POST /api/requests/:id/cancel` y, con `METRICS_TOKEN`, `GET /api/metrics`: mismas rutas, mismos campos y mismos códigos de error. Se pueden **añadir** campos opcionales; nunca quitar ni cambiar de significado los que hay. |
| **Rutas de la web** | `/s/:id`, `/r/:id` y `/p/:id` siguen abriendo la pantalla de siempre. |
| **Configuración** | Las variables de [DESPLIEGUE.md](DESPLIEGUE.md) (`PORT`, `HOST`, `DATA_DIR`, `PUBLIC_URL`, `CREATE_FROM`, `TRUST_PROXY`, `TRUST_CF_FROM`, `CREATE_QUOTA_MB`, `MAX_STORAGE_MB`, `RATE_LIMIT_CREATE`, `RATE_LIMIT_OPEN`, `HSTS`, `METRICS_TOKEN`…) conservan su nombre y su valor por defecto, salvo que el valor por defecto deje de ser seguro (ver abajo). |
| **Datos** | La base de datos de una 1.x la abre cualquier 1.x posterior sin pasos a mano. Volver a una versión anterior no está garantizado. |
| **Imagen Docker** | `ghcr.io/bertmarti/runa:1` apunta siempre a la última 1.x; `:1.y` a la última de esa menor; `:1.y.z` no cambia nunca. amd64 y arm64. |
| **CLI** | Los comandos `send`, `open`, `burn`, `request`, `reply`, `pickup` y `version`, sus opciones y su salida por stdout (lo que se puede encadenar en un script). Los avisos de stderr pueden cambiar de texto. |
| **Métricas** | Los nombres de las series `runa_*` y sus etiquetas. Se pueden añadir series. |

## La excepción: la seguridad

Si un fallo de seguridad solo se arregla cambiando un comportamiento (por ejemplo, un valor por defecto o un límite
más estricto), se hará en una versión de parche o menor, explicado en la sección «Seguridad» del CHANGELOG. Los
límites de tamaño, de peticiones y de intentos **pueden endurecerse** sin que cuente como cambio incompatible.

## Lo que no es interfaz pública

- Los textos de la interfaz y las traducciones, el diseño y las capturas.
- El formato interno de la base de datos (solo se garantiza la migración automática).
- Los registros (`LOG_LEVEL`): qué se escribe y cómo.
- Cualquier cosa bajo `apps/*/src` usada como biblioteca.

## Soporte

Se mantiene la última versión menor de la 1.x. Los arreglos de seguridad salen como parche sobre ella; para recibirlos,
basta con usar la etiqueta `:1` de la imagen o descargar la última CLI. Para informar de un fallo, ver
[SECURITY.md](../SECURITY.md).
