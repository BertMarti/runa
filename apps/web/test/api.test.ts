import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, burnRemote, createSecret, openRemote } from '../src/api';

const ID = 'AbCdEfGhIjKlMnOpQrStUv';
const TOKEN = { link: 'c'.repeat(64), token: 'a'.repeat(64) };

const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  }
  throw new Error('se esperaba un error');
}

const createReq = {
  ciphertext: 'x'.repeat(40),
  verifier: 'b'.repeat(64),
  linkVerifier: 'd'.repeat(64),
  ttl: 3600,
  views: 1,
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createSecret', () => {
  it('envía JSON sin cookies, sin caché y sin Referer', async () => {
    fetchMock.mockResolvedValue(json(201, { id: ID, expiresAt: '2030-01-01T00:00:00.000Z' }));
    const res = await createSecret(createReq);

    expect(res.id).toBe(ID);
    expect(res.expiresAt.toISOString()).toBe('2030-01-01T00:00:00.000Z');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/secrets');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(String(init?.body))).toEqual(createReq);
  });

  it.each([
    [400, { error: 'invalid_request' }, 'invalid_request'],
    [413, { error: 'too_large' }, 'too_large'],
    [507, { error: 'storage_full' }, 'storage_full'],
    [500, { error: 'internal_error' }, 'server'],
    [502, 'no es json', 'server'],
  ] as const)('HTTP %i → %s', async (status, body, code) => {
    fetchMock.mockResolvedValue(json(status, body));
    expect((await caught(createSecret(createReq))).code).toBe(code);
  });

  it('429 conserva los segundos de espera', async () => {
    fetchMock.mockResolvedValue(json(429, { error: 'rate_limited', retryAfterSeconds: 42 }));
    const err = await caught(createSecret(createReq));
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfterSeconds).toBe(42);
  });

  it('un fallo de red es `network`', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect((await caught(createSecret(createReq))).code).toBe('network');
  });

  it('rechaza una respuesta con un id mal formado', async () => {
    fetchMock.mockResolvedValue(json(201, { id: '../../etc', expiresAt: '2030-01-01T00:00:00.000Z' }));
    expect((await caught(createSecret(createReq))).code).toBe('server');
  });
});

describe('openRemote', () => {
  it('devuelve cifrado y lecturas restantes', async () => {
    fetchMock.mockResolvedValue(json(200, { ciphertext: 'AbC-_9', viewsLeft: 0 }));
    await expect(openRemote(ID, TOKEN)).resolves.toEqual({ ciphertext: 'AbC-_9', viewsLeft: 0 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/secrets/${ID}/open`);
    expect(JSON.parse(String(init?.body))).toEqual({ link: TOKEN.link, token: TOKEN.token });
  });

  it('403 trae los intentos restantes', async () => {
    fetchMock.mockResolvedValue(json(403, { error: 'denied', attemptsLeft: 3 }));
    const err = await caught(openRemote(ID, TOKEN));
    expect(err.code).toBe('denied');
    expect(err.attemptsLeft).toBe(3);
  });

  it('403 con 0 intentos (destruido)', async () => {
    fetchMock.mockResolvedValue(json(403, { error: 'denied', attemptsLeft: 0 }));
    expect((await caught(openRemote(ID, TOKEN))).attemptsLeft).toBe(0);
  });

  it('404 es `not_found`', async () => {
    fetchMock.mockResolvedValue(json(404, { error: 'not_found' }));
    expect((await caught(openRemote(ID, TOKEN))).code).toBe('not_found');
  });

  it('no llama a la red con un id no válido', async () => {
    expect((await caught(openRemote('../secrets', TOKEN))).code).toBe('not_found');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rechaza un cuerpo inesperado', async () => {
    fetchMock.mockResolvedValue(json(200, { ciphertext: '<script>', viewsLeft: 1 }));
    expect((await caught(openRemote(ID, TOKEN))).code).toBe('server');
  });
});

describe('burnRemote', () => {
  it('204 resuelve', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(burnRemote(ID, TOKEN)).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/secrets/${ID}/burn`);
  });

  it('403 y 404 se tipan', async () => {
    fetchMock.mockResolvedValueOnce(json(403, { error: 'denied' }));
    expect((await caught(burnRemote(ID, TOKEN))).code).toBe('denied');
    fetchMock.mockResolvedValueOnce(json(404, { error: 'not_found' }));
    expect((await caught(burnRemote(ID, TOKEN))).code).toBe('not_found');
  });
});
