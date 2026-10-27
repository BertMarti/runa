import { createHash, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_FAILED_ATTEMPTS } from '../src/limits.js';
import { REQUEST_ROW_BYTES, SecretStore } from '../src/store.js';

const sha = (b: Buffer) => createHash('sha256').update(b).digest();
const token = randomBytes(32);
const link = randomBytes(32);
const verifier = sha(token);
const linkVerifier = sha(link);
const proof = { link, token };
const wrongToken = () => ({ link, token: randomBytes(32) });
const wrongLink = () => ({ link: randomBytes(32), token });
const ciphertext = randomBytes(1052);

let clock = 1_000_000;
let store: SecretStore;

function fresh(): SecretStore {
  clock = 1_000_000;
  store = new SecretStore(':memory:', () => clock);
  return store;
}

afterEach(() => store?.close());

describe('SecretStore', () => {
  it('entrega el cifrado una vez y lo borra', () => {
    const s = fresh();
    const { id } = s.create({ ciphertext, verifier, linkVerifier, ttlSeconds: 60, maxViews: 1 });
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const first = s.open(id, proof);
    expect(first).toMatchObject({ status: 'ok', viewsLeft: 0 });
    if (first.status === 'ok') expect(first.ciphertext.equals(ciphertext)).toBe(true);
    expect(s.open(id, proof)).toEqual({ status: 'not_found' });
    expect(s.count()).toBe(0);
  });

  it('descuenta visualizaciones hasta agotarlas', () => {
    const s = fresh();
    const { id } = s.create({ ciphertext, verifier, linkVerifier, ttlSeconds: 60, maxViews: 3 });
    expect(s.open(id, proof)).toMatchObject({ viewsLeft: 2 });
    expect(s.open(id, proof)).toMatchObject({ viewsLeft: 1 });
    expect(s.open(id, proof)).toMatchObject({ viewsLeft: 0 });
    expect(s.open(id, proof).status).toBe('not_found');
  });

  it('un token incorrecto no consume visualizaciones', () => {
    const s = fresh();
    const { id } = s.create({ ciphertext, verifier, linkVerifier, ttlSeconds: 60, maxViews: 1 });
    expect(s.open(id, wrongToken())).toEqual({ status: 'denied', attemptsLeft: MAX_FAILED_ATTEMPTS - 1 });
    expect(s.open(id, proof).status).toBe('ok');
  });

  it(`destruye el secreto tras ${MAX_FAILED_ATTEMPTS} intentos fallidos`, () => {
    const s = fresh();
    const { id } = s.create({ ciphertext, verifier, linkVerifier, ttlSeconds: 60, maxViews: 5 });
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
      expect(s.open(id, wrongToken())).toEqual({ status: 'denied', attemptsLeft: MAX_FAILED_ATTEMPTS - i });
    }
    expect(s.open(id, wrongToken())).toEqual({ status: 'denied', attemptsLeft: 0 });
    expect(s.open(id, proof)).toEqual({ status: 'not_found' });
  });

  it('sin la prueba de enlace responde «no existe» y no cuenta el intento', () => {
    const s = fresh();
    const { id } = s.create({ ciphertext, verifier, linkVerifier, ttlSeconds: 60, maxViews: 1 });
    for (let i = 0; i < MAX_FAILED_ATTEMPTS * 3; i++) {
      expect(s.open(id, wrongLink())).toEqual({ status: 'not_found' });
      expect(s.burn(id, wrongLink())).toBe('not_found');
    }
    expect(s.open(id, wrongToken())).toEqual({ status: 'denied', attemptsLeft: MAX_FAILED_ATTEMPTS - 1 });
    expect(s.open(id, proof).status).toBe('ok');
  });

  it('un acierto reinicia los intentos fallidos', () => {
    const s = fresh();
    const { id } = s.create({ ciphertext, verifier, linkVerifier, ttlSeconds: 60, maxViews: 3 });
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) s.open(id, wrongToken());
    expect(s.open(id, proof).status).toBe('ok');
    expect(s.open(id, wrongToken())).toEqual({ status: 'denied', attemptsLeft: MAX_FAILED_ATTEMPTS - 1 });
  });

  it('caduca a su hora aunque no se haya purgado', () => {
    const s = fresh();
    const { id } = s.create({ ciphertext, verifier, linkVerifier, ttlSeconds: 60, maxViews: 1 });
    clock += 60_000;
    expect(s.open(id, proof)).toEqual({ status: 'not_found' });
    expect(s.count()).toBe(0);
  });

  it('purga los caducados y conserva los vivos', () => {
    const s = fresh();
    s.create({ ciphertext, verifier, linkVerifier, ttlSeconds: 300, maxViews: 1 });
    s.create({ ciphertext, verifier, linkVerifier, ttlSeconds: 3600, maxViews: 1 });
    clock += 301_000;
    expect(s.purgeExpired()).toBe(1);
    expect(s.count()).toBe(1);
  });

  it('burn exige el token y borra', () => {
    const s = fresh();
    const { id } = s.create({ ciphertext, verifier, linkVerifier, ttlSeconds: 60, maxViews: 5 });
    expect(s.burn(id, wrongToken())).toBe('denied');
    expect(s.burn(id, proof)).toBe('ok');
    expect(s.burn(id, proof)).toBe('not_found');
  });

  it('cuenta los bytes ocupados', () => {
    const s = fresh();
    s.create({ ciphertext, verifier, linkVerifier, ttlSeconds: 60, maxViews: 1 });
    s.create({ ciphertext, verifier, linkVerifier, ttlSeconds: 60, maxViews: 1 });
    expect(s.usedBytes()).toBe(ciphertext.length * 2);
  });
});

describe('peticiones en el almacén', () => {
  it('cuentan en el espacio usado y se purgan al caducar', () => {
    const s = fresh();
    const send = Buffer.alloc(32, 1);
    const { id } = s.createRequest({ sendVerifier: sha(send), openVerifier: sha(Buffer.alloc(32, 2)), ttlSeconds: 60 });
    // Una petición vacía también cuenta (verificadores y metadatos): crear muchas no sale gratis.
    expect(s.usedBytes()).toBe(REQUEST_ROW_BYTES);
    expect(s.fillRequest(id, send, ciphertext, Buffer.alloc(32))).toMatchObject({ status: 'ok' });
    expect(s.usedBytes()).toBe(ciphertext.length + REQUEST_ROW_BYTES);
    clock += 61_000;
    expect(s.purgeExpired()).toBe(1);
    expect(s.usedBytes()).toBe(0);
  });
});

describe('peticiones caducadas', () => {
  it('no existen para rellenar, recoger ni cancelar', () => {
    const s = fresh();
    const send = Buffer.alloc(32, 3);
    const open = Buffer.alloc(32, 4);
    const { id } = s.createRequest({ sendVerifier: sha(send), openVerifier: sha(open), ttlSeconds: 60 });
    clock += 61_000;
    expect(s.peekFill(id, send)).toBe('not_found');
    expect(s.fillRequest(id, send, ciphertext, Buffer.alloc(32))).toEqual({ status: 'not_found' });
    expect(s.pickupRequest(id, open)).toEqual({ status: 'not_found' });
    expect(s.cancelRequest(id, open)).toBe('not_found');
  });
});
