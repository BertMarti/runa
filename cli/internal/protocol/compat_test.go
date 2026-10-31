package protocol

// Compatibilidad con la web (apps/web/src/crypto) en los dos sentidos. Ver apps/web/test/compat-go.test.ts.
//
//   - testdata/desde-ts.json lo genera la web; aquí se abre y se vuelve a cifrar con la misma K y el mismo IV,
//     exigiendo el mismo cifrado byte a byte (mismo envoltorio, mismo JSON, mismo nombre saneado).
//   - testdata/desde-go.json lo genera TestGenerarVectores con -actualizar; lo abre el test de la web.

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"
)

var actualizar = flag.Bool("actualizar", false, "regenera testdata/desde-go.json")

const testdata = "../../testdata/"

type archivoJSON struct {
	Nombre string `json:"nombre"`
	Tipo   string `json:"tipo"`
	Datos  string `json:"datos"`
}

type esperadoJSON struct {
	Texto   string       `json:"texto"`
	Archivo *archivoJSON `json:"archivo,omitempty"`
}

type secretoTS struct {
	Nombre       string       `json:"nombre"`
	Texto        string       `json:"texto"`
	Contrasena   *string      `json:"contrasena"`
	Archivo      *archivoJSON `json:"archivo,omitempty"`
	Fragmento    string       `json:"fragmento"`
	Ciphertext   string       `json:"ciphertext"`
	Verifier     string       `json:"verifier"`
	LinkVerifier string       `json:"linkVerifier"`
	Link         string       `json:"link"`
	Token        string       `json:"token"`
	Esperado     esperadoJSON `json:"esperado"`
}

type peticionTS struct {
	Nombre         string       `json:"nombre"`
	Texto          string       `json:"texto"`
	Archivo        *archivoJSON `json:"archivo,omitempty"`
	SendFragment   string       `json:"sendFragment"`
	PickupFragment string       `json:"pickupFragment"`
	SendVerifier   string       `json:"sendVerifier"`
	OpenVerifier   string       `json:"openVerifier"`
	SendProof      string       `json:"sendProof"`
	OpenProof      string       `json:"openProof"`
	Ciphertext     string       `json:"ciphertext"`
	Ephemeral      string       `json:"ephemeral"`
	Esperado       esperadoJSON `json:"esperado"`
}

type limites struct {
	PadBuckets        []int `json:"padBuckets"`
	MaxPaddedBytes    int   `json:"maxPaddedBytes"`
	MaxTextChars      int   `json:"maxTextChars"`
	MaxFileBytes      int   `json:"maxFileBytes"`
	MaxFileName       int   `json:"maxFileName"`
	PBKDF2Iterations  int   `json:"pbkdf2Iterations"`
	TTLOptions        []int `json:"ttlOptions"`
	LargeSecretBytes  int   `json:"largeSecretBytes"`
	LargeSecretMaxTTL int   `json:"largeSecretMaxTtl"`
	MaxFailedAttempts int   `json:"maxFailedAttempts"`
	Servidor          struct {
		PadBuckets        []int `json:"padBuckets"`
		MaxPaddedBytes    int   `json:"maxPaddedBytes"`
		MaxCiphertextB64  int   `json:"maxCiphertextB64"`
		TTLOptions        []int `json:"ttlOptions"`
		LargeSecretBytes  int   `json:"largeSecretBytes"`
		LargeSecretMaxTTL int   `json:"largeSecretMaxTtl"`
		MinViews          int   `json:"minViews"`
		MaxViews          int   `json:"maxViews"`
		MaxFailedAttempts int   `json:"maxFailedAttempts"`
	} `json:"servidor"`
}

type vectoresTS struct {
	Limites limites `json:"limites"`
	Nombres []struct {
		Entrada string `json:"entrada"`
		Salida  string `json:"salida"`
	} `json:"nombres"`
	Secretos   []secretoTS  `json:"secretos"`
	NFD        secretoTS    `json:"nfd"`
	Peticiones []peticionTS `json:"peticiones"`
}

func cargarTS(t *testing.T) *vectoresTS {
	t.Helper()
	raw, err := os.ReadFile(testdata + "desde-ts.json")
	if err != nil {
		t.Fatalf("faltan los vectores de la web: %v", err)
	}
	var v vectoresTS
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Secretos) == 0 || len(v.Peticiones) == 0 {
		t.Fatal("vectores vacíos")
	}
	return &v
}

