import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ca } from './ca';
import { en } from './en';
import { es, type Messages } from './es';
import { gl } from './gl';
import { pt } from './pt';

export type { Messages };

/** En el orden en que se ofrecen en la cabecera: el español (referencia), las otras lenguas de la península e inglés. */
export const LANGS = ['es', 'ca', 'gl', 'pt', 'en'] as const;
export type Lang = (typeof LANGS)[number];

export const dictionaries: Record<Lang, Messages> = { es, ca, gl, pt, en };

/** Locale de `Intl` (fechas, números, plurales). `pt` es portugués de Portugal. */
export const LOCALES: Record<Lang, string> = { es: 'es-ES', ca: 'ca-ES', gl: 'gl-ES', pt: 'pt-PT', en: 'en-GB' };

/**
 * Lo que recibe `Intl`: el locale y, detrás, el que se usa si el navegador no trae sus datos. Chromium no incluye el
 * gallego en su ICU: sin la reserva, `gl-ES` caería al idioma del sistema (y en un sistema en gallego, a los datos
 * raíz: «M11 3, Tue»). Mejor el español, que quien lee gallego entiende sin esfuerzo.
 */
export const INTL_LOCALES: Record<Lang, readonly string[]> = {
  es: ['es-ES'],
  ca: ['ca-ES', 'es-ES'],
  gl: ['gl-ES', 'es-ES'],
  pt: ['pt-PT', 'pt'],
  en: ['en-GB', 'en'],
};

/**
 * Valor de `lang` en el HTML. Sin región salvo el portugués: así un lector de pantalla elige la voz de Portugal y no
 * la de Brasil.
 */
export const HTML_LANG: Record<Lang, string> = { es: 'es', ca: 'ca', gl: 'gl', pt: 'pt-PT', en: 'en' };

/** Nombre de cada idioma en ese mismo idioma (el selector no depende del idioma activo). */
export const LANG_NAMES: Record<Lang, string> = {
  es: 'Español',
  ca: 'Català',
  gl: 'Galego',
  pt: 'Português',
  en: 'English',
};

// Lo único que se guarda en el navegador: la preferencia de idioma (como `runa.theme`). Nunca secretos ni fragmentos.
const STORAGE_KEY = 'runa.lang';

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

/**
 * Lenguas del dispositivo que aún no tenemos y cuyos hablantes leen mejor otra de las nuestras. El euskera espera
 * una revisión nativa (PLAN.md): mientras tanto, español, como el asturiano y el aragonés.
 */
const CLOSEST: Readonly<Record<string, Lang>> = { eu: 'es', ast: 'es', an: 'es' };

/**
 * Primer idioma de la lista (`navigator.languages`, por orden de preferencia) que RUNA sabe hablar, por la subetiqueta
 * principal: `ca-ES-valencia` da catalán y `pt-BR`, portugués. Si ninguno coincide, inglés; sin lista, español.
 */
export function pickLang(tags: readonly unknown[]): Lang {
  let any = false;
  for (const tag of tags) {
    if (typeof tag !== 'string' || tag.trim() === '') continue;
    any = true;
    const primary = tag.trim().toLowerCase().split(/[-_]/)[0] ?? '';
    if (isLang(primary)) return primary;
    // `hasOwn`: una etiqueta «constructor» o «__proto__» no puede sacar nada de la cadena de prototipos.
    if (Object.hasOwn(CLOSEST, primary)) return CLOSEST[primary]!;
  }
  return any ? 'en' : 'es';
}

/** Idiomas preferidos del navegador (vacío si no hay `navigator`). */
export function deviceLanguages(): string[] {
  try {
    if (typeof navigator === 'undefined') return [];
    const list = navigator.languages?.length ? navigator.languages : [navigator.language];
    return list.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

/** El idioma elegido a mano (si se guardó) manda; si no, el del dispositivo. */
export function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    // Almacenamiento bloqueado (modo privado, política): seguimos sin él.
  }
  return pickLang(deviceLanguages());
}

/** Sustituye `{nombre}` por su valor. Las variables que falten se dejan tal cual. */
export function fmt(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

export interface PluralForms {
  one: string;
  other: string;
}

interface I18nValue {
  lang: Lang;
  /** Para `Intl`: el locale del idioma y su reserva (ver `INTL_LOCALES`). */
  locale: string[];
  t: Messages;
  setLang: (lang: Lang) => void;
  /** Elige la forma singular/plural según `Intl.PluralRules` y sustituye `{n}`. */
  plural: (n: number, forms: PluralForms) => string;
  formatDate: (date: Date) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => initial ?? detectLang());

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Sin persistencia: el cambio vale para esta pestaña.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = HTML_LANG[lang];
  }, [lang]);

  const value = useMemo<I18nValue>(() => {
    const locale = [...INTL_LOCALES[lang]];
    const rules = new Intl.PluralRules(locale);
    const dateFormat = new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
    return {
      lang,
      locale,
      t: dictionaries[lang],
      setLang,
      plural: (n, forms) => fmt(rules.select(n) === 'one' ? forms.one : forms.other, { n }),
      formatDate: (date) => dateFormat.format(date),
    };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n fuera de I18nProvider');
  return ctx;
}
