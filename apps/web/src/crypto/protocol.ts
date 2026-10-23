/**
 * Protocolo RUNA v1 (ver docs/PROTOCOLO.md).
 *
 *   K      = 32 bytes aleatorios — viajan solo en el fragmento `#` del enlace
 *   salt   = HKDF(K, info="runa/v1/salt")[0..16]
 *   P      = PBKDF2-SHA256(contraseña, salt, 600 000)   (solo si hay contraseña)
 *   ikm    = K ‖ P   (o K)
 *   kEnc   = HKDF(ikm, salt, "runa/v1/enc")   → AES-256-GCM
 *   token  = HKDF(ikm, salt, "runa/v1/auth")  → demuestra la contraseña (si la hay)
 *   link   = HKDF(K,   salt, "runa/v1/link")  → demuestra tener el enlace completo
 *   verificadores = SHA-256(token), SHA-256(link) → lo único que guarda el servidor
 *
 * El navegador nunca envía K al servidor (los fragmentos no forman parte de la
 * petición HTTP). El servidor guarda cifrado + verificadores y no puede derivar
 * ni la clave ni los tokens. Sin `link` correcto responde 404 y no cuenta el
 * intento: conocer solo el id no permite agotar los intentos ni quemar nada.
 */
import { concat, fromBase64Url, toBase64Url, toHex, utf8 } from './encoding';
import { decodePayload, encodePayload, type SecretPayload } from './envelope';
import { PBKDF2_ITERATIONS } from './limits';

export const PROTOCOL_VERSION = 'v1';

const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const FRAGMENT = /^v1\.([A-Za-z0-9_-]{43})(\.p)?$/;

export interface LinkKey {
  key: Uint8Array<ArrayBuffer>;
  hasPassphrase: boolean;
}

/** Lo que se presenta al servidor para abrir o destruir (ambos en hex). */
export interface AccessProof {
  /** Prueba de tener el enlace completo (deriva solo de K). */
  link: string;
  /** Prueba de conocer la contraseña (deriva de K y de la contraseña). */
  token: string;
}

export interface SealedSecret {
  /** IV ‖ cifrado ‖ etiqueta GCM, en base64url. Se envía al servidor. */
  ciphertext: string;
  /** SHA-256 del token, en hex. Se envía al servidor. */
  verifier: string;
  /** SHA-256 de la prueba de enlace, en hex. Se envía al servidor. */
  linkVerifier: string;
  /** La conserva quien envía para «Destruir ahora»; no se sube al crear. */
  proof: AccessProof;
  /** Lo que va tras `#` en el enlace. Nunca se envía al servidor. */
  fragment: string;
}

interface DerivedKeys {
  encKey: CryptoKey;
  token: Uint8Array<ArrayBuffer>;
  link: Uint8Array<ArrayBuffer>;
}

const subtle = () => globalThis.crypto.subtle;

function aad(hasPassphrase: boolean): Uint8Array<ArrayBuffer> {
  return utf8.encode(`runa/${PROTOCOL_VERSION}|${hasPassphrase ? 'p' : '-'}`);
}

async function hkdfBits(ikm: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, info: string, bits: number) {
  const base = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const out = await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: utf8.encode(info) }, base, bits);
  return new Uint8Array(out);
}

async function deriveKeys(link: LinkKey, passphrase: string | undefined): Promise<DerivedKeys> {
  if (link.key.length !== KEY_BYTES) throw new Error('Clave no válida');
  if (link.hasPassphrase !== Boolean(passphrase)) throw new Error('Contraseña requerida');

  const salt = await hkdfBits(link.key, new Uint8Array(), `runa/${PROTOCOL_VERSION}/salt`, SALT_BYTES * 8);
  const linkProof = await hkdfBits(link.key, salt, `runa/${PROTOCOL_VERSION}/link`, 256);

  let ikm = link.key;
  if (passphrase) {
    const pwKey = await subtle().importKey('raw', utf8.encode(passphrase.normalize('NFC')), 'PBKDF2', false, [
      'deriveBits',
    ]);
    const stretched = await subtle().deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
      pwKey,
      256,
    );
    ikm = concat(link.key, new Uint8Array(stretched));
  }

  const base = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveKey', 'deriveBits']);
  const encKey = await subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8.encode(`runa/${PROTOCOL_VERSION}/enc`) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const token = new Uint8Array(
    await subtle().deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: utf8.encode(`runa/${PROTOCOL_VERSION}/auth`) },
      base,
      256,
    ),
  );
  return { encKey, token, link: linkProof };
}