func mustB64(t *testing.T, s string) []byte {
	t.Helper()
	b, err := FromBase64URL(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func fileFrom(t *testing.T, a *archivoJSON) *File {
	if a == nil {
		return nil
	}
	return &File{Name: a.Nombre, Type: a.Tipo, Data: mustB64(t, a.Datos)}
}

func comparar(t *testing.T, got Payload, want esperadoJSON) {
	t.Helper()
	if got.Text != want.Texto {
		t.Errorf("texto = %q, se esperaba %q", got.Text, want.Texto)
	}
	if (got.File == nil) != (want.Archivo == nil) {
		t.Fatalf("adjunto: %v, se esperaba %v", got.File != nil, want.Archivo != nil)
	}
	if got.File != nil {
		if got.File.Name != want.Archivo.Nombre || got.File.Type != want.Archivo.Tipo || ToBase64URL(got.File.Data) != want.Archivo.Datos {
			t.Errorf("adjunto = %q %q %x, se esperaba %+v", got.File.Name, got.File.Type, got.File.Data, *want.Archivo)
		}
	}
}

func shaHex(t *testing.T, h string) string {
	b, err := hex.DecodeString(h)
	if err != nil {
		t.Fatal(err)
	}
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

func TestLimitesComoLaWebYElServidor(t *testing.T) {
	l := cargarTS(t).Limites
	checks := map[string][2]any{
		"padBuckets (web)":      {l.PadBuckets, PadBuckets},
		"padBuckets (servidor)": {l.Servidor.PadBuckets, PadBuckets},
		"maxPaddedBytes":        {[]int{l.MaxPaddedBytes, l.Servidor.MaxPaddedBytes}, []int{MaxPaddedBytes, MaxPaddedBytes}},
		"maxCiphertextB64":      {l.Servidor.MaxCiphertextB64, MaxCiphertextB64},
		"maxTextChars":          {l.MaxTextChars, MaxTextChars},
		"maxFileBytes":          {l.MaxFileBytes, MaxFileBytes},
		"maxFileName":           {l.MaxFileName, MaxFileName},
		"pbkdf2Iterations":      {l.PBKDF2Iterations, PBKDF2Iterations},
		"ttlOptions (web)":      {l.TTLOptions, TTLOptions},
		"ttlOptions (servidor)": {l.Servidor.TTLOptions, TTLOptions},
		"largeSecret":           {[]int{l.LargeSecretBytes, l.Servidor.LargeSecretBytes, l.LargeSecretMaxTTL, l.Servidor.LargeSecretMaxTTL}, []int{LargeSecretBytes, LargeSecretBytes, LargeSecretMaxTTL, LargeSecretMaxTTL}},
		"views":                 {[]int{l.Servidor.MinViews, l.Servidor.MaxViews}, []int{MinViews, MaxViews}},
		"maxFailedAttempts":     {[]int{l.MaxFailedAttempts, l.Servidor.MaxFailedAttempts}, []int{MaxFailedAttempts, MaxFailedAttempts}},
	}
	for name, c := range checks {
		if !reflect.DeepEqual(c[0], c[1]) {
			t.Errorf("%s: web/servidor %v, CLI %v", name, c[0], c[1])
		}
	}
}

func TestSafeFileNameComoLaWeb(t *testing.T) {
	for _, n := range cargarTS(t).Nombres {
		units := safeFileNameUnits(n.Entrada)
		parts := make([]string, len(units))
		for i, u := range units {
			parts[i] = fmt.Sprintf("%04x", u)
		}
		if got := strings.Join(parts, " "); got != n.Salida {
			t.Errorf("safeFileName(%q) = %s, la web da %s", n.Entrada, got, n.Salida)
		}
	}
}

func TestAbreLoQueCifraLaWeb(t *testing.T) {
	for _, v := range cargarTS(t).Secretos {
		t.Run(v.Nombre, func(t *testing.T) {
			key, ok := ParseFragment(v.Fragmento)
			if !ok {
				t.Fatal("fragmento no válido")
			}
			var pw []byte
			if v.Contrasena != nil {
				pw = []byte(*v.Contrasena)
			}
			u, err := Unlock(key, pw)
			if err != nil {
				t.Fatal(err)
			}
			if u.Proof.Link != v.Link || u.Proof.Token != v.Token {
				t.Error("las pruebas no coinciden con las de la web")
			}
			if shaHex(t, u.Proof.Token) != v.Verifier || shaHex(t, u.Proof.Link) != v.LinkVerifier {
				t.Error("los verificadores no coinciden con los de la web")
			}
			got, err := u.Open(v.Ciphertext)
			if err != nil {
				t.Fatal(err)
			}
			comparar(t, got, v.Esperado)

			// Mismo K, mismo IV y la entrada original: el cifrado debe salir idéntico byte a byte.
			iv := mustB64(t, v.Ciphertext)[:ivBytes]
			s, err := sealWith(key.Key, iv, Payload{Text: v.Texto, File: fileFrom(t, v.Archivo)}, pw)
			if err != nil {
				t.Fatal(err)
			}
			if s.Ciphertext != v.Ciphertext || s.Fragment != v.Fragmento || s.Verifier != v.Verifier || s.LinkVerifier != v.LinkVerifier {
				t.Error("el cifrado de Go no es idéntico byte a byte al de la web")
			}
		})
	}
}

func TestRechazaContrasenaQueLaWebNormalizaria(t *testing.T) {
	v := cargarTS(t).NFD
	key, _ := ParseFragment(v.Fragmento)
	if _, err := Unlock(key, []byte(*v.Contrasena)); !errors.Is(err, ErrPasswordNotNFC) {
		t.Fatalf("se esperaba ErrPasswordNotNFC, llegó %v", err)
	}
	// La misma contraseña ya en NFC sí abre lo que cifró la web con la contraseña en NFD.
	nfc := strings.ReplaceAll(*v.Contrasena, "ñ", "ñ")
	u, err := Unlock(key, []byte(nfc))
	if err != nil {
		t.Fatal(err)
	}
	got, err := u.Open(v.Ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	comparar(t, got, v.Esperado)
}

func TestRecogeLasPeticionesDeLaWeb(t *testing.T) {
	for _, v := range cargarTS(t).Peticiones {
		t.Run(v.Nombre, func(t *testing.T) {
			send, ok := ParseSendFragment(v.SendFragment)
			if !ok {
				t.Fatal("fragmento de envío no válido")
			}
			pickup, ok := ParsePickupFragment(v.PickupFragment)
			if !ok {
				t.Fatal("fragmento de recogida no válido")
			}
			pkcs8 := pickup.PKCS8
			h, err := PreparePickup(pickup)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(pkcs8, make([]byte, len(pkcs8))) {
				t.Error("PreparePickup no puso a cero la clave privada")
			}
			if h.Proof != v.OpenProof || shaHex(t, h.Proof) != v.OpenVerifier {
				t.Error("la prueba de recogida no coincide")
			}
			got, err := h.Open(v.Ciphertext, v.Ephemeral)
			if err != nil {
				t.Fatal(err)
			}
			comparar(t, got, v.Esperado)
			// Lo que Go cifre para este enlace de envío lleva la misma prueba que la web.
			s, err := SealForRequest(Payload{Text: "x"}, send)
			if err != nil {
				t.Fatal(err)
			}
			if s.Proof != v.SendProof || shaHex(t, s.Proof) != v.SendVerifier {
				t.Error("la prueba de envío no coincide")
			}
			// Y la clave pública del enlace de envío es la de la privada del de recogida.
			if !bytes.Equal(h.pub, send.Pub) {
				t.Error("las claves de los dos enlaces no casan")
			}
		})
	}
}

/* ---------- desde-go.json ---------- */

type secretoGo struct {
	Nombre       string       `json:"nombre"`
	Texto        string       `json:"texto"`
	Contrasena   *string      `json:"contrasena"`
	Archivo      *archivoJSON `json:"archivo,omitempty"`
	Fragmento    string       `json:"fragmento"`
	Ciphertext   string       `json:"ciphertext"`
	Verifier     string       `json:"verifier"`
	LinkVerifier string       `json:"linkVerifier"`
	// Esperado: lo que Go obtiene al abrirlo (nombre y tipo ya saneados); la web debe obtener lo mismo.
	Esperado *esperadoJSON `json:"esperado,omitempty"`
}

type peticionGo struct {
	Nombre         string        `json:"nombre"`
	Texto          string        `json:"texto"`
	Archivo        *archivoJSON  `json:"archivo,omitempty"`
	SendFragment   string        `json:"sendFragment"`
	PickupFragment string        `json:"pickupFragment"`
	SendVerifier   string        `json:"sendVerifier"`
	OpenVerifier   string        `json:"openVerifier"`
	Ciphertext     string        `json:"ciphertext"`
	Ephemeral      string        `json:"ephemeral"`
	Esperado       *esperadoJSON `json:"esperado,omitempty"`
}

func esperadoDe(p Payload) *esperadoJSON {
	e := &esperadoJSON{Texto: p.Text}
	if p.File != nil {
		e.Archivo = archivo(p.File.Name, p.File.Type, p.File.Data)
	}
	return e
}

type vectoresGo struct {
	Aviso      string       `json:"aviso"`
	Secretos   []secretoGo  `json:"secretos"`
	Peticiones []peticionGo `json:"peticiones"`
}

func ptr(s string) *string { return &s }

func archivo(name, typ string, data []byte) *archivoJSON {
	return &archivoJSON{Nombre: name, Tipo: typ, Datos: ToBase64URL(data)}
}

// Entradas para desde-go.json: los mismos rincones que en la web (escapes, Unicode, nombres, bloques).
var entradasGo = []secretoGo{
	{Nombre: "go-simple", Texto: "hola desde Go"},
	{Nombre: "go-escapes-json", Texto: "Contraseña: Ñu-77 · \"comillas\" \\ barra\nlínea\ttab\r\x01\x1f\x7f   😀 <script>&</script>"},
	{Nombre: "go-contrasena", Texto: "clave del wifi: 7#kP!2", Contrasena: ptr("fiordo azul ñandú €")},
	{Nombre: "go-adjunto", Texto: "con adjunto", Archivo: archivo("clave.pem", "application/x-pem-file", []byte("-----BEGIN-----\n"))},
	{Nombre: "go-adjunto-hostil", Contrasena: ptr("x"), Archivo: archivo("../../etc/factura‮fdp.exe", "text/html; charset=utf-8", []byte{0, 1, 2, 255})},
	{Nombre: "go-bloque-64k", Texto: strings.Repeat("ñ", 20000)},
	{Nombre: "go-vacio"},
}

func TestGenerarVectores(t *testing.T) {
	if !*actualizar {
		t.Skip("solo con -actualizar")
	}
	out := vectoresGo{Aviso: "Generado por cli/internal/protocol/compat_test.go (go test -run TestGenerarVectores -actualizar). No editar a mano."}
	for _, e := range entradasGo {
		var pw []byte
		if e.Contrasena != nil {
			pw = []byte(*e.Contrasena)
		}
		s, err := Seal(Payload{Text: e.Texto, File: fileFrom(t, e.Archivo)}, pw)
		if err != nil {
			t.Fatal(err)
		}
		e.Fragmento, e.Ciphertext, e.Verifier, e.LinkVerifier = s.Fragment, s.Ciphertext, s.Verifier, s.LinkVerifier
		key, _ := ParseFragment(s.Fragment)
		u, err := Unlock(key, pw)
		if err != nil {
			t.Fatal(err)
		}
		opened, err := u.Open(s.Ciphertext)
		if err != nil {
			t.Fatal(err)
		}
		e.Esperado = esperadoDe(opened)
		out.Secretos = append(out.Secretos, e)
	}
	for _, e := range []peticionGo{
		{Nombre: "go-peticion-texto", Texto: "usuario: ana · clave: 7#kP!2"},
		{Nombre: "go-peticion-adjunto", Texto: "va el certificado", Archivo: archivo("cert.p12", "application/x-pkcs12", bytes.Repeat([]byte{0xa5}, 2000))},
	} {
		r, err := CreateRequestKeys()
		if err != nil {
			t.Fatal(err)
		}
		send, _ := ParseSendFragment(r.SendFragment)
		s, err := SealForRequest(Payload{Text: e.Texto, File: fileFrom(t, e.Archivo)}, send)
		if err != nil {
			t.Fatal(err)
		}
		e.SendFragment, e.PickupFragment, e.SendVerifier, e.OpenVerifier = r.SendFragment, r.PickupFragment, r.SendVerifier, r.OpenVerifier
		e.Ciphertext, e.Ephemeral = s.Ciphertext, s.Ephemeral
		pk, _ := ParsePickupFragment(r.PickupFragment)
		h, err := PreparePickup(pk)
		if err != nil {
			t.Fatal(err)
		}
		opened, err := h.Open(s.Ciphertext, s.Ephemeral)
		if err != nil {
			t.Fatal(err)
		}
		e.Esperado = esperadoDe(opened)
		out.Peticiones = append(out.Peticiones, e)
	}
	b, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(testdata+"desde-go.json", append(b, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
}

// Los vectores de Go guardados siguen abriéndose con Go (la web los abre en compat-go.test.ts).
func TestVectoresGoGuardados(t *testing.T) {
	raw, err := os.ReadFile(testdata + "desde-go.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vectoresGo
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Secretos) != len(entradasGo) || len(v.Peticiones) == 0 {
		t.Fatal("desde-go.json no está al día: regenera con -actualizar")
	}
	for _, s := range v.Secretos {
		key, ok := ParseFragment(s.Fragmento)
		if !ok {
			t.Fatalf("%s: fragmento no válido", s.Nombre)
		}
		var pw []byte
		if s.Contrasena != nil {
			pw = []byte(*s.Contrasena)
		}
		u, err := Unlock(key, pw)
		if err != nil {
			t.Fatal(err)
		}
		got, err := u.Open(s.Ciphertext)
		if err != nil {
			t.Fatalf("%s: %v", s.Nombre, err)
		}
		comparar(t, got, *s.Esperado)
	}
	for _, p := range v.Peticiones {
		pk, ok := ParsePickupFragment(p.PickupFragment)
		if !ok {
			t.Fatalf("%s: fragmento no válido", p.Nombre)
		}
		h, err := PreparePickup(pk)
		if err != nil {
			t.Fatal(err)
		}
		got, err := h.Open(p.Ciphertext, p.Ephemeral)
		if err != nil {
			t.Fatalf("%s: %v", p.Nombre, err)
		}
		comparar(t, got, *p.Esperado)
	}
}
