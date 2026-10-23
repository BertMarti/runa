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
  | 'denied'
  | 'not_found'
  | 'network'
  | 'server';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** Solo en `denied` al abrir: intentos restantes (0 = destruido). */
  readonly attemptsLeft?: number;
  /** Solo en `rate_limited`. */
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
      return new ApiError('invalid_request', 400);
    case 403:
      return new ApiError('denied', 403, { attemptsLeft: nonNegativeInt(body.attemptsLeft) });
    case 404:
      return new ApiError('not_found', 404);
    case 413:
      return new ApiError('too_large', 413);
    case 429: {
      const header = Number.parseInt(res.headers.get('retry-after') ?? '', 10);
      const retry = nonNegativeInt(body.retryAfterSeconds) ?? (Number.isFinite(header) ? header : 60);
      return new ApiError('rate_limited', 429, { retryAfterSeconds: retry });
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
