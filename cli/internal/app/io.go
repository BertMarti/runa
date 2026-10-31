package app

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/BertMarti/runa/cli/internal/protocol"
	"github.com/BertMarti/runa/cli/internal/tty"
)

// readText lee el texto del secreto de la entrada estándar. Con --file y la entrada en una terminal no lee nada
// (el secreto es solo el archivo). Quita un salto de línea final (el de `echo` o el Intro antes de Ctrl-D)
// salvo con --keep-newline.
func readText(env *Env, hasFile, keepNewline bool) (string, error) {
	if hasFile && env.StdinIsTTY {
		return "", nil
	}
	if env.StdinIsTTY {
		fmt.Fprintln(env.Stderr, "Escribe o pega el secreto y termina con Ctrl-D (Ctrl-Z e Intro en Windows):")
	}
	// Cada unidad UTF-16 ocupa como mucho 3 bytes en UTF-8 (los pares sustitutos, 4 bytes por 2 unidades).
	limit := int64(3*protocol.MaxTextChars + 2)
	b, err := io.ReadAll(io.LimitReader(env.Stdin, limit+1))
	defer protocol.Wipe(b)
	if err != nil {
		return "", fmt.Errorf("no se pudo leer la entrada estándar: %w", err)
	}
	if int64(len(b)) > limit {
		return "", fmt.Errorf("el texto supera el máximo de %d caracteres", protocol.MaxTextChars)
	}
	if !utf8.Valid(b) {
		return "", errors.New("el texto no es UTF-8 válido; para datos binarios usa --file")
	}
	text := string(b)
	if !keepNewline {
		if strings.HasSuffix(text, "\r\n") {
			text = text[:len(text)-2]
		} else if strings.HasSuffix(text, "\n") {
			text = text[:len(text)-1]
		}
	}
	if protocol.UTF16Len(text) > protocol.MaxTextChars {
		return "", fmt.Errorf("el texto supera el máximo de %d caracteres", protocol.MaxTextChars)
	}
	return text, nil
}

// cause quita la ruta de un *fs.PathError (el mensaje ya dice de qué se trata).
func cause(err error) error {
	var pe *fs.PathError
	if errors.As(err, &pe) {
		return pe.Err
	}
	return err
}

// readFile lee el adjunto: solo archivos normales y de 3 MiB como mucho.
func readFile(path string) (*protocol.File, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("no se pudo abrir el archivo: %w", cause(err))
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("--file debe ser un archivo normal")
	}
	if info.Size() > protocol.MaxFileBytes {
		return nil, fmt.Errorf("el archivo supera el máximo de %d MiB", protocol.MaxFileBytes>>20)
	}
	data, err := io.ReadAll(io.LimitReader(f, protocol.MaxFileBytes+1))
	if err != nil {
		return nil, fmt.Errorf("no se pudo leer el archivo: %w", err)
	}
	if len(data) > protocol.MaxFileBytes {
		protocol.Wipe(data)
		return nil, fmt.Errorf("el archivo supera el máximo de %d MiB", protocol.MaxFileBytes>>20)
	}
	return &protocol.File{Name: filepath.Base(path), Type: mimeOf(path), Data: data}, nil
}

// mimeOf adivina el tipo por la extensión, como hace el navegador. Solo es un dato: quien lo recibe lo guarda
// siempre como bytes.
func mimeOf(path string) string {
	t := mime.TypeByExtension(strings.ToLower(filepath.Ext(path)))
	if t == "" {
		return "application/octet-stream"
	}
	if base, _, err := mime.ParseMediaType(t); err == nil {
		return base
	}
	return "application/octet-stream"
}

// readPayload junta texto y adjunto; un secreto vacío es un error.
func readPayload(env *Env, filePath string, keepNewline bool) (protocol.Payload, error) {
	var p protocol.Payload
	if filePath != "" {
		f, err := readFile(filePath)
		if err != nil {
			return p, err
		}
		p.File = f
	}
	text, err := readText(env, p.File != nil, keepNewline)
	if err != nil {
		p.Wipe()
		return protocol.Payload{}, err
	}
	p.Text = text
	if p.Text == "" && p.File == nil {
		return p, errors.New("no hay nada que enviar: escribe un texto por la entrada estándar o usa --file")
	}
	return p, nil
}

