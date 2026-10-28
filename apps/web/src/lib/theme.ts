/**
 * Tema: «auto» sigue al sistema (solo CSS, sin parpadeo), «light» y «dark» lo fijan con `data-theme` en <html>.
 * La preferencia se guarda en localStorage: no es un secreto (la regla 6 de AGENTS.md habla de claves y contenidos).
 */
export type Theme = 'auto' | 'light' | 'dark';

export const THEMES: readonly Theme[] = ['auto', 'light', 'dark'];
const STORAGE_KEY = 'runa.theme';

export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = theme;
}

export function saveTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    if (theme === 'auto') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* modo privado o almacenamiento bloqueado: se aplica, pero no se recuerda */
  }
}

/** El siguiente del ciclo auto → claro → oscuro → auto. */
export const nextTheme = (t: Theme): Theme => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length]!;
