import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, burnRemote, ID_PATTERN, openRemote } from '../api';
import { useAnnounce } from '../components/Announcer';
import { CopyButton } from '../components/CopyButton';
import { Icon } from '../components/Icon';
import { PassphraseField } from '../components/PassphraseField';
import { RuneScramble } from '../components/RuneScramble';
import { RuneSeal, type SealState } from '../components/RuneSeal';
import {
  parseFragment,
  safeFileName,
  unlock,
  type AccessProof,
  type LinkKey,
  type SecretFile,
  type SecretPayload,
} from '../crypto';
import { fmt, useI18n } from '../i18n';
import { errorMessage } from '../lib/errors';
import { formatBytes } from '../lib/format';
import { onLinkClick } from '../router';

type Phase =
  | { k: 'ready' }
  | { k: 'working' }
  | { k: 'open'; payload: SecretPayload; viewsLeft: number }
  | { k: 'gone' }
  | { k: 'destroyed' }
  | { k: 'corrupt' }
  | { k: 'forgotten' };

function readLink(): LinkKey | null {
  try {
    return parseFragment(location.hash);
  } catch {
    return null;
  }
}

/**
 * Quita la clave de la barra de direcciones y de la entrada actual de la sesión.
 * El historial global del navegador conserva la URL original: ver I4 en
 * docs/MODELO_DE_AMENAZAS.md.
 */
function stripKey(): void {
  history.replaceState(null, '', location.pathname);
}

