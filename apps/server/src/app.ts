import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { Config } from './config.js';
import {
  GCM_OVERHEAD_BYTES,
  ID_PATTERN,
  MAX_CIPHERTEXT_B64,
  MAX_VIEWS,
  MIN_VIEWS,
  PAD_BUCKETS,
  TOKEN_PATTERN,
  TTL_OPTIONS,
} from './limits.js';
import type { SecretStore } from './store.js';

const B64URL = /^[A-Za-z0-9_-]+$/;

/** Margen para las claves JSON alrededor del cifrado en base64url. */
const BODY_LIMIT = MAX_CIPHERTEXT_B64 + 4096;

const idParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', pattern: ID_PATTERN } },
} as const;

const proofBody = {
  type: 'object',
  required: ['link', 'token'],
  additionalProperties: false,
  properties: {
    link: { type: 'string', pattern: TOKEN_PATTERN },
    token: { type: 'string', pattern: TOKEN_PATTERN },
  },
} as const;

const createBody = {
  type: 'object',
  required: ['ciphertext', 'verifier', 'linkVerifier', 'ttl', 'views'],
  additionalProperties: false,
  properties: {
    ciphertext: { type: 'string', minLength: 16, maxLength: MAX_CIPHERTEXT_B64 },
    verifier: { type: 'string', pattern: TOKEN_PATTERN },
    linkVerifier: { type: 'string', pattern: TOKEN_PATTERN },
    ttl: { type: 'integer', enum: [...TTL_OPTIONS] },
    views: { type: 'integer', minimum: MIN_VIEWS, maximum: MAX_VIEWS },
  },
} as const;

interface CreateBody {
  ciphertext: string;
  verifier: string;
  linkVerifier: string;
  ttl: number;
  views: number;
}

/**
 * Política de contenido estricta: solo recursos propios, ningún script en
 * línea, sin marcos, sin formularios hacia fuera y sin `<base>`.
 */
const CSP = {
  defaultSrc: ["'none'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  imgSrc: ["'self'", 'data:', 'blob:'],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  manifestSrc: ["'self'"],
  baseUri: ["'none'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  objectSrc: ["'none'"],
  workerSrc: ["'self'"],
  requireTrustedTypesFor: ["'script'"],
  upgradeInsecureRequests: null,
};

interface ProofBody {
  link: string;
  token: string;
}

const API_PATH = /^\/api(\/|\?|$)/;

/** Tamaños de cifrado que produce un cliente conforme: bloque de relleno + IV + etiqueta. */
const VALID_SIZES = new Set(PAD_BUCKETS.map((b) => b + GCM_OVERHEAD_BYTES));

/**
 * Clave del límite de peticiones: la IP, salvo en IPv6, donde se agrupa el /64.
 * Un cliente IPv6 suele controlar todo su /64 y podría rotar direcciones.
 */
export function rateLimitKey(ip: string): string {
  if (!ip.includes(':') || ip.startsWith('::ffff:')) return ip;
  const [head = '', tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

const PRIVATE = createAllowed(['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', 'fc00::/7', '::1']);

/**
 * IP para el límite de peticiones. Por el túnel de Cloudflare, `Cf-Connecting-IP` es la IP real (Cloudflare la
 * pone y descarta la del cliente); solo se cree si la conexión llega desde una red privada (el conector).
 */
export function clientIp(req: FastifyRequest): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && net.isIP(cf) && PRIVATE(req.socket.remoteAddress ?? '')) return cf;
  return req.ip;
}

/** ¿Puede esta IP crear secretos? Sin `CREATE_FROM`, todas pueden. */
export function createAllowed(networks: string[] | null): (ip: string) => boolean {
  if (!networks) return () => true;
  const list = new net.BlockList();
  for (const n of networks) {
    const [ip = '', bits] = n.split('/');
    const family = net.isIP(ip) === 6 ? 'ipv6' : 'ipv4';
    if (bits === undefined) list.addAddress(ip, family);
    else list.addSubnet(ip, Number(bits), family);
  }
  return (ip) => {
    const v4 = ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7)) ? ip.slice(7) : ip;
    const family = net.isIPv4(v4) ? 'ipv4' : net.isIPv6(v4) ? 'ipv6' : null;
    return family !== null && list.check(v4, family);
  };
}

/** Registro sin IP, sin cuerpos ni identificadores: solo método, ruta y código. */
const logSerializers = {
  req(req: FastifyRequest) {
    return { method: req.method, route: req.routeOptions?.url ?? 'unknown' };
  },
};

