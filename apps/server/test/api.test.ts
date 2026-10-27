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
    trustCfFrom: null,
    createQuotaBytes: 64 * 1024 * 1024,
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
    expect(csp).toContain("trusted-types 'none'");
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
  const tunnel = { createFrom: ['172.16.0.0/12', '192.168.0.0/16'], trustProxy: '172.16.0.0/12', trustCfFrom: ['172.16.0.0/12'] };
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

  it('Cf-Connecting-IP solo se cree si la conexión llega de un conector declarado (TRUST_CF_FROM)', () => {
    const req = (remote: string) => ({ headers: { 'cf-connecting-ip': '203.0.113.1' }, socket: { remoteAddress: remote }, ip: remote }) as never;
    const conector = (ip: string) => ip === CONECTOR;
    expect(clientIp(req(CONECTOR), conector)).toBe('203.0.113.1');
    expect(clientIp(req('198.51.100.50'), conector)).toBe('198.51.100.50');
    // Por defecto no se cree nunca, aunque venga de una red privada.
    expect(clientIp(req(CONECTOR))).toBe(CONECTOR);
  });

  it('R1: detrás de otro proxy, inventarse Cf-Connecting-IP no esquiva el límite', async () => {
    // Caddy o nginx en la red de Docker, sin TRUST_CF_FROM: cada petición trae una IP falsa distinta.
    const proxy = await buildApp(config({ trustProxy: '172.16.0.0/12', openRateLimit: 2 }), store);
    const abrir = (falsa: string) =>
      proxy.inject({
        method: 'POST',
        url: `/api/secrets/${'A'.repeat(22)}/open`,
        payload: { link: 'a'.repeat(64), token: 'a'.repeat(64) },
        remoteAddress: '172.17.0.1',
        headers: { 'x-forwarded-for': '198.51.100.7', 'cf-connecting-ip': falsa },
      });
    const codes = [];
    for (const ip of ['203.0.113.1', '203.0.113.2', '203.0.113.3']) codes.push((await abrir(ip)).statusCode);
    expect(codes).toEqual([404, 404, 429]);
    await proxy.close();
  });
});

