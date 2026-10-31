package app

import (
	"bytes"
	"os"
	"path/filepath"
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
		// Revisión: los controles C1 y bidireccionales no llegan ni al disco ni a la terminal.
		"\u009b2J\u009d0;X\u009cinforme.txt": "_2J_0;X_informe.txt",
		"factura\u2066.pdf":                  "factura.pdf", // ya lo quita safeFileName
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

// Revisión: una carpeta de solo lectura se rechaza **antes** de llamar al servidor (abrir destruye el secreto).
func TestOpenOutDirExigeEscritura(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root escribe en cualquier carpeta")
	}
	dir := filepath.Join(t.TempDir(), "solo-lectura")
	if err := os.Mkdir(dir, 0o500); err != nil {
		t.Fatal(err)
	}
	if root, err := openOutDir(dir); err == nil || !strings.Contains(err.Error(), "no se puede escribir") {
		if root != nil {
			_ = root.Close()
		}
		t.Fatalf("se aceptó una carpeta sin permiso de escritura: %v", err)
	}
	root, err := openOutDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	entries, _ := os.ReadDir(root.Name())
	if len(entries) != 0 {
		t.Errorf("la prueba de escritura dejó restos: %v", entries)
	}
}

// Revisión: si el servidor publica los enlaces en otro origen (PUBLIC_URL), se avisa.
func TestAvisoPublicURL(t *testing.T) {
	var buf bytes.Buffer
	env := &Env{Stderr: &buf}
	noticePublicURL(env, "https://runa.example", "https://runa.example")
	if buf.Len() != 0 {
		t.Errorf("aviso sin motivo: %q", buf.String())
	}
	noticePublicURL(env, "https://interno.example", "https://runa.example")
	if !strings.Contains(buf.String(), "https://runa.example") || !strings.Contains(buf.String(), "PUBLIC_URL") {
		t.Errorf("falta el aviso: %q", buf.String())
	}
}
