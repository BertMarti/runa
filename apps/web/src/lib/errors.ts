import { ApiError } from '../api';
import { PayloadTooLargeError } from '../crypto';
import { fmt, type Messages } from '../i18n';

/** Mensaje para la persona a partir de cualquier error del flujo de creación. */
export function errorMessage(err: unknown, t: Messages): string {
  if (err instanceof PayloadTooLargeError) return t.errors.too_large;
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'rate_limited':
        return fmt(t.errors.rate_limited, { s: err.retryAfterSeconds ?? 60 });
      case 'quota_exceeded':
        return fmt(t.errors.quota_exceeded, { m: Math.max(1, Math.ceil((err.retryAfterSeconds ?? 3600) / 60)) });
      case 'ttl_too_long':
        return t.errors.ttl_too_long;
      case 'already_filled':
        return t.request.alreadyFilled;
      case 'not_found':
        return t.request.notFound;
      case 'invalid_request':
      case 'too_large':
      case 'storage_full':
      case 'create_forbidden':
      case 'network':
      case 'server':
        return t.errors[err.code];
      default:
        return t.errors.server;
    }
  }
  return t.errors.crypto;
}

export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