export async function buildApp(config: Config, store: SecretStore): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.logLevel === 'silent' ? false : { level: config.logLevel, serializers: logSerializers },
    trustProxy: config.trustProxy,
    bodyLimit: 16 * 1024,
    return503OnClosing: true,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, allErrors: false } },
  });

  await app.register(helmet, {
    contentSecurityPolicy: { useDefaults: false, directives: CSP },
    crossOriginEmbedderPolicy: { policy: 'require-corp' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    // Sin `preload`: inscribir el dominio en la lista de precarga es una decisión de quien despliega.
    strictTransportSecurity: config.hsts ? { maxAge: 63_072_000, includeSubDomains: true } : false,
    xFrameOptions: { action: 'deny' },
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()',
    );
    if (API_PATH.test(req.url)) {
      reply.header('Cache-Control', 'no-store');
      reply.header('Pragma', 'no-cache');
    }
  });

  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: '1 minute',
    // La web estática no cuenta: una oficina tras una sola IP no debe quedarse sin página.
    allowList: (req) => !API_PATH.test(req.url),
    keyGenerator: (req) => rateLimitKey(clientIp(req)),
    // Solo en memoria: las IP no se escriben en disco ni en el registro.
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: 'rate_limited',
      retryAfterSeconds: Math.ceil(ctx.ttl / 1000),
    }),
  });

  // Errores sin trazas ni detalles internos hacia el cliente.
  app.setErrorHandler((error: { statusCode?: number; validation?: unknown }, req, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) req.log.error({ err: error }, 'error interno');
    if (error.validation) return reply.status(400).send({ error: 'invalid_request' });
    if (status === 413) return reply.status(413).send({ error: 'too_large' });
    if (status === 429) return reply.status(429).send(error);
    return reply.status(status).send({ error: status >= 500 ? 'internal_error' : 'bad_request' });
  });

  app.get('/api/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));

  const allowedIp = createAllowed(config.createFrom);
  /**
   * Con `CREATE_FROM`, todo lo que llega por Cloudflare es externo, aunque `TRUST_PROXY` estuviera mal puesto
   * (sin él, la IP sería la del conector del túnel, que está en la red de confianza). Quien añada esas cabeceras
   * a mano desde dentro solo consigue quitarse permisos.
   */
  const viaCloudflare = (req: FastifyRequest) =>
    req.headers['cf-connecting-ip'] !== undefined || req.headers['cf-ray'] !== undefined;
  const canCreate = (req: FastifyRequest) => !(config.createFrom && viaCloudflare(req)) && allowedIp(req.ip);

  // Lo que la web necesita saber del despliegue. No revela la configuración de red, solo el resultado.
  app.get('/api/config', async (req) => ({ publicUrl: config.publicUrl, createAllowed: canCreate(req) }));

  app.post<{ Body: CreateBody }>(
    '/api/secrets',
    {
      bodyLimit: BODY_LIMIT,
      schema: { body: createBody },
      config: { rateLimit: { max: config.createRateLimit, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      if (!canCreate(req)) return reply.status(403).send({ error: 'create_forbidden' });
      const { ciphertext, verifier, linkVerifier, ttl, views } = req.body;
      if (!B64URL.test(ciphertext)) return reply.status(400).send({ error: 'invalid_request' });

      // Solo tamaños de bloque exactos: rechaza basura y garantiza que el
      // tamaño guardado nunca revela la longitud real del secreto.
      const bytes = Buffer.from(ciphertext, 'base64url');
      if (!VALID_SIZES.has(bytes.length)) return reply.status(400).send({ error: 'invalid_request' });
      if (store.usedBytes() + bytes.length > config.maxStorageBytes) {
        req.log.warn('almacenamiento lleno');
        return reply.status(507).send({ error: 'storage_full' });
      }

      const created = store.create({
        ciphertext: bytes,
        verifier: Buffer.from(verifier, 'hex'),
        linkVerifier: Buffer.from(linkVerifier, 'hex'),
        ttlSeconds: ttl,
        maxViews: views,
      });
      return reply.status(201).send({ id: created.id, expiresAt: new Date(created.expiresAt).toISOString() });
    },
  );

  const openLimit = { rateLimit: { max: config.openRateLimit, timeWindow: '1 minute' } };

  const proofOf = (body: ProofBody) => ({ link: Buffer.from(body.link, 'hex'), token: Buffer.from(body.token, 'hex') });

  app.post<{ Params: { id: string }; Body: ProofBody }>(
    '/api/secrets/:id/open',
    { schema: { params: idParams, body: proofBody }, config: openLimit },
    async (req, reply) => {
      const result = store.open(req.params.id, proofOf(req.body));
      switch (result.status) {
        case 'ok':
          return { ciphertext: result.ciphertext.toString('base64url'), viewsLeft: result.viewsLeft };
        case 'denied':
          return reply.status(403).send({ error: 'denied', attemptsLeft: result.attemptsLeft });
        case 'not_found':
          return reply.status(404).send({ error: 'not_found' });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: ProofBody }>(
    '/api/secrets/:id/burn',
    { schema: { params: idParams, body: proofBody }, config: openLimit },
    async (req, reply) => {
      const result = store.burn(req.params.id, proofOf(req.body));
      if (result === 'ok') return reply.status(204).send();
      if (result === 'denied') return reply.status(403).send({ error: 'denied' });
      return reply.status(404).send({ error: 'not_found' });
    },
  );

  if (config.publicDir && fs.existsSync(path.join(config.publicDir, 'index.html'))) {
    await registerWeb(app, config.publicDir);
  } else {
    app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'not_found' }));
  }

  return app;
}

/** Sirve la web compilada; las rutas de la SPA reciben `index.html`. */
async function registerWeb(app: FastifyInstance, publicDir: string): Promise<void> {
  await app.register(fastifyStatic, {
    root: publicDir,
    index: false,
    wildcard: false,
    dotfiles: 'deny',
    setHeaders(res, filePath) {
      const immutable = filePath.includes(`${path.sep}assets${path.sep}`);
      res.header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });

  const sendIndex = (reply: import('fastify').FastifyReply, noindex: boolean) => {
    reply.header('Cache-Control', 'no-cache');
    if (noindex) reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return reply.sendFile('index.html');
  };

  app.get('/', (_req, reply) => sendIndex(reply, false));
  app.get('/s/:id', (_req, reply) => sendIndex(reply, true));

  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !API_PATH.test(req.url)) return sendIndex(reply, true);
    return reply.status(404).send({ error: 'not_found' });
  });
}
