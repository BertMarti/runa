package protocol

// Peticiones de secreto (docs/PROTOCOLO.md § «Pedir un secreto» y apps/web/src/crypto/request.ts).
//
// Quien pide genera un par X25519 (a, A) y reparte dos enlaces:
//
//	envío    /r/<id>#v1.<A>           → para la persona que va a enviar el secreto (clave pública)
//	recogida /p/<id>#v1.<a en PKCS#8> → solo para quien pide (clave privada)
//
//	sendProof = HKDF(A,        info="runa/v1/req-send") → SHA-256 en el servidor: rellenar (una sola vez)
//	openProof = HKDF(PKCS#8 a, info="runa/v1/req-open") → SHA-256 en el servidor: recoger o cancelar
//
// Quien envía cifra con una clave efímera (e, E):
//
//	z    = X25519(e, A)
//	kEnc = HKDF(z, salt = E ‖ A, info="runa/v1/req-enc") → AES-256-GCM, aad = "runa/v1|req"

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/rand"
	"errors"
	"regexp"
)

const (
	publicBytes      = 32
	privatePKCS8Size = 48
)

// pkcs8Prefix es la cabecera DER fija de una clave privada X25519 en PKCS#8 v1 (RFC 8410), tal como la exporta
// Web Crypto: SEQUENCE { INTEGER 0, SEQUENCE { OID 1.3.101.110 }, OCTET STRING { OCTET STRING (32 bytes) } }.
var pkcs8Prefix = []byte{0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20}

var (
	sendFragmentRE   = regexp.MustCompile(`^v1\.([A-Za-z0-9_-]{43})$`)
	pickupFragmentRE = regexp.MustCompile(`^v1\.([A-Za-z0-9_-]{64})$`)
	requestAAD       = []byte("runa/" + Version + "|req")
)

// NewRequest es una petición recién generada.
type NewRequest struct {
	// SendVerifier y OpenVerifier se suben al servidor (hex).
	SendVerifier string
	OpenVerifier string
	// SendFragment y PickupFragment van tras `#` en cada enlace. Nunca se envían al servidor.
	SendFragment   string
	PickupFragment string
}

func sendProofOf(pub []byte) ([]byte, error) {
	return hkdf32(pub, nil, "runa/"+Version+"/req-send", 32)
}

func openProofOf(pkcs8 []byte) ([]byte, error) {
	return hkdf32(pkcs8, nil, "runa/"+Version+"/req-open", 32)
}

