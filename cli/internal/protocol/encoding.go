package protocol

import (
	"encoding/base64"
	"encoding/hex"
	"errors"
)

var errBase64 = errors.New("base64url no válido")

// isB64URL comprueba el alfabeto base64url sin relleno (como `/^[A-Za-z0-9_-]*$/` en la web).
func isB64URL(s string) bool {
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

// IsB64URL es la versión exportada, para validar respuestas del servidor.
func IsB64URL(s string) bool { return len(s) > 0 && isB64URL(s) }

// ToBase64URL codifica sin relleno.
func ToBase64URL(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

// FromBase64URL decodifica base64url sin relleno. Como `atob` en la web, no exige que los bits sobrantes del
// último carácter sean cero (el modo no estricto de Go hace lo mismo).
func FromBase64URL(s string) ([]byte, error) {
	if !isB64URL(s) || len(s)%4 == 1 {
		return nil, errBase64
	}
	out, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, errBase64
	}
	return out, nil
}

// toHex codifica en hexadecimal en minúsculas (como `toHex` en la web).
func toHex(b []byte) string { return hex.EncodeToString(b) }

// Wipe pone a cero un búfer con material sensible. Go puede haber hecho copias (el recolector de basura las
// mueve), así que es una defensa en profundidad, no una garantía.
func Wipe(bufs ...[]byte) {
	for _, b := range bufs {
		clear(b)
	}
}
