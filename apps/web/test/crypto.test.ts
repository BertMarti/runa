import { describe, expect, it } from 'vitest';
import {
  accessProof,
  formatFragment,
  MAX_FILE_BYTES,
  MAX_TEXT_CHARS,
  openSecret,
  parseFragment,
  PayloadTooLargeError,
  safeFileName,
  sealSecret,
  type LinkKey,
} from '../src/crypto';
import { fromBase64Url, toBase64Url } from '../src/crypto/encoding';
import { decodePayload, encodePayload } from '../src/crypto/envelope';

async function sha256Hex(hex: string): Promise<string> {
  const bytes = new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

function linkOf(fragment: string): LinkKey {
  const link = parseFragment(fragment);
  if (!link) throw new Error('fragmento no válido');
  return link;
}

describe('protocolo v1', () => {
  it('cifra y descifra texto con la clave del enlace', async () => {
    const sealed = await sealSecret({ text: 'contraseña: hunter2 ✓' });
    const opened = await openSecret(sealed.ciphertext, linkOf(sealed.fragment));
    expect(opened).toEqual({ text: 'contraseña: hunter2 ✓' });
  });

  it('los verificadores son el SHA-256 de las pruebas de acceso', async () => {
    const sealed = await sealSecret({ text: 'x' });
    const proof = await accessProof(linkOf(sealed.fragment));
    expect(proof.token).toMatch(/^[0-9a-f]{64}$/);
    expect(proof.link).toMatch(/^[0-9a-f]{64}$/);
    expect(proof.link).not.toBe(proof.token);
    expect(await sha256Hex(proof.token)).toBe(sealed.verifier);
    expect(await sha256Hex(proof.link)).toBe(sealed.linkVerifier);
  });

  it('sealSecret devuelve las mismas pruebas que deriva quien recibe', async () => {
    const sealed = await sealSecret({ text: 'x' }, 'clave');
    expect(sealed.proof).toEqual(await accessProof(linkOf(sealed.fragment), 'clave'));
    expect(await sha256Hex(sealed.proof.token)).toBe(sealed.verifier);
  });

  it('nada de lo que se sube contiene la clave del enlace', async () => {
    const sealed = await sealSecret({ text: 'secreto' });
    const key = sealed.fragment.split('.')[1]!;
    expect(sealed.ciphertext).not.toContain(key);
    expect(sealed.verifier).not.toContain(key);
    expect(sealed.linkVerifier).not.toContain(key);
    expect(sealed.ciphertext).not.toContain(toBase64Url(new TextEncoder().encode('secreto')));
  });

  it('cada cifrado usa clave e IV nuevos', async () => {
    const a = await sealSecret({ text: 'igual' });
    const b = await sealSecret({ text: 'igual' });
    expect(a.fragment).not.toBe(b.fragment);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.ciphertext.slice(0, 16)).not.toBe(b.ciphertext.slice(0, 16));
  });

  it('detecta cualquier alteración del cifrado', async () => {
    const sealed = await sealSecret({ text: 'íntegro' });
    const bytes = fromBase64Url(sealed.ciphertext);
    bytes[bytes.length - 20]! ^= 0x01;
    await expect(openSecret(toBase64Url(bytes), linkOf(sealed.fragment))).rejects.toThrow();
  });

  it('una clave distinta no descifra', async () => {
    const a = await sealSecret({ text: 'a' });
    const b = await sealSecret({ text: 'b' });
    await expect(openSecret(a.ciphertext, linkOf(b.fragment))).rejects.toThrow();
  });

  it('rellena hasta bloques fijos para ocultar la longitud', async () => {
    const short = await sealSecret({ text: 'a' });
    const longer = await sealSecret({ text: 'a'.repeat(900) });
    expect(fromBase64Url(short.ciphertext).length).toBe(1024 + 12 + 16);
    expect(fromBase64Url(longer.ciphertext).length).toBe(1024 + 12 + 16);
  });

  it('transporta un archivo binario intacto', async () => {
    const data = crypto.getRandomValues(new Uint8Array(50_000));
    const sealed = await sealSecret({ text: '', file: { name: 'clave.pem', type: 'application/x-pem-file', data } });
    const opened = await openSecret(sealed.ciphertext, linkOf(sealed.fragment));
    expect(opened.file?.name).toBe('clave.pem');
    expect(opened.file?.type).toBe('application/x-pem-file');
    expect(opened.file?.data).toEqual(data);
  });

  it('rechaza secretos demasiado grandes', async () => {
    await expect(sealSecret({ text: 'a'.repeat(MAX_TEXT_CHARS + 1) })).rejects.toBeInstanceOf(PayloadTooLargeError);
    const big = new Uint8Array(MAX_FILE_BYTES + 1);
    await expect(sealSecret({ text: '', file: { name: 'a', type: 'x/y', data: big } })).rejects.toBeInstanceOf(
      PayloadTooLargeError,
    );
  });
});