export function RevealScreen({ id }: { id: string }) {
  const { t, plural } = useI18n();
  const say = useAnnounce();
  // La clave vive solo en memoria y solo hasta revelar o destruir.
  const [link, setLink] = useState<LinkKey | null>(readLink);
  const [phase, setPhase] = useState<Phase>({ k: 'ready' });
  const [pass, setPass] = useState('');
  const [passError, setPassError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [burning, setBurning] = useState(false);
  const [burnedNow, setBurnedNow] = useState(false);
  const tokenRef = useRef<AccessProof | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const passRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = t.meta.revealTitle;
  }, [t]);

  // Si se pega otro fragmento en la misma pestaña, se vuelve a leer (sin llamar a la API).
  useEffect(() => {
    const onHash = () => {
      if (phase.k === 'ready') setLink(readLink());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [phase.k]);

  const focusHeading = () => requestAnimationFrame(() => headingRef.current?.focus());

  const finish = (next: Phase) => {
    stripKey();
    setLink(null);
    setPass('');
    setPhase(next);
    focusHeading();
  };

  const reveal = async (e: FormEvent) => {
    e.preventDefault();
    if (!link || phase.k === 'working') return;
    if (link.hasPassphrase && !pass) {
      setPassError(t.reveal.passRequired);
      passRef.current?.focus();
      return;
    }
    setPassError(null);
    setError(null);
    setPhase({ k: 'working' });
    const passphrase = pass || undefined;
    try {
      const unlocked = await unlock(link, passphrase);
      const token = unlocked.proof;
      const remote = await openRemote(id, token);
      let payload: SecretPayload;
      try {
        payload = await unlocked.open(remote.ciphertext);
      } catch {
        finish({ k: 'corrupt' });
        return;
      }
      tokenRef.current = remote.viewsLeft > 0 ? token : null;
      setBurnedNow(remote.viewsLeft === 0);
      finish({ k: 'open', payload, viewsLeft: remote.viewsLeft });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'not_found') return finish({ k: 'gone' });
        if (err.code === 'denied') {
          if (err.attemptsLeft === 0) return finish({ k: 'destroyed' });
          setPhase({ k: 'ready' });
          const attempts = err.attemptsLeft;
          setPassError(
            attempts === undefined
              ? t.reveal.deniedPlain
              : fmt(t.reveal.denied, { attempts: plural(attempts, t.plural.attempts) }),
          );
          requestAnimationFrame(() => passRef.current?.select());
          return;
        }
      }
      setPhase({ k: 'ready' });
      setError(errorMessage(err, t));
    }
  };

  const burn = async () => {
    const token = tokenRef.current;
    if (!token || phase.k !== 'open') return;
    setBurning(true);
    setError(null);
    try {
      await burnRemote(id, token);
    } catch (err) {
      if (!(err instanceof ApiError && err.code === 'not_found')) {
        setError(errorMessage(err, t));
        setBurning(false);
        return;
      }
    }
    tokenRef.current = null;
    setBurning(false);
    setBurnedNow(true);
    setPhase({ ...phase, viewsLeft: 0 });
    say(t.reveal.burned);
  };

  const forget = () => {
    tokenRef.current = null;
    setPhase({ k: 'forgotten' });
    focusHeading();
  };

  const validId = ID_PATTERN.test(id);
  const seal: SealState =
    phase.k === 'working'
      ? 'working'
      : phase.k === 'open'
        ? burnedNow
          ? 'burned'
          : 'open'
        : phase.k === 'gone' || phase.k === 'destroyed' || phase.k === 'corrupt'
          ? 'burned'
          : 'idle';

  const createLink = (
    <a className="btn btn--ghost btn--big" href="/" onClick={onLinkClick}>
      <Icon name="plus" />
      <span>{t.reveal.createOwn}</span>
    </a>
  );

  let title: string;
  let body: ReactNode;

  if (phase.k === 'open') {
    title = t.reveal.openedTitle;
    body = (
      <Opened
        payload={phase.payload}
        viewsLeft={phase.viewsLeft}
        burnedNow={burnedNow}
        burning={burning}
        error={error}
        onBurn={burn}
        onForget={forget}
      />
    );
  } else if (phase.k === 'gone' || phase.k === 'destroyed' || phase.k === 'corrupt' || phase.k === 'forgotten') {
    const copy = {
      gone: [t.reveal.goneTitle, t.reveal.goneLead],
      destroyed: [t.reveal.destroyedTitle, t.reveal.deniedFinal],
      corrupt: [t.reveal.goneTitle, t.reveal.corrupt],
      forgotten: [t.reveal.forgotten, t.reveal.forgottenLead],
    }[phase.k];
    title = copy[0]!;
    body = (
      <div className="card notice">
        <p className="notice__text">{copy[1]}</p>
        {createLink}
      </div>
    );
  } else if (!validId || !link) {
    title = validId ? t.reveal.incomplete : t.reveal.invalidId;
    body = (
      <div className="card notice" role="alert">
        <p className="notice__text">{t.reveal.incompleteLead}</p>
        {createLink}
      </div>
    );
  } else {
    const working = phase.k === 'working';
    title = t.reveal.title;
    body = (
      <form className="card form reveal-form" onSubmit={reveal} noValidate aria-label={t.reveal.submit}>
        {link.hasPassphrase ? (
          <PassphraseField
            mode="reveal"
            label={t.reveal.passLabel}
            value={pass}
            onChange={(v) => {
              setPass(v);
              if (passError) setPassError(null);
            }}
            hint={t.reveal.passHint}
            error={passError ?? undefined}
            disabled={working}
            inputRef={passRef}
          />
        ) : null}
        <button type="submit" className="btn btn--primary btn--big" disabled={working} aria-busy={working || undefined}>
          {working ? <RuneScramble /> : <Icon name="eye" />}
          <span>{working ? t.reveal.working : t.reveal.submit}</span>
        </button>
        {error ? (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        ) : null}
        <p className="sr-only" role="status" aria-live="polite">
          {working ? t.reveal.working : ''}
        </p>
      </form>
    );
  }

  return (
    <>
      <section className="hero hero--reveal">
        <RuneSeal state={seal} />
        <h1 ref={headingRef} tabIndex={-1} className="hero__title">
          {title}
        </h1>
        {phase.k === 'ready' || phase.k === 'working' ? (
          validId && link ? <p className="hero__lead">{t.reveal.lead}</p> : null
        ) : null}
      </section>
      {body}
    </>
  );
}

