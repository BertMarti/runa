import net from 'node:net';
import path from 'node:path';

export interface Config {
  host: string;
  port: number;
  /** Carpeta donde vive la base de datos SQLite. */
  dataDir: string;
  /** Carpeta con la web compilada; `null` para servir solo la API. */
  publicDir: string | null;
  /** Ver https://fastify.dev/docs/latest/Reference/Server/#trustproxy */
  trustProxy: boolean | string;
  /** Tope de bytes cifrados guardados entre todos los secretos. */
  maxStorageBytes: number;
  /** Peticiones por minuto y por IP para crear secretos. */
  createRateLimit: number;
  /** Peticiones por minuto y por IP para abrir o destruir secretos. */
  openRateLimit: number;
  logLevel: string;
  /** Envía HSTS: solo tiene sentido detrás de HTTPS. */
  hsts: boolean;
  /**
   * Redes desde las que se pueden **crear** secretos (IP o CIDR). `null` = desde cualquier sitio.
   * Leer siempre es posible: así el servidor puede publicarse para leer sin que cualquiera cree secretos.
   */
  createFrom: string[] | null;
  /** Base de los enlaces que genera la web (p. ej. el dominio público). `null` = el origen de la página. */
  publicUrl: string | null;
}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} debe ser un entero entre ${min} y ${max}`);
  }
  return value;
}

function trustProxy(raw: string | undefined): boolean | string {
  if (raw === undefined || raw === '' || raw === 'false') return false;
  if (raw === 'true') return true;
  return raw; // lista de IP o CIDR separadas por comas (p. ej. «127.0.0.1,10.0.0.0/8»)
}

/** Lista de IP o CIDR («192.168.0.0/16, 172.16.0.0/12, ::1»). Lanza si alguna no es válida. */
export function parseNetworks(raw: string | undefined): string[] | null {
  if (raw === undefined || raw.trim() === '') return null;
  const nets = raw.split(',').map((s) => s.trim()).filter(Boolean);
  for (const n of nets) {
    const [ip = '', bits] = n.split('/');
    const family = net.isIP(ip);
    const max = family === 4 ? 32 : 128;
    if (!family || (bits !== undefined && !(/^\d+$/.test(bits) && Number(bits) <= max))) {
      throw new Error(`CREATE_FROM: «${n}» no es una IP ni un CIDR válido`);
    }
  }
  return nets;
}

function parsePublicUrl(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === '') return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('PUBLIC_URL debe ser una URL completa, p. ej. https://runa.example.com');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password) {
    throw new Error('PUBLIC_URL debe usar https (el cifrado del navegador lo exige) y no llevar usuario ni contraseña');
  }
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('PUBLIC_URL no admite ruta, consulta ni fragmento');
  return url.origin;
}

export function loadConfig(env = process.env): Config {
  const publicDir = env.PUBLIC_DIR ?? path.resolve(import.meta.dirname, '../../web/dist');
  return {
    host: env.HOST ?? '127.0.0.1',
    port: int(env, 'PORT', 8080, 1, 65_535),
    dataDir: path.resolve(env.DATA_DIR ?? './data'),
    publicDir: publicDir === 'none' ? null : path.resolve(publicDir),
    trustProxy: trustProxy(env.TRUST_PROXY),
    maxStorageBytes: int(env, 'MAX_STORAGE_MB', 512, 1, 1_048_576) * 1024 * 1024,
    createRateLimit: int(env, 'RATE_LIMIT_CREATE', 20, 1, 10_000),
    openRateLimit: int(env, 'RATE_LIMIT_OPEN', 30, 1, 10_000),
    logLevel: env.LOG_LEVEL ?? 'info',
    hsts: env.HSTS === 'true',
    createFrom: parseNetworks(env.CREATE_FROM),
    publicUrl: parsePublicUrl(env.PUBLIC_URL),
  };
}
