/**
 * Peticiones de secreto (protocolo RUNA v1, ver docs/PROTOCOLO.md § «Pedir un secreto»).
 *
 * Quien pide genera un par X25519 (a, A) y reparte dos enlaces:
 *
 *   envío    /r/<id>#v1.<A>          → para la persona que va a enviar el secreto (clave pública)
 *   recogida /p/<id>#v1.<a en PKCS#8> → solo para quien pide (clave privada)
 *
 *   sendProof = HKDF(A,       info="runa/v1/req-send")  → SHA-256 en el servidor: rellenar (una sola vez)
 *   openProof = HKDF(PKCS#8 a, info="runa/v1/req-open") → SHA-256 en el servidor: recoger o cancelar
 *
 * Quien envía cifra con una clave efímera (e, E):
 *
 *   z    = X25519(e, A)
 *   kEnc = HKDF(z, salt = E ‖ A, info="runa/v1/req-enc") → AES-256-GCM, aad = "runa/v1|req"
 *
 * El servidor nunca ve A ni a; con el enlace de envío no se puede leer lo enviado.
 */
import { concat, fromBase64Url, toBase64Url, toHex, utf8 } from './encoding';
import { decodePayload, encodePayload, type SecretPayload } from './envelope';
import { PROTOCOL_VERSION } from './protocol';

const PUBLIC_BYTES = 32;
const PRIVATE_PKCS8_BYTES = 48;
const IV_BYTES = 12;
const X25519 = { name: 'X25519' } as const;
const SEND_FRAGMENT = /^v1\.([A-Za-z0-9_-]{43})$/;
const PICKUP_FRAGMENT = /^v1\.([A-Za-z0-9_-]{64})$/;

const subtle = () => globalThis.crypto.subtle;
const AAD = () => utf8.encode(`runa/${PROTOCOL_VERSION}|req`);

async function hkdfBits(ikm: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, info: string) {
  const base = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: utf8.encode(info) }, base, 256));
}

const sha256Hex = async (bytes: Uint8Array<ArrayBuffer>) => toHex(new Uint8Array(await subtle().digest('SHA-256', bytes)));
const sendProofOf = (pub: Uint8Array<ArrayBuffer>) => hkdfBits(pub, new Uint8Array(), `runa/${PROTOCOL_VERSION}/req-send`);
const openProofOf = (pkcs8: Uint8Array<ArrayBuffer>) => hkdfBits(pkcs8, new Uint8Array(), `runa/${PROTOCOL_VERSION}/req-open`);

async function encKey(shared: Uint8Array<ArrayBuffer>, ephemeral: Uint8Array<ArrayBuffer>, pub: Uint8Array<ArrayBuffer>) {
  const base = await subtle().importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: concat(ephemeral, pub), info: utf8.encode(`runa/${PROTOCOL_VERSION}/req-enc`) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface NewRequest {
  /** Se suben al servidor (hex). */
  sendVerifier: string;
  openVerifier: string;
  /** Lo que va tras `#` en cada enlace. Nunca se envían al servidor. */
  sendFragment: string;
  pickupFragment: string;
}

/** Genera una petición: el par de claves vive solo en los dos fragmentos. */
export async function createRequestKeys(): Promise<NewRequest> {
  const pair = (await subtle().generateKey(X25519, true, ['deriveBits'])) as CryptoKeyPair;
  const pub = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  const pkcs8 = new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey));
  return {
    sendVerifier: await sha256Hex(await sendProofOf(pub)),
    openVerifier: await sha256Hex(await openProofOf(pkcs8)),
    sendFragment: `${PROTOCOL_VERSION}.${toBase64Url(pub)}`,
    pickupFragment: `${PROTOCOL_VERSION}.${toBase64Url(pkcs8)}`,
  };
}

export interface SendKey {
  pub: Uint8Array<ArrayBuffer>;
}

export interface PickupKey {
  pkcs8: Uint8Array<ArrayBuffer>;
}

