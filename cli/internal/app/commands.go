package app

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/BertMarti/runa/cli/internal/api"
	"github.com/BertMarti/runa/cli/internal/link"
	"github.com/BertMarti/runa/cli/internal/protocol"
)

/* ---------- send ---------- */

const sendUsage = `Uso: runa send [opciones] < texto

Cifra en este equipo el texto de la entrada estándar (y, si quieres, un archivo), lo sube y escribe el
enlace en la salida estándar. Se quita un salto de línea final, como el que añade «echo».

Opciones:
  --ttl valor       caducidad: 5m, 1h, 1d o 7d (por defecto 1d; con más de 1 MiB, como mucho 1d)
  --views n         lecturas permitidas, del 1 al 10 (por defecto 1)
  --password        pide una contraseña en la terminal (sin eco); quien lo abra la necesitará
  --file ruta       adjunta un archivo (máximo 3 MiB); el texto pasa a ser opcional
  --keep-newline    conserva el salto de línea final del texto
  --server URL      servidor de RUNA (o variable RUNA_SERVER), p. ej. https://runa.example

Ejemplos:
  pwgen -s 24 1 | runa send --server https://runa.example
  runa send --file contrato.pdf --ttl 1h --password < /dev/null
`

func cmdSend(ctx context.Context, env *Env, args []string) error {
	fs := newFlags(env, "send", sendUsage)
	ttlFlag := fs.String("ttl", "1d", "")
	viewsFlag := fs.String("views", "1", "")
	withPassword := fs.Bool("password", false, "")
	filePath := fs.String("file", "", "")
	keepNewline := fs.Bool("keep-newline", false, "")
	server := fs.String("server", "", "")
	pos, err := parseArgs(fs, args)
	if err != nil {
		return err
	}
	if len(pos) > 0 {
		return usageErr("send no admite argumentos: el texto se lee de la entrada estándar (nunca de la línea de órdenes)")
	}
	ttl, err := parseTTL(*ttlFlag)
	if err != nil {
		return err
	}
	views, err := parseViews(*viewsFlag)
	if err != nil {
		return err
	}
	origin, err := serverFrom(env, *server)
	if err != nil {
		return err
	}

	var password []byte
	if *withPassword {
		password, err = askNewPassword(env)
		if err != nil {
			return err
		}
		defer protocol.Wipe(password)
	}
	payload, err := readPayload(env, *filePath, *keepNewline)
	if err != nil {
		return err
	}
	defer payload.Wipe()

	sealed, err := protocol.Seal(payload, password)
	if err != nil {
		return sealError(err)
	}
	if sealed.PaddedLen > protocol.LargeSecretBytes && ttl > protocol.LargeSecretMaxTTL {
		return usageErr("los secretos de más de 1 MiB caducan como mucho en 1 día: usa --ttl 1d o menos")
	}
	client := api.New(origin, env.HTTP)
	cfg := client.GetConfig(ctx)
	created, err := client.CreateSecret(ctx, sealed, ttl, views)
	if err != nil {
		return err
	}
	base := origin
	if cfg.PublicURL != "" {
		base = cfg.PublicURL
		noticePublicURL(env, origin, base)
	}
	fmt.Fprintln(env.Stdout, link.Format(base, link.Secret, created.ID, sealed.Fragment))
	fmt.Fprintf(env.Stderr, "Secreto creado: caduca el %s o tras %d %s.\n", formatTime(created.ExpiresAt), views, plural(views, "lectura", "lecturas"))
	if len(password) > 0 {
		fmt.Fprintln(env.Stderr, "Envía la contraseña por un canal distinto al del enlace.")
	}
	return nil
}

func sealError(err error) error {
	switch {
	case errors.Is(err, protocol.ErrTooLarge):
		return errors.New("el secreto supera el tamaño máximo (texto de 100 000 caracteres y archivo de 3 MiB)")
	case errors.Is(err, protocol.ErrInvalidUTF8):
		return errors.New("el texto no es UTF-8 válido; para datos binarios usa --file")
	}
	return err
}

