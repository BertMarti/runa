package protocol

// Protocolo RUNA v1 (ver docs/PROTOCOLO.md y apps/web/src/crypto/protocol.ts).
//
//	K      = 32 bytes aleatorios — viajan solo en el fragmento `#` del enlace
//	salt   = HKDF(K, info="runa/v1/salt")[0..16]
//	P      = PBKDF2-SHA256(NFC(contraseña), salt, 600 000)   (solo si hay contraseña)
//	ikm    = K ‖ P   (o K)
//	kEnc   = HKDF(ikm, salt, "runa/v1/enc")   → AES-256-GCM
//	token  = HKDF(ikm, salt, "runa/v1/auth")  → demuestra la contraseña (si la hay)
//	link   = HKDF(K,   salt, "runa/v1/link")  → demuestra tener el enlace completo
//	verificadores = SHA-256(token), SHA-256(link) → lo único que guarda el servidor

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"regexp"
)

// Version es el prefijo del fragmento y de las etiquetas `info`.
const Version = "v1"

const (
	keyBytes  = 32
	saltBytes = 16
	ivBytes   = 12
)

var fragmentRE = regexp.MustCompile(`^v1\.([A-Za-z0-9_-]{43})(\.p)?$`)

var (
	// ErrPasswordRequired: el enlace lleva `.p` y no se dio contraseña, o al revés.
	ErrPasswordRequired = errors.New("contraseña requerida")
	// ErrDecrypt: el cifrado no se pudo abrir (clave o contraseña incorrecta, o alterado).
	ErrDecrypt = errors.New("no se pudo descifrar: el contenido fue alterado o la clave no es la correcta")
	errKey     = errors.New("clave no válida")
)

// LinkKey es lo que lleva el fragmento de un enlace de secreto.
type LinkKey struct {
	Key           []byte
	HasPassphrase bool
}

// Proof es lo que se presenta al servidor para abrir o destruir (ambos en hex).
type Proof struct {
	Link  string
	Token string
}

// Sealed es un secreto cifrado listo para subir.
type Sealed struct {
	// Ciphertext: IV ‖ cifrado ‖ etiqueta GCM, en base64url. Se envía al servidor.
	Ciphertext string
	// Verifier y LinkVerifier: SHA-256 de token y de link, en hex. Se envían al servidor.
	Verifier     string
	LinkVerifier string
	// Proof: para destruirlo después; no se sube al crear.
	Proof Proof
	// Fragment: lo que va tras `#`. Nunca se envía al servidor.
	Fragment string
	// PaddedLen: tamaño del envoltorio rellenado (para la caducidad máxima de los secretos grandes).
	PaddedLen int
}

func aad(hasPassphrase bool) []byte {
	if hasPassphrase {
		return []byte("runa/" + Version + "|p")
	}
	return []byte("runa/" + Version + "|-")
}

func hkdf32(ikm, salt []byte, info string, n int) ([]byte, error) {
	return hkdf.Key(sha256.New, ikm, salt, info, n)
}

type derived struct {
	gcm   cipher.AEAD
	token []byte
	link  []byte
}

func (d *derived) proof() Proof { return Proof{Link: toHex(d.link), Token: toHex(d.token)} }

func (d *derived) wipe() { Wipe(d.token, d.link) }

// deriveKeys sigue `deriveKeys` de protocol.ts. Pone a cero sus intermedios (P, ikm, kEnc); la clave AES expandida
// queda dentro de crypto/aes y no se puede borrar desde fuera.
func deriveKeys(link LinkKey, password []byte) (*derived, error) {
	if len(link.Key) != keyBytes {
		return nil, errKey
	}
	if link.HasPassphrase != (len(password) > 0) {
		return nil, ErrPasswordRequired
	}
	if len(password) > 0 {
		if err := checkNFC(password); err != nil {
			return nil, err
		}
	}
	salt, err := hkdf32(link.Key, nil, "runa/"+Version+"/salt", saltBytes)
	if err != nil {
		return nil, err
	}
	linkProof, err := hkdf32(link.Key, salt, "runa/"+Version+"/link", 32)
	if err != nil {
		return nil, err
	}
	ikm := append([]byte(nil), link.Key...)
	if len(password) > 0 {
		// crypto/pbkdf2 recibe la contraseña como string: esa copia inmutable no se puede poner a cero.
		stretched, err := pbkdf2.Key(sha256.New, string(password), salt, PBKDF2Iterations, 32)
		if err != nil {
			return nil, err
		}
		ikm = append(ikm, stretched...)
		Wipe(stretched)
	}
	defer Wipe(ikm)
	kEnc, err := hkdf32(ikm, salt, "runa/"+Version+"/enc", 32)
	if err != nil {
		return nil, err
	}
	defer Wipe(kEnc)
	token, err := hkdf32(ikm, salt, "runa/"+Version+"/auth", 32)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(kEnc)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &derived{gcm: gcm, token: token, link: linkProof}, nil
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return toHex(sum[:])
}

