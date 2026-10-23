/** Aleatoriedad para contraseñas: siempre `crypto.getRandomValues`, sin sesgo de módulo. */

const LOWER = 'abcdefghijkmnpqrstuvwxyz'; // sin l
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin I ni O
const DIGITS = '23456789'; // sin 0 ni 1
const SYMBOLS = '!#$%&*+-=?@^_~';

/** Entero uniforme en [0, n) por muestreo con rechazo. */
export function randomIndex(n: number): number {
  if (!Number.isInteger(n) || n <= 0 || n > 2 ** 32) throw new RangeError('n fuera de rango');
  const limit = Math.floor(2 ** 32 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const v = buf[0]!;
    if (v < limit) return v % n;
  }
}

export function randomString(alphabet: string, length: number): string {
  const chars = Array.from(alphabet);
  let out = '';
  for (let i = 0; i < length; i++) out += chars[randomIndex(chars.length)];
  return out;
}

/**
 * Contraseña adicional fácil de dictar: 4 grupos de 5 sin caracteres ambiguos
 * (56 símbolos → ~116 bits).
 */
export function generatePassphrase(): string {
  const alphabet = LOWER + UPPER + DIGITS;
  return Array.from({ length: 4 }, () => randomString(alphabet, 5)).join('-');
}

/**
 * Contraseña para compartir como secreto (p. ej. credenciales nuevas): incluye
 * las cuatro clases. Se repite el sorteo completo en vez de forzar posiciones,
 * para no sesgar la distribución.
 */
export function generatePassword(length = 24): string {
  const alphabet = LOWER + UPPER + DIGITS + SYMBOLS;
  for (;;) {
    const pw = randomString(alphabet, length);
    if ([LOWER, UPPER, DIGITS, SYMBOLS].every((set) => Array.from(pw).some((c) => set.includes(c)))) return pw;
  }
}

/**
 * Estimación sencilla de entropía: tamaño del alfabeto usado × longitud, con
 * penalización por caracteres repetidos. Orientativa, no un auditor.
 */
export function estimateEntropy(password: string): number {
  const chars = Array.from(password);
  if (chars.length === 0) return 0;
  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/[0-9]/.test(password)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(password)) pool += 33;
  const unique = new Set(chars).size;
  // Cada repetición aporta la mitad: «aaaaaaaa» no vale como 8 caracteres.
  const effective = unique + (chars.length - unique) * 0.5;
  return Math.round(effective * Math.log2(Math.max(pool, 2)));
}

export type Strength = 'weak' | 'fair' | 'good' | 'strong';

export function strengthOf(bits: number): Strength {
  if (bits < 40) return 'weak';
  if (bits < 60) return 'fair';
  if (bits < 80) return 'good';
  return 'strong';
}
