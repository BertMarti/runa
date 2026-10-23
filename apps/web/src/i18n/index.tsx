import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en } from './en';
import { es, type Messages } from './es';

export type Lang = 'es' | 'en';
export type { Messages };

export const LANGS: readonly Lang[] = ['es', 'en'];
export const dictionaries: Record<Lang, Messages> = { es, en };

const LOCALES: Record<Lang, string> = { es: 'es-ES', en: 'en-GB' };

// Lo único que se guarda en el navegador: la preferencia de idioma.
const STORAGE_KEY = 'runa.lang';

function isLang(value: unknown): value is Lang {
  return value === 'es' || value === 'en';
}

export function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    // Almacenamiento bloqueado (modo privado, política): seguimos sin él.
  }
  const nav = typeof navigator === 'undefined' ? '' : (navigator.language ?? '').toLowerCase();
  if (!nav) return 'es';
  // Español también para las lenguas cooficiales en España.
  return /^(es|ca|gl|eu)\b/.test(nav) ? 'es' : 'en';
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
  locale: string;
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
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<I18nValue>(() => {
    const locale = LOCALES[lang];
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
