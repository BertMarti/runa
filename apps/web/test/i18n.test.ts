import { afterEach, describe, expect, it } from 'vitest';
import { es } from '../src/i18n/es';
import { detectLang, dictionaries, fmt, INTL_LOCALES, isLang, LANGS, LOCALES, pickLang } from '../src/i18n';

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

/** Variables de una cadena, con repeticiones y ordenadas: `{n} de {max}` → `['max', 'n']`. */
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

const flatEs = flatten(es);
const others = LANGS.filter((l) => l !== 'es');

describe('diccionarios', () => {
  it('hay un diccionario y un locale por idioma', () => {
    expect(Object.keys(dictionaries).sort()).toEqual([...LANGS].sort());
    expect(Object.keys(LOCALES).sort()).toEqual([...LANGS].sort());
    expect(LOCALES).toMatchObject({ ca: 'ca-ES', gl: 'gl-ES', pt: 'pt-PT' });
  });

  it('Intl recibe el locale y una reserva conocida (Chromium no trae datos del gallego)', () => {
    for (const lang of LANGS) expect(INTL_LOCALES[lang][0], lang).toBe(LOCALES[lang]);
    expect(INTL_LOCALES.gl).toEqual(['gl-ES', 'es-ES']);
    expect(INTL_LOCALES.ca).toEqual(['ca-ES', 'es-ES']);
    // Con la reserva, un locale sin datos cae al español y no al idioma del sistema.
    expect(new Intl.DateTimeFormat(['zz-ZZ', 'es-ES']).resolvedOptions().locale).toBe('es-ES');
  });

  it.each(others)('%s tiene exactamente las mismas claves que es', (lang) => {
    expect([...flatten(dictionaries[lang]).keys()].sort()).toEqual([...flatEs.keys()].sort());
  });

  it.each(LANGS)('%s: ningún texto está vacío', (lang) => {
    for (const [key, value] of flatten(dictionaries[lang])) {
      expect(typeof value, key).toBe('string');
      expect(String(value).trim(), key).not.toBe('');
    }
  });

  it.each(others)('%s: las variables coinciden con es en cada clave', (lang) => {
    const flat = flatten(dictionaries[lang]);
    for (const [key, value] of flatEs) {
      expect(placeholders(String(flat.get(key))), key).toEqual(placeholders(String(value)));
    }
  });

  it.each(LANGS)('%s: cada plural tiene «one» y «other», y los dos llevan {n}', (lang) => {
    for (const [name, forms] of Object.entries(dictionaries[lang].plural)) {
      expect(Object.keys(forms).sort(), name).toEqual(['one', 'other']);
      expect(forms.one, name).toContain('{n}');
      expect(forms.other, name).toContain('{n}');
    }
  });

  it.each(LANGS)('%s: las reglas de plural del locale solo piden «one» y «other» para enteros', (lang) => {
    const rules = new Intl.PluralRules(LOCALES[lang]);
    const used = new Set([0, 1, 2, 5, 21, 100].map((n) => rules.select(n)));
    for (const category of used) expect(['one', 'other'], `${lang}: ${category}`).toContain(category);
  });

  it.each(LANGS)('%s: ningún texto lleva marcado ni entidades HTML', (lang) => {
    for (const [key, value] of flatten(dictionaries[lang])) {
      expect(String(value), key).not.toMatch(/[<>]|&[#\w]+;/);
    }
  });

  it.each(LANGS)('%s: las preguntas frecuentes citan los botones con su texto exacto', (lang) => {
    const t = dictionaries[lang];
    expect(t.faq.a2).toContain(t.result.burn);
    expect(t.faq.a4).toContain(t.reveal.submit);
  });
});

describe('detección del idioma', () => {
  afterEach(() => localStorage.clear());

  it.each([
    [['ca-ES'], 'ca'],
    [['ca-ES-valencia'], 'ca'],
    [['gl'], 'gl'],
    [['gl-ES'], 'gl'],
    [['pt-PT'], 'pt'],
    [['pt-BR'], 'pt'],
    [['es-MX'], 'es'],
    [['en-US'], 'en'],
    [['EN_gb'], 'en'],
    [['eu-ES'], 'es'],
    [['ast'], 'es'],
    [['an-ES'], 'es'],
    [['de-DE'], 'en'],
    [['fr-FR', 'gl-ES'], 'gl'],
    [['de-DE', 'eu', 'ca'], 'es'],
    [['pt-BR', 'es-ES'], 'pt'],
    [[], 'es'],
    [[''], 'es'],
  ] as const)('%j → %s', (tags, expected) => {
    expect(pickLang(tags)).toBe(expected);
  });

  it('las etiquetas que coinciden con propiedades de Object no eligen nada raro', () => {
    for (const tag of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(pickLang([tag]), tag).toBe('en');
      expect(pickLang([tag, 'ca']), tag).toBe('ca');
    }
    expect(pickLang([1, null, 'gl'] as unknown[])).toBe('gl');
    expect(isLang('constructor')).toBe(false);
    expect(isLang(undefined)).toBe(false);
  });

  it('la elección guardada manda sobre el idioma del navegador', () => {
    localStorage.setItem('runa.lang', 'gl');
    expect(detectLang()).toBe('gl');
    localStorage.setItem('runa.lang', 'pt');
    expect(detectLang()).toBe('pt');
  });

  it('un valor guardado desconocido se ignora y manda el navegador', () => {
    localStorage.setItem('runa.lang', 'constructor');
    // happy-dom dice `en-US`.
    expect(detectLang()).toBe(pickLang(navigator.languages));
  });
});

describe('fmt', () => {
  it('sustituye variables y deja las desconocidas', () => {
    expect(fmt('{a} y {b}', { a: 1 })).toBe('1 y {b}');
  });
});
