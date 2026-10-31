// Package app implementa las órdenes de la CLI de RUNA (send, open, burn, request, reply, pickup).
//
// Reglas que se cumplen en todo el paquete:
//   - El texto descifrado solo se escribe en la salida estándar; los avisos van a la salida de errores.
//   - Ningún mensaje contiene el enlace, su fragmento, la contraseña, las pruebas ni el contenido.
//   - Las contraseñas solo se leen de la terminal, sin eco; nunca de los argumentos.
package app

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/BertMarti/runa/cli/internal/api"
	"github.com/BertMarti/runa/cli/internal/link"
	"github.com/BertMarti/runa/cli/internal/protocol"
)

// Códigos de salida.
const (
	ExitOK      = 0
	ExitError   = 1
	ExitUsage   = 2
	ExitWaiting = 3 // `pickup`: todavía no han enviado nada
)

// Env es todo lo que la CLI toma del exterior; los tests lo sustituyen.
type Env struct {
	Stdin       io.Reader
	Stdout      io.Writer
	Stderr      io.Writer
	StdinIsTTY  bool
	StdoutIsTTY bool
	Getenv      func(string) string
	// ReadSecret pide algo a la terminal sin eco (contraseñas y enlaces).
	ReadSecret func(prompt string) ([]byte, error)
	HTTP       *http.Client
	Version    string
	// Sleep espera entre consultas de `pickup --wait`.
	Sleep func(ctx context.Context, d time.Duration) error
	// Dir es la carpeta por defecto para guardar adjuntos.
	Dir string
}

// errUsage marca un error de uso (código de salida 2).
type errUsage struct{ msg string }

func (e errUsage) Error() string { return e.msg }

func usageErr(format string, a ...any) error { return errUsage{fmt.Sprintf(format, a...)} }

// errWaiting: `pickup` sin nada que recoger todavía.
var errWaiting = errors.New("todavía no te han enviado nada")

const mainUsage = `runa — secretos cifrados de extremo a extremo que se autodestruyen (protocolo v1)

Uso:
  runa send    [--ttl 1d] [--views 1] [--password] [--file ruta] [--server URL]  < texto
  runa open    [--out carpeta] [--raw] [enlace]
  runa burn    [enlace]
  runa request [--ttl 1d] [--server URL]
  runa reply   [--file ruta] [enlace-de-envío]  < texto
  runa pickup  [--out carpeta] [--raw] [--wait] [--cancel] [enlace-de-recogida]
  runa version

Todo se cifra y descifra en este equipo: el servidor solo ve ruido cifrado. La clave va en el
fragmento del enlace (lo que sigue a #) y nunca se envía.

Si no pasas el enlace como argumento, se pide en la terminal sin mostrarlo (o se lee de la
entrada estándar): así no queda en el historial del shell ni lo ve nadie con «ps».

El servidor de send y request sale de --server o de la variable RUNA_SERVER; en el resto de
órdenes, del propio enlace. Solo https (http únicamente en localhost).

«runa <orden> --help» explica cada orden.
`