// askNewPassword pide la contraseña dos veces, sin eco, y comprueba que el CLI puede derivarla igual que la web.
func askNewPassword(env *Env) ([]byte, error) {
	first, err := env.ReadSecret("Contraseña: ")
	if err != nil {
		return nil, fmt.Errorf("no se pudo pedir la contraseña: %w", err)
	}
	if len(first) == 0 {
		return nil, errors.New("la contraseña está vacía")
	}
	if err := protocol.CheckPassword(first); err != nil {
		protocol.Wipe(first)
		return nil, err
	}
	second, err := env.ReadSecret("Repite la contraseña: ")
	defer protocol.Wipe(second)
	if err != nil {
		protocol.Wipe(first)
		return nil, fmt.Errorf("no se pudo pedir la contraseña: %w", err)
	}
	if !bytes.Equal(first, second) {
		protocol.Wipe(first)
		return nil, errors.New("las contraseñas no coinciden")
	}
	return first, nil
}

/* ---------- open y burn ---------- */

const openUsage = `Uso: runa open [opciones] [enlace]

Abre un secreto: lo pide al servidor (que lo destruye al llegar a 0 lecturas), lo descifra aquí y escribe
el texto en la salida estándar. Un adjunto se guarda en la carpeta actual (o --out) con un nombre seguro,
permisos 0600 y sin sobrescribir nada.

Sin enlace (o con «-»), se lee de la entrada estándar o se pide en la terminal sin mostrarlo: así no queda
en el historial del shell. Si lleva contraseña, se pide en la terminal.

Opciones:
  --out carpeta   dónde guardar el adjunto (por defecto, la actual)
  --raw           escribe el texto tal cual aunque la salida sea una terminal (sin filtrar controles)
`

func cmdOpen(ctx context.Context, env *Env, args []string) error {
	fs := newFlags(env, "open", openUsage)
	out := fs.String("out", env.Dir, "")
	raw := fs.Bool("raw", false, "")
	pos, err := parseArgs(fs, args)
	if err != nil {
		return err
	}
	l, err := readLink(env, pos, link.Secret, true)
	if err != nil {
		return err
	}
	key, ok := protocol.ParseFragment(l.Fragment)
	if !ok {
		return errors.New("la clave del enlace no es válida: ¿se ha cortado al copiarlo?")
	}
	defer protocol.Wipe(key.Key)
	root, err := openOutDir(*out)
	if err != nil {
		return err
	}
	defer root.Close()

	client := api.New(l.Origin, env.HTTP)
	var opened *api.Opened
	var unlocked *protocol.Unlocked
	for {
		unlocked, err = unlockWithPrompt(env, key)
		if err != nil {
			return err
		}
		opened, err = client.OpenSecret(ctx, l.ID, unlocked.Proof)
		var apiErr *api.Error
		if errors.As(err, &apiErr) && apiErr.Code == api.Denied && apiErr.AttemptsLeft > 0 && key.HasPassphrase {
			fmt.Fprintf(env.Stderr, "%s.\n", apiErr)
			continue
		}
		if err != nil {
			return err
		}
		break
	}
	payload, err := unlocked.Open(opened.Ciphertext)
	if err != nil {
		return fmt.Errorf("%w (el servidor ya ha descontado la lectura)", err)
	}
	defer payload.Wipe()
	if err := writePayload(env, payload, root, *raw); err != nil {
		return err
	}
	if opened.ViewsLeft > 0 {
		fmt.Fprintf(env.Stderr, "%s %d %s más.\n", plural(opened.ViewsLeft, "Queda", "Quedan"), opened.ViewsLeft, plural(opened.ViewsLeft, "lectura", "lecturas"))
	} else {
		fmt.Fprintln(env.Stderr, "Destruido del servidor: el enlace ya no sirve.")
	}
	return nil
}

// unlockWithPrompt deriva las pruebas; si el enlace lleva contraseña, la pide a la terminal.
func unlockWithPrompt(env *Env, key protocol.LinkKey) (*protocol.Unlocked, error) {
	var password []byte
	if key.HasPassphrase {
		var err error
		password, err = env.ReadSecret("Contraseña del secreto: ")
		if err != nil {
			return nil, fmt.Errorf("este secreto lleva contraseña y no se pudo pedir: %w", err)
		}
		defer protocol.Wipe(password)
		if len(password) == 0 {
			return nil, errors.New("la contraseña está vacía")
		}
	}
	return protocol.Unlock(key, password)
}

