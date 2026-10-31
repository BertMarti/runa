package app

// Servidor de RUNA falso, en memoria, con la misma semántica que apps/server (pruebas de enlace y de
// contraseña, vistas, 5 intentos, peticiones de un solo uso). Permite probar las órdenes sin Node; las mismas
// pruebas se repiten contra el servidor real con RUNA_E2E_URL (ver e2e_test.go).

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/BertMarti/runa/cli/internal/protocol"
)

type fakeSecret struct {
	ct                     []byte
	verifier, linkVerifier []byte
	views, fails           int
}

type fakeRequest struct {
	sendVer, openVer []byte
	ct, eph          []byte
	filled           bool
}

type fakeServer struct {
	mu       sync.Mutex
	secrets  map[string]*fakeSecret
	requests map[string]*fakeRequest
	n        int
	// bodies guarda todo lo que llega, para comprobar que nunca viaja la clave ni el texto.
	bodies []string
}

func newFakeServer(t *testing.T) (*fakeServer, string) {
	f := &fakeServer{secrets: map[string]*fakeSecret{}, requests: map[string]*fakeRequest{}}
	ts := httptest.NewServer(f)
	t.Cleanup(ts.Close)
	return f, ts.URL
}

func sum(hexStr string) []byte {
	b, _ := hex.DecodeString(hexStr)
	s := sha256.Sum256(b)
	return s[:]
}

func eq(a, b []byte) bool { return subtle.ConstantTimeCompare(a, b) == 1 }

func reply(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if body != nil {
		_ = json.NewEncoder(w).Encode(body)
	}
}

func (f *fakeServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var body map[string]any
	if r.Method == http.MethodPost {
		var raw strings.Builder
		_ = json.NewDecoder(teeReader(r, &raw)).Decode(&body)
		f.bodies = append(f.bodies, raw.String())
	}
	s := func(k string) string { v, _ := body[k].(string); return v }
	expires := time.Now().Add(time.Hour).UTC().Format("2006-01-02T15:04:05.000Z")
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/api/config":
		reply(w, 200, map[string]any{"publicUrl": nil, "createAllowed": true})
	case r.Method == http.MethodPost && r.URL.Path == "/api/secrets":
		ct, err := protocol.FromBase64URL(s("ciphertext"))
		ttl, _ := body["ttl"].(float64)
		views, _ := body["views"].(float64)
		if err != nil || !protocol.ValidCiphertextSize(len(ct)) || views < 1 || views > 10 {
			reply(w, 400, map[string]string{"error": "invalid_request"})
			return
		}
		if len(ct)-protocol.GCMOverhead > protocol.LargeSecretBytes && ttl > protocol.LargeSecretMaxTTL {
			reply(w, 400, map[string]any{"error": "ttl_too_long", "maxTtl": protocol.LargeSecretMaxTTL})
			return
		}
		f.n++
		id := strings.Repeat("s", 20) + string(rune('A'+f.n/26)) + string(rune('a'+f.n%26))
		v, _ := hex.DecodeString(s("verifier"))
		lv, _ := hex.DecodeString(s("linkVerifier"))
		f.secrets[id] = &fakeSecret{ct: ct, verifier: v, linkVerifier: lv, views: int(views)}
		reply(w, 201, map[string]string{"id": id, "expiresAt": expires})
	case r.Method == http.MethodPost && len(parts) == 4 && parts[1] == "secrets":
		sec := f.secrets[parts[2]]
		if sec == nil || !eq(sum(s("link")), sec.linkVerifier) {
			reply(w, 404, map[string]string{"error": "not_found"})
			return
		}
		if !eq(sum(s("token")), sec.verifier) {
			sec.fails++
			if sec.fails >= protocol.MaxFailedAttempts {
				delete(f.secrets, parts[2])
			}
			reply(w, 403, map[string]any{"error": "denied", "attemptsLeft": protocol.MaxFailedAttempts - sec.fails})
			return
		}
		if parts[3] == "burn" {
			delete(f.secrets, parts[2])
			reply(w, 204, nil)
			return
		}
		sec.views--
		sec.fails = 0
		if sec.views == 0 {
			delete(f.secrets, parts[2])
		}
		reply(w, 200, map[string]any{"ciphertext": protocol.ToBase64URL(sec.ct), "viewsLeft": sec.views})
	case r.Method == http.MethodPost && r.URL.Path == "/api/requests":
		f.n++
		id := strings.Repeat("r", 20) + string(rune('A'+f.n/26)) + string(rune('a'+f.n%26))
		sv, _ := hex.DecodeString(s("sendVerifier"))
		ov, _ := hex.DecodeString(s("openVerifier"))
		f.requests[id] = &fakeRequest{sendVer: sv, openVer: ov}
		reply(w, 201, map[string]string{"id": id, "expiresAt": expires})
	case r.Method == http.MethodPost && len(parts) == 4 && parts[1] == "requests":
		req := f.requests[parts[2]]
		switch parts[3] {
		case "fill":
			if req == nil || !eq(sum(s("proof")), req.sendVer) {
				reply(w, 404, map[string]string{"error": "not_found"})
				return
			}
			if req.filled {
				reply(w, 409, map[string]string{"error": "already_filled"})
				return
			}
			ct, err := protocol.FromBase64URL(s("ciphertext"))
			eph, _ := protocol.FromBase64URL(s("ephemeral"))
			if err != nil || !protocol.ValidCiphertextSize(len(ct)) {
				reply(w, 400, map[string]string{"error": "invalid_request"})
				return
			}
			req.ct, req.eph, req.filled = ct, eph, true
			reply(w, 201, map[string]string{"expiresAt": expires})
		case "open", "cancel":
			if req == nil || !eq(sum(s("proof")), req.openVer) {
				reply(w, 404, map[string]string{"error": "not_found"})
				return
			}
			if parts[3] == "cancel" {
				delete(f.requests, parts[2])
				reply(w, 204, nil)
				return
			}
			if !req.filled {
				reply(w, 200, map[string]string{"status": "waiting", "expiresAt": expires})
				return
			}
			delete(f.requests, parts[2])
			reply(w, 200, map[string]string{"status": "ready", "ciphertext": protocol.ToBase64URL(req.ct), "ephemeral": protocol.ToBase64URL(req.eph)})
		default:
			reply(w, 404, map[string]string{"error": "not_found"})
		}
	default:
		reply(w, 404, map[string]string{"error": "not_found"})
	}
}

func teeReader(r *http.Request, w io.Writer) io.Reader { return io.TeeReader(r.Body, w) }

// seen devuelve los cuerpos recibidos.
func (f *fakeServer) seen() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.bodies...)
}
