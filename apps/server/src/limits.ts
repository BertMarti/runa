/**
 * Límites del protocolo. Deben coincidir con `apps/web/src/crypto/limits.ts`.
 * El servidor nunca ve el contenido: solo puede acotar tamaños y tiempos.
 */

/** Bloques de relleno del cliente: un cifrado válido mide exactamente bloque + 28. */
export const PAD_BUCKETS = [1, 4, 16, 64, 256, 1024, 4096].map((k) => k * 1024);

/** Tamaño máximo del texto en claro ya rellenado (padding) en el cliente. */
export const MAX_PADDED_BYTES = 4 * 1024 * 1024;

/** IV de AES-GCM (12) + etiqueta de autenticación (16). */
export const GCM_OVERHEAD_BYTES = 12 + 16;

/** Tamaño máximo del cifrado que aceptamos guardar. */
export const MAX_CIPHERTEXT_BYTES = MAX_PADDED_BYTES + GCM_OVERHEAD_BYTES;

/** Longitud máxima del cifrado en base64url (sin relleno `=`). */
export const MAX_CIPHERTEXT_B64 = Math.ceil((MAX_CIPHERTEXT_BYTES * 4) / 3);

/** El cifrado más pequeño posible: 1 KiB de bloque mínimo + IV + etiqueta. */
export const MIN_CIPHERTEXT_BYTES = 1024 + GCM_OVERHEAD_BYTES;

/** Caducidades permitidas, en segundos: 5 min, 1 h, 1 día, 7 días. */
export const TTL_OPTIONS = [300, 3600, 86_400, 604_800] as const;

/**
 * Secretos grandes (más de 1 MiB rellenado, es decir, el bloque de 4 MiB): caducan como mucho en 1 día, para que
 * no puedan ocupar el almacenamiento una semana entera.
 */
export const LARGE_SECRET_BYTES = 1024 * 1024;
export const LARGE_SECRET_MAX_TTL = 86_400;

export const MIN_VIEWS = 1;
export const MAX_VIEWS = 10;

/** Intentos fallidos (contraseña incorrecta) antes de destruir el secreto. */
export const MAX_FAILED_ATTEMPTS = 5;

/** Identificador: 16 bytes aleatorios en base64url = 22 caracteres. */
export const ID_PATTERN = '^[A-Za-z0-9_-]{22}$';

/** Token de acceso derivado en el cliente: 32 bytes en hexadecimal. */
export const TOKEN_PATTERN = '^[0-9a-f]{64}$';
