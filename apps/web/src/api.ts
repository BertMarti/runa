/**
 * Cliente de la API. Solo viajan cifrado, verificador y token: nunca la clave
 * ni el texto en claro. Sin cookies, sin caché y sin `Referer`.
 */

import type { AccessProof } from './crypto';

export const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;

export type ApiErrorCode =
  | 'invalid_request'
  | 'too_large'
  | 'rate_limited'
  | 'storage_full'
  | 'create_forbidden'
  | 'quota_exceeded'
  | 'ttl_too_long'
  | 'already_filled'
  | 'denied'
  | 'not_found'
  | 'network'
  | 'server';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** Solo en `denied` al abrir: intentos restantes (0 = destruido). */
  readonly attemptsLeft?: number;
  /** Solo en `rate_limited` y `quota_exceeded`. */
  readonly retryAfterSeconds?: number;

  constructor(code: ApiErrorCode, status: number, extra: { attemptsLeft?: number; retryAfterSeconds?: number } = {}) {
    super(`API: ${code}`);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    if (extra.attemptsLeft !== undefined) this.attemptsLeft = extra.attemptsLeft;
    if (extra.retryAfterSeconds !== undefined) this.retryAfterSeconds = extra.retryAfterSeconds;
  }
}

export interface CreateRequest {
  ciphertext: string;
  verifier: string;
  linkVerifier: string;
  ttl: number;
  views: number;
}

export interface CreatedSecret {
  id: string;
  expiresAt: Date;
}

export interface OpenedSecret {
  ciphertext: string;
  viewsLeft: number;
}

function nonNegativeInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await res.json();
    return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Traduce una respuesta de error a `ApiError`, fiándose del código HTTP antes que del cuerpo. */
async function toApiError(res: Response): Promise<ApiError> {
  const body = await readJson(res);
  switch (res.status) {
    case 400:
      return new ApiError(body.error === 'ttl_too_long' ? 'ttl_too_long' : 'invalid_request', 400);
    case 403:
      if (body.error === 'create_forbidden') return new ApiError('create_forbidden', 403);
      return new ApiError('denied', 403, { attemptsLeft: nonNegativeInt(body.attemptsLeft) });
    case 404:
      return new ApiError('not_found', 404);
    case 409:
      return new ApiError('already_filled', 409);
    case 413:
      return new ApiError('too_large', 413);
    case 429: {
      const header = Number.parseInt(res.headers.get('retry-after') ?? '', 10);
      const retry = nonNegativeInt(body.retryAfterSeconds) ?? (Number.isFinite(header) ? header : 60);
      return new ApiError(body.error === 'quota_exceeded' ? 'quota_exceeded' : 'rate_limited', 429, { retryAfterSeconds: retry });
    }
    case 507:
      return new ApiError('storage_full', 507);
    default:
      return new ApiError(res.status >= 500 ? 'server' : 'invalid_request', res.status);
  }
}

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError('network', 0);
  }
  if (!res.ok) throw await toApiError(res);
  return res;
}

export interface DeployConfig {
  /** Origen de los enlaces que se comparten; `null` = el de esta página. */
  publicUrl: string | null;
  /** Si este navegador puede crear secretos (el servidor puede limitarlo a la red de casa). */
  createAllowed: boolean;
}

const DEFAULT_CONFIG: DeployConfig = { publicUrl: null, createAllowed: true };

/** Solo un origen https (o http en localhost); cualquier otra cosa se ignora. */
function safeOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return url.protocol === 'https:' || (url.protocol === 'http:' && local) ? url.origin : null;
  } catch {
    return null;
  }
}