const burnUsage = `Uso: runa burn [enlace]

Destruye un secreto sin leerlo (por ejemplo, si lo enviaste a quien no debías). Hace falta el enlace
completo y, si la tiene, la contraseña. Sin enlace, se lee de la entrada estándar o se pide en la terminal.
`

func cmdBurn(ctx context.Context, env *Env, args []string) error {
	fs := newFlags(env, "burn", burnUsage)
	pos, err := parseArgs(fs, args)
	if err != nil {
		return err
	}
	l, err := readLink(env, pos, link.Secret, true)
	if err != nil {
		return err
	}
	key, ok := protocol.ParseFragment(l.Fragment)
	if !ok {
		return errors.New("la clave del enlace no es válida: ¿se ha cortado al copiarlo?")
	}
	defer protocol.Wipe(key.Key)
	unlocked, err := unlockWithPrompt(env, key)
	if err != nil {
		return err
	}
	if err := api.New(l.Origin, env.HTTP).BurnSecret(ctx, l.ID, unlocked.Proof); err != nil {
		return err
	}
	fmt.Fprintln(env.Stderr, "Destruido: nadie podrá abrirlo.")
	return nil
}

/* ---------- request, reply y pickup ---------- */

const requestUsage = `Uso: runa request [opciones]

Crea una petición para que otra persona te envíe un secreto cifrado con tu clave (X25519). Escribe dos
líneas en la salida estándar, siempre en este orden:

  envío: https://…/r/…#v1.…      → compártelo con quien te lo tiene que mandar
  recogida: https://…/p/…#v1.…   → guárdalo tú: es la llave para leerlo (con «runa pickup»)

Opciones:
  --ttl valor     caducidad de la petición: 5m, 1h, 1d o 7d (por defecto 1d)
  --server URL    servidor de RUNA (o variable RUNA_SERVER)
`

func cmdRequest(ctx context.Context, env *Env, args []string) error {
	fs := newFlags(env, "request", requestUsage)
	ttlFlag := fs.String("ttl", "1d", "")
	server := fs.String("server", "", "")
	pos, err := parseArgs(fs, args)
	if err != nil {
		return err
	}
	if len(pos) > 0 {
		return usageErr("request no admite argumentos")
	}
	ttl, err := parseTTL(*ttlFlag)
	if err != nil {
		return err
	}
	origin, err := serverFrom(env, *server)
	if err != nil {
		return err
	}
	keys, err := protocol.CreateRequestKeys()
	if err != nil {
		return err
	}
	client := api.New(origin, env.HTTP)
	cfg := client.GetConfig(ctx)
	created, err := client.CreateRequest(ctx, keys, ttl)
	if err != nil {
		return err
	}
	base := origin
	if cfg.PublicURL != "" {
		base = cfg.PublicURL
		noticePublicURL(env, origin, base)
	}
	fmt.Fprintf(env.Stdout, "envío: %s\nrecogida: %s\n",
		link.Format(base, link.Send, created.ID, keys.SendFragment),
		link.Format(base, link.Pickup, created.ID, keys.PickupFragment))
	fmt.Fprintf(env.Stderr, "Petición creada: caduca el %s.\n", formatTime(created.ExpiresAt))
	fmt.Fprintln(env.Stderr, "Comparte solo el enlace de envío. El de recogida es tu llave: no lo compartas.")
	return nil
}

const replyUsage = `Uso: runa reply [opciones] [enlace-de-envío] < texto

Envía un secreto a quien te pasó un enlace de envío: se cifra aquí con su clave pública y solo esa persona
puede abrirlo. Una petición se puede responder una sola vez. Sin enlace, se pide en la terminal.

Opciones:
  --file ruta       adjunta un archivo (máximo 3 MiB); el texto pasa a ser opcional
  --keep-newline    conserva el salto de línea final del texto
`

