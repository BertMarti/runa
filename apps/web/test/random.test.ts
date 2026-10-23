import { describe, expect, it } from 'vitest';
import { estimateEntropy, generatePassphrase, generatePassword, randomIndex, strengthOf } from '../src/lib/random';

describe('aleatoriedad', () => {
  it('randomIndex queda dentro del rango', () => {
    for (let i = 0; i < 2000; i++) {
      const v = randomIndex(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });

  it('la frase generada tiene 4 grupos de 5 sin caracteres ambiguos', () => {
    const p = generatePassphrase();
    expect(p).toMatch(/^[A-Za-z2-9]{5}(-[A-Za-z2-9]{5}){3}$/);
    expect(p).not.toMatch(/[0O1lI]/);
  });

  it('la contraseña generada incluye las cuatro clases', () => {
    const pw = generatePassword();
    expect(pw).toHaveLength(24);
    expect(pw).toMatch(/[a-z]/);
    expect(pw).toMatch(/[A-Z]/);
    expect(pw).toMatch(/[0-9]/);
    expect(pw).toMatch(/[^A-Za-z0-9]/);
  });

  it('la estimación de entropía ordena con sentido', () => {
    expect(strengthOf(estimateEntropy('aaaaaaaa'))).toBe('weak');
    expect(strengthOf(estimateEntropy(generatePassphrase()))).toBe('strong');
    expect(estimateEntropy('')).toBe(0);
  });
});
