package app

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// result es lo que deja una ejecución de la CLI.
type result struct {
	code           int
	stdout, stderr string
}

// cli prepara ejecuciones contra un servidor. secrets son las respuestas a ReadSecret, en orden.
type cli struct {
	t      *testing.T
	server string
	dir    string
	// leaks: textos que nunca deben aparecer en la salida de errores (claves, fragmentos, secretos).
	leaks []string
}

type opts struct {
	stdin       string
	stdinTTY    bool
	stdoutTTY   bool
	secrets     []string
	sleep       func(context.Context, time.Duration) error
	noServerEnv bool
}

func (c *cli) run(o opts, args ...string) result {
	c.t.Helper()
	var stdout, stderr bytes.Buffer
	secrets := append([]string(nil), o.secrets...)
	env := &Env{
		Stdin:       strings.NewReader(o.stdin),
		Stdout:      &stdout,
		Stderr:      &stderr,
		StdinIsTTY:  o.stdinTTY,
		StdoutIsTTY: o.stdoutTTY,
		Getenv: func(k string) string {
			if k == "RUNA_SERVER" && !o.noServerEnv {
				return c.server
			}
			return ""
		},
		ReadSecret: func(string) ([]byte, error) {
			if len(secrets) == 0 {
				return nil, errors.New("sin terminal")
			}
			s := secrets[0]
			secrets = secrets[1:]
			return []byte(s), nil
		},
		Version: "test",
		Dir:     c.dir,
		Sleep:   o.sleep,
	}
	code := Run(context.Background(), env, args)
	r := result{code: code, stdout: stdout.String(), stderr: stderr.String()}
	for _, leak := range c.leaks {
		if leak != "" && strings.Contains(r.stderr, leak) {
			c.t.Errorf("la salida de errores filtra %q: %s", leak, r.stderr)
		}
	}
	return r
}

// fragmentOf guarda la clave de un enlace para vigilar que no se filtre.
func (c *cli) watch(link string) string {
	link = strings.TrimSpace(link)
	if _, frag, ok := strings.Cut(link, "#"); ok {
		c.leaks = append(c.leaks, frag)
	}
	return link
}

func (c *cli) send(text string, args ...string) string {
	c.t.Helper()
	c.leaks = append(c.leaks, text)
	r := c.run(opts{stdin: text}, append([]string{"send"}, args...)...)
	if r.code != 0 {
		c.t.Fatalf("send: %d %s", r.code, r.stderr)
	}
	return c.watch(r.stdout)
}

func expect(t *testing.T, r result, code int, stderrHas string) {
	t.Helper()
	if r.code != code {
		t.Fatalf("código %d, se esperaba %d; stderr: %s", r.code, code, r.stderr)
	}
	if stderrHas != "" && !strings.Contains(r.stderr, stderrHas) {
		t.Fatalf("stderr sin %q: %s", stderrHas, r.stderr)
	}
}

