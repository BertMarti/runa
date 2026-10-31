package protocol

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"math"
	"strconv"
	"unicode/utf16"
	"unicode/utf8"
)

// File es un adjunto.
type File struct {
	Name string
	Type string
	Data []byte
}

// Payload es el contenido de un secreto: texto y, opcionalmente, un archivo.
type Payload struct {
	Text string
	File *File
}

// Wipe pone a cero los bytes del adjunto (el texto es una cadena inmutable de Go).
func (p *Payload) Wipe() {
	if p != nil && p.File != nil {
		Wipe(p.File.Data)
	}
}

var (
	// ErrTooLarge: el secreto supera el tamaño máximo.
	ErrTooLarge = errors.New("el secreto supera el tamaño máximo")
	// ErrInvalidUTF8: el texto no es UTF-8 válido (la web solo maneja texto Unicode).
	ErrInvalidUTF8 = errors.New("el texto no es UTF-8 válido")
	errFormat      = errors.New("formato no válido")
)

// UTF16Len mide una cadena como `string.length` en JavaScript (unidades UTF-16).
func UTF16Len(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

// isJSWhitespace: el `\s` de las expresiones regulares de JavaScript (solo hay caracteres del plano básico).
func isJSWhitespace(u uint16) bool {
	switch {
	case u >= 0x09 && u <= 0x0d, u == 0x20, u == 0xa0, u == 0x1680, u >= 0x2000 && u <= 0x200a,
		u == 0x2028, u == 0x2029, u == 0x202f, u == 0x205f, u == 0x3000, u == 0xfeff:
		return true
	}
	return false
}

// isInvisible: controles bidireccionales y de anchura cero que `safeFileName` elimina.
func isInvisible(u uint16) bool {
	return u >= 0x200b && u <= 0x200f || u >= 0x202a && u <= 0x202e || u >= 0x2060 && u <= 0x2064 ||
		u >= 0x2066 && u <= 0x2069 || u == 0xfeff
}

// safeFileNameUnits es `safeFileName` de envelope.ts, unidad UTF-16 a unidad UTF-16 (como JavaScript), para que
// el nombre de la cabecera salga idéntico byte a byte, incluso si el recorte a 200 parte un par sustituto.
func safeFileNameUnits(name string) []uint16 {
	units := utf16.Encode([]rune(name))
	// Sin rutas: solo lo que hay tras la última barra (de cualquiera de los dos tipos).
	for i := len(units) - 1; i >= 0; i-- {
		if units[i] == '/' || units[i] == '\\' {
			units = units[i+1:]
			break
		}
	}
	clean := make([]uint16, 0, len(units))
	for _, u := range units {
		switch {
		case u <= 0x1f || u == 0x7f || u == '<' || u == '>' || u == ':' || u == '"' || u == '|' || u == '?' || u == '*':
			clean = append(clean, '_')
		case isInvisible(u):
			// se elimina
		default:
			clean = append(clean, u)
		}
	}
	trim := func(u uint16) bool { return u == '.' || isJSWhitespace(u) }
	for len(clean) > 0 && trim(clean[0]) {
		clean = clean[1:]
	}
	for len(clean) > 0 && trim(clean[len(clean)-1]) {
		clean = clean[:len(clean)-1]
	}
	if len(clean) == 0 {
		clean = utf16.Encode([]rune("archivo"))
	}
	if len(clean) > MaxFileName {
		clean = clean[:MaxFileName]
	}
	return clean
}

// SafeFileName es el nombre seguro para guardar un adjunto: sin rutas, caracteres de control, controles
// bidireccionales ni de anchura cero, sin puntos o espacios sobrantes y nunca vacío. Igual que la web.
func SafeFileName(name string) string {
	return string(utf16.Decode(safeFileNameUnits(name)))
}

// safeMime conserva el tipo MIME solo como dato; si no tiene la forma esperada, octet-stream.
func safeMime(t string) string {
	if len(t) > 100 {
		return "application/octet-stream"
	}
	slash := -1
	for i := 0; i < len(t); i++ {
		c := t[i]
		switch {
		case c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '_' || c == '.' || c == '+' || c == '-':
		case c == '/' && slash < 0:
			slash = i
		default:
			return "application/octet-stream"
		}
	}
	if slash <= 0 || slash == len(t)-1 {
		return "application/octet-stream"
	}
	return t
}

// writeJSONString escribe una cadena (en unidades UTF-16) exactamente como `JSON.stringify`: solo escapa
// comillas, barra inversa y controles C0 (con \b \f \n \r \t abreviados y el resto como \u00xx en minúsculas);
// los sustitutos sueltos salen como \udxxx. Todo lo demás va tal cual en UTF-8.
func writeJSONString(buf *bytes.Buffer, units []uint16) {
	const hexdigits = "0123456789abcdef"
	buf.WriteByte('"')
	for i := 0; i < len(units); i++ {
		u := units[i]
		switch {
		case u == '"':
			buf.WriteString(`\"`)
		case u == '\\':
			buf.WriteString(`\\`)
		case u == '\b':
			buf.WriteString(`\b`)
		case u == '\f':
			buf.WriteString(`\f`)
		case u == '\n':
			buf.WriteString(`\n`)
		case u == '\r':
			buf.WriteString(`\r`)
		case u == '\t':
			buf.WriteString(`\t`)
		case u < 0x20:
			buf.WriteString(`\u00`)
			buf.WriteByte(hexdigits[u>>4])
			buf.WriteByte(hexdigits[u&0xf])
		case utf16.IsSurrogate(rune(u)):
			if u < 0xdc00 && i+1 < len(units) && units[i+1] >= 0xdc00 && units[i+1] <= 0xdfff {
				buf.WriteRune(utf16.DecodeRune(rune(u), rune(units[i+1])))
				i++
				continue
			}
			buf.WriteString(`\u`)
			for shift := 12; shift >= 0; shift -= 4 {
				buf.WriteByte(hexdigits[(u>>shift)&0xf])
			}
		default:
			buf.WriteRune(rune(u))
		}
	}
	buf.WriteByte('"')
}

// paddedLen devuelve el bloque de relleno para n bytes, o -1 si no cabe.
func paddedLen(n int) int {
	for _, b := range PadBuckets {
		if b >= n {
			return b
		}
	}
	return -1
}

// EncodePayload serializa el secreto y lo rellena hasta el siguiente bloque fijo, byte a byte igual que
// `encodePayload` de la web: `u32 BE longitud de cabecera | cabecera JSON | bytes del archivo | ceros`.
func EncodePayload(p Payload) ([]byte, error) {
	if !utf8.ValidString(p.Text) {
		return nil, ErrInvalidUTF8
	}
	if UTF16Len(p.Text) > MaxTextChars {
		return nil, ErrTooLarge
	}
	if p.File != nil && len(p.File.Data) > MaxFileBytes {
		return nil, ErrTooLarge
	}
	var header bytes.Buffer
	header.WriteString(`{"text":`)
	writeJSONString(&header, utf16.Encode([]rune(p.Text)))
	if p.File != nil {
		header.WriteString(`,"file":{"name":`)
		writeJSONString(&header, safeFileNameUnits(p.File.Name))
		header.WriteString(`,"type":`)
		writeJSONString(&header, utf16.Encode([]rune(safeMime(p.File.Type))))
		header.WriteString(`,"size":`)
		header.WriteString(strconv.Itoa(len(p.File.Data)))
		header.WriteByte('}')
	}
	header.WriteByte('}')

	size := 4 + header.Len()
	if p.File != nil {
		size += len(p.File.Data)
	}
	padded := paddedLen(size)
	if padded < 0 {
		return nil, ErrTooLarge
	}
	out := make([]byte, padded)
	binary.BigEndian.PutUint32(out, uint32(header.Len()))
	n := 4 + copy(out[4:], header.Bytes())
	if p.File != nil {
		copy(out[n:], p.File.Data)
	}
	Wipe(header.Bytes())
	return out, nil
}

// PaddedSize dice cuánto medirá el envoltorio rellenado (para avisar antes de subir un secreto grande).
func PaddedSize(p Payload) (int, error) {
	b, err := EncodePayload(p)
	if err != nil {
		return 0, err
	}
	defer Wipe(b)
	return len(b), nil
}

// truthy imita la conversión a booleano de JavaScript para un valor JSON ya decodificado.
func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case float64:
		return x != 0
	case string:
		return x != ""
	}
	return true
}

