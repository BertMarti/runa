import { describe, expect, it } from 'vitest';
import { ByteQuota } from '../src/quota.js';

describe('ByteQuota', () => {
  it('suma por clave, se renueva al acabar la ventana y dice cuánto esperar', () => {
    let t = 0;
    const q = new ByteQuota(100, 60_000, () => t);
    expect(q.take('a', 60)).toBe(0);
    expect(q.take('a', 40)).toBe(0);
    expect(q.take('a', 1)).toBe(60);
    expect(q.take('b', 100)).toBe(0);
    t = 59_500;
    expect(q.take('a', 1)).toBe(1);
    t = 60_000;
    expect(q.take('a', 100)).toBe(0);
  });

  it('un rechazo no gasta cuota', () => {
    const q = new ByteQuota(100, 60_000, () => 0);
    expect(q.take('a', 150)).toBeGreaterThan(0);
    expect(q.take('a', 100)).toBe(0);
  });
});
