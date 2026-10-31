import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as server from '../../server/src/limits';
import {
  accessProof,
  createRequestKeys,
  LARGE_SECRET_BYTES,
  LARGE_SECRET_MAX_TTL,
  MAX_FAILED_ATTEMPTS,
  MAX_FILE_BYTES,
  MAX_FILE_NAME,
  MAX_PADDED_BYTES,
  MAX_TEXT_CHARS,
  openSecret,
  PAD_BUCKETS,
  parseFragment,
  parsePickupFragment,
  parseSendFragment,
  PBKDF2_ITERATIONS,
  preparePickup,
  safeFileName,
  sealForRequest,
  sealSecret,
  TTL_OPTIONS,
  type SecretPayload,
} from '../src/crypto';

/**
 * Compatibilidad con la CLI en Go (cli/). Mismo esquema que compat-python, pero en los dos sentidos y con
 * vectores en archivos:
 *
 * - `cli/testdata/desde-ts.json`: lo cifra ESTA implementación. Lo abre `cli/internal/protocol/compat_test.go`,
 *   que además vuelve a cifrar con la misma K y el mismo IV y exige el mismo cifrado byte a byte.
 *   Se regenera con `RUNA_GENERAR_VECTORES=1 npx vitest run test/compat-go.test.ts` (en apps/web).
 * - `cli/testdata/desde-go.json`: lo cifra la CLI. Este test lo abre.
 *   Se regenera con `go test ./internal/protocol -run TestGenerarVectores -actualizar` (en cli/).
 *
 * Si un cambio del protocolo rompe esta prueba, también rompe la CLI.
 */

// Con happy-dom, `URL` es la del navegador simulado: la ruta se resuelve con node:path.
const TESTDATA = path.resolve(import.meta.dirname, '../../../cli/testdata') + path.sep;
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64url');
/** Unidades UTF-16 en hex, separadas por espacios (`Array.from` sobre una cadena iteraría por puntos de código). */
const units = (s: string) =>
  Array.from({ length: s.length }, (_, i) => s.charCodeAt(i).toString(16).padStart(4, '0')).join(' ');
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

async function sha256Hex(hex: string): Promise<string> {
  return Buffer.from(await crypto.subtle.digest('SHA-256', Buffer.from(hex, 'hex'))).toString('hex');
}

interface ArchivoJson {
  nombre: string;
  tipo: string;
  datos: string;
}

interface Entrada {
  nombre: string;
  texto: string;
  contrasena: string | null;
  archivo?: ArchivoJson;
}

const fileOf = (a?: ArchivoJson) => (a ? { name: a.nombre, type: a.tipo, data: unb64(a.datos) } : undefined);
const jsonOf = (p: SecretPayload) => ({
  texto: p.text,
  archivo: p.file ? { nombre: p.file.name, tipo: p.file.type, datos: b64(p.file.data) } : undefined,
});

// Casos que ejercitan el envoltorio: escapes de JSON.stringify, Unicode, nombres saneados y tamaños de bloque.
const SECRETOS: Entrada[] = [
  { nombre: 'simple', texto: 'hola', contrasena: null },
  {
    nombre: 'escapes-json',
    texto: 'Contraseña: Ñu-77 · "comillas" \\ barra\nlínea\ttab\r\u0001\u001f\u007f\u2028\u2029 😀 <script>&</script>',
    contrasena: null,
  },
  { nombre: 'con-contrasena', texto: 'clave del wifi: 7#kP!2', contrasena: 'fiordo azul ñandú €' },
  {
    nombre: 'adjunto',
    texto: 'con adjunto',
    contrasena: null,
    archivo: { nombre: 'clave.pem', tipo: 'application/x-pem-file', datos: b64(new TextEncoder().encode('-----BEGIN-----\n')) },
  },
  {
    nombre: 'adjunto-nombre-hostil',
    texto: '',
    contrasena: 'x',
    archivo: { nombre: '../../etc/factura\u202Efdp.exe', tipo: 'text/html; charset=utf-8', datos: b64(new Uint8Array([0, 1, 2, 255])) },
  },
  {
    // El recorte a 200 unidades UTF-16 parte el emoji: la cabecera lleva un sustituto suelto («\ud83d»).
    nombre: 'nombre-sustituto-partido',
    texto: '',
    contrasena: null,
    archivo: { nombre: 'a'.repeat(199) + '😀.txt', tipo: '', datos: b64(new Uint8Array(3)) },
  },
  { nombre: 'bloque-16k', texto: 'ñ'.repeat(5000), contrasena: null },
  { nombre: 'vacio', texto: '', contrasena: null },
];