// DecodePayload es el inverso de EncodePayload, con las mismas validaciones que `decodePayload` de la web.
// Las claves JSON se buscan con su nombre exacto (encoding/json ignoraría mayúsculas y minúsculas).
func DecodePayload(b []byte) (Payload, error) {
	if len(b) < 4 || len(b) > MaxPaddedBytes {
		return Payload{}, errFormat
	}
	headerLen := binary.BigEndian.Uint32(b)
	if uint64(headerLen) > uint64(len(b)-4) {
		return Payload{}, errFormat
	}
	raw := b[4 : 4+int(headerLen)]
	// La web usa TextDecoder con `fatal: true`: UTF-8 no válido es un error, no un carácter de sustitución.
	if !utf8.Valid(raw) {
		return Payload{}, errFormat
	}
	var header map[string]json.RawMessage
	if err := json.Unmarshal(raw, &header); err != nil || header == nil {
		return Payload{}, errFormat
	}
	var text string
	if t, ok := header["text"]; !ok || json.Unmarshal(t, &text) != nil || !isJSONString(t) {
		return Payload{}, errFormat
	}
	rawFile, ok := header["file"]
	if !ok {
		return Payload{Text: text}, nil
	}
	var fileValue any
	if err := json.Unmarshal(rawFile, &fileValue); err != nil {
		return Payload{}, errFormat
	}
	if !truthy(fileValue) {
		return Payload{Text: text}, nil
	}
	obj, isObj := fileValue.(map[string]any)
	if !isObj {
		return Payload{}, errFormat
	}
	name, ok1 := obj["name"].(string)
	typ, ok2 := obj["type"].(string)
	sizeF, ok3 := obj["size"].(float64)
	// Number.isSafeInteger(size) && size >= 0 && size <= MAX_FILE_BYTES
	if !ok1 || !ok2 || !ok3 || sizeF != math.Trunc(sizeF) || sizeF < 0 || sizeF > MaxFileBytes {
		return Payload{}, errFormat
	}
	size := int(sizeF)
	start := 4 + int(headerLen)
	if start+size > len(b) {
		return Payload{}, errFormat
	}
	data := make([]byte, size)
	copy(data, b[start:start+size])
	return Payload{Text: text, File: &File{Name: SafeFileName(name), Type: safeMime(typ), Data: data}}, nil
}

// isJSONString: json.Unmarshal en un string acepta `null` (lo deja vacío); la web exige una cadena.
func isJSONString(raw json.RawMessage) bool {
	r := bytes.TrimSpace(raw)
	return len(r) > 0 && r[0] == '"'
}
