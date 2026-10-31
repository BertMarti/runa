import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { SecretStore } from './store.js';

/**
 * Métricas para Prometheus, sin datos personales: solo recuentos agregados. Nunca llevan ids, IP, tamaños de un
 * secreto concreto ni nada que salga de un cuerpo; las rutas se cuentan por su patrón (`/api/secrets/:id/open`).
 */
export class Metrics {
  private readonly responses = new Map<string, number>();
  private readonly startedAt = Date.now();

  constructor(
    private readonly store: SecretStore,
    private readonly maxStorageBytes: number,
    private readonly version: string,
  ) {}

  /** Cuenta una respuesta de la API. `route` es el patrón de Fastify, nunca la URL real. */
  record(route: string, status: number): void {
    const key = `${route}\u0000${status}`;
    this.responses.set(key, (this.responses.get(key) ?? 0) + 1);
  }

  /** Formato de texto de Prometheus 0.0.4. */
  render(): string {
    const s = this.store.stats();
    const lines = [
      '# HELP runa_build_info Versión de RUNA.',
      '# TYPE runa_build_info gauge',
      `runa_build_info{version="${label(this.version)}"} 1`,
      '# HELP runa_start_time_seconds Momento en que arrancó el proceso.',
      '# TYPE runa_start_time_seconds gauge',
      `runa_start_time_seconds ${Math.floor(this.startedAt / 1000)}`,
      '# HELP runa_secrets_active Secretos guardados que aún no se han leído ni han caducado.',
      '# TYPE runa_secrets_active gauge',
      `runa_secrets_active ${s.secrets}`,
      '# HELP runa_requests_active Peticiones de secreto vivas, por estado.',
      '# TYPE runa_requests_active gauge',
      `runa_requests_active{state="waiting"} ${s.waiting}`,
      `runa_requests_active{state="filled"} ${s.filled}`,
      '# HELP runa_storage_used_bytes Bytes cifrados guardados (secretos y peticiones).',
      '# TYPE runa_storage_used_bytes gauge',
      `runa_storage_used_bytes ${this.store.usedBytes()}`,
      '# HELP runa_storage_limit_bytes Tope de almacenamiento (MAX_STORAGE_MB).',
      '# TYPE runa_storage_limit_bytes gauge',
      `runa_storage_limit_bytes ${this.maxStorageBytes}`,
      '# HELP runa_http_responses_total Respuestas de la API por patrón de ruta y código.',
      '# TYPE runa_http_responses_total counter',
    ];
    for (const [key, n] of [...this.responses].sort(([a], [b]) => a.localeCompare(b))) {
      const [route = '', status = ''] = key.split('\u0000');
      lines.push(`runa_http_responses_total{route="${label(route)}",status="${status}"} ${n}`);
    }
    return lines.join('\n') + '\n';
  }
}

const label = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

/** Compara `Authorization: Bearer <token>` en tiempo constante (sobre los resúmenes, que miden lo mismo). */
export function bearerMatches(header: string | undefined, token: string): boolean {
  const m = /^Bearer (.+)$/.exec(header ?? '');
  if (!m) return false;
  const digest = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(digest(m[1]!), digest(token));
}

/** Versión del `package.json` del servidor: junto al código en la imagen Docker, una carpeta arriba en desarrollo. */
export function serverVersion(dir = import.meta.dirname): string {
  for (const file of [path.join(dir, 'package.json'), path.join(dir, '..', 'package.json')]) {
    try {
      const { name, version } = JSON.parse(fs.readFileSync(file, 'utf8')) as { name?: string; version?: string };
      if (name === '@runa/server' && typeof version === 'string') return version;
    } catch {
      // siguiente candidato
    }
  }
  return 'desconocida';
}