// Contraseña en NFD: la web la normaliza a NFC; la CLI debe negarse (no puede normalizar sin x/text).
const NFD: Entrada = { nombre: 'contrasena-nfd', texto: 'nfd', contrasena: 'man\u0303ana' };

const NOMBRES = [
  'informe.pdf',
  '../../etc/passwd',
  'C:\\Users\\ana\\clave.txt',
  'factura\u202Efdp.exe',
  'con\u0000trol\u0007.txt',
  '  ..oculto..  ',
  '...',
  '',
  '\u00a0\u3000nbsp\u2028',
  'a<b>c:d"e|f?g*h',
  'zero\u200bwidth\ufeff',
  'x'.repeat(250),
  'a'.repeat(199) + '😀',
  'emoji 😀 ok.png',
  'CON',
  'tab\tname',
];

const LIMITES = {
  padBuckets: PAD_BUCKETS,
  maxPaddedBytes: MAX_PADDED_BYTES,
  maxTextChars: MAX_TEXT_CHARS,
  maxFileBytes: MAX_FILE_BYTES,
  maxFileName: MAX_FILE_NAME,
  pbkdf2Iterations: PBKDF2_ITERATIONS,
  ttlOptions: [...TTL_OPTIONS],
  largeSecretBytes: LARGE_SECRET_BYTES,
  largeSecretMaxTtl: LARGE_SECRET_MAX_TTL,
  maxFailedAttempts: MAX_FAILED_ATTEMPTS,
  servidor: {
    padBuckets: server.PAD_BUCKETS,
    maxPaddedBytes: server.MAX_PADDED_BYTES,
    maxCiphertextB64: server.MAX_CIPHERTEXT_B64,
    ttlOptions: [...server.TTL_OPTIONS],
    largeSecretBytes: server.LARGE_SECRET_BYTES,
    largeSecretMaxTtl: server.LARGE_SECRET_MAX_TTL,
    minViews: server.MIN_VIEWS,
    maxViews: server.MAX_VIEWS,
    maxFailedAttempts: server.MAX_FAILED_ATTEMPTS,
  },
};

async function sellar(e: Entrada) {
  const payload = { text: e.texto, file: fileOf(e.archivo) };
  const s = await sealSecret(payload, e.contrasena ?? undefined);
  return { ...e, fragmento: s.fragment, ciphertext: s.ciphertext, verifier: s.verifier, linkVerifier: s.linkVerifier, link: s.proof.link, token: s.proof.token, esperado: jsonOf(await openSecret(s.ciphertext, parseFragment(s.fragment)!, e.contrasena ?? undefined)) };
}

async function pedir(e: Omit<Entrada, 'contrasena'>) {
  const req = await createRequestKeys();
  const payload = { text: e.texto, file: fileOf(e.archivo) };
  const sealed = await sealForRequest(payload, parseSendFragment(req.sendFragment)!);
  const handle = await preparePickup(parsePickupFragment(req.pickupFragment)!);
  return {
    ...e,
    sendFragment: req.sendFragment,
    pickupFragment: req.pickupFragment,
    sendVerifier: req.sendVerifier,
    openVerifier: req.openVerifier,
    sendProof: sealed.proof,
    openProof: handle.proof,
    ciphertext: sealed.ciphertext,
    ephemeral: sealed.ephemeral,
    esperado: jsonOf(await handle.open(sealed.ciphertext, sealed.ephemeral)),
  };
}