func cmdReply(ctx context.Context, env *Env, args []string) error {
	fs := newFlags(env, "reply", replyUsage)
	filePath := fs.String("file", "", "")
	keepNewline := fs.Bool("keep-newline", false, "")
	pos, err := parseArgs(fs, args)
	if err != nil {
		return err
	}
	// La entrada estándar es el contenido: el enlace va en el argumento o se pide a la terminal.
	l, err := readLink(env, pos, link.Send, false)
	if err != nil {
		return err
	}
	key, ok := protocol.ParseSendFragment(l.Fragment)
	if !ok {
		return errors.New("la clave del enlace de envío no es válida: ¿se ha cortado al copiarlo?")
	}
	payload, err := readPayload(env, *filePath, *keepNewline)
	if err != nil {
		return err
	}
	defer payload.Wipe()
	sealed, err := protocol.SealForRequest(payload, key)
	if err != nil {
		return sealError(err)
	}
	expires, err := api.New(l.Origin, env.HTTP).FillRequest(ctx, l.ID, sealed)
	if err != nil {
		return err
	}
	fmt.Fprintf(env.Stderr, "Enviado: solo quien lo pidió puede abrirlo, hasta el %s.\n", formatTime(expires))
	return nil
}

const pickupUsage = `Uso: runa pickup [opciones] [enlace-de-recogida]

Recoge lo que te han enviado a una petición: lo descifra aquí, escribe el texto en la salida estándar y el
servidor lo borra. Si todavía no hay nada, lo dice y sale con código 3. Sin enlace, se lee de la entrada
estándar o se pide en la terminal sin mostrarlo.

Opciones:
  --wait          espera (consultando cada 15 s) hasta que llegue algo o caduque la petición
  --cancel        cancela la petición (y borra lo enviado, si lo hay)
  --out carpeta   dónde guardar el adjunto (por defecto, la actual)
  --raw           escribe el texto tal cual aunque la salida sea una terminal
`

// pickupInterval: 4 consultas por minuto, muy por debajo del límite de aperturas del servidor (30/min).
const pickupInterval = 15 * time.Second

func cmdPickup(ctx context.Context, env *Env, args []string) error {
	fs := newFlags(env, "pickup", pickupUsage)
	wait := fs.Bool("wait", false, "")
	cancel := fs.Bool("cancel", false, "")
	out := fs.String("out", env.Dir, "")
	raw := fs.Bool("raw", false, "")
	pos, err := parseArgs(fs, args)
	if err != nil {
		return err
	}
	if *wait && *cancel {
		return usageErr("--wait y --cancel no se pueden usar juntas")
	}
	l, err := readLink(env, pos, link.Pickup, true)
	if err != nil {
		return err
	}
	key, ok := protocol.ParsePickupFragment(l.Fragment)
	if !ok {
		return errors.New("la clave del enlace de recogida no es válida: ¿se ha cortado al copiarlo?")
	}
	handle, err := protocol.PreparePickup(key)
	if err != nil {
		return err
	}
	client := api.New(l.Origin, env.HTTP)
	if *cancel {
		if err := client.CancelRequest(ctx, l.ID, handle.Proof); err != nil {
			return err
		}
		fmt.Fprintln(env.Stderr, "Petición cancelada: el enlace de envío ya no sirve.")
		return nil
	}
	root, err := openOutDir(*out)
	if err != nil {
		return err
	}
	defer root.Close()

	announced := false
	for {
		res, err := client.OpenRequest(ctx, l.ID, handle.Proof)
		if err != nil {
			return err
		}
		if !res.Waiting {
			payload, err := handle.Open(res.Ciphertext, res.Ephemeral)
			if err != nil {
				return fmt.Errorf("%w (el servidor ya lo ha borrado)", err)
			}
			defer payload.Wipe()
			if err := writePayload(env, payload, root, *raw); err != nil {
				return err
			}
			fmt.Fprintln(env.Stderr, "Recogido y borrado del servidor.")
			return nil
		}
		if !*wait {
			fmt.Fprintf(env.Stderr, "Todavía no te han enviado nada. La petición caduca el %s.\n", formatTime(res.ExpiresAt))
			return errWaiting
		}
		if !announced {
			fmt.Fprintf(env.Stderr, "Esperando a que te lo envíen (caduca el %s; Ctrl-C para salir)…\n", formatTime(res.ExpiresAt))
			announced = true
		}
		if err := env.Sleep(ctx, pickupInterval); err != nil {
			return err
		}
	}
}

// noticePublicURL avisa si el servidor pide publicar los enlaces en otro origen (PUBLIC_URL), como hace la web:
// quien comparte debe saber a qué sitio va a mandar a la otra persona.
func noticePublicURL(env *Env, origin, public string) {
	if public != origin {
		fmt.Fprintf(env.Stderr, "Aviso: el servidor publica los enlaces en %s (PUBLIC_URL), no en %s.\n", public, origin)
	}
}
