package protocol

import (
	"errors"
	"unicode"
	"unicode/utf8"
)

//go:generate sh -c "node gen/nfc.mjs > nfc_tabla.go"

// ErrPasswordNotNFC: la contraseña tiene caracteres que la normalización NFC podría cambiar.
//
// La web deriva la clave de `contraseña.normalize('NFC')`. La biblioteca estándar de Go no implementa NFC (está en
// golang.org/x/text, una dependencia que el CLI no admite), así que en lugar de arriesgarse a derivar una clave
// distinta, el CLI acepta solo contraseñas que ya están en NFC «por construcción»: ninguno de sus caracteres
// cambia ni se combina con el anterior al normalizar (tabla generada desde Node, ver gen/nfc.mjs). Eso incluye
// todo el ASCII y las letras precompuestas que produce cualquier teclado (ñ, á, ç, ü, ß, €…); quedan fuera las
// marcas combinantes sueltas, los jamos hangul y caracteres de compatibilidad, que la web sí acepta.
var ErrPasswordNotNFC = errors.New("la contraseña contiene caracteres combinantes o de compatibilidad Unicode que este cliente no sabe normalizar (NFC); usa la web o elige otra contraseña")

// ErrPasswordUTF8: la contraseña no es UTF-8 válido (p. ej., un terminal en Latin-1).
var ErrPasswordUTF8 = errors.New("la contraseña no es UTF-8 válido; revisa la codificación del terminal")

// checkNFC devuelve nil si NFC(pw) = pw con seguridad.
//
// Si ningún carácter es «inestable» (ver gen/nfc.mjs), cada uno es su propia forma NFC, su descomposición
// empieza por un carácter base (la reordenación canónica no cruza de un carácter a otro) y ninguno puede
// componerse con el anterior; por tanto la cadena entera ya está en NFC.
func checkNFC(pw []byte) error {
	if !utf8.Valid(pw) {
		return ErrPasswordUTF8
	}
	for i := 0; i < len(pw); {
		if pw[i] < utf8.RuneSelf {
			i++
			continue
		}
		r, size := utf8.DecodeRune(pw[i:])
		if unicode.Is(nfcUnstable, r) || unicode.Is(unicode.M, r) {
			return ErrPasswordNotNFC
		}
		i += size
	}
	return nil
}

// CheckPassword comprueba de antemano que la contraseña se puede usar (UTF-8 válido y ya en NFC).
func CheckPassword(pw []byte) error { return checkNFC(pw) }