/** Configuración del despliegue. Si falla, la de siempre: el servidor vuelve a comprobarlo todo al crear. */
export async function getConfig(signal?: AbortSignal): Promise<DeployConfig> {
  try {
    const res = await fetch('/api/config', {
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal,
    });
    if (!res.ok) return DEFAULT_CONFIG;
    const body = await readJson(res);
    return { publicUrl: safeOrigin(body.publicUrl), createAllowed: body.createAllowed !== false };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function secretPath(id: string, action: 'open' | 'burn'): string {
  // El id sale de la URL: se valida antes de componer la ruta.
  if (!ID_PATTERN.test(id)) throw new ApiError('not_found', 404);
  return `/api/secrets/${id}/${action}`;
}

export async function createSecret(req: CreateRequest, signal?: AbortSignal): Promise<CreatedSecret> {
  const res = await post('/api/secrets', req, signal);
  const body = await readJson(res);
  const expiresAt = typeof body.expiresAt === 'string' ? new Date(body.expiresAt) : null;
  if (typeof body.id !== 'string' || !ID_PATTERN.test(body.id) || !expiresAt || Number.isNaN(expiresAt.getTime())) {
    throw new ApiError('server', res.status);
  }
  return { id: body.id, expiresAt };
}

export async function openRemote(id: string, proof: AccessProof, signal?: AbortSignal): Promise<OpenedSecret> {
  const res = await post(secretPath(id, 'open'), { link: proof.link, token: proof.token }, signal);
  const body = await readJson(res);
  const viewsLeft = nonNegativeInt(body.viewsLeft);
  if (typeof body.ciphertext !== 'string' || !B64URL.test(body.ciphertext) || viewsLeft === undefined) {
    throw new ApiError('server', res.status);
  }
  return { ciphertext: body.ciphertext, viewsLeft };
}

export async function burnRemote(id: string, proof: AccessProof, signal?: AbortSignal): Promise<void> {
  await post(secretPath(id, 'burn'), { link: proof.link, token: proof.token }, signal);
}

/* ---------- Pedir un secreto ---------- */

function requestPath(id: string, action: 'fill' | 'open' | 'cancel'): string {
  if (!ID_PATTERN.test(id)) throw new ApiError('not_found', 404);
  return `/api/requests/${id}/${action}`;
}

const EPHEMERAL = /^[A-Za-z0-9_-]{43}$/;

function expiry(value: unknown, status: number): Date {
  const date = typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) throw new ApiError('server', status);
  return date;
}

export async function createRequest(
  req: { sendVerifier: string; openVerifier: string; ttl: number },
  signal?: AbortSignal,
): Promise<CreatedSecret> {
  const res = await post('/api/requests', req, signal);
  const body = await readJson(res);
  if (typeof body.id !== 'string' || !ID_PATTERN.test(body.id)) throw new ApiError('server', res.status);
  return { id: body.id, expiresAt: expiry(body.expiresAt, res.status) };
}

export async function fillRequest(
  id: string,
  sealed: { proof: string; ciphertext: string; ephemeral: string },
  signal?: AbortSignal,
): Promise<{ expiresAt: Date }> {
  const res = await post(requestPath(id, 'fill'), sealed, signal);
  return { expiresAt: expiry((await readJson(res)).expiresAt, res.status) };
}

export type PickupResponse = { status: 'waiting'; expiresAt: Date } | { status: 'ready'; ciphertext: string; ephemeral: string };

export async function openRequest(id: string, proof: string, signal?: AbortSignal): Promise<PickupResponse> {
  const res = await post(requestPath(id, 'open'), { proof }, signal);
  const body = await readJson(res);
  if (body.status === 'waiting') return { status: 'waiting', expiresAt: expiry(body.expiresAt, res.status) };
  if (
    body.status === 'ready' &&
    typeof body.ciphertext === 'string' &&
    B64URL.test(body.ciphertext) &&
    typeof body.ephemeral === 'string' &&
    EPHEMERAL.test(body.ephemeral)
  ) {
    return { status: 'ready', ciphertext: body.ciphertext, ephemeral: body.ephemeral };
  }
  throw new ApiError('server', res.status);
}

export async function cancelRequest(id: string, proof: string, signal?: AbortSignal): Promise<void> {
  await post(requestPath(id, 'cancel'), { proof }, signal);
}
