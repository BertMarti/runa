/** Límites del protocolo. Deben coincidir con `apps/server/src/limits.ts`. */

/** Bloques de relleno: el tamaño cifrado solo revela en cuál cae el secreto. */
export const PAD_BUCKETS = [1, 4, 16, 64, 256, 1024, 4096].map((k) => k * 1024);

export const MAX_PADDED_BYTES = PAD_BUCKETS[PAD_BUCKETS.length - 1]!;

/** Texto máximo (caracteres). En UTF-8 ocupa como mucho 4 bytes por carácter. */
export const MAX_TEXT_CHARS = 100_000;

/** Archivo adjunto máximo. Deja sitio de sobra para la cabecera y el texto. */
export const MAX_FILE_BYTES = 3 * 1024 * 1024;

export const MAX_FILE_NAME = 200;

/** Iteraciones de PBKDF2-SHA256 (recomendación OWASP 2023 para SHA-256). */
export const PBKDF2_ITERATIONS = 600_000;

export const TTL_OPTIONS = [300, 3600, 86_400, 604_800] as const;
export type Ttl = (typeof TTL_OPTIONS)[number];

/**
 * Secretos grandes (más de 1 MiB rellenado, es decir, el bloque de 4 MiB): caducan como mucho en 1 día, para que
 * no puedan ocupar el almacenamiento una semana entera.
 */
export const LARGE_SECRET_BYTES = 1024 * 1024;
export const LARGE_SECRET_MAX_TTL = 86_400;

export const VIEW_OPTIONS = [1, 2, 3, 5, 10] as const;

export const MAX_FAILED_ATTEMPTS = 5;
