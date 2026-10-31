// Package link lee y valida los enlaces de RUNA y las direcciones de servidor.
//
// Ningún error de este paquete incluye el enlace ni su fragmento: los mensajes se escriben en la terminal, y
// el fragmento es la clave.
package link

import (
	"errors"
	"net/url"
	"regexp"
	"strings"
)

// Kind es el tipo de enlace, según su ruta.
type Kind byte

const (
	// Secret: /s/<id>, para abrir (o destruir) un secreto.
	Secret Kind = 's'
	// Send: /r/<id>, para enviar un secreto a quien lo pidió.
	Send Kind = 'r'
	// Pickup: /p/<id>, para recoger lo enviado (solo quien pidió).
	Pickup Kind = 'p'
)

// Name es el nombre del tipo, para los mensajes.
func (k Kind) Name() string {
	switch k {
	case Secret:
		return "enlace de secreto"
	case Send:
		return "enlace de envío"
	case Pickup:
		return "enlace de recogida"
	}
	return "enlace"
}

// Link es un enlace ya validado.
type Link struct {
	Kind Kind
	// Origin: esquema y anfitrión (con puerto), sin barra final. Es el servidor al que se habla.
	Origin string
	// ID: identificador del servidor (22 caracteres base64url).
	ID string
	// Fragment: lo que va tras `#`, sin decodificar (como `location.hash`). Es la clave: no se muestra nunca.
	Fragment string
}

// IDPattern: 16 bytes en base64url (apps/server/src/limits.ts).
var IDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{22}$`)

var routeRE = regexp.MustCompile(`^/([spr])/([^/]+)/?$`)

var (
	// ErrNotLink: no parece un enlace de RUNA.
	ErrNotLink = errors.New("no es un enlace de RUNA válido (se espera https://servidor/s/…#v1.…)")
	// ErrNoFragment: falta la parte tras `#` (el enlace se ha cortado o lo ha recortado alguna aplicación).
	ErrNoFragment = errors.New("al enlace le falta la clave (la parte tras #): ¿se ha cortado al copiarlo?")
	// ErrInsecure: http fuera de localhost.
	ErrInsecure = errors.New("solo se admite https (http únicamente para localhost, 127.0.0.1 y [::1])")
	// ErrUserinfo: usuario o contraseña en la URL.
	ErrUserinfo = errors.New("la dirección no puede llevar usuario ni contraseña")
)

// isLocal: los mismos anfitriones que la web considera locales (safeOrigin en api.ts).
func isLocal(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

// checkOrigin valida esquema, anfitrión y credenciales, y devuelve el origen normalizado.
func checkOrigin(u *url.URL) (string, error) {
	if u.User != nil {
		return "", ErrUserinfo
	}
	if u.Host == "" || u.Hostname() == "" || u.Opaque != "" {
		return "", ErrNotLink
	}
	scheme := strings.ToLower(u.Scheme)
	switch {
	case scheme == "https":
	case scheme == "http" && isLocal(strings.ToLower(u.Hostname())):
	case scheme == "http":
		return "", ErrInsecure
	default:
		return "", ErrNotLink
	}
	return scheme + "://" + strings.ToLower(u.Host), nil
}

// Parse lee un enlace de RUNA. Espacios alrededor y `<…>` (como lo envuelven algunos correos) se ignoran.
func Parse(raw string) (*Link, error) {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimSuffix(strings.TrimPrefix(raw, "<"), ">")
	base, fragment, found := strings.Cut(raw, "#")
	if !found || fragment == "" {
		// Ojo: sin `#` el texto entero no es secreto, pero tampoco se repite en el error.
		if _, err := url.Parse(base); err == nil && routeRE.MatchString(pathOf(base)) {
			return nil, ErrNoFragment
		}
		return nil, ErrNotLink
	}
	u, err := url.Parse(base)
	if err != nil {
		return nil, ErrNotLink
	}
	origin, err := checkOrigin(u)
	if err != nil {
		return nil, err
	}
	// Como la web (matchRoute): la ruta sin decodificar; la consulta `?…` se ignora.
	m := routeRE.FindStringSubmatch(u.EscapedPath())
	if m == nil || !IDPattern.MatchString(m[2]) {
		return nil, ErrNotLink
	}
	return &Link{Kind: Kind(m[1][0]), Origin: origin, ID: m[2], Fragment: fragment}, nil
}

func pathOf(s string) string {
	u, err := url.Parse(s)
	if err != nil {
		return ""
	}
	return u.EscapedPath()
}

// Server valida la dirección de un servidor (para --server o RUNA_SERVER) y devuelve su origen.
func Server(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("falta el servidor: usa --server https://runa.example o la variable RUNA_SERVER")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", errors.New("la dirección del servidor no es válida")
	}
	origin, err := checkOrigin(u)
	if err != nil {
		if errors.Is(err, ErrNotLink) {
			return "", errors.New("la dirección del servidor no es válida (se espera https://servidor)")
		}
		return "", err
	}
	if (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("la dirección del servidor no admite ruta, consulta ni fragmento (solo https://servidor[:puerto])")
	}
	return origin, nil
}

// SafeOrigin es `safeOrigin` de la web: un origen https (o http en localhost); cualquier otra cosa, "".
func SafeOrigin(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	origin, err := checkOrigin(u)
	if err != nil {
		return ""
	}
	return origin
}

// Format compone un enlace.
func Format(origin string, kind Kind, id, fragment string) string {
	return origin + "/" + string(kind) + "/" + id + "#" + fragment
}
