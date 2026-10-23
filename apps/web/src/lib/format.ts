import { TTL_OPTIONS, type Ttl } from '../crypto';
import type { Messages } from '../i18n';

export function formatBytes(bytes: number, locale: string): string {
  const units = ['B', 'KB', 'MB'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}

export function formatNumber(n: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(n);
}

const TTL_KEYS: Record<Ttl, keyof Messages['ttl']> = { 300: 'm5', 3600: 'h1', 86_400: 'd1', 604_800: 'd7' };

export function ttlLabel(ttl: Ttl, t: Messages): string {
  return t.ttl[TTL_KEYS[ttl]];
}

export const TTLS: readonly Ttl[] = TTL_OPTIONS;

/** Bytes reales de una cadena base64url sin relleno. */
export function base64UrlBytes(b64: string): number {
  return Math.floor((b64.length * 3) / 4);
}