interface OpenedProps {
  payload: SecretPayload;
  viewsLeft: number;
  burnedNow: boolean;
  burning: boolean;
  error: string | null;
  onBurn: () => void;
  onForget: () => void;
}

function Opened({ payload, viewsLeft, burnedNow, burning, error, onBurn, onForget }: OpenedProps) {
  const { t, plural } = useI18n();

  return (
    <div className="opened">
      <div className={`status ${burnedNow ? 'status--burned' : 'status--left'}`} role="status">
        {burnedNow ? (
          <>
            <Icon name="flame" />
            <div>
              <strong className="status__title">{t.reveal.burned}</strong>
              <span className="status__lead">{t.reveal.burnedLead}</span>
            </div>
          </>
        ) : (
          <>
            <Icon name="eye" />
            <span>{fmt(t.reveal.viewsLeft, { left: plural(viewsLeft, t.plural.viewsLeft) })}</span>
          </>
        )}
      </div>

      <SecretContent payload={payload} />

      <div className="result__actions">
        <button type="button" className="btn btn--ghost btn--big" onClick={onForget}>
          <Icon name="close" />
          <span>{t.reveal.forget}</span>
        </button>
        {viewsLeft > 0 ? (
          <button type="button" className="btn btn--danger btn--big" onClick={onBurn} disabled={burning} aria-busy={burning || undefined}>
            {burning ? <RuneScramble /> : <Icon name="flame" />}
            <span>{burning ? t.reveal.burning : t.reveal.burn}</span>
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Lo que se ha descifrado: texto (ocultable y copiable) y archivo adjunto. También lo usa la recogida de peticiones. */
export function SecretContent({ payload }: { payload: SecretPayload }) {
  const { t } = useI18n();
  const [hidden, setHidden] = useState(false);
  const textRef = useRef<HTMLPreElement>(null);
  return (
    <section className="card secret" aria-labelledby="secret-label">
      <div className="secret__head">
        <h2 id="secret-label" className="field__label">
          {t.reveal.contentLabel}
        </h2>
        {payload.text ? (
          <div className="secret__tools">
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setHidden((h) => !h)} aria-pressed={hidden}>
              <Icon name={hidden ? 'eye' : 'eyeOff'} />
              <span>{hidden ? t.reveal.showText : t.reveal.hideText}</span>
            </button>
            <CopyButton
              className="btn--small"
              text={payload.text}
              label={t.reveal.copy}
              copiedLabel={t.reveal.copied}
              announce={t.reveal.copiedAnnounce}
              fallbackMessage={t.reveal.copyFallback}
              target={hidden ? undefined : textRef}
            />
          </div>
        ) : null}
      </div>
      {payload.text ? (
        hidden ? (
          <p className="secret__text secret__text--hidden">{t.reveal.hiddenText}</p>
        ) : (
          <pre ref={textRef} className="secret__text mono">
            {payload.text}
          </pre>
        )
      ) : (
        <p className="field__hint">{t.reveal.emptyText}</p>
      )}
      {payload.file ? <Download file={payload.file} /> : null}
    </section>
  );
}

/** Descarga siempre como octet-stream: un HTML adjunto nunca se interpreta en nuestro origen. */
function Download({ file }: { file: SecretFile }) {
  const { t, locale } = useI18n();
  const name = safeFileName(file.name);

  // La URL del blob existe solo durante el clic: no queda ninguna referencia viva al archivo.
  const download = () => {
    const blob = new Blob([file.data as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="download">
      <div className="file-chip">
        <Icon name="file" />
        <span className="file-chip__name mono">{name}</span>
        <span className="file-chip__size">{formatBytes(file.data.length, locale)}</span>
      </div>
      <button type="button" className="btn btn--primary" onClick={download}>
        <Icon name="download" />
        <span>{t.reveal.download}</span>
      </button>
      <p className="field__hint">{t.reveal.downloadHint}</p>
    </div>
  );
}