// Run ejecuta la CLI y devuelve el código de salida.
func Run(ctx context.Context, env *Env, args []string) int {
	if env.HTTP == nil {
		env.HTTP = api.NewHTTPClient()
	}
	if env.Getenv == nil {
		env.Getenv = func(string) string { return "" }
	}
	if env.Dir == "" {
		env.Dir = "."
	}
	if env.Sleep == nil {
		env.Sleep = sleepCtx
	}
	if len(args) == 0 {
		fmt.Fprint(env.Stderr, mainUsage)
		return ExitUsage
	}
	cmds := map[string]func(context.Context, *Env, []string) error{
		"send":    cmdSend,
		"open":    cmdOpen,
		"burn":    cmdBurn,
		"request": cmdRequest,
		"reply":   cmdReply,
		"pickup":  cmdPickup,
	}
	name, rest := args[0], args[1:]
	switch name {
	case "help", "-h", "--help", "ayuda":
		fmt.Fprint(env.Stdout, mainUsage)
		return ExitOK
	case "version", "--version":
		fmt.Fprintf(env.Stdout, "runa %s (protocolo %s)\n", env.Version, protocol.Version)
		return ExitOK
	}
	cmd, ok := cmds[name]
	if !ok {
		fmt.Fprintf(env.Stderr, "runa: orden desconocida %q\n\n%s", name, mainUsage)
		return ExitUsage
	}
	err := cmd(ctx, env, rest)
	switch {
	case err == nil:
		return ExitOK
	case errors.Is(err, flag.ErrHelp):
		return ExitOK
	case errors.Is(err, errWaiting):
		return ExitWaiting
	}
	fmt.Fprintf(env.Stderr, "runa %s: %s\n", name, err)
	var u errUsage
	if errors.As(err, &u) {
		return ExitUsage
	}
	return ExitError
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// newFlags crea el juego de opciones de una orden con su ayuda en castellano.
func newFlags(env *Env, name, usage string) *flag.FlagSet {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.Usage = func() { fmt.Fprint(env.Stdout, usage) }
	return fs
}

// parseArgs admite opciones antes y después de los argumentos («runa open ENLACE --out dir»).
func parseArgs(fs *flag.FlagSet, args []string) ([]string, error) {
	var positional []string
	for {
		if err := fs.Parse(args); err != nil {
			if errors.Is(err, flag.ErrHelp) {
				fs.Usage()
				return nil, err
			}
			return nil, usageErr("%s (ver «runa %s --help»)", translateFlagError(err), fs.Name())
		}
		rest := fs.Args()
		if len(rest) == 0 {
			return positional, nil
		}
		positional = append(positional, rest[0])
		args = rest[1:]
	}
}

func translateFlagError(err error) string {
	msg := err.Error()
	switch {
	case strings.HasPrefix(msg, "flag provided but not defined: "):
		return "opción desconocida " + strings.TrimPrefix(msg, "flag provided but not defined: ")
	case strings.HasPrefix(msg, "flag needs an argument: "):
		return "falta el valor de la opción " + strings.TrimPrefix(msg, "flag needs an argument: ")
	case strings.HasPrefix(msg, "invalid boolean value"), strings.HasPrefix(msg, "invalid value"):
		return "valor no válido: " + msg
	}
	return msg
}

// parseTTL acepta 5m, 1h, 1d, 7d (y sus equivalentes en segundos).
func parseTTL(s string) (int, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "5m", "5min", "300":
		return 300, nil
	case "1h", "60m", "3600":
		return 3600, nil
	case "1d", "24h", "86400":
		return 86_400, nil
	case "7d", "1w", "168h", "604800":
		return 604_800, nil
	}
	return 0, usageErr("caducidad no válida %q: usa 5m, 1h, 1d o 7d", s)
}

func parseViews(s string) (int, error) {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil || n < protocol.MinViews || n > protocol.MaxViews {
		return 0, usageErr("lecturas no válidas %q: un número del %d al %d", s, protocol.MinViews, protocol.MaxViews)
	}
	return n, nil
}

// serverFrom: --server o RUNA_SERVER.
func serverFrom(env *Env, flagValue string) (string, error) {
	raw := flagValue
	if raw == "" {
		raw = env.Getenv("RUNA_SERVER")
	}
	origin, err := link.Server(raw)
	if err != nil {
		return "", usageErr("%s", err)
	}
	return origin, nil
}

// readLink obtiene el enlace: del argumento, de la entrada estándar (si no es una terminal y allowStdin) o
// preguntando a la terminal sin eco. Nunca lo repite en un error.
func readLink(env *Env, args []string, want link.Kind, allowStdin bool) (*link.Link, error) {
	if len(args) > 1 {
		return nil, usageErr("sobran argumentos: se espera un solo enlace")
	}
	var raw string
	switch {
	case len(args) == 1 && args[0] != "-":
		raw = args[0]
	case allowStdin && !env.StdinIsTTY:
		line, err := bufio.NewReaderSize(io.LimitReader(env.Stdin, 4096), 4096).ReadString('\n')
		if err != nil && !errors.Is(err, io.EOF) {
			return nil, err
		}
		raw = line
	default:
		b, err := env.ReadSecret(fmt.Sprintf("Pega el %s (no se mostrará): ", want.Name()))
		if err != nil {
			return nil, usageErr("falta el %s: pásalo como argumento o desde una terminal", want.Name())
		}
		raw = string(b)
		protocol.Wipe(b)
	}
	l, err := link.Parse(raw)
	if err != nil {
		return nil, err
	}
	if l.Kind != want {
		hint := map[link.Kind]string{link.Secret: "runa open", link.Send: "runa reply", link.Pickup: "runa pickup"}[l.Kind]
		return nil, fmt.Errorf("es un %s, no un %s: usa «%s»", l.Kind.Name(), want.Name(), hint)
	}
	return l, nil
}

func formatTime(t time.Time) string { return t.Local().Format("2006-01-02 15:04 MST") }

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}
