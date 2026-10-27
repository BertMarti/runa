/**
 * Pedir un secreto (ver docs/PROTOCOLO.md § «Pedir un secreto»):
 * - `RequestForm` / `RequestResult`: quien pide crea la petición y recibe dos enlaces.
 * - `SendScreen` (`/r/:id`): quien envía cifra para la clave pública del enlace.
 * - `PickupScreen` (`/p/:id`): quien pidió lo recoge con su clave privada.
 *
 * Igual que al revelar, ninguna pantalla llama a la API al cargar (los bots de vista previa no gastan nada) y
 * la clave del fragmento se borra de la barra en cuanto deja de hacer falta.
 */
import { useEffect, useId, useState, type FormEvent } from 'react';
import { ApiError, cancelRequest, createRequest, fillRequest, getConfig, openRequest, type DeployConfig } from '../api';
import { FileDrop } from '../components/FileDrop';
import { Icon } from '../components/Icon';
import { RuneScramble } from '../components/RuneScramble';
import { RuneSeal, type SealState } from '../components/RuneSeal';
import { Segmented } from '../components/Segmented';
import {
  createRequestKeys,
  MAX_TEXT_CHARS,
  parsePickupFragment,
  parseSendFragment,
  preparePickup,
  sealForRequest,
  type SecretPayload,
  type Ttl,
} from '../crypto';
import { fmt, useI18n, type Messages } from '../i18n';
import { errorMessage } from '../lib/errors';
import { formatNumber, TTLS, ttlLabel } from '../lib/format';
import { LinkBlock } from './ResultView';
import { SecretContent } from './RevealScreen';

/** Quita la clave de la barra de direcciones (y de esta entrada del historial). */
function stripKey(): void {
  history.replaceState(history.state, '', location.pathname);
}

function requestError(err: unknown, t: Messages): string {
  if (err instanceof ApiError && err.code === 'not_found') return t.request.notFound;
  return errorMessage(err, t);
}

/* ---------- Crear la petición ---------- */

export interface CreatedRequest {
  sendLink: string;
  pickupLink: string;
  expiresAt: Date;
}

