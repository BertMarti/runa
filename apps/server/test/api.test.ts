import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, clientIp, rateLimitKey } from '../src/app.js';
import { loadConfig, parseNetworks, type Config } from '../src/config.js';
import { MAX_CIPHERTEXT_BYTES } from '../src/limits.js';
import { SecretStore } from '../src/store.js';

const webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runa-web-'));

function config(overrides: Partial<Config> = {}): Config {
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir: '',
    publicDir: webDir,
    trustProxy: false,
    maxStorageBytes: 64 * 1024 * 1024,
    createRateLimit: 1000,
    openRateLimit: 1000,
    logLevel: 'silent',
    hsts: false,
    createFrom: null,
    publicUrl: null,
    ...overrides,
  };
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function body(overrides: Record<string, unknown> = {}) {
  const token = randomBytes(32);
  const link = randomBytes(32);
  return {
    proof: { link: link.toString('hex'), token: token.toString('hex') },
    payload: {
      ciphertext: randomBytes(1052).toString('base64url'),
      verifier: sha(token),
      linkVerifier: sha(link),
      ttl: 3600,
      views: 1,
      ...overrides,
    },
  };
}

const hex = () => randomBytes(32).toString('hex');

let app: FastifyInstance;
let store: SecretStore;

beforeAll(() => {
  fs.mkdirSync(path.join(webDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>RUNA</title>');
  fs.writeFileSync(path.join(webDir, 'assets', 'app-abc.js'), 'console.log(1)');
});
afterAll(() => fs.rmSync(webDir, { recursive: true, force: true }));

beforeEach(async () => {
  store = new SecretStore(':memory:');
  app = await buildApp(config(), store);
});
afterEach(async () => {
  await app.close();
  store.close();
});

async function create(payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/secrets', payload });
}

describe('ciclo de vida', () => {
  it('crea, abre una vez y después responde 404', async () => {
    const { proof, payload } = body();
    const created = await create(payload);
    expect(created.statusCode).toBe(201);
    const { id, expiresAt } = created.json<{ id: string; expiresAt: string }>();
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());

    const opened = await app.inject({ method: 'POST', url: `/api/secrets/${id}/open`, payload: proof });
    expect(opened.statusCode).toBe(200);
    expect(opened.json()).toEqual({ ciphertext: payload.ciphertext, viewsLeft: 0 });

    const again = await app.inject({ method: 'POST', url: `/api/secrets/${id}/open`, payload: proof });
    expect(again.statusCode).toBe(404);
    expect(again.json()).toEqual({ error: 'not_found' });
  });

  it('403 con intentos restantes si el token no es el correcto', async () => {
    const { proof, payload } = body();
    const { id } = (await create(payload)).json<{ id: string }>();
    const res = await app.inject({
      method: 'POST',
      url: `/api/secrets/${id}/open`,
      payload: { link: proof.link, token: hex() },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'denied', attemptsLeft: 4 });
  });

  it('con solo el id no se puede agotar los intentos ni quemar el secreto', async () => {
    const { proof, payload } = body();
    const { id } = (await create(payload)).json<{ id: string }>();
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({ method: 'POST', url: `/api/secrets/${id}/open`, payload: { link: hex(), token: hex() } });
      expect(res.statusCode).toBe(404);
      const burn = await app.inject({ method: 'POST', url: `/api/secrets/${id}/burn`, payload: { link: hex(), token: hex() } });
      expect(burn.statusCode).toBe(404);
    }
    const ok = await app.inject({ method: 'POST', url: `/api/secrets/${id}/open`, payload: proof });
    expect(ok.statusCode).toBe(200);
  });

  it('burn borra el secreto', async () => {
    const { proof, payload } = body({ views: 5 });
    const { id } = (await create(payload)).json<{ id: string }>();
    expect((await app.inject({ method: 'POST', url: `/api/secrets/${id}/burn`, payload: proof })).statusCode).toBe(
      204,
    );
    expect((await app.inject({ method: 'POST', url: `/api/secrets/${id}/open`, payload: proof })).statusCode).toBe(
      404,
    );
  });

  it('un id inexistente y uno ya leído son indistinguibles', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/secrets/${'A'.repeat(22)}/open`,
      payload: { link: 'a'.repeat(64), token: 'a'.repeat(64) },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });
});

describe('validación', () => {
  it.each([
    ['ttl no permitido', { ttl: 1234 }],
    ['ttl como texto', { ttl: '3600' }],
    ['0 vistas', { views: 0 }],
    ['demasiadas vistas', { views: 11 }],
    ['verificador corto', { verifier: 'abc' }],
    ['verificador en mayúsculas', { verifier: 'A'.repeat(64) }],
    ['cifrado con caracteres fuera de base64url', { ciphertext: `${'a'.repeat(1400)}+/=` }],
    ['cifrado demasiado corto', { ciphertext: randomBytes(100).toString('base64url') }],
    ['cifrado que no mide un bloque exacto', { ciphertext: randomBytes(2000).toString('base64url') }],
    ['sin verificador de enlace', { linkVerifier: undefined }],
    ['campos extra', { extra: true }],
  ])('400 con %s', async (_name, overrides) => {
    const res = await create(body(overrides).payload);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
  });

  it('400 si falta un campo', async () => {
    const { payload } = body();
    const { ciphertext: _omit, ...rest } = payload;
    expect((await create(rest)).statusCode).toBe(400);
  });

  it('rechaza cuerpos que superan el máximo', async () => {
    const huge = randomBytes(MAX_CIPHERTEXT_BYTES + 4096).toString('base64url');
    const res = await create(body({ ciphertext: huge }).payload);
    expect([400, 413]).toContain(res.statusCode);
  });

  it('acepta el cifrado de tamaño máximo', async () => {
    const max = randomBytes(MAX_CIPHERTEXT_BYTES).toString('base64url');
    expect((await create(body({ ciphertext: max }).payload)).statusCode).toBe(201);
  });

  it('400 con un id con formato no válido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/secrets/../../etc/open',
      payload: { link: 'a'.repeat(64), token: 'a'.repeat(64) },
    });
    expect([400, 404]).toContain(res.statusCode);
  });

  it('no filtra detalles internos en los errores', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/secrets',
      headers: { 'content-type': 'application/json' },
      payload: '{"roto":',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toMatch(/stack|at |node_modules/);
  });
});

describe('cabeceras de seguridad', () => {
  it('CSP estricta y cabeceras defensivas en la web', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("require-trusted-types-for 'script'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(res.headers['permissions-policy']).toContain('camera=()');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('la API no se cachea', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('las páginas de secreto no se indexan y sirven la SPA', async () => {
    const res = await app.inject({ method: 'GET', url: '/s/AAAAAAAAAAAAAAAAAAAAAA' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(res.body).toContain('RUNA');
  });

  it('los recursos con hash se cachean como inmutables', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/app-abc.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('HSTS solo cuando se activa', async () => {
    expect((await app.inject({ method: 'GET', url: '/' })).headers['strict-transport-security']).toBeUndefined();
    const secure = await buildApp(config({ hsts: true }), store);
    const res = await secure.inject({ method: 'GET', url: '/' });
    expect(res.headers['strict-transport-security']).toContain('max-age=63072000');
    await secure.close();
  });

  it.each(['/api/nada', '/api', '/api?x=1'])('%s devuelve 404 JSON, no la SPA', async (url) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });

  it('HSTS no inscribe el dominio en la lista de precarga', async () => {
    const secure = await buildApp(config({ hsts: true }), store);
    const res = await secure.inject({ method: 'GET', url: '/' });
    expect(res.headers['strict-transport-security']).not.toContain('preload');
    await secure.close();
  });
});

describe('protecciones de abuso', () => {
  it('la web estática no consume el límite de peticiones', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/app-abc.js' });
    expect(res.headers['x-ratelimit-remaining']).toBeUndefined();
    const api = await app.inject({ method: 'GET', url: '/api/health' });
    expect(api.statusCode).toBe(200);
  });

  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '::ffff:203.0.113.7'],
    ['2001:db8:1:2:aaaa:bbbb:cccc:dddd', '2001:db8:1:2::/64'],
    ['2001:db8:1:2::1', '2001:db8:1:2::/64'],
    ['2001:DB8:0001:0002:0:0:0:9', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
  ])('agrupa %s como %s', (ip, key) => {
    expect(rateLimitKey(ip)).toBe(key);
  });

  it('limita la creación por IP', async () => {
    const limited = await buildApp(config({ createRateLimit: 2 }), store);
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) {
      codes.push((await limited.inject({ method: 'POST', url: '/api/secrets', payload: body().payload })).statusCode);
    }
    expect(codes).toEqual([201, 201, 429]);
    await limited.close();
  });

  it('507 cuando se llena el almacenamiento', async () => {
    const tiny = await buildApp(config({ maxStorageBytes: 1500 }), store);
    expect((await tiny.inject({ method: 'POST', url: '/api/secrets', payload: body().payload })).statusCode).toBe(201);
    const full = await tiny.inject({ method: 'POST', url: '/api/secrets', payload: body().payload });
    expect(full.statusCode).toBe(507);
    expect(full.json()).toEqual({ error: 'storage_full' });
    await tiny.close();
  });
});

describe('despliegue tras un túnel (CREATE_FROM, PUBLIC_URL)', () => {
  // Como en ARIA: cloudflared y Caddy en la red de Docker (172.16/12), la LAN en 192.168/16.
  const tunnel = { createFrom: ['172.16.0.0/12', '192.168.0.0/16'], trustProxy: '172.16.0.0/12' };
  const CONECTOR = '172.18.0.9';
  let homelab: FastifyInstance;

  beforeEach(async () => {
    homelab = await buildApp(config({ ...tunnel, publicUrl: 'https://runa.example.com' }), store);
  });
  afterEach(async () => {
    await homelab.close();
  });

  const crear = (remoteAddress: string, headers: Record<string, string> = {}) =>
    homelab.inject({ method: 'POST', url: '/api/secrets', payload: body().payload, remoteAddress, headers });

  it('ARIA (red de Docker) y la LAN a través de Caddy pueden crear', async () => {
    expect((await crear('172.18.0.3')).statusCode).toBe(201);
    expect((await crear('172.18.0.4', { 'x-forwarded-for': '192.168.1.20' })).statusCode).toBe(201);
  });

  it('por el túnel no se crea, aunque el cliente falsifique X-Forwarded-For', async () => {
    // Cloudflare añade la IP real al final de lo que mande el cliente.
    const spoof = { 'x-forwarded-for': '192.168.1.5, 203.0.113.9', 'cf-connecting-ip': '203.0.113.9', 'cf-ray': 'abc-MAD' };
    const res = await crear(CONECTOR, spoof);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'create_forbidden' });
    // Sin cabeceras de Cloudflare: la IP es la de más a la derecha que no es de confianza (la real).
    expect((await crear(CONECTOR, { 'x-forwarded-for': '192.168.1.5, 203.0.113.9' })).statusCode).toBe(403);
  });

  it('desde fuera se rechaza antes de leer el cuerpo (ni se valida ni se recibe entero)', async () => {
    const res = await homelab.inject({
      method: 'POST',
      url: '/api/secrets',
      payload: { basura: 'x'.repeat(100_000) },
      remoteAddress: CONECTOR,
      headers: { 'cf-connecting-ip': '203.0.113.9' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'create_forbidden' });
  });

  it('con TRUST_PROXY mal configurado, las cabeceras de Cloudflare siguen bloqueando la creación', async () => {
    const mal = await buildApp(config({ ...tunnel, trustProxy: false }), store);
    const res = await mal.inject({
      method: 'POST',
      url: '/api/secrets',
      payload: body().payload,
      remoteAddress: CONECTOR, // la IP del conector está en la red de confianza…
      headers: { 'cf-ray': 'abc-MAD' }, // …pero viene por Cloudflare
    });
    expect(res.statusCode).toBe(403);
    await mal.close();
  });

  it('desde fuera sí se lee: abrir funciona por el túnel', async () => {
    const { proof, payload } = body();
    const created = await homelab.inject({ method: 'POST', url: '/api/secrets', payload, remoteAddress: '172.18.0.3' });
    const { id } = created.json<{ id: string }>();
    const res = await homelab.inject({
      method: 'POST',
      url: `/api/secrets/${id}/open`,
      payload: proof,
      remoteAddress: CONECTOR,
      headers: { 'cf-connecting-ip': '203.0.113.9', 'cf-ray': 'abc-MAD' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('/api/config dice a la web el dominio de los enlaces y si puede crear', async () => {
    const dentro = await homelab.inject({ method: 'GET', url: '/api/config', remoteAddress: '172.18.0.4', headers: { 'x-forwarded-for': '192.168.1.20' } });
    expect(dentro.json()).toEqual({ publicUrl: 'https://runa.example.com', createAllowed: true });
    const fuera = await homelab.inject({ method: 'GET', url: '/api/config', remoteAddress: CONECTOR, headers: { 'cf-connecting-ip': '203.0.113.9' } });
    expect(fuera.json()).toEqual({ publicUrl: 'https://runa.example.com', createAllowed: false });
    expect(fuera.headers['cache-control']).toBe('no-store');
  });

  it('el límite de lectura va por la IP real de cada cliente del túnel', async () => {
    const limitado = await buildApp(config({ ...tunnel, openRateLimit: 2 }), store);
    const abrir = (ip: string) =>
      limitado.inject({
        method: 'POST',
        url: `/api/secrets/${'A'.repeat(22)}/open`,
        payload: { link: 'a'.repeat(64), token: 'a'.repeat(64) },
        remoteAddress: CONECTOR,
        headers: { 'cf-connecting-ip': ip },
      });
    expect([(await abrir('203.0.113.1')).statusCode, (await abrir('203.0.113.1')).statusCode]).toEqual([404, 404]);
    expect((await abrir('203.0.113.1')).statusCode).toBe(429);
    expect((await abrir('198.51.100.7')).statusCode).toBe(404); // otro cliente, otro contador
    await limitado.close();
  });

  it('Cf-Connecting-IP solo se cree si la conexión llega desde una red privada', () => {
    const req = (remote: string) => ({ headers: { 'cf-connecting-ip': '203.0.113.1' }, socket: { remoteAddress: remote }, ip: remote }) as never;
    expect(clientIp(req(CONECTOR))).toBe('203.0.113.1');
    expect(clientIp(req('198.51.100.50'))).toBe('198.51.100.50');
  });
});

describe('configuración', () => {
  it.each(['192.168.0.0/16', '172.16.0.0/12, 192.168.1.10', '::1, fc00::/7'])('acepta CREATE_FROM=%s', (v) => {
    expect(parseNetworks(v)).not.toBeNull();
  });
  it.each(['192.168.0.0/33', 'red-de-casa', '10.0.0.0/x'])('rechaza CREATE_FROM=%s', (v) => {
    expect(() => parseNetworks(v)).toThrow(/CREATE_FROM/);
  });
  it('PUBLIC_URL exige https y solo el origen', () => {
    expect(loadConfig({ PUBLIC_URL: 'https://runa.example.com/' }).publicUrl).toBe('https://runa.example.com');
    expect(loadConfig({ PUBLIC_URL: 'http://localhost:8484' }).publicUrl).toBe('http://localhost:8484');
    for (const mala of ['http://runa.example.com', 'https://u:p@runa.example.com', 'https://runa.example.com/s', 'runa']) {
      expect(() => loadConfig({ PUBLIC_URL: mala })).toThrow(/PUBLIC_URL/);
    }
    expect(loadConfig({}).createFrom).toBeNull();
  });
});
