package protocol

import (
	"bytes"
	"encoding/binary"
	"errors"
	"strings"
	"testing"
)

func TestCifraYDescifra(t *testing.T) {
	for _, pw := range []string{"", "fiordo azul"} {
		p := Payload{Text: "usuario: ana · clave: 7#kP!2", File: &File{Name: "a.txt", Type: "text/plain", Data: []byte("hola")}}
		s, err := Seal(p, []byte(pw))
		if err != nil {
			t.Fatal(err)
		}
		key, ok := ParseFragment("#" + s.Fragment)
		if !ok || key.HasPassphrase != (pw != "") {
			t.Fatalf("fragmento %v %v", ok, key.HasPassphrase)
		}
		u, err := Unlock(key, []byte(pw))
		if err != nil {
			t.Fatal(err)
		}
		if u.Proof != s.Proof {
			t.Error("las pruebas no coinciden")
		}
		got, err := u.Open(s.Ciphertext)
		if err != nil {
			t.Fatal(err)
		}
		if got.Text != p.Text || got.File.Name != "a.txt" || string(got.File.Data) != "hola" {
			t.Errorf("payload %+v", got)
		}
	}
}

func TestCadaCifradoUsaClaveEIVNuevos(t *testing.T) {
	a, _ := Seal(Payload{Text: "x"}, nil)
	b, _ := Seal(Payload{Text: "x"}, nil)
	if a.Fragment == b.Fragment || a.Ciphertext[:16] == b.Ciphertext[:16] {
		t.Error("K o IV repetidos")
	}
}

func TestDetectaAlteraciones(t *testing.T) {
	s, _ := Seal(Payload{Text: "secreto"}, nil)
	key, _ := ParseFragment(s.Fragment)
	u, _ := Unlock(key, nil)
	b, _ := FromBase64URL(s.Ciphertext)
	for _, i := range []int{0, 11, 12, 500, len(b) - 1} {
		c := bytes.Clone(b)
		c[i] ^= 1
		if _, err := u.Open(ToBase64URL(c)); !errors.Is(err, ErrDecrypt) {
			t.Errorf("byte %d alterado: %v", i, err)
		}
	}
	if _, err := u.Open(ToBase64URL(b[:20])); !errors.Is(err, ErrDecrypt) {
		t.Error("cifrado corto aceptado")
	}
	if _, err := u.Open("no*es*base64"); !errors.Is(err, ErrDecrypt) {
		t.Error("base64 inválido aceptado")
	}
}

