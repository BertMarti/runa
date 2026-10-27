import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MAX_FAILED_ATTEMPTS } from './limits.js';

export interface NewSecret {
  ciphertext: Buffer;
  /** SHA-256 del token de acceso (32 bytes). El token nunca se guarda. */
  verifier: Buffer;
  /** SHA-256 de la prueba de enlace (32 bytes). */
  linkVerifier: Buffer;
  ttlSeconds: number;
  maxViews: number;
}

export type OpenResult =
  | { status: 'ok'; ciphertext: Buffer; viewsLeft: number }
  | { status: 'denied'; attemptsLeft: number }
  | { status: 'not_found' };

export type BurnResult = 'ok' | 'denied' | 'not_found';

/** Lo que cuenta cada petición viva en el espacio usado (verificadores y metadatos), aunque esté vacía. */
export const REQUEST_ROW_BYTES = 256;

/** Petición de secreto: quien pide guarda los verificadores; quien envía la rellena una sola vez. */
export interface NewRequest {
  /** SHA-256 de la prueba del enlace de envío. */
  sendVerifier: Buffer;
  /** SHA-256 de la prueba del enlace de recogida. */
  openVerifier: Buffer;
  ttlSeconds: number;
}

export type FillResult = { status: 'ok'; expiresAt: number } | { status: 'already_filled' } | { status: 'not_found' };

export type PickupResult =
  | { status: 'waiting'; expiresAt: number }
  | { status: 'ok'; ciphertext: Buffer; ephemeral: Buffer }
  | { status: 'not_found' };

interface RequestRow {
  send_verifier: Uint8Array;
  open_verifier: Uint8Array;
  ciphertext: Uint8Array | null;
  ephemeral: Uint8Array | null;
  expires_at: number;
}

/** Lo que presenta quien abre: prueba de enlace y token (32 bytes cada uno). */
export interface Proof {
  link: Buffer;
  token: Buffer;
}

interface Row {
  ciphertext: Uint8Array;
  verifier: Uint8Array;
  link_verifier: Uint8Array;
  views_left: number;
  failed_attempts: number;
}

/** Hash del token presentado, en tiempo constante frente al verificador guardado. */
function tokenMatches(token: Buffer, verifier: Uint8Array): boolean {
  const digest = createHash('sha256').update(token).digest();
  return digest.length === verifier.length && timingSafeEqual(digest, verifier);
}

