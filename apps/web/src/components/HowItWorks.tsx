import { useI18n } from '../i18n';
import { Icon } from './Icon';

// Ruido de muestra para la ilustración: estático, no es ningún secreto real.
const NOISE = 'q8Zr0-Kx_v3TfWm9aPc2LhYeN7uJb5sD1oGiRkE4wXnQ6tVyBz';

/** Tres pasos con su propia mini-ilustración en HTML/CSS. Es una secuencia real, de ahí la numeración. */
export function HowItWorks() {
  const { t } = useI18n();
  return (
    <section className="how" aria-labelledby="how-title">
      <h2 id="how-title" className="section-title">
        {t.how.title}
      </h2>
      <ol className="how__steps">
        <li className="how__step">
          <div className="illu illu--browser" aria-hidden="true">
            <span className="illu__bar">
              <span className="illu__dot" />
              <span className="illu__dot" />
              <span className="illu__dot" />
            </span>
            <span className="illu__plain">{t.how.illuPlain}</span>
            <span className="illu__arrow" />
            <span className="illu__lock">
              <Icon name="lock" />
              <span className="mono">AES-256-GCM</span>
            </span>
          </div>
          <h3 className="how__title">{t.how.s1Title}</h3>
          <p className="how__body">{t.how.s1Body}</p>
        </li>
        <li className="how__step">
          <div className="illu illu--server" aria-hidden="true">
            <span className="illu__rack" />
            <span className="illu__rack" />
            <span className="illu__noise mono">{NOISE}</span>
          </div>
          <h3 className="how__title">{t.how.s2Title}</h3>
          <p className="how__body">{t.how.s2Body}</p>
        </li>
        <li className="how__step">
          <div className="illu illu--url" aria-hidden="true">
            <span className="illu__address mono">
              <span className="illu__sent">/s/Q2x9…</span>
              <span className="illu__frag">#v1.k3Y…</span>
            </span>
            <span className="illu__caption">{t.how.s3Caption}</span>
          </div>
          <h3 className="how__title">{t.how.s3Title}</h3>
          <p className="how__body">{t.how.s3Body}</p>
        </li>
      </ol>
    </section>
  );
}