// openOutDir abre la carpeta de destino de los adjuntos **antes** de llamar al servidor: abrir destruye el
// secreto, así que un error de carpeta después sería perderlo.
func openOutDir(dir string) (*os.Root, error) {
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("no se puede usar la carpeta de destino: %w", cause(err))
	}
	return root, nil
}

// windowsReserved: nombres de dispositivo que Windows no deja usar como archivo (con cualquier extensión).
var windowsReserved = map[string]bool{
	"CON": true, "PRN": true, "AUX": true, "NUL": true, "CONIN$": true, "CONOUT$": true,
	"COM0": true, "COM1": true, "COM2": true, "COM3": true, "COM4": true, "COM5": true, "COM6": true, "COM7": true,
	"COM8": true, "COM9": true, "COM¹": true, "COM²": true, "COM³": true,
	"LPT0": true, "LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true, "LPT5": true, "LPT6": true, "LPT7": true,
	"LPT8": true, "LPT9": true, "LPT¹": true, "LPT²": true, "LPT³": true,
}

// localName es el nombre con el que se guarda: el de safeFileName (sin rutas ni controles, igual que la web),
// sin nombres de dispositivo de Windows y sin empezar por «-» (no se confunde con una opción al usarlo después).
func localName(name string) string {
	name = protocol.SafeFileName(name)
	stem, _, _ := strings.Cut(name, ".")
	if windowsReserved[strings.ToUpper(strings.TrimRight(stem, " "))] || strings.HasPrefix(name, "-") {
		name = "_" + name
	}
	return name
}

// saveFile guarda el adjunto dentro de root, con permisos 0600, sin sobrescribir nunca: si el nombre existe
// (también si es un enlace simbólico), prueba «nombre (1).ext», «nombre (2).ext»… os.Root impide salir de la
// carpeta y O_EXCL impide seguir enlaces simbólicos.
func saveFile(root *os.Root, f *protocol.File) (string, error) {
	name := localName(f.Name)
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 0; i < 1000; i++ {
		candidate := name
		if i > 0 {
			candidate = fmt.Sprintf("%s (%d)%s", stem, i, ext)
		}
		out, err := root.OpenFile(candidate, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if errors.Is(err, fs.ErrExist) {
			continue
		}
		if err != nil {
			return "", fmt.Errorf("no se pudo guardar el adjunto: %w", cause(err))
		}
		_, werr := out.Write(f.Data)
		cerr := out.Close()
		if werr != nil || cerr != nil {
			_ = root.Remove(candidate)
			return "", fmt.Errorf("no se pudo guardar el adjunto: %w", errors.Join(werr, cerr))
		}
		return filepath.Join(root.Name(), candidate), nil
	}
	return "", errors.New("no se pudo guardar el adjunto: ya existen demasiados archivos con ese nombre")
}

// writePayload entrega lo descifrado: el adjunto a disco y el texto a la salida estándar. Si la salida es una
// terminal (y no se pidió --raw), el texto pasa por tty.ForDisplay para que no pueda inyectar secuencias de
// escape; redirigido a un archivo o a otro programa, sale exacto.
func writePayload(env *Env, p protocol.Payload, root *os.Root, raw bool) error {
	// Si el adjunto no se puede guardar, el texto se muestra igualmente: en el servidor ya no queda nada.
	var saveErr error
	if p.File != nil {
		path, err := saveFile(root, p.File)
		if err != nil {
			saveErr = err
		} else {
			fmt.Fprintf(env.Stderr, "Adjunto guardado en %s (%d bytes, permisos 0600).\n", path, len(p.File.Data))
		}
	}
	if p.Text == "" {
		return saveErr
	}
	text := p.Text
	if env.StdoutIsTTY && !raw {
		var changed bool
		text, changed = tty.ForDisplay(text)
		if changed {
			fmt.Fprintln(env.Stderr, "Aviso: el texto tiene caracteres de control y se muestran como «�». Para obtenerlo exacto: --raw o redirige la salida a un archivo.")
		}
		if !strings.HasSuffix(text, "\n") {
			text += "\n"
		}
	}
	if _, err := io.WriteString(env.Stdout, text); err != nil {
		return errors.Join(saveErr, fmt.Errorf("no se pudo escribir el texto: %w", err))
	}
	return saveErr
}
