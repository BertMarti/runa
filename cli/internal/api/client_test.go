package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/BertMarti/runa/cli/internal/protocol"
)

const id = "AbCdEfGhIjKlMnOpQrStUv"

var proof = protocol.Proof{Link: strings.Repeat("a", 64), Token: strings.Repeat("b", 64)}

func server(t *testing.T, h http.HandlerFunc) *Client {
	t.Helper()
	ts := httptest.NewServer(h)
	t.Cleanup(ts.Close)
	return New(ts.URL, nil)
}

func TestNoSigueRedirecciones(t *testing.T) {
	var hits int
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++ }))
	defer target.Close()
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+r.URL.Path, http.StatusTemporaryRedirect)
	})
	_, err := c.OpenSecret(context.Background(), id, proof)
	if err == nil || hits != 0 {
		t.Fatalf("siguió la redirección: %v, %d", err, hits)
	}
	if strings.Contains(err.Error(), id) || strings.Contains(err.Error(), "http") {
		t.Errorf("el error filtra la URL: %v", err)
	}
}

func TestLimitaElTamanoDeLaRespuesta(t *testing.T) {
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
		_, _ = w.Write([]byte(strings.Repeat(" ", maxErrorBody+10)))
	})
	if _, err := c.OpenSecret(context.Background(), id, proof); !IsCode(err, Server) {
		t.Errorf("respuesta de error enorme: %v", err)
	}
	c = server(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ciphertext":"` + strings.Repeat("A", maxOKBody) + `","viewsLeft":0}`))
	})
	if _, err := c.OpenSecret(context.Background(), id, proof); !IsCode(err, Server) {
		t.Errorf("respuesta enorme: %v", err)
	}
}

func TestErroresComoLaWeb(t *testing.T) {
	cases := []struct {
		status int
		body   string
		code   Code
		check  func(*Error) bool
	}{
		{404, `{"error":"not_found"}`, NotFound, nil},
		{403, `{"error":"denied","attemptsLeft":3}`, Denied, func(e *Error) bool { return e.AttemptsLeft == 3 }},
		{403, `{"error":"denied","attemptsLeft":-2}`, Denied, func(e *Error) bool { return e.AttemptsLeft == -1 }},
		{403, `{"error":"create_forbidden"}`, CreateForbidden, nil},
		{400, `{"error":"ttl_too_long"}`, TTLTooLong, nil},
		{400, `basura`, InvalidRequest, nil},
		{409, ``, AlreadyFilled, nil},
		{429, `{"error":"quota_exceeded","retryAfterSeconds":12}`, QuotaExceeded, func(e *Error) bool { return e.RetryAfter == 12 }},
		{429, `{}`, RateLimited, func(e *Error) bool { return e.RetryAfter == 60 }},
		{507, `{}`, StorageFull, nil},
		{502, `<html>`, Server, nil},
	}
	for _, tc := range cases {
		c := server(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(tc.status)
			_, _ = w.Write([]byte(tc.body))
		})
		_, err := c.OpenSecret(context.Background(), id, proof)
		e, ok := err.(*Error)
		if !ok || e.Code != tc.code || (tc.check != nil && !tc.check(e)) {
			t.Errorf("%d %s → %#v", tc.status, tc.body, err)
		}
	}
}

func TestValidaLasRespuestas(t *testing.T) {
	for _, body := range []string{
		`{"ciphertext":"no*b64","viewsLeft":0}`,
		`{"ciphertext":"AAAA","viewsLeft":-1}`,
		`{"ciphertext":"AAAA"}`,
		`{"ciphertext":5,"viewsLeft":0}`,
		`[]`,
	} {
		c := server(t, func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(body)) })
		if _, err := c.OpenSecret(context.Background(), id, proof); !IsCode(err, Server) {
			t.Errorf("%s aceptado: %v", body, err)
		}
	}
	for _, body := range []string{`{"id":"../../etc","expiresAt":"2026-01-01T00:00:00.000Z"}`, `{"id":"` + id + `","expiresAt":"mañana"}`} {
		c := server(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(201); _, _ = w.Write([]byte(body)) })
		if _, err := c.CreateRequest(context.Background(), &protocol.NewRequest{}, 3600); !IsCode(err, Server) {
			t.Errorf("%s aceptado: %v", body, err)
		}
	}
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"status":"ready","ciphertext":"AAAA","ephemeral":"corta"}`))
	})
	if _, err := c.OpenRequest(context.Background(), id, proof.Link); !IsCode(err, Server) {
		t.Errorf("efímera inválida aceptada: %v", err)
	}
}

func TestNoComponeRutasConIdsInvalidos(t *testing.T) {
	called := false
	c := server(t, func(w http.ResponseWriter, r *http.Request) { called = true })
	if _, err := c.OpenSecret(context.Background(), "../config", proof); !IsCode(err, NotFound) || called {
		t.Errorf("id inválido: %v %v", err, called)
	}
}

func TestPeticionesSinCookiesYConJSON(t *testing.T) {
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/json" || r.Header.Get("Cookie") != "" {
			w.WriteHeader(400)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "rastreo", Value: "1"})
		w.WriteHeader(204)
	})
	for i := 0; i < 2; i++ {
		if err := c.BurnSecret(context.Background(), id, proof); err != nil {
			t.Fatal(err)
		}
	}
}

func TestConfigSoloAceptaOrigenesSeguros(t *testing.T) {
	for body, want := range map[string]string{
		`{"publicUrl":"https://runa.example","createAllowed":true}`: "https://runa.example",
		`{"publicUrl":"http://evil.example","createAllowed":true}`:  "",
		`{"publicUrl":null}`: "",
	} {
		c := server(t, func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(body)) })
		if got := c.GetConfig(context.Background()).PublicURL; got != want {
			t.Errorf("%s → %q", body, got)
		}
	}
}
