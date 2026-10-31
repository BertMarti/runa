// Package api habla con el servidor de RUNA. Solo viajan cifrados, verificadores y pruebas: nunca la clave, la
// contraseña ni el texto en claro. Sin cookies, sin redirecciones y con respuestas de tamaño acotado.
package api

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"time"

	"github.com/BertMarti/runa/cli/internal/link"
	"github.com/BertMarti/runa/cli/internal/protocol"
)

const (
	// maxOKBody: la respuesta más grande es la de abrir (el cifrado de 4 MiB en base64url y poco más).
	maxOKBody = protocol.MaxCiphertextB64 + 4096
	// maxErrorBody: las respuestas de error son JSON diminutos.
	maxErrorBody = 4096
	userAgent    = "runa-cli"
)

var (
	ephemeralRE = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
	errRedirect = errors.New("el servidor respondió con una redirección")
)

// Code es el tipo de error de la API, como ApiErrorCode en la web.
type Code string

// Códigos de error (los mismos que la web).
const (
	InvalidRequest  Code = "invalid_request"
	TooLarge        Code = "too_large"
	RateLimited     Code = "rate_limited"
	StorageFull     Code = "storage_full"
	CreateForbidden Code = "create_forbidden"
	QuotaExceeded   Code = "quota_exceeded"
	TTLTooLong      Code = "ttl_too_long"
	AlreadyFilled   Code = "already_filled"
	Denied          Code = "denied"
	NotFound        Code = "not_found"
	Network         Code = "network"
	Server          Code = "server"
)

// Error es un error de la API. Su mensaje está en castellano y no contiene ids, pruebas ni enlaces.
type Error struct {
	Code   Code
	Status int
	// AttemptsLeft: solo en Denied al abrir (-1 si el servidor no lo dijo).
	AttemptsLeft int
	// RetryAfter: segundos, solo en RateLimited y QuotaExceeded.
	RetryAfter int
	// cause: detalle de red (sin la URL).
	cause error
}

func (e *Error) Error() string {
	switch e.Code {
	case NotFound:
		return "no existe: ya se abrió, caducó, se destruyó o el enlace no es correcto"
	case Denied:
		switch {
		case e.AttemptsLeft == 0:
			return "contraseña incorrecta: se ha destruido tras demasiados intentos"
		case e.AttemptsLeft > 0:
			return fmt.Sprintf("contraseña incorrecta (quedan %d intentos)", e.AttemptsLeft)
		}
		return "contraseña incorrecta"
	case CreateForbidden:
		return "este servidor no permite crear secretos ni peticiones desde tu red"
	case RateLimited:
		return fmt.Sprintf("demasiadas peticiones: espera %d s y vuelve a intentarlo", e.RetryAfter)
	case QuotaExceeded:
		return fmt.Sprintf("has superado la cuota de envío del servidor: espera %d s", e.RetryAfter)
	case StorageFull:
		return "el servidor no tiene espacio ahora mismo"
	case TTLTooLong:
		return "los secretos de más de 1 MiB caducan como mucho en 1 día (usa --ttl 1d o menos)"
	case AlreadyFilled:
		return "esta petición ya recibió un secreto"
	case TooLarge:
		return "el servidor lo rechaza por demasiado grande"
	case InvalidRequest:
		return fmt.Sprintf("el servidor rechazó la petición (HTTP %d)", e.Status)
	case Network:
		if e.cause != nil {
			return "no se pudo conectar con el servidor: " + e.cause.Error()
		}
		return "no se pudo conectar con el servidor"
	}
	return fmt.Sprintf("respuesta inesperada del servidor (HTTP %d)", e.Status)
}

func (e *Error) Unwrap() error { return e.cause }

// IsCode dice si err es un error de la API con ese código.
func IsCode(err error, code Code) bool {
	var e *Error
	return errors.As(err, &e) && e.Code == code
}

// NewHTTPClient crea el cliente HTTP: tiempos máximos, TLS 1.2 o superior y ninguna redirección (como
// `redirect: 'error'` en la web). Respeta HTTPS_PROXY; el TLS va de extremo a extremo igualmente.
func NewHTTPClient() *http.Client {
	transport := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           (&net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSClientConfig:       &tls.Config{MinVersion: tls.VersionTLS12},
		TLSHandshakeTimeout:   15 * time.Second,
		ResponseHeaderTimeout: 60 * time.Second,
		ExpectContinueTimeout: time.Second,
		IdleConnTimeout:       30 * time.Second,
		MaxIdleConns:          2,
		ForceAttemptHTTP2:     true,
		DisableCompression:    true,
	}
	return &http.Client{
		Transport:     transport,
		Timeout:       3 * time.Minute,
		CheckRedirect: func(*http.Request, []*http.Request) error { return errRedirect },
	}
}

// Client habla con un servidor concreto.
type Client struct {
	origin string
	http   *http.Client
}

// New crea un cliente para un origen ya validado (link.Server o link.Parse).
func New(origin string, hc *http.Client) *Client {
	if hc == nil {
		hc = NewHTTPClient()
	}
	return &Client{origin: origin, http: hc}
}

