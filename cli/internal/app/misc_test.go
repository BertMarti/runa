package app

import (
	"strings"
	"testing"
)

func TestUso(t *testing.T) {
	c := &cli{t: t, server: "https://runa.example", dir: t.TempDir()}
	cases := []struct {
		args []string
		o    opts
		code int
		has  string
	}{
		{nil, opts{}, ExitUsage, "Uso:"},
		{[]string{"enviarlo"}, opts{}, ExitUsage, "orden desconocida"},
		{[]string{"send", "mi-contraseña"}, opts{}, ExitUsage, "nunca de la línea de órdenes"},
		{[]string{"send", "--ttl", "2d"}, opts{stdin: "x"}, ExitUsage, "5m, 1h, 1d o 7d"},
		{[]string{"send", "--views", "11"}, opts{stdin: "x"}, ExitUsage, "del 1 al 10"},
		{[]string{"send", "--nada"}, opts{}, ExitUsage, "opción desconocida"},
		{[]string{"send"}, opts{stdin: "x", noServerEnv: true}, ExitUsage, "RUNA_SERVER"},
		{[]string{"send", "--server", "http://runa.example"}, opts{stdin: "x"}, ExitUsage, "solo se admite https"},
		{[]string{"send"}, opts{stdin: ""}, ExitError, "nada que enviar"},
		{[]string{"send"}, opts{stdin: "\xff\xfe"}, ExitError, "UTF-8"},
		{[]string{"send"}, opts{stdin: strings.Repeat("a", 100_001)}, ExitError, "máximo"},
		{[]string{"send", "--file", "/no/existe"}, opts{}, ExitError, "no se pudo abrir"},
		{[]string{"send", "--file", "/"}, opts{}, ExitError, "archivo normal"},
		{[]string{"open"}, opts{stdinTTY: true}, ExitUsage, "falta el enlace de secreto"},
		{[]string{"open", "a", "b"}, opts{}, ExitUsage, "sobran"},
		{[]string{"open", "https://runa.example/s/AbCdEfGhIjKlMnOpQrStUv"}, opts{}, ExitError, "le falta la clave"},
		{[]string{"open", "https://runa.example/s/AbCdEfGhIjKlMnOpQrStUv#v1.corta"}, opts{}, ExitError, "no es válida"},
		{[]string{"reply"}, opts{stdin: "x"}, ExitUsage, "falta el enlace de envío"},
		{[]string{"pickup", "--wait", "--cancel", "x"}, opts{}, ExitUsage, "no se pueden usar juntas"},
	}
	for _, tc := range cases {
		r := c.run(tc.o, tc.args...)
		if r.code != tc.code || !strings.Contains(r.stderr, tc.has) {
			t.Errorf("%v → %d %q", tc.args, r.code, r.stderr)
		}
	}
	for _, args := range [][]string{{"help"}, {"send", "--help"}, {"open", "-h"}, {"version"}} {
		if r := c.run(opts{}, args...); r.code != 0 || r.stdout == "" {
			t.Errorf("%v → %d", args, r.code)
		}
	}
}

func TestLocalName(t *testing.T) {
	for in, want := range map[string]string{
		"informe.pdf":      "informe.pdf",
		"../../etc/passwd": "passwd",
		"CON":              "_CON",
		"nul.txt":          "_nul.txt",
		"Com1.tar.gz":      "_Com1.tar.gz",
		"console.log":      "console.log",
		"-rf":              "_-rf",
		"":                 "archivo",
	} {
		if got := localName(in); got != want {
			t.Errorf("localName(%q) = %q, se esperaba %q", in, got, want)
		}
	}
}

func TestParseTTL(t *testing.T) {
	for in, want := range map[string]int{"5m": 300, "1H": 3600, "1d": 86400, "24h": 86400, "7d": 604800, "604800": 604800} {
		if got, err := parseTTL(in); err != nil || got != want {
			t.Errorf("%q → %d %v", in, got, err)
		}
	}
	for _, in := range []string{"", "2h", "30d", "-1"} {
		if _, err := parseTTL(in); err == nil {
			t.Errorf("%q aceptado", in)
		}
	}
}