export function RequestForm({ onCreated }: { onCreated: (r: CreatedRequest) => void }) {
  const { t } = useI18n();
  const id = useId();
  const [ttl, setTtl] = useState<Ttl>(86_400);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deploy, setDeploy] = useState<DeployConfig>({ publicUrl: null, createAllowed: true });

  useEffect(() => {
    const ctl = new AbortController();
    void getConfig(ctl.signal).then((cfg) => {
      if (!ctl.signal.aborted) setDeploy(cfg);
    });
    return () => ctl.abort();
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !deploy.createAllowed) return;
    setBusy(true);
    setError(null);
    try {
      const keys = await createRequestKeys();
      const created = await createRequest({ sendVerifier: keys.sendVerifier, openVerifier: keys.openVerifier, ttl });
      const base = deploy.publicUrl ?? location.origin;
      onCreated({
        sendLink: `${base}/r/${created.id}#${keys.sendFragment}`,
        pickupLink: `${base}/p/${created.id}#${keys.pickupFragment}`,
        expiresAt: created.expiresAt,
      });
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card form" onSubmit={onSubmit} aria-label={t.request.formLabel} noValidate>
      <p className="field__hint">{t.request.lead}</p>
      <div className="form__options">
        <Segmented
          legend={t.create.expiry}
          name={`${id}-ttl`}
          value={ttl}
          options={TTLS.map((v) => ({ value: v, label: ttlLabel(v, t) }))}
          onChange={setTtl}
          disabled={busy}
        />
      </div>
      <div className="form__submit">
        {deploy.createAllowed ? null : (
          <p className="alert alert--note" role="note">
            <Icon name="lock" />
            <span>{t.create.createDisabled}</span>
          </p>
        )}
        <button type="submit" className="btn btn--primary btn--big" disabled={busy || !deploy.createAllowed} aria-busy={busy || undefined}>
          {busy ? <RuneScramble /> : <Icon name="key" />}
          <span>{busy ? t.request.creating : t.request.create}</span>
        </button>
      </div>
      {error ? (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function RequestResult({ result, onReset }: { result: CreatedRequest; onReset: () => void }) {
  const { t, formatDate } = useI18n();
  return (
    <div className="result">
      <p className="result__lead">{t.request.resultLead}</p>
      <LinkBlock link={result.sendLink} label={t.request.sendLinkLabel} qrLabel={t.request.sendQr} />
      <p className="alert alert--note" role="note">
        <Icon name="lock" />
        <span>{t.request.pickupWarning}</span>
      </p>
      <LinkBlock link={result.pickupLink} label={t.request.pickupLinkLabel} qrLabel={t.request.pickupQr} />
      <p className="field__hint">{fmt(t.request.expires, { date: formatDate(result.expiresAt) })}</p>
      <div className="result__actions">
        <button type="button" className="btn btn--ghost btn--big" onClick={onReset}>
          <Icon name="plus" />
          <span>{t.request.another}</span>
        </button>
      </div>
    </div>
  );
}

/* ---------- Enviar a una petición (/r/:id) ---------- */

export function SendScreen({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const formId = useId();
  const [key] = useState(() => parseSendFragment(location.hash));
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = `${t.request.sendTitle} · RUNA`;
  }, [t]);

  const tooLong = text.length > MAX_TEXT_CHARS;
  const empty = text.length === 0 && !file;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!key || busy || empty || tooLong) return;
    setBusy(true);
    setError(null);
    try {
      const data = file ? new Uint8Array(await file.arrayBuffer()) : undefined;
      const payload: SecretPayload = { text, file: file && data ? { name: file.name, type: file.type, data } : undefined };
      const sealed = await sealForRequest(payload, key);
      await fillRequest(id, sealed);
      stripKey();
      setText('');
      setFile(null);
      setSent(true);
    } catch (err) {
      setError(requestError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const seal: SealState = busy ? 'working' : sent ? 'sealed' : 'idle';

  return (
    <>
      <section className="hero">
        <RuneSeal state={seal} />
        <h1 className="hero__title">{sent ? t.request.sentTitle : t.request.sendTitle}</h1>
        <p className="hero__lead">{sent ? t.request.sentLead : t.request.sendLead}</p>
      </section>

      {!key ? (
        <p className="alert alert--error" role="alert">
          {t.request.badSendLink}
        </p>
      ) : sent ? null : (
        <form className="card form" onSubmit={onSubmit} aria-label={t.request.sendFormLabel} noValidate>
          <div className="field">
            <label className="field__label" htmlFor={`${formId}-text`}>
              {t.create.textLabel}
            </label>
            <textarea
              id={`${formId}-text`}
              className="secret-input mono"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t.create.textPlaceholder}
              rows={6}
              autoComplete="off"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              disabled={busy}
              aria-invalid={tooLong || undefined}
            />
            <p className="counter" data-over={tooLong || undefined}>
              {fmt(t.create.counter, { n: formatNumber(text.length, locale), max: formatNumber(MAX_TEXT_CHARS, locale) })}
            </p>
          </div>
          <FileDrop file={file} onChange={setFile} disabled={busy} />
          <div className="form__submit">
            <button type="submit" className="btn btn--primary btn--big" disabled={busy || empty || tooLong} aria-busy={busy || undefined}>
              {busy ? <RuneScramble /> : <Icon name="lock" />}
              <span>{busy ? t.request.sending : t.request.sendSubmit}</span>
            </button>
          </div>
          {error ? (
            <p className="alert alert--error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      )}
    </>
  );
}

/* ---------- Recoger (/p/:id) ---------- */

type PickupState =
  | { s: 'idle' }
  | { s: 'busy' }
  | { s: 'waiting'; expiresAt: Date }
  | { s: 'opened'; payload: SecretPayload }
  | { s: 'cancelled' };

export function PickupScreen({ id }: { id: string }) {
  const { t, formatDate } = useI18n();
  const [key] = useState(() => parsePickupFragment(location.hash));
  const [state, setState] = useState<PickupState>({ s: 'idle' });
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = `${t.request.pickupTitle} · RUNA`;
  }, [t]);

  const check = async () => {
    if (!key) return;
    setError(null);
    setState({ s: 'busy' });
    try {
      const handle = await preparePickup(key);
      const res = await openRequest(id, handle.proof);
      if (res.status === 'waiting') {
        setState({ s: 'waiting', expiresAt: res.expiresAt });
        return;
      }
      const payload = await handle.open(res.ciphertext, res.ephemeral);
      stripKey();
      setState({ s: 'opened', payload });
    } catch (err) {
      setError(requestError(err, t));
      setState({ s: 'idle' });
    }
  };

  const cancel = async () => {
    if (!key) return;
    setCancelling(true);
    setError(null);
    try {
      await cancelRequest(id, (await preparePickup(key)).proof);
      stripKey();
      setState({ s: 'cancelled' });
    } catch (err) {
      setError(requestError(err, t));
    } finally {
      setCancelling(false);
    }
  };

  const busy = state.s === 'busy';
  const seal: SealState = busy ? 'working' : state.s === 'opened' ? 'sealed' : state.s === 'cancelled' ? 'burned' : 'idle';

  return (
    <>
      <section className="hero hero--reveal">
        <RuneSeal state={seal} />
        <h1 className="hero__title">{state.s === 'opened' ? t.request.received : t.request.pickupTitle}</h1>
        {state.s === 'opened' || state.s === 'cancelled' ? null : <p className="hero__lead">{t.request.pickupLead}</p>}
      </section>

      {!key ? (
        <p className="alert alert--error" role="alert">
          {t.request.badPickupLink}
        </p>
      ) : state.s === 'opened' ? (
        <div className="opened">
          <SecretContent payload={state.payload} />
        </div>
      ) : state.s === 'cancelled' ? (
        <p className="alert alert--note" role="status">
          <Icon name="flame" />
          <span>{t.request.cancelled}</span>
        </p>
      ) : (
        <div className="card form">
          {state.s === 'waiting' ? (
            <p className="alert alert--note" role="status">
              <Icon name="eye" />
              <span>{fmt(t.request.waiting, { date: formatDate(state.expiresAt) })}</span>
            </p>
          ) : null}
          <div className="result__actions">
            <button type="button" className="btn btn--primary btn--big" onClick={check} disabled={busy || cancelling} aria-busy={busy || undefined}>
              {busy ? <RuneScramble /> : <Icon name="key" />}
              <span>{busy ? t.request.checking : t.request.check}</span>
            </button>
            <button type="button" className="btn btn--ghost btn--big" onClick={cancel} disabled={busy || cancelling} aria-busy={cancelling || undefined}>
              <Icon name="close" />
              <span>{cancelling ? t.request.cancelling : t.request.cancel}</span>
            </button>
          </div>
        </div>
      )}
      {error ? (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