// networkError quita la URL de los errores de net/http (llevaría el id en la ruta).
func networkError(err error) error {
	if errors.Is(err, context.Canceled) {
		return err
	}
	var ue *url.Error
	if errors.As(err, &ue) {
		err = ue.Err
	}
	if errors.Is(err, errRedirect) {
		return &Error{Code: Server, Status: 0, cause: err}
	}
	return &Error{Code: Network, cause: err}
}

func (c *Client) do(ctx context.Context, method, path string, body any) (map[string]json.RawMessage, int, error) {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, 0, err
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.origin+path, reader)
	if err != nil {
		return nil, 0, &Error{Code: Network}
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Cache-Control", "no-store")
	res, err := c.http.Do(req)
	if err != nil {
		return nil, 0, networkError(err)
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 && res.StatusCode < 400 {
		return nil, res.StatusCode, &Error{Code: Server, Status: res.StatusCode, cause: errRedirect}
	}
	limit := int64(maxErrorBody)
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		limit = maxOKBody
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if err != nil {
		return nil, res.StatusCode, networkError(err)
	}
	if int64(len(raw)) > limit {
		return nil, res.StatusCode, &Error{Code: Server, Status: res.StatusCode}
	}
	var obj map[string]json.RawMessage
	if len(bytes.TrimSpace(raw)) > 0 && json.Unmarshal(raw, &obj) != nil {
		obj = nil
	}
	if obj == nil {
		obj = map[string]json.RawMessage{}
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, res.StatusCode, toError(res, obj)
	}
	return obj, res.StatusCode, nil
}

func str(obj map[string]json.RawMessage, key string) (string, bool) {
	var s string
	raw, ok := obj[key]
	if !ok || len(raw) == 0 || raw[0] != '"' || json.Unmarshal(raw, &s) != nil {
		return "", false
	}
	return s, true
}

// nonNegativeInt: entero seguro y no negativo, o -1.
func nonNegativeInt(obj map[string]json.RawMessage, key string) int {
	var f float64
	raw, ok := obj[key]
	if !ok || json.Unmarshal(raw, &f) != nil || f < 0 || f > 1<<53-1 || f != float64(int64(f)) {
		return -1
	}
	return int(f)
}

// toError traduce una respuesta de error, fiándose del código HTTP antes que del cuerpo (como toApiError).
func toError(res *http.Response, body map[string]json.RawMessage) *Error {
	code, _ := str(body, "error")
	e := &Error{Status: res.StatusCode, AttemptsLeft: -1}
	switch res.StatusCode {
	case 400:
		e.Code = InvalidRequest
		if code == string(TTLTooLong) {
			e.Code = TTLTooLong
		}
	case 403:
		e.Code = Denied
		if code == string(CreateForbidden) {
			e.Code = CreateForbidden
		} else {
			e.AttemptsLeft = nonNegativeInt(body, "attemptsLeft")
		}
	case 404:
		e.Code = NotFound
	case 409:
		e.Code = AlreadyFilled
	case 413:
		e.Code = TooLarge
	case 429:
		e.Code = RateLimited
		if code == string(QuotaExceeded) {
			e.Code = QuotaExceeded
		}
		e.RetryAfter = nonNegativeInt(body, "retryAfterSeconds")
		if e.RetryAfter < 0 {
			if h, err := strconv.Atoi(res.Header.Get("Retry-After")); err == nil && h >= 0 {
				e.RetryAfter = h
			} else {
				e.RetryAfter = 60
			}
		}
	case 507:
		e.Code = StorageFull
	default:
		e.Code = InvalidRequest
		if res.StatusCode >= 500 {
			e.Code = Server
		}
	}
	return e
}

func expiry(obj map[string]json.RawMessage, status int) (time.Time, error) {
	s, ok := str(obj, "expiresAt")
	if !ok {
		return time.Time{}, &Error{Code: Server, Status: status}
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return time.Time{}, &Error{Code: Server, Status: status}
	}
	return t, nil
}

func validCiphertext(s string) bool {
	return len(s) <= protocol.MaxCiphertextB64 && protocol.IsB64URL(s)
}

// Config es lo que la CLI necesita del despliegue.
type Config struct {
	// PublicURL: origen de los enlaces que se comparten; "" = el del servidor.
	PublicURL     string
	CreateAllowed bool
}

// GetConfig lee /api/config. Si falla, la de siempre: el servidor vuelve a comprobarlo todo al crear.
func (c *Client) GetConfig(ctx context.Context) Config {
	obj, _, err := c.do(ctx, http.MethodGet, "/api/config", nil)
	if err != nil {
		return Config{CreateAllowed: true}
	}
	cfg := Config{CreateAllowed: string(obj["createAllowed"]) != "false"}
	if s, ok := str(obj, "publicUrl"); ok {
		cfg.PublicURL = link.SafeOrigin(s)
	}
	return cfg
}

// Created es la respuesta al crear un secreto o una petición.
type Created struct {
	ID        string
	ExpiresAt time.Time
}

func created(obj map[string]json.RawMessage, status int) (*Created, error) {
	id, ok := str(obj, "id")
	if !ok || !link.IDPattern.MatchString(id) {
		return nil, &Error{Code: Server, Status: status}
	}
	t, err := expiry(obj, status)
	if err != nil {
		return nil, err
	}
	return &Created{ID: id, ExpiresAt: t}, nil
}

// CreateSecret sube un secreto cifrado.
func (c *Client) CreateSecret(ctx context.Context, s *protocol.Sealed, ttl, views int) (*Created, error) {
	obj, status, err := c.do(ctx, http.MethodPost, "/api/secrets", map[string]any{
		"ciphertext":   s.Ciphertext,
		"verifier":     s.Verifier,
		"linkVerifier": s.LinkVerifier,
		"ttl":          ttl,
		"views":        views,
	})
	if err != nil {
		return nil, err
	}
	return created(obj, status)
}

func checkID(id string) error {
	// El id sale del enlace: se valida antes de componer la ruta.
	if !link.IDPattern.MatchString(id) {
		return &Error{Code: NotFound, Status: 404}
	}
	return nil
}

// Opened es lo que entrega el servidor al abrir un secreto.
type Opened struct {
	Ciphertext string
	ViewsLeft  int
}

// OpenSecret pide el cifrado (descuenta una lectura; a 0, el servidor lo borra).
func (c *Client) OpenSecret(ctx context.Context, id string, p protocol.Proof) (*Opened, error) {
	if err := checkID(id); err != nil {
		return nil, err
	}
	obj, status, err := c.do(ctx, http.MethodPost, "/api/secrets/"+id+"/open", map[string]string{"link": p.Link, "token": p.Token})
	if err != nil {
		return nil, err
	}
	ct, ok := str(obj, "ciphertext")
	views := nonNegativeInt(obj, "viewsLeft")
	if !ok || !validCiphertext(ct) || views < 0 {
		return nil, &Error{Code: Server, Status: status}
	}
	return &Opened{Ciphertext: ct, ViewsLeft: views}, nil
}

// BurnSecret destruye un secreto sin leerlo.
func (c *Client) BurnSecret(ctx context.Context, id string, p protocol.Proof) error {
	if err := checkID(id); err != nil {
		return err
	}
	_, _, err := c.do(ctx, http.MethodPost, "/api/secrets/"+id+"/burn", map[string]string{"link": p.Link, "token": p.Token})
	return err
}

// CreateRequest crea una petición de secreto.
func (c *Client) CreateRequest(ctx context.Context, r *protocol.NewRequest, ttl int) (*Created, error) {
	obj, status, err := c.do(ctx, http.MethodPost, "/api/requests", map[string]any{
		"sendVerifier": r.SendVerifier,
		"openVerifier": r.OpenVerifier,
		"ttl":          ttl,
	})
	if err != nil {
		return nil, err
	}
	return created(obj, status)
}

// FillRequest envía el secreto cifrado a una petición (una sola vez).
func (c *Client) FillRequest(ctx context.Context, id string, s *protocol.SealedForRequest) (time.Time, error) {
	if err := checkID(id); err != nil {
		return time.Time{}, err
	}
	obj, status, err := c.do(ctx, http.MethodPost, "/api/requests/"+id+"/fill", map[string]string{
		"proof":      s.Proof,
		"ciphertext": s.Ciphertext,
		"ephemeral":  s.Ephemeral,
	})
	if err != nil {
		return time.Time{}, err
	}
	return expiry(obj, status)
}

// Pickup es la respuesta al recoger: o todavía nada (Waiting) o el cifrado.
type Pickup struct {
	Waiting    bool
	ExpiresAt  time.Time
	Ciphertext string
	Ephemeral  string
}

// OpenRequest recoge lo enviado (y el servidor lo borra) o dice que aún no hay nada.
func (c *Client) OpenRequest(ctx context.Context, id, proof string) (*Pickup, error) {
	if err := checkID(id); err != nil {
		return nil, err
	}
	obj, status, err := c.do(ctx, http.MethodPost, "/api/requests/"+id+"/open", map[string]string{"proof": proof})
	if err != nil {
		return nil, err
	}
	st, _ := str(obj, "status")
	switch st {
	case "waiting":
		t, err := expiry(obj, status)
		if err != nil {
			return nil, err
		}
		return &Pickup{Waiting: true, ExpiresAt: t}, nil
	case "ready":
		ct, ok1 := str(obj, "ciphertext")
		eph, ok2 := str(obj, "ephemeral")
		if ok1 && ok2 && validCiphertext(ct) && ephemeralRE.MatchString(eph) {
			return &Pickup{Ciphertext: ct, Ephemeral: eph}, nil
		}
	}
	return nil, &Error{Code: Server, Status: status}
}

// CancelRequest borra la petición (y lo enviado, si lo hay).
func (c *Client) CancelRequest(ctx context.Context, id, proof string) error {
	if err := checkID(id); err != nil {
		return err
	}
	_, _, err := c.do(ctx, http.MethodPost, "/api/requests/"+id+"/cancel", map[string]string{"proof": proof})
	return err
}
