/**
 * Cuota de bytes por cliente y ventana (en memoria: las IP no se escriben en disco).
 *
 * El límite de peticiones (20/min) no basta: con secretos de 4 MiB, una sola IP llenaría el almacenamiento en
 * minutos y dejaría el servicio sin espacio para todos durante días. Esto acota lo que cada cliente puede guardar.
 */
export class ByteQuota {
  private readonly used = new Map<string, { bytes: number; resetAt: number }>();

  constructor(
    private readonly limitBytes: number,
    private readonly windowMs = 60 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Reserva `bytes` para `key`. Devuelve 0 si caben, o los segundos que faltan para que se renueve la cuota. */
  take(key: string, bytes: number): number {
    const t = this.now();
    if (this.used.size > 10_000) this.prune(t);
    let entry = this.used.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { bytes: 0, resetAt: t + this.windowMs };
      this.used.set(key, entry);
    }
    if (entry.bytes + bytes > this.limitBytes) return Math.max(1, Math.ceil((entry.resetAt - t) / 1000));
    entry.bytes += bytes;
    return 0;
  }

  private prune(t: number): void {
    for (const [k, v] of this.used) if (v.resetAt <= t) this.used.delete(k);
  }
}
