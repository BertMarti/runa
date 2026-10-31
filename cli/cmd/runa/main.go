// Orden runa: cliente de línea de órdenes de RUNA, compatible con el protocolo v1 de la web.
package main

import (
	"context"
	"os"
	"os/signal"

	"github.com/BertMarti/runa/cli/internal/app"
	"github.com/BertMarti/runa/cli/internal/tty"
)

// version la fija el flujo de publicación con -ldflags "-X main.version=…".
var version = "dev"

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	env := &app.Env{
		Stdin:       os.Stdin,
		Stdout:      os.Stdout,
		Stderr:      os.Stderr,
		StdinIsTTY:  tty.IsTerminal(os.Stdin),
		StdoutIsTTY: tty.IsTerminal(os.Stdout),
		Getenv:      os.Getenv,
		ReadSecret:  tty.ReadSecret,
		Version:     version,
	}
	code := app.Run(ctx, env, os.Args[1:])
	stop()
	os.Exit(code)
}
