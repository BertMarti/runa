import { version } from '../../package.json';
import { fmt, useI18n } from '../i18n';
import { Rune } from './runes';

export const REPO_URL = 'https://github.com/BertMarti/runa';

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="footer">
      <Rune name="raido" className="footer__rune" />
      <a className="footer__link" href={REPO_URL} rel="noopener noreferrer" target="_blank">
        {t.footer.source}
      </a>
      <span className="footer__meta">{fmt(t.footer.version, { v: version })}</span>
      <span className="footer__meta footer__etym">
        {t.footer.etymology}
      </span>
    </footer>
  );
}
