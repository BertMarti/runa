// Orden runa: cliente de línea de órdenes de RUNA, compatible con el protocolo v1 de la web.
package main

import (
	"context"
	"os"

	"github.com/BertMarti/runa/cli/internal/app"
	"github.com/BertMarti/runa/cli/internal/tty"
)

// version la fija el flujo de publicación con -ldflags "-X main.version=…".
var version = "dev"

func main() {
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
	// Sin capturar Ctrl-C: interrumpe en cualquier momento (también mientras se lee la entrada estándar). Al pedir
	// una contraseña, tty.ReadSecret lo captura un instante para devolver el eco a la terminal antes de salir.
	os.Exit(app.Run(context.Background(), env, os.Args[1:]))
}
