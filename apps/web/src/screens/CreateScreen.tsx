import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createSecret, getConfig, type DeployConfig } from '../api';
import { Faq } from '../components/Faq';
import { FileDrop } from '../components/FileDrop';
import { HowItWorks } from '../components/HowItWorks';
import { Icon } from '../components/Icon';
import { PassphraseField } from '../components/PassphraseField';
import { RuneScramble } from '../components/RuneScramble';
import { RuneSeal, type SealState } from '../components/RuneSeal';
import { Segmented } from '../components/Segmented';
import { TrustBadges } from '../components/TrustBadges';
import { useAnnounce } from '../components/Announcer';
import { LARGE_SECRET_BYTES, LARGE_SECRET_MAX_TTL, MAX_TEXT_CHARS, sealSecret, VIEW_OPTIONS, type Ttl } from '../crypto';
import { fmt, useI18n } from '../i18n';
import { delay, errorMessage } from '../lib/errors';
import { formatNumber, TTLS, ttlLabel } from '../lib/format';
import { generatePassphrase, generatePassword } from '../lib/random';
import { ResultView, type CreatedResult } from './ResultView';

// El cifrado sin contraseña es instantáneo; un mínimo evita un parpadeo ilegible.
const MIN_SEALING_MS = 700;

export function CreateScreen() {
  const { t } = useI18n();
  const [sealing, setSealing] = useState(false);
  const [result, setResult] = useState<CreatedResult | null>(null);
  const [burned, setBurned] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = t.meta.title;
  }, [t]);

  // Al cambiar de fase, el foco va al titular para que el lector de pantalla lo anuncie.
  const focusHeading = () => requestAnimationFrame(() => headingRef.current?.focus());

  const reset = () => {
    setResult(null);
    setBurned(false);
    focusHeading();
  };

  const seal: SealState = sealing ? 'working' : burned ? 'burned' : result ? 'sealed' : 'idle';
  const title = burned ? t.result.burnedTitle : result ? t.result.title : t.create.title;

  return (
    <>
      <section className="hero">
        <RuneSeal state={seal} />
        <h1 ref={headingRef} tabIndex={-1} className="hero__title">
          {title}
        </h1>
        {!result ? <p className="hero__lead">{t.create.lead}</p> : null}
      </section>

      {result ? (
        <ResultView result={result} burned={burned} onBurned={() => setBurned(true)} onReset={reset} />
      ) : (
        <CreateForm
          sealing={sealing}
          onSealing={setSealing}
          onCreated={(r) => {
            setResult(r);
            focusHeading();
          }}
        />
      )}

      <div className="info">
        <HowItWorks />
        <TrustBadges />
        <Faq />
      </div>
    </>
  );
}

interface CreateFormProps {
  sealing: boolean;
  onSealing: (sealing: boolean) => void;
  onCreated: (result: CreatedResult) => void;
}

