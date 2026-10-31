package link

import (
	"errors"
	"strings"
	"testing"
)

const id = "AbCdEfGhIjKlMnOpQrStUv"
const frag = "v1.SECRETOsecretoSECRETOsecretoSECRETOsecret"

func TestParse(t *testing.T) {
	cases := map[string]Link{
		"https://runa.example/s/" + id + "#" + frag:                {Secret, "https://runa.example", id, frag},
		"  <https://RUNA.example:8443/r/" + id + "/#" + frag + ">": {Send, "https://runa.example:8443", id, frag},
		"https://runa.example/p/" + id + "?utm=x#" + frag:          {Pickup, "https://runa.example", id, frag},
		"http://localhost:8080/s/" + id + "#" + frag:               {Secret, "http://localhost:8080", id, frag},
		"http://127.0.0.1/s/" + id + "#" + frag:                    {Secret, "http://127.0.0.1", id, frag},
		"http://[::1]:8499/s/" + id + "#" + frag:                   {Secret, "http://[::1]:8499", id, frag},
	}
	for raw, want := range cases {
		got, err := Parse(raw)
		if err != nil {
			t.Errorf("%q: %v", raw, err)
			continue
		}
		if *got != want {
			t.Errorf("%q → %+v", raw, *got)
		}
	}
}

func TestParseRechaza(t *testing.T) {
	cases := map[string]error{
		"http://runa.example/s/" + id + "#" + frag:         ErrInsecure,
		"http://192.168.1.10/s/" + id + "#" + frag:         ErrInsecure,
		"http://localhost.evil.com/s/" + id + "#" + frag:   ErrInsecure,
		"https://ana:pw@runa.example/s/" + id + "#" + frag: ErrUserinfo,
		"https://runa.example/s/" + id:                     ErrNoFragment,
		"https://runa.example/s/" + id + "#":               ErrNoFragment,
		"https://runa.example/x/" + id + "#" + frag:        ErrNotLink,
		"https://runa.example/s/corto#" + frag:             ErrNotLink,
		"https://runa.example/base/s/" + id + "#" + frag:   ErrNotLink,
		"ftp://runa.example/s/" + id + "#" + frag:          ErrNotLink,
		"/s/" + id + "#" + frag:                            ErrNotLink,
		"javascript:alert(1)#" + frag:                      ErrNotLink,
		"https://runa.example/s/%41" + id[1:] + "#" + frag: ErrNotLink,
	}
	for raw, want := range cases {
		_, err := Parse(raw)
		if !errors.Is(err, want) {
			t.Errorf("%q: %v, se esperaba %v", raw, err, want)
		}
		// Ningún error repite el enlace ni la clave.
		if err != nil && (strings.Contains(err.Error(), "SECRETO") || strings.Contains(err.Error(), id)) {
			t.Errorf("el error filtra el enlace: %v", err)
		}
	}
}

func TestServer(t *testing.T) {
	for raw, want := range map[string]string{
		"https://runa.example":        "https://runa.example",
		"https://runa.example/":       "https://runa.example",
		" HTTPS://Runa.Example:8443 ": "https://runa.example:8443",
		"http://localhost:8080":       "http://localhost:8080",
	} {
		got, err := Server(raw)
		if err != nil || got != want {
			t.Errorf("%q → %q %v", raw, got, err)
		}
	}
	for _, raw := range []string{"", "runa.example", "http://runa.example", "https://runa.example/api", "https://runa.example/?x", "https://u@runa.example", "https://runa.example/#x"} {
		if _, err := Server(raw); err == nil {
			t.Errorf("%q aceptado", raw)
		}
	}
}

func TestSafeOrigin(t *testing.T) {
	for raw, want := range map[string]string{
		"https://runa.example/ruta": "https://runa.example",
		"http://evil.example":       "",
		"http://localhost:9":        "http://localhost:9",
		"javascript:alert(1)":       "",
		"":                          "",
	} {
		if got := SafeOrigin(raw); got != want {
			t.Errorf("%q → %q", raw, got)
		}
	}
}
