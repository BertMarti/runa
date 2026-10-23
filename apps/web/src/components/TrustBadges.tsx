import { useI18n } from '../i18n';
import { Rune } from './runes';

/** Algiz es la runa de la protección: hace de viñeta. */
export function TrustBadges() {
  const { t } = useI18n();
  const items = [t.badges.e2e, t.badges.zk, t.badges.burn, t.badges.noTrack, t.badges.oss];
  return (
    <ul className="badges" aria-label={t.badges.label}>
      {items.map((label) => (
        <li key={label} className="badge">
          <Rune name="algiz" className="badge__rune" />
          {label}
        </li>
      ))}
    </ul>
  );
}
