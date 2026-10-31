// Package tty lee secretos de la terminal sin eco y prepara el texto descifrado para mostrarlo en pantalla.
//
// Las contraseñas y los enlaces que se piden aquí se leen de la propia terminal (/dev/tty, o CONIN$ en Windows),
// nunca de los argumentos: lo que va en la línea de órdenes queda en el historial del shell y lo ve cualquiera
// con `ps`.
package tty

import (
	"errors"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"unicode/utf8"

	"golang.org/x/term"
)

// ErrNoTTY: no hay terminal a la que preguntar (p. ej., en un cron o un CI).
var ErrNoTTY = errors.New("no hay una terminal para pedirlo sin eco")

// IsTerminal dice si f es una terminal.
func IsTerminal(f *os.File) bool { return term.IsTerminal(int(f.Fd())) }

// ReadSecret escribe el aviso en la terminal y lee una línea sin eco. El resultado es un []byte para poder
// ponerlo a cero después.
func ReadSecret(prompt string) ([]byte, error) {
	in, out, err := openTTY()
	if err != nil {
		return nil, ErrNoTTY
	}
	defer closeTTY(in, out)
	if _, err := out.WriteString(prompt); err != nil {
		return nil, err
	}
	fd := int(in.Fd())
	// term.ReadPassword quita el eco pero deja pasar Ctrl-C: sin esto, la terminal se quedaría sin eco.
	if state, err := term.GetState(fd); err == nil {
		sig := make(chan os.Signal, 1)
		done := make(chan struct{})
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		go func() {
			select {
			case <-sig:
				_ = term.Restore(fd, state)
				_, _ = out.WriteString("\n")
				os.Exit(130)
			case <-done:
			}
		}()
		defer func() {
			signal.Stop(sig)
			close(done)
		}()
	}
	b, err := term.ReadPassword(fd)
	_, _ = out.WriteString("\n")
	if err != nil {
		return nil, err
	}
	return b, nil
}

// IsUnsafeRune: lo que puede alterar la terminal o engañar a la vista: controles C0 (salvo \t y \n), DEL,
// controles C1 (empiezan secuencias de escape en algunas terminales) y controles bidireccionales.
func IsUnsafeRune(r rune) bool {
	switch {
	case r == '\t' || r == '\n':
		return false
	case r < 0x20 || r == 0x7f || (r >= 0x80 && r <= 0x9f):
		return true
	case r >= 0x202a && r <= 0x202e, r >= 0x2066 && r <= 0x2069, r == 0x200e || r == 0x200f || r == 0x061c:
		return true
	}
	return false
}

// ForDisplay prepara un texto descifrado para escribirlo en una terminal: sustituye por «�» los caracteres que
// podrían inyectar secuencias de escape (cambiar el título, borrar líneas, ocultar texto…) y dice si lo ha
// hecho. «\r\n» se conserva. Si el destino no es una terminal, el texto se escribe tal cual, sin pasar por aquí.
func ForDisplay(s string) (string, bool) {
	var b strings.Builder
	changed := false
	for i, r := range s {
		if r == utf8.RuneError {
			// UTF-8 no válido no debería llegar (el envoltorio es JSON), pero por si acaso.
			b.WriteRune(r)
			continue
		}
		if r == '\r' && i+1 < len(s) && s[i+1] == '\n' {
			b.WriteRune(r)
			continue
		}
		if IsUnsafeRune(r) {
			b.WriteRune('�')
			changed = true
			continue
		}
		b.WriteRune(r)
	}
	return b.String(), changed
}