describe('configuración', () => {
  it.each(['192.168.0.0/16', '172.16.0.0/12, 192.168.1.10', '::1, fc00::/7'])('acepta CREATE_FROM=%s', (v) => {
    expect(parseNetworks(v)).not.toBeNull();
  });
  it.each(['192.168.0.0/33', 'red-de-casa', '10.0.0.0/x'])('rechaza CREATE_FROM=%s', (v) => {
    expect(() => parseNetworks(v)).toThrow(/CREATE_FROM/);
  });
  it('TRUST_CF_FROM: por defecto no se cree a nadie; las redes se validan', () => {
    expect(loadConfig({}).trustCfFrom).toBeNull();
    expect(loadConfig({ TRUST_CF_FROM: '172.16.0.0/12' }).trustCfFrom).toEqual(['172.16.0.0/12']);
    expect(() => loadConfig({ TRUST_CF_FROM: 'red-de-casa' })).toThrow(/TRUST_CF_FROM/);
  });
  it('CREATE_QUOTA_MB: 64 por defecto', () => {
    expect(loadConfig({}).createQuotaBytes).toBe(64 * 1024 * 1024);
    expect(loadConfig({ CREATE_QUOTA_MB: '8' }).createQuotaBytes).toBe(8 * 1024 * 1024);
    expect(() => loadConfig({ CREATE_QUOTA_MB: '0' })).toThrow(/CREATE_QUOTA_MB/);
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

describe('cuotas (revisión externa R2)', () => {
  let quota: FastifyInstance;
  let qstore: SecretStore;
  const bloque = 1024 + 28;
  beforeEach(async () => {
    qstore = new SecretStore(':memory:');
    quota = await buildApp(config({ createQuotaBytes: 3 * bloque }), qstore);
  });
  afterEach(async () => {
    await quota.close();
    qstore.close();
  });

  it('cada cliente tiene una cuota de bytes por hora', async () => {
    const crear = (remoteAddress: string) => quota.inject({ method: 'POST', url: '/api/secrets', payload: body().payload, remoteAddress });
    for (let i = 0; i < 3; i++) expect((await crear('198.51.100.7')).statusCode).toBe(201);
    const lleno = await crear('198.51.100.7');
    expect(lleno.statusCode).toBe(429);
    expect(lleno.json()).toMatchObject({ error: 'quota_exceeded' });
    expect(Number(lleno.headers['retry-after'])).toBeGreaterThan(3000);
    // Otro cliente no se ve afectado.
    expect((await crear('198.51.100.8')).statusCode).toBe(201);
  });

  it('un secreto grande caduca como mucho en un día', async () => {
    const grande = (ttl: number) =>
      app.inject({ method: 'POST', url: '/api/secrets', payload: body({ ciphertext: randomBytes(MAX_CIPHERTEXT_BYTES).toString('base64url'), ttl }).payload });
    const semana = await grande(604_800);
    expect(semana.statusCode).toBe(400);
    expect(semana.json()).toMatchObject({ error: 'ttl_too_long', maxTtl: 86_400 });
    expect((await grande(86_400)).statusCode).toBe(201);
  });
});

describe('pedir un secreto', () => {
  const nueva = () => {
    const send = randomBytes(32);
    const open = randomBytes(32);
    return { send, open, body: { sendVerifier: sha(send), openVerifier: sha(open), ttl: 86_400 } };
  };
  const crear = (a: FastifyInstance, payload: object, remoteAddress = '127.0.0.1', headers: Record<string, string> = {}) =>
    a.inject({ method: 'POST', url: '/api/requests', payload, remoteAddress, headers });
  const rellenar = (a: FastifyInstance, id: string, proof: Buffer, size = 1052, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    a.inject({
      method: 'POST',
      url: `/api/requests/${id}/fill`,
      payload: { proof: proof.toString('hex'), ciphertext: randomBytes(size).toString('base64url'), ephemeral: randomBytes(32).toString('base64url'), ...extra },
      headers,
    });
  const recoger = (a: FastifyInstance, id: string, proof: Buffer) =>
    a.inject({ method: 'POST', url: `/api/requests/${id}/open`, payload: { proof: proof.toString('hex') } });

  it('crear → esperando → rellenar una vez → recoger una vez', async () => {
    const r = nueva();
    const created = await crear(app, r.body);
    expect(created.statusCode).toBe(201);
    const { id } = created.json() as { id: string };

    expect((await recoger(app, id, r.open)).json()).toMatchObject({ status: 'waiting' });
    expect((await rellenar(app, id, r.send)).statusCode).toBe(201);
    const otra = await rellenar(app, id, r.send);
    expect(otra.statusCode).toBe(409);
    expect(otra.json()).toEqual({ error: 'already_filled' });

    const listo = await recoger(app, id, r.open);
    expect(listo.json()).toMatchObject({ status: 'ready' });
    expect(Buffer.from((listo.json() as { ephemeral: string }).ephemeral, 'base64url')).toHaveLength(32);
    expect((await recoger(app, id, r.open)).statusCode).toBe(404);
  });

  it('sin la prueba correcta la petición «no existe», para rellenar y para recoger', async () => {
    const r = nueva();
    const { id } = (await crear(app, r.body)).json() as { id: string };
    expect((await rellenar(app, id, randomBytes(32))).statusCode).toBe(404);
    expect((await recoger(app, id, randomBytes(32))).statusCode).toBe(404);
    // El enlace de envío no sirve para recoger.
    expect((await recoger(app, id, r.send)).statusCode).toBe(404);
    expect((await recoger(app, id, r.open)).json()).toMatchObject({ status: 'waiting' });
  });

  it('se puede cancelar con el enlace de recogida', async () => {
    const r = nueva();
    const { id } = (await crear(app, r.body)).json() as { id: string };
    await rellenar(app, id, r.send);
    const cancelar = (proof: Buffer) => app.inject({ method: 'POST', url: `/api/requests/${id}/cancel`, payload: { proof: proof.toString('hex') } });
    expect((await cancelar(r.send)).statusCode).toBe(404);
    expect((await cancelar(r.open)).statusCode).toBe(204);
    expect((await recoger(app, id, r.open)).statusCode).toBe(404);
  });

  it('valida el cifrado y la clave efímera', async () => {
    const r = nueva();
    const { id } = (await crear(app, r.body)).json() as { id: string };
    expect((await rellenar(app, id, r.send, 1000)).statusCode).toBe(400);
    expect((await rellenar(app, id, r.send, 1052, { ephemeral: 'corta' })).statusCode).toBe(400);
    expect((await rellenar(app, id, r.send, 1052, { extra: 1 })).statusCode).toBe(400);
  });

  it('un contenido grande caduca como mucho en un día', async () => {
    const r = nueva();
    const { id } = (await crear(app, { ...r.body, ttl: 604_800 })).json() as { id: string };
    const res = await rellenar(app, id, r.send, MAX_CIPHERTEXT_BYTES);
    expect(res.statusCode).toBe(201);
    const expires = Date.parse((res.json() as { expiresAt: string }).expiresAt);
    expect(expires - Date.now()).toBeLessThanOrEqual(86_400_000 + 5000);
  });

  it('con CREATE_FROM: pedir solo desde casa, pero rellenar desde fuera (por el túnel)', async () => {
    const tunel = { createFrom: ['172.16.0.0/12'], trustProxy: '172.16.0.0/12', trustCfFrom: ['172.16.0.0/12'] };
    const casa = await buildApp(config(tunel), store);
    const r = nueva();
    const cf = { 'cf-connecting-ip': '203.0.113.9', 'cf-ray': 'abc-MAD' };
    expect((await crear(casa, r.body, '172.18.0.9', cf)).statusCode).toBe(403);
    const { id } = (await crear(casa, r.body, '172.18.0.3')).json() as { id: string };
    expect((await rellenar(casa, id, r.send, 1052, {}, cf)).statusCode).toBe(201);
    await casa.close();
  });

  it('las páginas de envío y recogida se sirven sin indexar', async () => {
    for (const url of [`/r/${'A'.repeat(22)}`, `/p/${'A'.repeat(22)}`]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-robots-tag']).toContain('noindex');
    }
  });
});

describe('pedir un secreto: auditoría (P1)', () => {
  const nueva = () => {
    const send = randomBytes(32);
    const open = randomBytes(32);
    return { send, open, body: { sendVerifier: sha(send), openVerifier: sha(open), ttl: 3600 } };
  };
  const rellenar = (a: FastifyInstance, id: string, proof: Buffer) =>
    a.inject({
      method: 'POST',
      url: `/api/requests/${id}/fill`,
      payload: { proof: proof.toString('hex'), ciphertext: randomBytes(1052).toString('base64url'), ephemeral: randomBytes(32).toString('base64url') },
    });

  it('sin la prueba correcta, rellenar nunca revela que el disco está lleno', async () => {
    const lleno = await buildApp(config({ maxStorageBytes: 1 }), store);
    const r = nueva();
    const { id } = (await lleno.inject({ method: 'POST', url: '/api/requests', payload: r.body })).json() as { id: string };
    expect((await rellenar(lleno, id, randomBytes(32))).statusCode).toBe(404);
    expect((await rellenar(lleno, 'A'.repeat(22), randomBytes(32))).statusCode).toBe(404);
    expect((await rellenar(lleno, id, r.send)).statusCode).toBe(507);
    await lleno.close();
  });

  it('sin la prueba correcta, rellenar no gasta la cuota de nadie', async () => {
    const justo = await buildApp(config({ createQuotaBytes: 1052 }), store);
    const r = nueva();
    const { id } = (await justo.inject({ method: 'POST', url: '/api/requests', payload: r.body })).json() as { id: string };
    for (let i = 0; i < 3; i++) expect((await rellenar(justo, id, randomBytes(32))).statusCode).toBe(404);
    expect((await rellenar(justo, id, r.send)).statusCode).toBe(201);
    await justo.close();
  });

  it('después de recoger o cancelar, rellenar da 404 (no 409)', async () => {
    const r = nueva();
    const { id } = (await app.inject({ method: 'POST', url: '/api/requests', payload: r.body })).json() as { id: string };
    await rellenar(app, id, r.send);
    await app.inject({ method: 'POST', url: `/api/requests/${id}/open`, payload: { proof: r.open.toString('hex') } });
    expect((await rellenar(app, id, r.send)).statusCode).toBe(404);
  });
});
