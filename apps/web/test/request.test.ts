import { describe, expect, it } from 'vitest';
import { createRequestKeys, parsePickupFragment, parseSendFragment, preparePickup, sealForRequest } from '../src/crypto';
import { toBase64Url } from '../src/crypto/encoding';

const payload = { text: 'usuario: ana · clave: 7#kP!2' };

async function nueva() {
  const req = await createRequestKeys();
  return { req, send: parseSendFragment(req.sendFragment)!, pickup: parsePickupFragment(`#${req.pickupFragment}`)! };
}

describe('pedir un secreto', () => {
  it('quien pide recupera lo que le envían', async () => {
    const { send, pickup } = await nueva();
    const sealed = await sealForRequest(payload, send);
    const handle = await preparePickup(pickup);
    expect(await handle.open(sealed.ciphertext, sealed.ephemeral)).toEqual(payload);
  });

  it('las pruebas coinciden con los verificadores y son distintas entre sí', async () => {
    const { req, send, pickup } = await nueva();
    const sha = async (hex: string) =>
      Buffer.from(await crypto.subtle.digest('SHA-256', Buffer.from(hex, 'hex'))).toString('hex');
    const sealed = await sealForRequest(payload, send);
    const handle = await preparePickup(pickup);
    expect(await sha(sealed.proof)).toBe(req.sendVerifier);
    expect(await sha(handle.proof)).toBe(req.openVerifier);
    expect(sealed.proof).not.toBe(handle.proof);
  });

  it('otra petición (otra clave privada) no puede abrirlo', async () => {
    const a = await nueva();
    const b = await nueva();
    const sealed = await sealForRequest(payload, a.send);
    await expect((await preparePickup(b.pickup)).open(sealed.ciphertext, sealed.ephemeral)).rejects.toThrow();
  });

  it('detecta cualquier alteración del cifrado o de la clave efímera', async () => {
    const { send, pickup } = await nueva();
    const sealed = await sealForRequest(payload, send);
    const handle = await preparePickup(pickup);
    const bytes = Buffer.from(sealed.ciphertext, 'base64url');
    bytes[20] = bytes[20]! ^ 1;
    await expect(handle.open(bytes.toString('base64url'), sealed.ephemeral)).rejects.toThrow();
    const other = await sealForRequest(payload, send);
    await expect(handle.open(sealed.ciphertext, other.ephemeral)).rejects.toThrow();
  });

  it('cada envío usa una clave efímera nueva', async () => {
    const { send } = await nueva();
    const [x, y] = await Promise.all([sealForRequest(payload, send), sealForRequest(payload, send)]);
    expect(x.ephemeral).not.toBe(y.ephemeral);
    expect(x.ciphertext).not.toBe(y.ciphertext);
  });

  it('rechaza claves públicas de orden pequeño', async () => {
    await expect(sealForRequest(payload, { pub: new Uint8Array(32) })).rejects.toThrow();
  });

  it('valida los fragmentos', () => {
    expect(parseSendFragment('v1.' + toBase64Url(new Uint8Array(32)))).not.toBeNull();
    expect(parseSendFragment('v1.' + toBase64Url(new Uint8Array(31)))).toBeNull();
    expect(parseSendFragment('v2.' + toBase64Url(new Uint8Array(32)))).toBeNull();
    expect(parsePickupFragment('v1.' + toBase64Url(new Uint8Array(48)))).not.toBeNull();
    expect(parsePickupFragment('v1.' + toBase64Url(new Uint8Array(32)))).toBeNull();
    expect(parsePickupFragment('v1.' + 'a'.repeat(64) + '.p')).toBeNull();
  });
});