var scenarios = map[string]func(*cli){
	"enviar y abrir; la segunda vez ya no existe": func(c *cli) {
		text := "usuario: ana · clave: 7#kP!2 — " + time.Now().String()
		link := c.send(text + "\n")
		if !strings.Contains(link, "/s/") || strings.Count(link, "\n") != 0 {
			c.t.Fatalf("enlace raro: %q", link)
		}
		r := c.run(opts{}, "open", link)
		expect(c.t, r, 0, "Destruido del servidor")
		if r.stdout != text {
			c.t.Fatalf("texto %q, se esperaba %q (sin el salto de línea final)", r.stdout, text)
		}
		expect(c.t, c.run(opts{}, "open", link), 1, "no existe")
	},
	"varias lecturas": func(c *cli) {
		link := c.send("tres veces", "--views", "2", "--ttl", "5m")
		expect(c.t, c.run(opts{}, "open", link), 0, "Queda 1 lectura más")
		expect(c.t, c.run(opts{}, "open", link), 0, "Destruido")
		expect(c.t, c.run(opts{}, "open", link), 1, "no existe")
	},
	"con contraseña: se pide en la terminal y se puede reintentar": func(c *cli) {
		c.leaks = append(c.leaks, "fiordo azul ñandú")
		r := c.run(opts{stdin: "con contraseña", secrets: []string{"fiordo azul ñandú", "fiordo azul ñandú"}}, "send", "--password")
		expect(c.t, r, 0, "canal distinto")
		link := c.watch(r.stdout)
		if !strings.HasSuffix(link, ".p") {
			c.t.Fatalf("el enlace no lleva .p")
		}
		r = c.run(opts{secrets: []string{"mala", "fiordo azul ñandú"}}, "open", link)
		expect(c.t, r, 0, "quedan 4 intentos")
		if r.stdout != "con contraseña" {
			c.t.Fatalf("texto %q", r.stdout)
		}
		// Contraseñas que no coinciden al crear.
		expect(c.t, c.run(opts{stdin: "x", secrets: []string{"a", "b"}}, "send", "--password"), 1, "no coinciden")
	},
	"sin terminal no se puede dar la contraseña": func(c *cli) {
		r := c.run(opts{stdin: "x", secrets: []string{"pw", "pw"}}, "send", "--password")
		link := c.watch(r.stdout)
		expect(c.t, c.run(opts{}, "open", link), 1, "lleva contraseña")
		// …y no se ha consumido: con la contraseña se abre.
		expect(c.t, c.run(opts{secrets: []string{"pw"}}, "open", link), 0, "")
	},
	"adjunto: nombre seguro, 0600 y sin sobrescribir": func(c *cli) {
		src := filepath.Join(c.t.TempDir(), "informe final.pdf")
		data := bytes.Repeat([]byte{0, 1, 2, 0xff}, 5000)
		if err := os.WriteFile(src, data, 0o644); err != nil {
			c.t.Fatal(err)
		}
		out := c.t.TempDir()
		// Ya existen el nombre y «(1)», y «(2)» es un enlace simbólico hacia fuera: nada de eso se toca.
		_ = os.WriteFile(filepath.Join(out, "informe final.pdf"), []byte("mío"), 0o644)
		_ = os.WriteFile(filepath.Join(out, "informe final (1).pdf"), []byte("mío"), 0o644)
		outside := filepath.Join(c.t.TempDir(), "fuera")
		_ = os.Symlink(outside, filepath.Join(out, "informe final (2).pdf"))

		r := c.run(opts{stdin: "", stdinTTY: true}, "send", "--file", src)
		expect(c.t, r, 0, "")
		link := c.watch(r.stdout)
		r = c.run(opts{}, "open", "--out", out, link)
		expect(c.t, r, 0, "informe final (3).pdf")
		if r.stdout != "" {
			c.t.Errorf("sin texto, stdout debería estar vacío: %q", r.stdout)
		}
		got, err := os.ReadFile(filepath.Join(out, "informe final (3).pdf"))
		if err != nil || !bytes.Equal(got, data) {
			c.t.Fatalf("adjunto distinto: %v", err)
		}
		info, _ := os.Stat(filepath.Join(out, "informe final (3).pdf"))
		if info.Mode().Perm() != 0o600 {
			c.t.Errorf("permisos %v", info.Mode().Perm())
		}
		if b, _ := os.ReadFile(filepath.Join(out, "informe final.pdf")); string(b) != "mío" {
			c.t.Error("sobrescribió un archivo existente")
		}
		if _, err := os.Stat(outside); !errors.Is(err, os.ErrNotExist) {
			c.t.Error("siguió el enlace simbólico")
		}
	},
	"la carpeta de destino se comprueba antes de consumir el secreto": func(c *cli) {
		link := c.send("no lo pierdas")
		expect(c.t, c.run(opts{}, "open", "--out", filepath.Join(c.t.TempDir(), "no-existe"), link), 1, "carpeta de destino")
		expect(c.t, c.run(opts{}, "open", link), 0, "")
	},
	"destruir": func(c *cli) {
		link := c.send("quémalo")
		expect(c.t, c.run(opts{}, "burn", link), 0, "Destruido")
		expect(c.t, c.run(opts{}, "open", link), 1, "no existe")
	},
	"el enlace se puede leer de la entrada estándar o de la terminal": func(c *cli) {
		link := c.send("por stdin")
		r := c.run(opts{stdin: link + "\n"}, "open")
		expect(c.t, r, 0, "")
		if r.stdout != "por stdin" {
			c.t.Fatalf("texto %q", r.stdout)
		}
		link = c.send("por la terminal")
		r = c.run(opts{stdinTTY: true, secrets: []string{link}}, "open")
		expect(c.t, r, 0, "")
		if r.stdout != "por la terminal" {
			c.t.Fatalf("texto %q", r.stdout)
		}
	},
	"pedir, responder y recoger": func(c *cli) {
		r := c.run(opts{}, "request", "--ttl", "1h")
		expect(c.t, r, 0, "no lo compartas")
		lines := strings.Split(strings.TrimSpace(r.stdout), "\n")
		if len(lines) != 2 || !strings.HasPrefix(lines[0], "envío: ") || !strings.HasPrefix(lines[1], "recogida: ") {
			c.t.Fatalf("salida de request: %q", r.stdout)
		}
		sendLink := c.watch(strings.TrimPrefix(lines[0], "envío: "))
		pickupLink := c.watch(strings.TrimPrefix(lines[1], "recogida: "))

		expect(c.t, c.run(opts{}, "pickup", pickupLink), ExitWaiting, "Todavía no")
		// El enlace de envío no sirve para recoger, ni el de recogida para responder.
		expect(c.t, c.run(opts{}, "pickup", sendLink), 1, "runa reply")
		expect(c.t, c.run(opts{stdin: "x"}, "reply", pickupLink), 1, "runa pickup")

		c.leaks = append(c.leaks, "usuario: ana")
		expect(c.t, c.run(opts{stdin: "usuario: ana\nclave: 1234\n"}, "reply", sendLink), 0, "Enviado")
		expect(c.t, c.run(opts{stdin: "otra vez"}, "reply", sendLink), 1, "ya recibió")
		r = c.run(opts{}, "pickup", pickupLink)
		expect(c.t, r, 0, "Recogido")
		if r.stdout != "usuario: ana\nclave: 1234" {
			c.t.Fatalf("texto %q", r.stdout)
		}
		expect(c.t, c.run(opts{}, "pickup", pickupLink), 1, "no existe")
	},
	"recoger esperando": func(c *cli) {
		r := c.run(opts{}, "request")
		lines := strings.Split(strings.TrimSpace(r.stdout), "\n")
		sendLink := c.watch(strings.TrimPrefix(lines[0], "envío: "))
		pickupLink := c.watch(strings.TrimPrefix(lines[1], "recogida: "))
		polls := 0
		sleep := func(context.Context, time.Duration) error {
			polls++
			if polls == 2 {
				expect(c.t, c.run(opts{stdin: "llegó"}, "reply", sendLink), 0, "")
			}
			return nil
		}
		r = c.run(opts{sleep: sleep}, "pickup", "--wait", pickupLink)
		expect(c.t, r, 0, "Esperando")
		if r.stdout != "llegó" || polls != 2 {
			c.t.Fatalf("texto %q tras %d esperas", r.stdout, polls)
		}
	},
	"cancelar una petición": func(c *cli) {
		r := c.run(opts{}, "request")
		lines := strings.Split(strings.TrimSpace(r.stdout), "\n")
		sendLink := c.watch(strings.TrimPrefix(lines[0], "envío: "))
		pickupLink := c.watch(strings.TrimPrefix(lines[1], "recogida: "))
		expect(c.t, c.run(opts{}, "pickup", "--cancel", pickupLink), 0, "cancelada")
		expect(c.t, c.run(opts{stdin: "tarde"}, "reply", sendLink), 1, "no existe")
	},
	"responder con adjunto": func(c *cli) {
		r := c.run(opts{}, "request")
		lines := strings.Split(strings.TrimSpace(r.stdout), "\n")
		sendLink := c.watch(strings.TrimPrefix(lines[0], "envío: "))
		pickupLink := c.watch(strings.TrimPrefix(lines[1], "recogida: "))
		src := filepath.Join(c.t.TempDir(), "cert.p12")
		_ = os.WriteFile(src, []byte{1, 2, 3}, 0o600)
		expect(c.t, c.run(opts{stdin: "va el certificado"}, "reply", "--file", src, sendLink), 0, "")
		out := c.t.TempDir()
		r = c.run(opts{}, "pickup", pickupLink, "--out", out)
		expect(c.t, r, 0, "cert.p12")
		if b, _ := os.ReadFile(filepath.Join(out, "cert.p12")); !bytes.Equal(b, []byte{1, 2, 3}) || r.stdout != "va el certificado" {
			c.t.Fatalf("recogido %q %v", r.stdout, b)
		}
	},
	"en una terminal, el texto no puede inyectar secuencias de escape": func(c *cli) {
		evil := "hola\x1b]0;título\x07\x1b[2J\rfin‮"
		link := c.send(evil)
		r := c.run(opts{stdoutTTY: true}, "open", link)
		expect(c.t, r, 0, "caracteres de control")
		if strings.ContainsAny(r.stdout, "\x1b\x07\r‮") || !strings.HasSuffix(r.stdout, "\n") {
			c.t.Fatalf("salida sin filtrar: %q", r.stdout)
		}
		link = c.send(evil)
		r = c.run(opts{stdoutTTY: true}, "open", "--raw", link)
		if r.stdout != evil {
			c.t.Fatalf("--raw debería dar el texto exacto: %q", r.stdout)
		}
	},
	"secretos grandes: como mucho 1 día": func(c *cli) {
		src := filepath.Join(c.t.TempDir(), "grande.bin")
		_ = os.WriteFile(src, make([]byte, 2<<20), 0o600)
		expect(c.t, c.run(opts{stdinTTY: true}, "send", "--file", src, "--ttl", "7d"), ExitUsage, "como mucho en 1 día")
		r := c.run(opts{stdinTTY: true}, "send", "--file", src)
		expect(c.t, r, 0, "")
		c.watch(r.stdout)
	},
}

func TestConServidorFalso(t *testing.T) {
	for name, scenario := range scenarios {
		t.Run(name, func(t *testing.T) {
			fake, url := newFakeServer(t)
			c := &cli{t: t, server: url, dir: t.TempDir()}
			scenario(c)
			// Al servidor nunca le llega ni una clave ni un texto en claro.
			for _, body := range fake.seen() {
				for _, leak := range c.leaks {
					if strings.Contains(body, leak) {
						t.Errorf("al servidor le llegó %q", leak)
					}
				}
			}
		})
	}
}