function CreateForm({ sealing, onSealing, onCreated }: CreateFormProps) {
  const { t, locale } = useI18n();
  const say = useAnnounce();
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [ttl, setTtl] = useState<Ttl>(86_400);
  const [views, setViews] = useState<number>(1);
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deploy, setDeploy] = useState<DeployConfig>({ publicUrl: null, createAllowed: true });
  const textRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const counterId = `${id}-counter`;
  const textErrorId = `${id}-text-error`;
  const emptyId = `${id}-empty`;
  const errorId = `${id}-error`;

  const tooLong = text.length > MAX_TEXT_CHARS;
  // Estimación por lo alto (3 bytes por carácter y margen para la cabecera): el servidor aplica la regla exacta.
  const large = (file?.size ?? 0) + text.length * 3 + 512 > LARGE_SECRET_BYTES;
  const ttlOptions = large ? TTLS.filter((v) => v <= LARGE_SECRET_MAX_TTL) : TTLS;
  // Los secretos grandes caducan como mucho en un día; si se quita el archivo, vuelve la elección anterior.
  const effectiveTtl: Ttl = large && ttl > LARGE_SECRET_MAX_TTL ? LARGE_SECRET_MAX_TTL : ttl;
  const empty = text.length === 0 && !file;
  const canSubmit = !empty && !tooLong && !sealing && deploy.createAllowed;

  // Dominio de los enlaces y permiso para crear: el servidor puede publicarse para leer desde fuera
  // y permitir crear solo desde casa (CREATE_FROM / PUBLIC_URL).
  useEffect(() => {
    const ctl = new AbortController();
    void getConfig(ctl.signal).then((cfg) => {
      if (!ctl.signal.aborted) setDeploy(cfg);
    });
    return () => ctl.abort();
  }, []);

  const insertPassword = () => {
    const pw = generatePassword();
    const el = textRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + pw + text.slice(end);
    setText(next);
    say(t.create.insertedPassword);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start, start + pw.length);
    });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    onSealing(true);
    const passphrase = pass || undefined;
    try {
      let data: Uint8Array | undefined;
      if (file) {
        try {
          data = new Uint8Array(await file.arrayBuffer());
        } catch {
          setError(t.create.fileReadError);
          return;
        }
      }
      const [sealed] = await Promise.all([
        sealSecret({ text, file: file && data ? { name: file.name, type: file.type, data } : undefined }, passphrase),
        delay(MIN_SEALING_MS),
      ]);
      const created = await createSecret({
        ciphertext: sealed.ciphertext,
        verifier: sealed.verifier,
        linkVerifier: sealed.linkVerifier,
        ttl: effectiveTtl,
        views,
      });

      // Token para «Destruir ahora»: sale del mismo cifrado, sin repetir PBKDF2
      // ni conservar la contraseña en memoria.
      const token = Promise.resolve(sealed.proof);

      onCreated({
        id: created.id,
        link: `${deploy.publicUrl ?? location.origin}/s/${created.id}#${sealed.fragment}`,
        expiresAt: created.expiresAt,
        views,
        hasPassphrase: Boolean(passphrase),
        ciphertext: sealed.ciphertext,
        chars: text.length,
        fileSize: data?.length,
        token,
      });
      // El formulario se desmonta; no dejamos el texto en el estado.
      setText('');
      setFile(null);
      setPass('');
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      onSealing(false);
    }
  };

  const textDescribedBy = [counterId, tooLong && textErrorId].filter(Boolean).join(' ');

  return (
    <form className="card form" onSubmit={onSubmit} aria-label={t.create.formLabel} noValidate>
      <div className="field">
        <div className="field__head">
          <label className="field__label" htmlFor={`${id}-text`}>
            {t.create.textLabel}
          </label>
          <button type="button" className="link-btn" onClick={insertPassword} disabled={sealing}>
            <Icon name="dice" />
            <span>{t.create.insertPassword}</span>
          </button>
        </div>
        <textarea
          ref={textRef}
          id={`${id}-text`}
          className="secret-input mono"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.create.textPlaceholder}
          rows={7}
          autoComplete="off"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          disabled={sealing}
          aria-invalid={tooLong || undefined}
          aria-describedby={textDescribedBy}
        />
        <p id={counterId} className="counter" data-over={tooLong || undefined}>
          {fmt(t.create.counter, { n: formatNumber(text.length, locale), max: formatNumber(MAX_TEXT_CHARS, locale) })}
        </p>
        {tooLong ? (
          <p id={textErrorId} className="field__error" role="alert">
            {fmt(t.create.tooLong, { max: formatNumber(MAX_TEXT_CHARS, locale) })}
          </p>
        ) : null}
      </div>

      <FileDrop file={file} onChange={setFile} disabled={sealing} />

      <div className="form__options">
        <Segmented
          legend={t.create.expiry}
          name={`${id}-ttl`}
          value={effectiveTtl}
          options={ttlOptions.map((v) => ({ value: v, label: ttlLabel(v, t) }))}
          onChange={setTtl}
          disabled={sealing}
        />
        <Segmented
          legend={t.create.views}
          name={`${id}-views`}
          value={views}
          options={VIEW_OPTIONS.map((v) => ({ value: v, label: String(v) }))}
          onChange={setViews}
          disabled={sealing}
        />
      </div>
      {large ? <p className="field__hint">{t.create.largeExpiry}</p> : null}

      <PassphraseField
        mode="create"
        label={
          <>
            {t.create.passLabel} <span className="field__optional">({t.create.passOptional})</span>
          </>
        }
        value={pass}
        onChange={setPass}
        hint={t.create.passHint}
        disabled={sealing}
        showStrength
        action={
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setPass(generatePassphrase());
              say(t.create.passGenerated);
            }}
            disabled={sealing}
          >
            <Icon name="dice" />
            <span>{t.create.passGenerate}</span>
          </button>
        }
      />

      <div className="form__submit">
        {deploy.createAllowed ? null : (
          <p className="alert alert--note" role="note">
            <Icon name="lock" />
            <span>{t.create.createDisabled}</span>
          </p>
        )}
        <button
          type="submit"
          className="btn btn--primary btn--big"
          disabled={!canSubmit}
          aria-describedby={[empty && emptyId, error && errorId].filter(Boolean).join(' ') || undefined}
          aria-busy={sealing || undefined}
        >
          {sealing ? (
            <>
              <RuneScramble />
              <span>{t.create.sealing}</span>
            </>
          ) : (
            <>
              <Icon name="lock" />
              <span>{t.create.submit}</span>
            </>
          )}
        </button>
        {empty ? (
          <p id={emptyId} className="field__hint form__empty">
            {t.create.emptyHint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} className="alert alert--error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {sealing ? t.create.sealing : ''}
      </p>
    </form>
  );
}
