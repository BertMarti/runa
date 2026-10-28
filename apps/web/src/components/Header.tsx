import { useState } from 'react';
import { fmt, LANGS, useI18n, type Lang } from '../i18n';
import { nextTheme, readTheme, saveTheme, type Theme } from '../lib/theme';
import { Icon, type IconName } from './Icon';
import { onLinkClick } from '../router';
import { Rune, RUNA_WORD } from './runes';

const LANG_NAMES: Record<Lang, string> = { es: 'Español', en: 'English' };

const THEME_ICON: Record<Theme, IconName> = {
  auto: 'contrast',
  light: 'sun',
  dark: 'moon',
};

export function Header() {
  const { t, lang, setLang } = useI18n();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const cycle = () => {
    const next = nextTheme(theme);
    saveTheme(next);
    setTheme(next);
  };
  const themeLabel = fmt(t.header.theme, { name: t.header.themeNames[theme] });
  return (
    <header className="header">
      <a className="wordmark" href="/" onClick={onLinkClick} aria-label={t.header.home}>
        <span className="wordmark__runes" aria-hidden="true">
          {RUNA_WORD.map((name) => (
            <Rune key={name} name={name} />
          ))}
        </span>
        <span className="wordmark__text">RUNA</span>
      </a>
      <div className="header__tools">
        <button type="button" className="theme-btn" onClick={cycle} aria-label={themeLabel} title={themeLabel}>
          <Icon name={THEME_ICON[theme]} />
        </button>
        <div className="lang" role="group" aria-label={t.header.language}>
          {LANGS.map((code) => (
            <button
              key={code}
              type="button"
              className="lang__btn"
              lang={code}
              aria-pressed={lang === code}
              aria-label={LANG_NAMES[code]}
              onClick={() => setLang(code)}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