const sha256Hex = async (bytes: Uint8Array<ArrayBuffer>) =>
  toHex(new Uint8Array(await subtle().digest('SHA-256', bytes)));

/** Cifra el secreto en el navegador. Devuelve lo que se sube y el fragmento del enlace. */
export async function sealSecret(payload: SecretPayload, passphrase?: string): Promise<SealedSecret> {
  const link: LinkKey = {
    key: globalThis.crypto.getRandomValues(new Uint8Array(KEY_BYTES)),
    hasPassphrase: Boolean(passphrase),
  };
  const keys = await deriveKeys(link, passphrase || undefined);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(link.hasPassphrase) },
    keys.encKey,
    encodePayload(payload),
  );
  return {
    ciphertext: toBase64Url(concat(iv, new Uint8Array(sealed))),
    verifier: await sha256Hex(keys.token),
    linkVerifier: await sha256Hex(keys.link),
    proof: { link: toHex(keys.link), token: toHex(keys.token) },
    fragment: formatFragment(link),
  };
}

export interface UnlockedLink {
  /** Pruebas para presentar al servidor. */
  proof: AccessProof;
  /** Descifra lo que entregue el servidor con la clave ya derivada. */
  open(ciphertext: string): Promise<SecretPayload>;
}

/**
 * Deriva una sola vez (PBKDF2 es lento a propósito) el token y la clave de
 * descifrado. La clave AES no es exportable y solo vive en este cierre.
 */
export async function unlock(link: LinkKey, passphrase?: string): Promise<UnlockedLink> {
  const keys = await deriveKeys(link, passphrase || undefined);
  return {
    proof: { link: toHex(keys.link), token: toHex(keys.token) },
    open: (ciphertext) => decryptWith(keys.encKey, ciphertext, link.hasPassphrase),
  };
}

async function decryptWith(encKey: CryptoKey, ciphertext: string, hasPassphrase: boolean): Promise<SecretPayload> {
  const bytes = fromBase64Url(ciphertext);
  if (bytes.length <= IV_BYTES + 16) throw new Error('Cifrado no válido');
  const plain = await subtle().decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES), additionalData: aad(hasPassphrase) },
    encKey,
    bytes.slice(IV_BYTES),
  );
  return decodePayload(new Uint8Array(plain));
}

/** Pruebas de que tenemos el enlace completo (y la contraseña). */
export async function accessProof(link: LinkKey, passphrase?: string): Promise<AccessProof> {
  return (await unlock(link, passphrase)).proof;
}

/** Descifra lo que entregó el servidor. Lanza si el cifrado fue alterado. */
export async function openSecret(ciphertext: string, link: LinkKey, passphrase?: string): Promise<SecretPayload> {
  return (await unlock(link, passphrase)).open(ciphertext);
}

export function formatFragment(link: LinkKey): string {
  return `${PROTOCOL_VERSION}.${toBase64Url(link.key)}${link.hasPassphrase ? '.p' : ''}`;
}

/** Lee el fragmento del enlace (`location.hash`, con o sin `#`). `null` si no es válido. */
export function parseFragment(hash: string): LinkKey | null {
  const match = FRAGMENT.exec(hash.replace(/^#/, ''));
  if (!match) return null;
  const key = fromBase64Url(match[1]!);
  if (key.length !== KEY_BYTES) return null;
  return { key: new Uint8Array(key), hasPassphrase: Boolean(match[2]) };
}