// Seal cifra el secreto en local con una K nueva. password vacía = sin contraseña.
func Seal(p Payload, password []byte) (*Sealed, error) {
	key := make([]byte, keyBytes)
	iv := make([]byte, ivBytes)
	rand.Read(key)
	rand.Read(iv)
	defer Wipe(key)
	return sealWith(key, iv, p, password)
}

// sealWith es Seal con K e IV dados: determinista, para los vectores de compatibilidad.
func sealWith(key, iv []byte, p Payload, password []byte) (*Sealed, error) {
	link := LinkKey{Key: key, HasPassphrase: len(password) > 0}
	keys, err := deriveKeys(link, password)
	if err != nil {
		return nil, err
	}
	defer keys.wipe()
	plain, err := EncodePayload(p)
	if err != nil {
		return nil, err
	}
	defer Wipe(plain)
	out := make([]byte, 0, ivBytes+len(plain)+keys.gcm.Overhead())
	out = append(out, iv...)
	out = keys.gcm.Seal(out, iv, plain, aad(link.HasPassphrase))
	return &Sealed{
		Ciphertext:   ToBase64URL(out),
		Verifier:     sha256Hex(keys.token),
		LinkVerifier: sha256Hex(keys.link),
		Proof:        keys.proof(),
		Fragment:     FormatFragment(link),
		PaddedLen:    len(plain),
	}, nil
}

// Unlocked guarda la clave ya derivada (PBKDF2 es lento a propósito: se deriva una sola vez).
type Unlocked struct {
	Proof         Proof
	gcm           cipher.AEAD
	hasPassphrase bool
}

// Unlock deriva las pruebas y la clave de descifrado.
func Unlock(link LinkKey, password []byte) (*Unlocked, error) {
	keys, err := deriveKeys(link, password)
	if err != nil {
		return nil, err
	}
	defer keys.wipe()
	return &Unlocked{Proof: keys.proof(), gcm: keys.gcm, hasPassphrase: link.HasPassphrase}, nil
}

// Open descifra lo que entregó el servidor. Falla si el cifrado fue alterado.
func (u *Unlocked) Open(ciphertext string) (Payload, error) {
	b, err := FromBase64URL(ciphertext)
	if err != nil || len(b) <= ivBytes+16 || len(b) > MaxCiphertextBytes {
		return Payload{}, ErrDecrypt
	}
	plain, err := u.gcm.Open(nil, b[:ivBytes], b[ivBytes:], aad(u.hasPassphrase))
	if err != nil {
		return Payload{}, ErrDecrypt
	}
	defer Wipe(plain)
	return DecodePayload(plain)
}

// FormatFragment es lo que va tras `#`: `v1.<K>[.p]`.
func FormatFragment(link LinkKey) string {
	s := Version + "." + ToBase64URL(link.Key)
	if link.HasPassphrase {
		s += ".p"
	}
	return s
}

// ParseFragment lee el fragmento (con o sin `#`). ok = false si no es válido.
func ParseFragment(fragment string) (LinkKey, bool) {
	if len(fragment) > 0 && fragment[0] == '#' {
		fragment = fragment[1:]
	}
	m := fragmentRE.FindStringSubmatch(fragment)
	if m == nil {
		return LinkKey{}, false
	}
	key, err := FromBase64URL(m[1])
	if err != nil || len(key) != keyBytes {
		return LinkKey{}, false
	}
	return LinkKey{Key: key, HasPassphrase: m[2] != ""}, true
}
