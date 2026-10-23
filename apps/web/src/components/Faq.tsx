import { useI18n } from '../i18n';

export function Faq() {
  const { t } = useI18n();
  const items = [
    [t.faq.q1, t.faq.a1],
    [t.faq.q2, t.faq.a2],
    [t.faq.q3, t.faq.a3],
    [t.faq.q4, t.faq.a4],
  ] as const;
  return (
    <section className="faq" aria-labelledby="faq-title">
      <h2 id="faq-title" className="section-title">
        {t.faq.title}
      </h2>
      {items.map(([q, a]) => (
        <details key={q} className="faq__item">
          <summary className="faq__q">{q}</summary>
          <p className="faq__a">{a}</p>
        </details>
      ))}
    </section>
  );
}