describe('contraseña opcional', () => {
  it('requiere la contraseña correcta', async () => {
    const sealed = await sealSecret({ text: 'con contraseña' }, 'caballo correcto batería grapa');
    const link = linkOf(sealed.fragment);
    expect(link.hasPassphrase).toBe(true);
    expect(sealed.fragment.endsWith('.p')).toBe(true);

    const opened = await openSecret(sealed.ciphertext, link, 'caballo correcto batería grapa');
    expect(opened.text).toBe('con contraseña');
    await expect(openSecret(sealed.ciphertext, link, 'otra')).rejects.toThrow();
    await expect(openSecret(sealed.ciphertext, link)).rejects.toThrow('Contraseña requerida');
  });

  it('una contraseña incorrecta conserva la prueba de enlace pero no el token', async () => {
    const sealed = await sealSecret({ text: 'x' }, 'buena');
    const link = linkOf(sealed.fragment);
    const good = await accessProof(link, 'buena');
    const bad = await accessProof(link, 'mala');
    expect(await sha256Hex(good.token)).toBe(sealed.verifier);
    expect(await sha256Hex(bad.token)).not.toBe(sealed.verifier);
    // El servidor reconoce el enlace (cuenta el intento) solo porque K es correcta.
    expect(await sha256Hex(bad.link)).toBe(sealed.linkVerifier);
  });

  it('normaliza Unicode (NFC) para que la misma contraseña escrita distinto funcione', async () => {
    const sealed = await sealSecret({ text: 'ñ' }, 'pin\u0303a'); // «ñ» descompuesta
    const opened = await openSecret(sealed.ciphertext, linkOf(sealed.fragment), 'piña');
    expect(opened.text).toBe('ñ');
  });

  it('quitar la marca de contraseña del enlace no permite descifrar', async () => {
    const sealed = await sealSecret({ text: 'x' }, 'clave');
    const stripped = linkOf(sealed.fragment.replace(/\.p$/, ''));
    await expect(openSecret(sealed.ciphertext, stripped)).rejects.toThrow();
  });
});

describe('fragmento del enlace', () => {
  it('ida y vuelta', () => {
    const link: LinkKey = { key: new Uint8Array(32).fill(7), hasPassphrase: false };
    expect(parseFragment(`#${formatFragment(link)}`)).toEqual(link);
  });

  it.each(['', '#', '#v2.abc', '#v1.corta', `#v1.${'A'.repeat(43)}.x`, `#v1.${'A'.repeat(44)}`, '#v1.<script>'])(
    'rechaza %s',
    (hash) => {
      expect(parseFragment(hash)).toBeNull();
    },
  );
});

describe('envoltorio', () => {
  it('rechaza cabeceras con longitudes imposibles', () => {
    const bytes = encodePayload({ text: 'hola' });
    new DataView(bytes.buffer).setUint32(0, 0xffffffff, false);
    expect(() => decodePayload(bytes)).toThrow('Formato no válido');
  });

  it('rechaza un archivo que dice ser más grande que el bloque', () => {
    const json = new TextEncoder().encode(JSON.stringify({ text: '', file: { name: 'a', type: 'a/b', size: 5000 } }));
    const bytes = new Uint8Array(1024);
    new DataView(bytes.buffer).setUint32(0, json.length, false);
    bytes.set(json, 4);
    expect(() => decodePayload(bytes)).toThrow('Formato no válido');
  });

  it('limpia nombres de archivo peligrosos', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\Windows\\evil.exe')).toBe('evil.exe');
    expect(safeFileName('.bashrc')).toBe('bashrc');
    expect(safeFileName('a\u0000b<c>.txt')).toBe('a_b_c_.txt');
    expect(safeFileName('')).toBe('archivo');
    expect(safeFileName('factura\u202efdp.exe')).toBe('facturafdp.exe');
    expect(safeFileName('a\u200bb.txt')).toBe('ab.txt');
    expect(safeFileName('informe.pdf. . ')).toBe('informe.pdf');
  });

  it('nunca conserva un tipo MIME malformado', () => {
    const bytes = encodePayload({ text: '', file: { name: 'x', type: 'text/html; charset=x"<', data: new Uint8Array(1) } });
    expect(decodePayload(bytes).file?.type).toBe('application/octet-stream');
  });
});
