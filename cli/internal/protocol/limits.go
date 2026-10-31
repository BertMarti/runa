// Package protocol implementa el protocolo RUNA v1 (ver docs/PROTOCOLO.md) con la biblioteca estándar de Go.
//
// Es una traducción fiel de apps/web/src/crypto/*.ts: mismas derivaciones, mismo envoltorio con relleno, mismo
// formato de enlace. La compatibilidad en los dos sentidos se comprueba con los vectores de cli/testdata/.
package protocol

// Límites del protocolo. Deben coincidir con apps/server/src/limits.ts y apps/web/src/crypto/limits.ts
// (lo comprueba compat_test.go con los vectores que genera la web).

// PadBuckets son los bloques de relleno: el tamaño cifrado solo revela en cuál cae el secreto.
var PadBuckets = []int{1 << 10, 4 << 10, 16 << 10, 64 << 10, 256 << 10, 1 << 20, 4 << 20}

const (
	// MaxPaddedBytes es el envoltorio rellenado más grande (el último bloque).
	MaxPaddedBytes = 4 << 20
	// MaxTextChars es el texto máximo, en unidades UTF-16 (lo que mide `string.length` en la web).
	MaxTextChars = 100_000
	// MaxFileBytes es el adjunto máximo.
	MaxFileBytes = 3 << 20
	// MaxFileName es la longitud máxima del nombre del adjunto, en unidades UTF-16.
	MaxFileName = 200
	// PBKDF2Iterations: PBKDF2-SHA256, recomendación OWASP 2023.
	PBKDF2Iterations = 600_000
	// GCMOverhead: IV (12) + etiqueta de autenticación (16).
	GCMOverhead = 12 + 16
	// MaxCiphertextBytes es el cifrado más grande que acepta el servidor.
	MaxCiphertextBytes = MaxPaddedBytes + GCMOverhead
	// MaxCiphertextB64 es su longitud en base64url sin relleno.
	MaxCiphertextB64 = (MaxCiphertextBytes*4 + 2) / 3
	// LargeSecretBytes: por encima (envoltorio rellenado), el secreto caduca como mucho en LargeSecretMaxTTL.
	LargeSecretBytes  = 1 << 20
	LargeSecretMaxTTL = 86_400
	// MinViews y MaxViews acotan las lecturas permitidas.
	MinViews = 1
	MaxViews = 10
	// MaxFailedAttempts: contraseñas incorrectas antes de que el servidor destruya el secreto.
	MaxFailedAttempts = 5
)

// TTLOptions son las caducidades permitidas, en segundos: 5 min, 1 h, 1 día, 7 días.
var TTLOptions = []int{300, 3600, 86_400, 604_800}

// ValidCiphertextSize dice si n bytes son un cifrado de tamaño conforme (bloque exacto + IV + etiqueta).
func ValidCiphertextSize(n int) bool {
	for _, b := range PadBuckets {
		if n == b+GCMOverhead {
			return true
		}
	}
	return false
}