func requestGCM(shared, ephemeral, pub []byte) (cipher.AEAD, error) {
	salt := append(append(make([]byte, 0, 2*publicBytes), ephemeral...), pub...)
	k, err := hkdf32(shared, salt, "runa/"+Version+"/req-enc", 32)
	if err != nil {
		return nil, err
	}
	defer Wipe(k)
	block, err := aes.NewCipher(k)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// CreateRequestKeys genera una petición: el par de claves vive solo en los dos fragmentos.
func CreateRequestKeys() (*NewRequest, error) {
	priv, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	pub := priv.PublicKey().Bytes()
	raw := priv.Bytes()
	pkcs8 := append(append(make([]byte, 0, privatePKCS8Size), pkcs8Prefix...), raw...)
	defer Wipe(raw, pkcs8)
	sendProof, err := sendProofOf(pub)
	if err != nil {
		return nil, err
	}
	openProof, err := openProofOf(pkcs8)
	if err != nil {
		return nil, err
	}
	defer Wipe(openProof)
	return &NewRequest{
		SendVerifier:   sha256Hex(sendProof),
		OpenVerifier:   sha256Hex(openProof),
		SendFragment:   Version + "." + ToBase64URL(pub),
		PickupFragment: Version + "." + ToBase64URL(pkcs8),
	}, nil
}

// SendKey es la clave pública del enlace de envío.
type SendKey struct{ Pub []byte }

// PickupKey es la clave privada (PKCS#8) del enlace de recogida.
type PickupKey struct{ PKCS8 []byte }

func trimHash(s string) string {
	if len(s) > 0 && s[0] == '#' {
		return s[1:]
	}
	return s
}

// ParseSendFragment: fragmento del enlace de envío → clave pública.
func ParseSendFragment(fragment string) (SendKey, bool) {
	m := sendFragmentRE.FindStringSubmatch(trimHash(fragment))
	if m == nil {
		return SendKey{}, false
	}
	pub, err := FromBase64URL(m[1])
	if err != nil || len(pub) != publicBytes {
		return SendKey{}, false
	}
	return SendKey{Pub: pub}, true
}

// ParsePickupFragment: fragmento del enlace de recogida → clave privada. Además de la longitud (como la web),
// exige la cabecera PKCS#8 fija, que es lo único que Web Crypto aceptaría al importarla.
func ParsePickupFragment(fragment string) (PickupKey, bool) {
	m := pickupFragmentRE.FindStringSubmatch(trimHash(fragment))
	if m == nil {
		return PickupKey{}, false
	}
	pkcs8, err := FromBase64URL(m[1])
	if err != nil || len(pkcs8) != privatePKCS8Size || !bytes.Equal(pkcs8[:len(pkcs8Prefix)], pkcs8Prefix) {
		Wipe(pkcs8)
		return PickupKey{}, false
	}
	return PickupKey{PKCS8: pkcs8}, true
}

// SealedForRequest es lo que se sube al rellenar una petición.
type SealedForRequest struct {
	// Proof: prueba de tener el enlace de envío (hex).
	Proof string
	// Ciphertext: IV ‖ cifrado ‖ etiqueta, en base64url.
	Ciphertext string
	// Ephemeral: clave pública efímera E, en base64url.
	Ephemeral string
	// PaddedLen: tamaño del envoltorio rellenado.
	PaddedLen int
}

// errLowOrder: la clave pública es de orden pequeño (el secreto compartido sería todo ceros).
var errLowOrder = errors.New("la clave pública del enlace no es válida")

// SealForRequest cifra el secreto para quien lo pidió. Solo su clave privada puede abrirlo.
func SealForRequest(p Payload, key SendKey) (*SealedForRequest, error) {
	if len(key.Pub) != publicBytes {
		return nil, errKey
	}
	recipient, err := ecdh.X25519().NewPublicKey(key.Pub)
	if err != nil {
		return nil, errKey
	}
	eph, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	// crypto/ecdh rechaza los puntos de orden pequeño (secreto compartido nulo), igual que Web Crypto.
	shared, err := eph.ECDH(recipient)
	if err != nil {
		return nil, errLowOrder
	}
	defer Wipe(shared)
	ephPub := eph.PublicKey().Bytes()
	gcm, err := requestGCM(shared, ephPub, key.Pub)
	if err != nil {
		return nil, err
	}
	plain, err := EncodePayload(p)
	if err != nil {
		return nil, err
	}
	defer Wipe(plain)
	iv := make([]byte, ivBytes)
	rand.Read(iv)
	out := append(make([]byte, 0, ivBytes+len(plain)+gcm.Overhead()), iv...)
	out = gcm.Seal(out, iv, plain, requestAAD)
	proof, err := sendProofOf(key.Pub)
	if err != nil {
		return nil, err
	}
	return &SealedForRequest{
		Proof:      toHex(proof),
		Ciphertext: ToBase64URL(out),
		Ephemeral:  ToBase64URL(ephPub),
		PaddedLen:  len(plain),
	}, nil
}

// PickupHandle tiene la clave privada importada y la prueba de recogida.
type PickupHandle struct {
	// Proof: prueba de tener el enlace de recogida (hex), para recoger o cancelar.
	Proof string
	priv  *ecdh.PrivateKey
	pub   []byte
}

// PreparePickup importa la clave privada y deriva la prueba. Después pone a cero los bytes PKCS#8 de key.
func PreparePickup(key PickupKey) (*PickupHandle, error) {
	defer Wipe(key.PKCS8)
	if len(key.PKCS8) != privatePKCS8Size || !bytes.Equal(key.PKCS8[:len(pkcs8Prefix)], pkcs8Prefix) {
		return nil, errKey
	}
	priv, err := ecdh.X25519().NewPrivateKey(key.PKCS8[len(pkcs8Prefix):])
	if err != nil {
		return nil, errKey
	}
	proof, err := openProofOf(key.PKCS8)
	if err != nil {
		return nil, err
	}
	defer Wipe(proof)
	return &PickupHandle{Proof: toHex(proof), priv: priv, pub: priv.PublicKey().Bytes()}, nil
}

// Open descifra lo enviado a la petición.
func (h *PickupHandle) Open(ciphertext, ephemeral string) (Payload, error) {
	eph, err1 := FromBase64URL(ephemeral)
	b, err2 := FromBase64URL(ciphertext)
	if err1 != nil || err2 != nil || len(eph) != publicBytes || len(b) <= ivBytes+16 || len(b) > MaxCiphertextBytes {
		return Payload{}, ErrDecrypt
	}
	ephKey, err := ecdh.X25519().NewPublicKey(eph)
	if err != nil {
		return Payload{}, ErrDecrypt
	}
	shared, err := h.priv.ECDH(ephKey)
	if err != nil {
		return Payload{}, ErrDecrypt
	}
	defer Wipe(shared)
	gcm, err := requestGCM(shared, eph, h.pub)
	if err != nil {
		return Payload{}, err
	}
	plain, err := gcm.Open(nil, b[:ivBytes], b[ivBytes:], requestAAD)
	if err != nil {
		return Payload{}, ErrDecrypt
	}
	defer Wipe(plain)
	return DecodePayload(plain)
}
