# `runa` · RUNA desde la terminal

Comparte secretos cifrados de extremo a extremo que se autodestruyen, sin abrir el navegador. Es el mismo
protocolo que la web ([protocolo v1](../docs/PROTOCOLO.md)): un enlace creado con `runa` se abre en la web y al
revés. Todo se cifra y se descifra **en tu equipo**; el servidor solo ve ruido cifrado.

```console
$ pwgen -s 24 1 | runa send --server https://runa.example
https://runa.example/s/q8Zx…#v1.Tm9…
Secreto creado: caduca el 2026-11-01 10:00 CET o tras 1 lectura.

$ runa open
Pega el enlace de secreto (no se mostrará):
Rk3v9Qe…
Destruido del servidor: el enlace ya no sirve.
```

## Instalar

**Binario ya compilado.** Cada versión publica en [Releases](https://github.com/BertMarti/runa/releases) binarios
estáticos para Linux, macOS y Windows (amd64 y arm64), un `SHA256SUMS` y una atestación de procedencia firmada.
Compruébalos antes de usarlos:

```bash
V=v0.6.0; F=runa-$V-linux-amd64
curl -LO https://github.com/BertMarti/runa/releases/download/$V/$F
curl -LO https://github.com/BertMarti/runa/releases/download/$V/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
gh attestation verify "$F" --repo BertMarti/runa     # se compiló en el CI de este repositorio
install -m 0755 "$F" ~/.local/bin/runa
```

**Desde el código** (Go 1.26 o posterior):

```bash
go install github.com/BertMarti/runa/cli/cmd/runa@latest
# o bien
git clone https://github.com/BertMarti/runa && cd runa/cli && go build -trimpath -o ~/.local/bin/runa ./cmd/runa
```

Para no repetir `--server`, define el servidor una vez:

```bash
export RUNA_SERVER=https://runa.example
```

## Órdenes

| Orden | Qué hace |
|---|---|
| `runa send` | Cifra el texto de la entrada estándar (y un archivo con `--file`) y escribe el enlace. |
| `runa open [enlace]` | Abre un secreto: escribe el texto y guarda el adjunto. Al agotarse las lecturas, se destruye. |
| `runa burn [enlace]` | Lo destruye sin leerlo. |
| `runa request` | Crea una petición para que **otra persona te envíe** un secreto. |
| `runa reply [enlace-de-envío]` | Responde a una petición: cifra para quien la creó. |
| `runa pickup [enlace-de-recogida]` | Recoge lo que te han enviado (`--wait` para esperar, `--cancel` para cancelar). |
| `runa version` | Versión de la CLI y del protocolo. |

`runa <orden> --help` explica todas las opciones.

### Enviar

```bash
echo 'la clave del wifi es 7#kP!2' | runa send                 # 1 lectura, caduca en 1 día
runa send --ttl 1h --views 3 < nota.txt                         # 5m, 1h, 1d o 7d; de 1 a 10 lecturas
runa send --password < credenciales.txt                         # pide la contraseña sin eco (dos veces)
runa send --file contrato.pdf < /dev/null                       # solo el archivo (máximo 3 MiB)
echo 'va el contrato' | runa send --file contrato.pdf           # texto y archivo
```

- El texto se lee de la **entrada estándar**, nunca de los argumentos (quedaría en el historial del shell y lo vería
  cualquiera con `ps`). Si escribes a mano, termina con Ctrl-D (Ctrl-Z e Intro en Windows).
- Se quita **un** salto de línea final, el que añaden `echo` o el Intro antes de Ctrl-D. `--keep-newline` lo conserva.
- Límites, los mismos que en la web: 100 000 caracteres de texto y un archivo de 3 MiB. Los secretos de más de 1 MiB
  caducan como mucho en 1 día.
- Solo se escribe el enlace en la salida estándar: `runa send < x | wl-copy` lo deja en el portapapeles.

### Abrir

```bash
runa open                                  # pide el enlace en la terminal, sin mostrarlo
runa open < enlace.txt                     # o lo lee de la entrada estándar
runa open 'https://runa.example/s/…#v1.…'  # también como argumento (ver «Seguridad»)
runa open --out ~/Descargas                # dónde guardar el adjunto
runa open > secreto.txt                    # el texto, exacto, a un archivo
```

- Si lleva contraseña (el enlace acaba en `.p`), se pide en la terminal. Tras 5 fallos, el servidor lo destruye.
- El adjunto se guarda con un **nombre seguro** (sin rutas, controles ni caracteres invisibles; igual que la web), con
  **permisos 0600** y **sin sobrescribir nunca**: si ya existe, `nombre (1).ext`, `nombre (2).ext`… La carpeta se
  comprueba **antes** de pedir el secreto, para no perderlo por un error de carpeta.
- Si la salida es una terminal, los caracteres de control del texto (los que podrían cambiar el título de la ventana,
  borrar la pantalla o esconder texto) se muestran como `�` y se avisa. Redirigido o con `--raw`, sale exacto.

### Pedir un secreto

```console
$ runa request --ttl 1d
envío: https://runa.example/r/Hc2…#v1.Pq7…
recogida: https://runa.example/p/Hc2…#v1.MC4…
Petición creada: caduca el 2026-11-01 10:00 CET.
Comparte solo el enlace de envío. El de recogida es tu llave: no lo compartas.
```

`request` escribe **siempre dos líneas** en la salida estándar, en este orden y con estas etiquetas, para que se
puedan separar en un script:

```bash
out=$(runa request)
envio=$(printf '%s\n' "$out" | sed -n 's/^envío: //p')
recogida=$(printf '%s\n' "$out" | sed -n 's/^recogida: //p')
```

Quien recibe el enlace de envío responde (en la web o con la CLI):

```bash
echo 'usuario: ana · clave: 1234' | runa reply 'https://runa.example/r/…#v1.…'
```

Y tú lo recoges:

```bash
runa pickup              # pide el enlace de recogida sin mostrarlo
runa pickup --wait       # espera (consulta cada 15 s) hasta que llegue
runa pickup --cancel     # ya no lo necesitas
```

Si todavía no han enviado nada, `pickup` lo dice y sale con el código **3**.

### Códigos de salida

| Código | Significado |
|---|---|
| 0 | Hecho. |
| 1 | Error (no existe, contraseña incorrecta, red…). El mensaje va a la salida de errores. |
| 2 | Uso incorrecto (opción desconocida, caducidad no válida, falta el servidor…). |
| 3 | `pickup`: todavía no te han enviado nada. |

## Seguridad

Lo que la CLI hace por ti:

- **Criptografía solo de la biblioteca estándar de Go** (`crypto/hkdf`, `crypto/pbkdf2`, `crypto/ecdh`, AES-GCM).
  La única dependencia es `golang.org/x/term`, para leer contraseñas sin eco.
- **Compatibilidad comprobada byte a byte** con la web: los tests abren lo que cifra la web, vuelven a cifrarlo con la
  misma clave y el mismo IV y exigen el mismo resultado; la web abre lo que cifra la CLI (`cli/testdata/`).
- **Solo HTTPS** (http únicamente para `localhost`, `127.0.0.1` y `[::1]`), TLS 1.2 o superior, sin seguir
  redirecciones, con tiempos máximos y respuestas de tamaño acotado. El servidor sale del propio enlace.
- **Nada sensible en los mensajes**: ni el enlace, ni la clave, ni la contraseña, ni el contenido aparecen en la salida
  de errores. Las claves se ponen a cero tras usarlas (en la medida en que Go lo permite).
- **Contraseñas solo por la terminal** (`/dev/tty`, o la consola en Windows), sin eco. No hay opción ni variable de
  entorno para pasarlas: una opción se ve con `ps` y una variable la heredan los procesos hijos.

Lo que depende de ti:

- **No pases enlaces como argumento** si puedes evitarlo: quedan en el historial del shell (`~/.bash_history`) y, mientras
  se ejecuta la orden, cualquier usuario del equipo los ve con `ps`. Sin argumento, `runa` los pide sin mostrarlos.
  Si alguno se cuela en el historial, bórralo (`history -d N`) o empieza la orden con un espacio (con
  `HISTCONTROL=ignorespace`).
- **El enlace de `send` y el de recogida de `request` se escriben en pantalla**: quedan en el *scrollback* de la
  terminal (y en `tmux`, `screen` o el registro de una sesión SSH). Redirígelos (`| wl-copy`, `> archivo`) si no quieres
  verlos, y borra lo que guardes cuando ya no lo necesites.
- **Lo que abres queda donde lo pongas**: el texto en la pantalla o en el archivo al que lo redirijas; el adjunto, en la
  carpeta de destino. RUNA lo borra del servidor, no de tu disco.

### Limitación: contraseñas con caracteres combinantes

La web normaliza la contraseña a Unicode NFC antes de derivar la clave. La biblioteca estándar de Go no incluye NFC
(está en `golang.org/x/text`, que la CLI no usa), así que `runa` **rechaza** las contraseñas que NFC podría cambiar, en
lugar de derivar una clave distinta: marcas combinantes sueltas (una `n` seguida de una tilde combinante), jamos
hangul sueltos y caracteres de compatibilidad (como `Å` U+212B). Las contraseñas que se escriben con cualquier
teclado (ñ, á, ç, ü, ß, €, chino, cirílico, emoji…) funcionan. Si una contraseña creada en la web contiene esos
caracteres, ábrela en la web.

## Desarrollo

```bash
cd cli
go vet ./... && test -z "$(gofmt -l .)" && go test ./...
```

- `internal/protocol`: el protocolo v1 (traducción de `apps/web/src/crypto`). `compat_test.go` usa los vectores de
  `testdata/`:
  - `desde-ts.json` lo genera la web: `cd apps/web && RUNA_GENERAR_VECTORES=1 npx vitest run test/compat-go.test.ts`.
  - `desde-go.json` lo genera la CLI: `cd cli && go test ./internal/protocol -run TestGenerarVectores -actualizar`.
  - `nfc_tabla.go` sale de `internal/protocol/gen/nfc.mjs` (con Node 24).
- `internal/app`: las órdenes. Sus escenarios se prueban contra un servidor falso en memoria y, con `RUNA_E2E_URL`,
  contra el real. `scripts/cli-e2e.sh` (tras `npm run build`) arranca el servidor y ejecuta los escenarios y la
  interoperabilidad en vivo con la web (`apps/web/test/cli-interop.test.ts`).