describe.runIf(process.env.RUNA_GENERAR_VECTORES)('genera cli/testdata/desde-ts.json', () => {
  it('escribe los vectores', { timeout: 60_000 }, async () => {
    const vectores = {
      aviso: 'Generado por apps/web/test/compat-go.test.ts (RUNA_GENERAR_VECTORES=1). No editar a mano.',
      limites: LIMITES,
      nombres: NOMBRES.map((entrada) => ({ entrada, salida: units(safeFileName(entrada)) })),
      secretos: await Promise.all(SECRETOS.map(sellar)),
      nfd: await sellar(NFD),
      peticiones: await Promise.all([
        pedir({ nombre: 'peticion-texto', texto: 'usuario: ana · clave: 7#kP!2' }),
        pedir({
          nombre: 'peticion-adjunto',
          texto: 'va el certificado',
          archivo: { nombre: 'cert.p12', tipo: 'application/x-pkcs12', datos: b64(crypto.getRandomValues(new Uint8Array(2000))) },
        }),
      ]),
    };
    fs.writeFileSync(`${TESTDATA}desde-ts.json`, JSON.stringify(vectores, null, 2) + '\n');
  });
});

describe('compatibilidad con la CLI en Go', () => {
  const desdeGoPath = `${TESTDATA}desde-go.json`;
  // Si falta, «hay vectores de la CLI» falla (y así se pueden generar los de la web la primera vez).
  const desdeGo = (fs.existsSync(desdeGoPath) ? JSON.parse(fs.readFileSync(desdeGoPath, 'utf8')) : { secretos: [], peticiones: [] }) as {
    secretos: (Entrada & { fragmento: string; ciphertext: string; verifier: string; linkVerifier: string; esperado: unknown })[];
    peticiones: (Omit<Entrada, 'contrasena'> & {
      sendFragment: string;
      pickupFragment: string;
      sendVerifier: string;
      openVerifier: string;
      ciphertext: string;
      ephemeral: string;
      esperado: unknown;
    })[];
  };

  it('hay vectores de la CLI', () => {
    expect(desdeGo.secretos.length).toBeGreaterThan(3);
    expect(desdeGo.peticiones.length).toBeGreaterThan(0);
  });

  it.each(desdeGo.secretos)('abre el secreto $nombre cifrado en Go', async (v) => {
    const link = parseFragment(v.fragmento);
    expect(link).not.toBeNull();
    const pass = v.contrasena ?? undefined;
    const opened = await openSecret(v.ciphertext, link!, pass);
    // Lo mismo que obtuvo Go al abrirlo (nombre y tipo saneados), y el texto original.
    expect(jsonOf(opened)).toEqual(v.esperado);
    expect(opened.text).toBe(v.texto);
    const proof = await accessProof(link!, pass);
    expect(await sha256Hex(proof.token)).toBe(v.verifier);
    expect(await sha256Hex(proof.link)).toBe(v.linkVerifier);
  });

  it.each(desdeGo.peticiones)('recoge la petición $nombre creada y rellenada en Go', async (v) => {
    const send = parseSendFragment(v.sendFragment);
    const pickup = parsePickupFragment(v.pickupFragment);
    expect(send).not.toBeNull();
    expect(pickup).not.toBeNull();
    const handle = await preparePickup(pickup!);
    expect(await sha256Hex(handle.proof)).toBe(v.openVerifier);
    const opened = await handle.open(v.ciphertext, v.ephemeral);
    expect(jsonOf(opened)).toEqual(v.esperado);
    expect(opened.text).toBe(v.texto);
    // La prueba de envío que derivaría la web para el enlace de Go coincide con lo que guarda el servidor.
    const resealed = await sealForRequest({ text: 'x' }, send!);
    expect(await sha256Hex(resealed.proof)).toBe(v.sendVerifier);
  });

  it('desde-ts.json está al día con los límites de la web y del servidor', () => {
    const desdeTs = JSON.parse(fs.readFileSync(`${TESTDATA}desde-ts.json`, 'utf8')) as { limites: unknown; nombres: unknown };
    expect(desdeTs.limites).toEqual(LIMITES);
    expect(desdeTs.nombres).toEqual(NOMBRES.map((entrada) => ({ entrada, salida: units(safeFileName(entrada)) })));
  });
});