func TestQuitarLaMarcaDeContrasenaNoSirve(t *testing.T) {
	s, _ := Seal(Payload{Text: "x"}, []byte("pw"))
	key, _ := ParseFragment(strings.TrimSuffix(s.Fragment, ".p"))
	if key.HasPassphrase {
		t.Fatal("sigue marcada")
	}
	u, err := Unlock(key, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := u.Open(s.Ciphertext); err == nil {
		t.Error("se abrió sin contraseña")
	}
}

func TestContrasenaIncorrectaDaOtroToken(t *testing.T) {
	s, _ := Seal(Payload{Text: "x"}, []byte("buena"))
	key, _ := ParseFragment(s.Fragment)
	u, err := Unlock(key, []byte("mala"))
	if err != nil {
		t.Fatal(err)
	}
	if u.Proof.Token == s.Proof.Token {
		t.Error("mismo token con otra contraseña")
	}
	if u.Proof.Link != s.Proof.Link {
		t.Error("la prueba de enlace no debe depender de la contraseña")
	}
	if _, err := u.Open(s.Ciphertext); err == nil {
		t.Error("abrió con la contraseña incorrecta")
	}
	if _, err := Unlock(key, nil); !errors.Is(err, ErrPasswordRequired) {
		t.Error("sin contraseña debería pedirla")
	}
}

func TestFragmentos(t *testing.T) {
	good := "v1." + strings.Repeat("A", 43)
	for _, f := range []string{good, "#" + good, good + ".p"} {
		if _, ok := ParseFragment(f); !ok {
			t.Errorf("%q rechazado", f)
		}
	}
	for _, f := range []string{"", "v2." + strings.Repeat("A", 43), good + "A", good[:45], good + ".x", "v1." + strings.Repeat("A", 42) + "=", good + ".p.p"} {
		if _, ok := ParseFragment(f); ok {
			t.Errorf("%q aceptado", f)
		}
	}
}

func TestEnvoltorioRellenaABloques(t *testing.T) {
	cases := map[int]int{0: 1024, 1000: 1024, 1010: 4096, 20_000: 65536}
	for n, want := range cases {
		b, err := EncodePayload(Payload{Text: strings.Repeat("a", n)})
		if err != nil {
			t.Fatal(err)
		}
		if len(b) != want {
			t.Errorf("texto de %d → bloque %d, se esperaba %d", n, len(b), want)
		}
	}
	big := Payload{Text: strings.Repeat("😀", MaxTextChars/2), File: &File{Name: "f", Data: make([]byte, MaxFileBytes)}}
	b, err := EncodePayload(big)
	if err != nil || len(b) != MaxPaddedBytes {
		t.Fatalf("el máximo debe caber en el último bloque: %v %d", err, len(b))
	}
	s, err := Seal(big, nil)
	if err != nil || s.PaddedLen <= LargeSecretBytes {
		t.Fatalf("PaddedLen %d %v", s.PaddedLen, err)
	}
	if raw, _ := FromBase64URL(s.Ciphertext); !ValidCiphertextSize(len(raw)) || len(s.Ciphertext) > MaxCiphertextB64 {
		t.Error("tamaño de cifrado no conforme")
	}
}

func TestLimitesDelEnvoltorio(t *testing.T) {
	if _, err := EncodePayload(Payload{Text: strings.Repeat("a", MaxTextChars+1)}); !errors.Is(err, ErrTooLarge) {
		t.Error("texto demasiado largo aceptado")
	}
	// Se mide en unidades UTF-16, como `string.length`: 50 001 emojis son 100 002 unidades.
	if _, err := EncodePayload(Payload{Text: strings.Repeat("😀", MaxTextChars/2+1)}); !errors.Is(err, ErrTooLarge) {
		t.Error("texto demasiado largo (UTF-16) aceptado")
	}
	if _, err := EncodePayload(Payload{File: &File{Data: make([]byte, MaxFileBytes+1)}}); !errors.Is(err, ErrTooLarge) {
		t.Error("archivo demasiado grande aceptado")
	}
	if _, err := EncodePayload(Payload{Text: "\xff"}); !errors.Is(err, ErrInvalidUTF8) {
		t.Error("UTF-8 inválido aceptado")
	}
}

func header(t *testing.T, json string, extra ...byte) []byte {
	t.Helper()
	b := make([]byte, 1024)
	binary.BigEndian.PutUint32(b, uint32(len(json)))
	copy(b[4:], json)
	copy(b[4+len(json):], extra)
	return b
}

func TestDecodeValidaComoLaWeb(t *testing.T) {
	ok := map[string]string{
		`{"text":"a"}`:                 "a",
		`{"text":"a","file":null}`:     "a",
		`{"text":"a","file":0}`:        "a",
		`{"text":"a","file":""}`:       "a",
		`{"text":"a","file":false}`:    "a",
		`{"text":"x","text":"b"}`:      "b", // como JSON.parse: gana la última
		`{"text":"\ud83d"}`:            "�",
		`{"text":"a","otro":[1,2,{}]}`: "a",
	}
	for h, want := range ok {
		p, err := DecodePayload(header(t, h))
		if err != nil || p.Text != want {
			t.Errorf("%s → %q %v", h, p.Text, err)
		}
	}
	bad := []string{
		`{"TEXT":"a"}`, // encoding/json no distingue mayúsculas; la web sí
		`{"text":null}`,
		`{"text":1}`,
		`[]`,
		`null`,
		`{"text":"a","file":1}`,
		`{"text":"a","file":{"name":"n","type":"t"}}`,
		`{"text":"a","file":{"name":"n","type":"t","size":1.5}}`,
		`{"text":"a","file":{"name":"n","type":"t","size":-1}}`,
		`{"text":"a","file":{"name":"n","type":"t","size":5000}}`,
		`{"text":"a","file":{"name":1,"type":"t","size":1}}`,
		`{"text":"a"`,
	}
	for _, h := range bad {
		if _, err := DecodePayload(header(t, h)); err == nil {
			t.Errorf("%s aceptado", h)
		}
	}
	// Cabecera más larga que el envoltorio, UTF-8 inválido y tamaños fuera de rango.
	b := header(t, `{"text":"a"}`)
	binary.BigEndian.PutUint32(b, 2000)
	if _, err := DecodePayload(b); err == nil {
		t.Error("longitud de cabecera excesiva aceptada")
	}
	if _, err := DecodePayload(header(t, "{\"text\":\"\xff\"}")); err == nil {
		t.Error("UTF-8 inválido aceptado")
	}
	if _, err := DecodePayload([]byte{0, 0}); err == nil {
		t.Error("envoltorio corto aceptado")
	}
	p, err := DecodePayload(header(t, `{"text":"","file":{"name":"../x/..evil.sh ","type":"a/b/c","size":3}}`, 1, 2, 3))
	if err != nil || p.File.Name != "evil.sh" || p.File.Type != "application/octet-stream" || !bytes.Equal(p.File.Data, []byte{1, 2, 3}) {
		t.Errorf("adjunto %+v %v", p.File, err)
	}
}

func TestSafeMime(t *testing.T) {
	for in, want := range map[string]string{
		"text/plain": "text/plain", "application/vnd.ms-excel": "application/vnd.ms-excel", "": "application/octet-stream",
		"text/html; charset=utf-8": "application/octet-stream", "a/b/c": "application/octet-stream", "/x": "application/octet-stream",
		"x/": "application/octet-stream", "image/svg+xml": "image/svg+xml", strings.Repeat("a", 60) + "/" + strings.Repeat("b", 60): "application/octet-stream",
	} {
		if got := safeMime(in); got != want {
			t.Errorf("safeMime(%q) = %q", in, got)
		}
	}
}

func TestNFC(t *testing.T) {
	for _, pw := range []string{"correcto caballo", "ñandú", "Ça va, über straße €", "密码", "пароль", "パスワード", "😀🔑", "한국어"} {
		if err := checkNFC([]byte(pw)); err != nil {
			t.Errorf("%q rechazada: %v", pw, err)
		}
	}
	for _, pw := range []string{
		"mañana", // n + tilde combinante
		"Å",       // ANGSTROM SIGN → Å
		"Ω",       // OHM SIGN → Ω
		"가",      // jamos hangul que se componen en 가
		"각",      // sílaba LV + jamo T
		"豈",       // ideograma de compatibilidad CJK
		"é",      // e + acento agudo combinante
		"̈́",       // se descompone en dos marcas
	} {
		if err := checkNFC([]byte(pw)); !errors.Is(err, ErrPasswordNotNFC) {
			t.Errorf("%q aceptada", pw)
		}
	}
	if err := checkNFC([]byte("\xff")); !errors.Is(err, ErrPasswordUTF8) {
		t.Error("UTF-8 inválido aceptado")
	}
}

func TestPeticion(t *testing.T) {
	r, err := CreateRequestKeys()
	if err != nil {
		t.Fatal(err)
	}
	if len(r.SendFragment) != 3+43 || len(r.PickupFragment) != 3+64 {
		t.Fatal("longitudes de fragmento")
	}
	send, ok1 := ParseSendFragment(r.SendFragment)
	pickup, ok2 := ParsePickupFragment("#" + r.PickupFragment)
	if !ok1 || !ok2 {
		t.Fatal("fragmentos no válidos")
	}
	p := Payload{Text: "usuario: ana", File: &File{Name: "c.p12", Data: []byte{9, 9}}}
	s, err := SealForRequest(p, send)
	if err != nil {
		t.Fatal(err)
	}
	h, err := PreparePickup(pickup)
	if err != nil {
		t.Fatal(err)
	}
	if shaHex(t, h.Proof) != r.OpenVerifier || shaHex(t, s.Proof) != r.SendVerifier || h.Proof == s.Proof {
		t.Error("pruebas")
	}
	got, err := h.Open(s.Ciphertext, s.Ephemeral)
	if err != nil || got.Text != p.Text || !bytes.Equal(got.File.Data, []byte{9, 9}) {
		t.Fatalf("%+v %v", got, err)
	}
	// Otra clave efímera (de otro envío) no abre este cifrado; otra petición tampoco.
	s2, _ := SealForRequest(p, send)
	if s2.Ephemeral == s.Ephemeral {
		t.Error("efímera repetida")
	}
	if _, err := h.Open(s.Ciphertext, s2.Ephemeral); err == nil {
		t.Error("abrió con otra efímera")
	}
	r2, _ := CreateRequestKeys()
	pk2, _ := ParsePickupFragment(r2.PickupFragment)
	h2, _ := PreparePickup(pk2)
	if _, err := h2.Open(s.Ciphertext, s.Ephemeral); err == nil {
		t.Error("otra petición lo abrió")
	}
}

func TestRechazaClavesDeOrdenPequeno(t *testing.T) {
	for _, pub := range [][]byte{make([]byte, 32), append([]byte{1}, make([]byte, 31)...)} {
		if _, err := SealForRequest(Payload{Text: "x"}, SendKey{Pub: pub}); err == nil {
			t.Errorf("clave %x aceptada", pub[:2])
		}
	}
}

func TestFragmentosDePeticion(t *testing.T) {
	r, _ := CreateRequestKeys()
	if _, ok := ParseSendFragment(r.PickupFragment); ok {
		t.Error("recogida como envío")
	}
	if _, ok := ParsePickupFragment(r.SendFragment); ok {
		t.Error("envío como recogida")
	}
	// 48 bytes con otra cabecera DER: Web Crypto no la importaría.
	bogus := "v1." + ToBase64URL(bytes.Repeat([]byte{0x30}, 48))
	if _, ok := ParsePickupFragment(bogus); ok {
		t.Error("PKCS#8 con otra cabecera aceptado")
	}
}

func TestWipe(t *testing.T) {
	b := []byte{1, 2, 3}
	Wipe(b, nil)
	if !bytes.Equal(b, []byte{0, 0, 0}) {
		t.Error("no se puso a cero")
	}
}
