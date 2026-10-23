import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';
import { fmt } from '../src/i18n';

function flatten(obj: object, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') {
      for (const [k, v] of flatten(value, path)) out.set(k, v);
    } else {
      out.set(path, value);
    }
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('diccionarios', () => {
  const flatEs = flatten(es);
  const flatEn = flatten(en);

  it('es y en tienen exactamente las mismas claves', () => {
    expect([...flatEn.keys()].sort()).toEqual([...flatEs.keys()].sort());
  });

  it('ningún texto está vacío', () => {
    for (const [key, value] of [...flatEs, ...flatEn]) {
      expect(typeof value, key).toBe('string');
      expect(String(value).trim(), key).not.toBe('');
    }
  });

  it('las variables coinciden entre idiomas', () => {
    for (const [key, value] of flatEs) {
      expect(placeholders(String(flatEn.get(key))), key).toEqual(placeholders(String(value)));
    }
  });
});

describe('fmt', () => {
  it('sustituye variables y deja las desconocidas', () => {
    expect(fmt('{a} y {b}', { a: 1 })).toBe('1 y {b}');
  });
});
