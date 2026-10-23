import { useRef, useState } from 'react';
import { ApiError, burnRemote } from '../api';
import { CopyButton } from '../components/CopyButton';
import { Icon } from '../components/Icon';
import { QrCode } from '../components/QrCode';
import { RuneScramble } from '../components/RuneScramble';
import type { AccessProof } from '../crypto';
import { fmt, useI18n } from '../i18n';
import { errorMessage } from '../lib/errors';
import { base64UrlBytes, formatBytes, formatNumber } from '../lib/format';

export interface CreatedResult {
  id: string;
  link: string;
  expiresAt: Date;
  views: number;
  hasPassphrase: boolean;
  /** Lo que se subió, para el panel «Lo que ve el servidor». */
  ciphertext: string;
  chars: number;
  fileSize?: number;
  /** Token de acceso, derivado en segundo plano, para «Destruir ahora». */
  token: Promise<AccessProof>;
}

interface ResultViewProps {
  result: CreatedResult;
  burned: boolean;
  onBurned: () => void;
  onReset: () => void;
}

const CIPHER_PREVIEW = 360;

export function ResultView({ result, burned, onBurned, onReset }: ResultViewProps) {
  const { t, plural, formatDate } = useI18n();

  if (burned) {
    return (
      <div className="card result">
        <p className="result__lead">{t.result.burnedLead}</p>
        <button type="button" className="btn btn--primary btn--big" onClick={onReset}>
          <Icon name="plus" />
          <span>{t.result.another}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="result">
      <div className="card result__main">
        <p className="result__lead">{fmt(t.result.lead, { views: plural(result.views, t.plural.views) })}</p>
        <LinkBlock link={result.link} />
        <ul className="facts">
          <li className="fact">{fmt(t.result.expires, { date: formatDate(result.expiresAt) })}</li>
          <li className="fact">{plural(result.views, t.plural.views)}</li>
        </ul>
        {result.hasPassphrase ? (
          <p className="alert alert--note">
            <Icon name="lock" />
            <span>{t.result.passReminder}</span>
          </p>
        ) : null}
      </div>

      <ServerView result={result} />

      <div className="result__actions">
        <button type="button" className="btn btn--ghost btn--big" onClick={onReset}>
          <Icon name="plus" />
          <span>{t.result.another}</span>
        </button>
        <BurnControl result={result} onBurned={onBurned} />
      </div>
    </div>
  );
}

function LinkBlock({ link }: { link: string }) {
  const { t } = useI18n();
  const linkRef = useRef<HTMLParagraphElement>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const share = async () => {
    try {
      await navigator.share({ title: 'RUNA', url: link });
    } catch {
      // Cancelado por la persona o no permitido: no hay nada que hacer.
    }
  };

  return (
    <div className="linkblock">
      <div className="linkblock__text">
        <span className="field__label" id="result-link-label">
          {t.result.linkLabel}
        </span>
        <p ref={linkRef} className="linkbox mono" aria-labelledby="result-link-label">
          {link}
        </p>
        <div className="linkblock__buttons">
          <CopyButton
            className="btn--primary btn--big"
            text={link}
            label={t.result.copy}
            copiedLabel={t.result.copied}
            announce={t.result.copiedAnnounce}
            fallbackMessage={t.result.copyFallback}
            target={linkRef}
          />
          {canShare ? (
            <button type="button" className="btn btn--ghost btn--big" onClick={share}>
              <Icon name="share" />
              <span>{t.result.share}</span>
            </button>
          ) : null}
        </div>
      </div>
      <figure className="linkblock__qr">
        <QrCode value={link} alt={t.result.qrAlt} />
        <figcaption className="field__hint">{t.result.qrLabel}</figcaption>
      </figure>
    </div>
  );
}

function ServerView({ result }: { result: CreatedResult }) {
  const { t, locale } = useI18n();
  const preview = result.ciphertext.slice(0, CIPHER_PREVIEW);
  return (
    <section className="card server" aria-labelledby="server-title">
      <h2 id="server-title" className="server__title">
        {t.result.serverTitle}
      </h2>
      <p className="server__lead">{t.result.serverLead}</p>
      <dl className="server__compare">
        <div className="server__col">
          <dt>{t.result.youWrote}</dt>
          <dd>
            {fmt(t.result.youWroteValue, { chars: formatNumber(result.chars, locale) })}
            {result.fileSize !== undefined ? (
              <span className="server__file"> {fmt(t.result.youWroteFile, { size: formatBytes(result.fileSize, locale) })}</span>
            ) : null}
          </dd>
        </div>
        <div className="server__col server__col--cipher">
          <dt>{t.result.serverGot}</dt>
          <dd>{fmt(t.result.serverGotValue, { size: formatBytes(base64UrlBytes(result.ciphertext), locale) })}</dd>
        </div>
      </dl>
      <p className="cipher mono" aria-hidden="true">
        {preview}…
      </p>
      <p className="field__hint">{t.result.lengthHidden}</p>
    </section>
  );
}

function BurnControl({ result, onBurned }: { result: CreatedResult; onBurned: () => void }) {
  const { t } = useI18n();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const burn = async () => {
    setBusy(true);
    setError(null);
    try {
      await burnRemote(result.id, await result.token);
      onBurned();
    } catch (err) {
      // 404: ya se leyó o caducó; el resultado es el mismo, ya no existe.
      if (err instanceof ApiError && err.code === 'not_found') onBurned();
      else setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  if (!asking) {
    return (
      <button type="button" className="btn btn--danger btn--big" onClick={() => setAsking(true)}>
        <Icon name="flame" />
        <span>{t.result.burn}</span>
      </button>
    );
  }

  return (
    <div className="confirm" role="group" aria-labelledby="burn-ask">
      <p id="burn-ask" className="confirm__text">
        {t.result.burnAsk}
      </p>
      <div className="confirm__buttons">
        <button type="button" className="btn btn--danger" onClick={burn} disabled={busy} aria-busy={busy || undefined}>
          {busy ? <RuneScramble /> : <Icon name="flame" />}
          <span>{busy ? t.result.burning : t.result.burnConfirm}</span>
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => setAsking(false)} disabled={busy}>
          {t.result.burnCancel}
        </button>
      </div>
      {error ? (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
