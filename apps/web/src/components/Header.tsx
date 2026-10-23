import { LANGS, useI18n, type Lang } from '../i18n';
import { onLinkClick } from '../router';
import { Rune, RUNA_WORD } from './runes';

const LANG_NAMES: Record<Lang, string> = { es: 'Español', en: 'English' };

export function Header() {
  const { t, lang, setLang } = useI18n();
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
    </header>
  );
}