/** Fragmento del enlace de envío → clave pública. `null` si no es válido. */
export function parseSendFragment(hash: string): SendKey | null {
  const m = SEND_FRAGMENT.exec(hash.replace(/^#/, ''));
  if (!m) return null;
  const pub = fromBase64Url(m[1]!);
  return pub.length === PUBLIC_BYTES ? { pub: new Uint8Array(pub) } : null;
}

/** Fragmento del enlace de recogida → clave privada. `null` si no es válido. */
export function parsePickupFragment(hash: string): PickupKey | null {
  const m = PICKUP_FRAGMENT.exec(hash.replace(/^#/, ''));
  if (!m) return null;
  const pkcs8 = fromBase64Url(m[1]!);
  return pkcs8.length === PRIVATE_PKCS8_BYTES ? { pkcs8: new Uint8Array(pkcs8) } : null;
}

export interface SealedForRequest {
  /** Prueba de tener el enlace de envío (hex). */
  proof: string;
  /** IV ‖ cifrado ‖ etiqueta, en base64url. */
  ciphertext: string;
  /** Clave pública efímera E, en base64url. */
  ephemeral: string;
}

/** Cifra el secreto para quien lo pidió. Solo su clave privada puede abrirlo. */
export async function sealForRequest(payload: SecretPayload, key: SendKey): Promise<SealedForRequest> {
  const recipient = await subtle().importKey('raw', key.pub, X25519, false, []);
  const eph = (await subtle().generateKey(X25519, true, ['deriveBits'])) as CryptoKeyPair;
  const ephPub = new Uint8Array(await subtle().exportKey('raw', eph.publicKey));
  // Web Crypto rechaza las claves públicas de orden pequeño (secreto compartido todo ceros).
  const shared = new Uint8Array(await subtle().deriveBits({ name: 'X25519', public: recipient }, eph.privateKey, 256));
  const k = await encKey(shared, ephPub, key.pub);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: AAD() }, k, encodePayload(payload)));
  return {
    proof: toHex(await sendProofOf(key.pub)),
    ciphertext: toBase64Url(concat(iv, sealed)),
    ephemeral: toBase64Url(ephPub),
  };
}

export interface PickupHandle {
  /** Prueba de tener el enlace de recogida (hex), para recoger o cancelar. */
  proof: string;
  open(ciphertext: string, ephemeral: string): Promise<SecretPayload>;
}

/** Prepara la recogida: importa la clave privada (no exportable) y deriva la prueba. */
export async function preparePickup(key: PickupKey): Promise<PickupHandle> {
  // Importada una vez como exportable solo para leer la clave pública (`x` del JWK), que forma parte de la sal.
  const withPub = await subtle().importKey('pkcs8', key.pkcs8, X25519, true, ['deriveBits']);
  const jwk = await subtle().exportKey('jwk', withPub);
  const pub = fromBase64Url(jwk.x ?? '');
  if (pub.length !== PUBLIC_BYTES) throw new Error('Clave no válida');
  const priv = await subtle().importKey('pkcs8', key.pkcs8, X25519, false, ['deriveBits']);
  return {
    proof: toHex(await openProofOf(key.pkcs8)),
    async open(ciphertext, ephemeral) {
      const eph = fromBase64Url(ephemeral);
      const bytes = fromBase64Url(ciphertext);
      if (eph.length !== PUBLIC_BYTES || bytes.length <= IV_BYTES + 16) throw new Error('Cifrado no válido');
      const ephKey = await subtle().importKey('raw', new Uint8Array(eph), X25519, false, []);
      const shared = new Uint8Array(await subtle().deriveBits({ name: 'X25519', public: ephKey }, priv, 256));
      const k = await encKey(shared, new Uint8Array(eph), new Uint8Array(pub));
      const plain = await subtle().decrypt({ name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES), additionalData: AAD() }, k, bytes.slice(IV_BYTES));
      return decodePayload(new Uint8Array(plain));
    },
  };
}