export function newId(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * Almacén de secretos cifrados sobre SQLite.
 *
 * - Todo acceso usa sentencias preparadas (sin SQL dinámico).
 * - `secure_delete` sobrescribe con ceros las páginas liberadas: un secreto
 *   borrado no queda recuperable en el fichero de la base de datos.
 * - Leer y descontar una visualización ocurre en una sola transacción, así
 *   dos lecturas simultáneas nunca obtienen la misma «última» vista.
 */
export class SecretStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;

  constructor(file: string, now: () => number = Date.now) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.now = now;
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA secure_delete = ON;

      CREATE TABLE IF NOT EXISTS secrets (
        id              TEXT    PRIMARY KEY,
        ciphertext      BLOB    NOT NULL,
        verifier        BLOB    NOT NULL,
        link_verifier   BLOB    NOT NULL,
        created_at      INTEGER NOT NULL,
        expires_at      INTEGER NOT NULL,
        views_left      INTEGER NOT NULL CHECK (views_left > 0),
        failed_attempts INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE INDEX IF NOT EXISTS secrets_expires_at ON secrets (expires_at);

      CREATE TABLE IF NOT EXISTS requests (
        id             TEXT    PRIMARY KEY,
        send_verifier  BLOB    NOT NULL,
        open_verifier  BLOB    NOT NULL,
        ciphertext     BLOB,
        ephemeral      BLOB,
        created_at     INTEGER NOT NULL,
        expires_at     INTEGER NOT NULL,
        filled_at      INTEGER
      ) STRICT;
      CREATE INDEX IF NOT EXISTS requests_expires_at ON requests (expires_at);
    `);
  }

  create(secret: NewSecret): { id: string; expiresAt: number } {
    const id = newId();
    const createdAt = this.now();
    const expiresAt = createdAt + secret.ttlSeconds * 1000;
    this.db
      .prepare(
        `INSERT INTO secrets (id, ciphertext, verifier, link_verifier, created_at, expires_at, views_left)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, secret.ciphertext, secret.verifier, secret.linkVerifier, createdAt, expiresAt, secret.maxViews);
    return { id, expiresAt };
  }

  /**
   * Entrega el cifrado si las pruebas son correctas y descuenta una visualización.
   *
   * Sin la prueba de enlace (derivada de la clave del `#`) el secreto «no existe»
   * y el intento no cuenta: quien solo conoce el id (un proxy, un bot de vista
   * previa) no puede agotar los intentos ni saber si ya se leyó.
   */
  open(id: string, proof: Proof): OpenResult {
    return this.transaction((): OpenResult => {
      const row = this.liveRow(id);
      if (!row || !tokenMatches(proof.link, row.link_verifier)) return { status: 'not_found' };

      if (!tokenMatches(proof.token, row.verifier)) {
        return { status: 'denied', attemptsLeft: this.registerFailure(id, row) };
      }

      const viewsLeft = row.views_left - 1;
      if (viewsLeft === 0) this.delete(id);
      // Un acierto reinicia los intentos: los errores de un lector no castigan al siguiente.
      else this.db.prepare('UPDATE secrets SET views_left = ?, failed_attempts = 0 WHERE id = ?').run(viewsLeft, id);
      return { status: 'ok', ciphertext: Buffer.from(row.ciphertext), viewsLeft };
    });
  }

  /** Destruye el secreto a petición de quien tiene el enlace completo (y la contraseña). */
  burn(id: string, proof: Proof): BurnResult {
    return this.transaction((): BurnResult => {
      const row = this.liveRow(id);
      if (!row || !tokenMatches(proof.link, row.link_verifier)) return 'not_found';
      if (!tokenMatches(proof.token, row.verifier)) {
        this.registerFailure(id, row);
        return 'denied';
      }
      this.delete(id);
      return 'ok';
    });
  }

  /* ---------- Peticiones de secreto ---------- */

  createRequest(req: NewRequest): { id: string; expiresAt: number } {
    const id = newId();
    const createdAt = this.now();
    const expiresAt = createdAt + req.ttlSeconds * 1000;
    this.db
      .prepare('INSERT INTO requests (id, send_verifier, open_verifier, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, req.sendVerifier, req.openVerifier, createdAt, expiresAt);
    return { id, expiresAt };
  }

  /**
   * Rellena una petición con el cifrado. Solo con la prueba del enlace de envío y solo una vez. Sin la prueba
   * correcta, la petición «no existe» (como en `open`): quien solo conoce el id no aprende nada.
   * `maxTtlSeconds` acorta la caducidad si el contenido es grande.
   */
  fillRequest(id: string, sendProof: Buffer, ciphertext: Buffer, ephemeral: Buffer, maxTtlSeconds?: number): FillResult {
    return this.transaction((): FillResult => {
      const row = this.liveRequest(id);
      if (!row || !tokenMatches(sendProof, row.send_verifier)) return { status: 'not_found' };
      if (row.ciphertext) return { status: 'already_filled' };
      const now = this.now();
      const expiresAt = maxTtlSeconds === undefined ? row.expires_at : Math.min(row.expires_at, now + maxTtlSeconds * 1000);
      this.db
        .prepare('UPDATE requests SET ciphertext = ?, ephemeral = ?, filled_at = ?, expires_at = ? WHERE id = ?')
        .run(ciphertext, ephemeral, now, expiresAt, id);
      return { status: 'ok', expiresAt };
    });
  }

  /**
   * Comprobación previa, sin efectos: ¿esta prueba rellenaría la petición? Se usa antes de mirar el espacio y la
   * cuota, para que sin la prueba correcta todo sea «no existe» (ni 507 ni cuota gastada).
   */
  peekFill(id: string, sendProof: Buffer): 'ok' | 'already_filled' | 'not_found' {
    const row = this.db
      .prepare('SELECT send_verifier, ciphertext, expires_at FROM requests WHERE id = ?')
      .get(id) as Pick<RequestRow, 'send_verifier' | 'ciphertext' | 'expires_at'> | undefined;
    if (!row || row.expires_at <= this.now() || !tokenMatches(sendProof, row.send_verifier)) return 'not_found';
    return row.ciphertext ? 'already_filled' : 'ok';
  }

  /** Recoge el secreto pedido (una sola vez: después se borra). Sin la prueba de recogida, «no existe». */
  pickupRequest(id: string, openProof: Buffer): PickupResult {
    return this.transaction((): PickupResult => {
      const row = this.liveRequest(id);
      if (!row || !tokenMatches(openProof, row.open_verifier)) return { status: 'not_found' };
      if (!row.ciphertext || !row.ephemeral) return { status: 'waiting', expiresAt: row.expires_at };
      this.deleteRequest(id);
      return { status: 'ok', ciphertext: Buffer.from(row.ciphertext), ephemeral: Buffer.from(row.ephemeral) };
    });
  }

  /** Cancela la petición (y borra lo que se hubiera enviado). */
  cancelRequest(id: string, openProof: Buffer): 'ok' | 'not_found' {
    return this.transaction(() => {
      const row = this.liveRequest(id);
      if (!row || !tokenMatches(openProof, row.open_verifier)) return 'not_found';
      this.deleteRequest(id);
      return 'ok';
    });
  }

  /**
   * Borra los secretos y peticiones caducados y vuelca el WAL al fichero principal, para
   * que las copias antiguas de las páginas no sobrevivan en `-wal`.
   * Devuelve cuántos registros se eliminaron.
   */
  purgeExpired(): number {
    const now = this.now();
    const removed =
      Number(this.db.prepare('DELETE FROM secrets WHERE expires_at <= ?').run(now).changes) +
      Number(this.db.prepare('DELETE FROM requests WHERE expires_at <= ?').run(now).changes);
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return removed;
  }

  /** Bytes que ocupan ahora mismo los secretos vivos y las peticiones (su cifrado más `REQUEST_ROW_BYTES` cada una). */
  usedBytes(): number {
    const row = this.db
      .prepare(
        `SELECT (SELECT COALESCE(SUM(length(ciphertext)), 0) FROM secrets)
              + (SELECT COALESCE(SUM(length(ciphertext)), 0) + COUNT(*) * ${REQUEST_ROW_BYTES} FROM requests) AS bytes`,
      )
      .get() as { bytes: number };
    return row.bytes;
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM secrets').get() as { n: number }).n;
  }

  close(): void {
    this.db.close();
  }

  /** `BEGIN IMMEDIATE` toma el bloqueo de escritura antes de leer. */
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private liveRow(id: string): Row | undefined {
    const row = this.db
      .prepare(
        `SELECT ciphertext, verifier, link_verifier, views_left, failed_attempts, expires_at
         FROM secrets WHERE id = ?`,
      )
      .get(id) as (Row & { expires_at: number }) | undefined;
    if (!row) return undefined;
    if (row.expires_at <= this.now()) {
      this.delete(id);
      return undefined;
    }
    return row;
  }

  /** Suma un intento fallido; al llegar al máximo destruye el secreto. */
  private registerFailure(id: string, row: Row): number {
    const failed = row.failed_attempts + 1;
    if (failed >= MAX_FAILED_ATTEMPTS) {
      this.delete(id);
      return 0;
    }
    this.db.prepare('UPDATE secrets SET failed_attempts = ? WHERE id = ?').run(failed, id);
    return MAX_FAILED_ATTEMPTS - failed;
  }

  private delete(id: string): void {
    this.db.prepare('DELETE FROM secrets WHERE id = ?').run(id);
  }

  private liveRequest(id: string): RequestRow | undefined {
    const row = this.db
      .prepare('SELECT send_verifier, open_verifier, ciphertext, ephemeral, expires_at FROM requests WHERE id = ?')
      .get(id) as RequestRow | undefined;
    if (!row) return undefined;
    if (row.expires_at <= this.now()) {
      this.deleteRequest(id);
      return undefined;
    }
    return row;
  }

  private deleteRequest(id: string): void {
    this.db.prepare('DELETE FROM requests WHERE id = ?').run(id);
  }
}
