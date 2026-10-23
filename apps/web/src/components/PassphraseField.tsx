import { useId, useState, type ReactNode, type Ref } from 'react';
import { fmt, useI18n } from '../i18n';
import { estimateEntropy, strengthOf } from '../lib/random';
import { Icon } from './Icon';

interface PassphraseFieldProps {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  /** `create` sugiere al gestor de contraseñas una nueva; `reveal` no autocompleta. */
  mode: 'create' | 'reveal';
  hint?: string;
  error?: string;
  disabled?: boolean;
  /** Botón extra (p. ej. «Generar») al lado del campo. */
  action?: ReactNode;
  showStrength?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}

export function PassphraseField(props: PassphraseFieldProps) {
  const { label, value, onChange, mode, hint, error, disabled, action, showStrength, inputRef } = props;
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const strengthId = `${id}-strength`;
  const describedBy =
    [hint && hintId, error && errorId, showStrength && value && strengthId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="pass">
        <div className="pass__box" data-invalid={error ? true : undefined}>
          <input
            ref={inputRef}
            id={id}
            className="pass__input mono"
            type={visible ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoComplete={mode === 'create' ? 'new-password' : 'off'}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
          />
          <button
            type="button"
            className="pass__toggle"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? t.pass.hide : t.pass.show}
            aria-pressed={visible}
            disabled={disabled}
          >
            <Icon name={visible ? 'eyeOff' : 'eye'} />
          </button>
        </div>
        {action}
      </div>
      {showStrength && value ? <StrengthMeter id={strengthId} value={value} /> : null}
      {hint ? (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function StrengthMeter({ id, value }: { id: string; value: string }) {
  const { t } = useI18n();
  const bits = estimateEntropy(value);
  const level = strengthOf(bits);
  const score = { weak: 1, fair: 2, good: 3, strong: 4 }[level];
  return (
    <div id={id} className="strength" data-level={level}>
      <span className="strength__bars" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className="strength__bar" data-on={n <= score || undefined} />
        ))}
      </span>
      <span className="strength__text">
        {t.pass.strength}: <strong>{t.pass[level]}</strong>
        <span className="strength__bits">, {fmt(t.pass.bits, { bits })}</span>
      </span>
    </div>
  );
}
