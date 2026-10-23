import { concat, utf8 } from './encoding';
import { MAX_FILE_BYTES, MAX_FILE_NAME, MAX_PADDED_BYTES, MAX_TEXT_CHARS, PAD_BUCKETS } from './limits';

export interface SecretFile {
  name: string;
  type: string;
  data: Uint8Array;
}

export interface SecretPayload {
  text: string;
  file?: SecretFile;
}

interface Header {
  text: string;
  file?: { name: string; type: string; size: number };
}

export class PayloadTooLargeError extends Error {
  constructor() {
    super('El secreto supera el tamaño máximo');
    this.name = 'PayloadTooLargeError';
  }
}

/**
 * Nombre seguro para descargar: sin rutas, caracteres de control, controles
 * bidireccionales ni de anchura cero (con U+202E, `factura<U+202E>fdp.exe` se
 * vería como `facturaexe.pdf`), sin puntos o espacios sobrantes y nunca vacío.
 */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, '')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  return (clean || 'archivo').slice(0, MAX_FILE_NAME);
}

/** Tipo MIME conservado solo como dato; la descarga siempre usa octet-stream. */
function safeMime(type: string): string {
  return /^[\w.+-]+\/[\w.+-]+$/.test(type) && type.length <= 100 ? type : 'application/octet-stream';
}

function bucketFor(length: number): number {
  const bucket = PAD_BUCKETS.find((b) => b >= length);
  if (bucket === undefined) throw new PayloadTooLargeError();
  return bucket;
}

/**
 * Serializa el secreto y lo rellena hasta el siguiente bloque fijo.
 *
 * Formato: `u32 BE longitud de cabecera | cabecera JSON | bytes del archivo | ceros`.
 * El relleno impide deducir la longitud exacta (p. ej. de una contraseña)
 * a partir del tamaño del cifrado.
 */
export function encodePayload(payload: SecretPayload): Uint8Array<ArrayBuffer> {
  if (payload.text.length > MAX_TEXT_CHARS) throw new PayloadTooLargeError();
  if (payload.file && payload.file.data.length > MAX_FILE_BYTES) throw new PayloadTooLargeError();

  const header: Header = { text: payload.text };
  if (payload.file) {
    header.file = {
      name: safeFileName(payload.file.name),
      type: safeMime(payload.file.type),
      size: payload.file.data.length,
    };
  }
  const headerBytes = utf8.encode(JSON.stringify(header));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, headerBytes.length, false);

  const body = concat(length, headerBytes, payload.file?.data ?? new Uint8Array());
  const padded = new Uint8Array(bucketFor(body.length));
  padded.set(body);
  return padded;
}

/** Inverso de `encodePayload`, validando cada longitud antes de leer. */
export function decodePayload(bytes: Uint8Array): SecretPayload {
  if (bytes.length < 4 || bytes.length > MAX_PADDED_BYTES) throw new Error('Formato no válido');
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false);
  if (headerLength > bytes.length - 4) throw new Error('Formato no válido');

  const header = JSON.parse(utf8.decode(bytes.subarray(4, 4 + headerLength))) as unknown;
  if (typeof header !== 'object' || header === null) throw new Error('Formato no válido');
  const { text, file } = header as Partial<Header>;
  if (typeof text !== 'string') throw new Error('Formato no válido');

  if (!file) return { text };
  if (
    typeof file.name !== 'string' ||
    typeof file.type !== 'string' ||
    !Number.isSafeInteger(file.size) ||
    file.size < 0 ||
    file.size > MAX_FILE_BYTES
  ) {
    throw new Error('Formato no válido');
  }
  const start = 4 + headerLength;
  if (start + file.size > bytes.length) throw new Error('Formato no válido');
  return {
    text,
    file: {
      name: safeFileName(file.name),
      type: safeMime(file.type),
      data: bytes.slice(start, start + file.size),
    },
  };
}
