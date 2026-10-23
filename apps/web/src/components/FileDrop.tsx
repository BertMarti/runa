import { useId, useRef, useState, type DragEvent } from 'react';
import { MAX_FILE_BYTES } from '../crypto';
import { fmt, useI18n } from '../i18n';
import { formatBytes } from '../lib/format';
import { useAnnounce } from './Announcer';
import { Icon } from './Icon';

interface FileDropProps {
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
}

/** Un único adjunto: arrastrar y soltar o botón. Rechaza lo que supere el límite antes de leerlo. */
export function FileDrop({ file, onChange, disabled }: FileDropProps) {
  const { t, locale } = useI18n();
  const say = useAnnounce();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const max = formatBytes(MAX_FILE_BYTES, locale);

  const accept = (next: File | undefined) => {
    if (!next) return;
    if (next.size > MAX_FILE_BYTES) {
      setError(fmt(t.create.fileTooBig, { name: next.name, size: formatBytes(next.size, locale), max }));
      return;
    }
    setError(null);
    onChange(next);
    say(fmt(t.create.fileAdded, { name: next.name }));
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (!disabled) accept(e.dataTransfer.files[0]);
  };

  const remove = () => {
    onChange(null);
    setError(null);
    say(t.create.fileRemoved);
    inputRef.current?.focus();
  };

  return (
    <div className="field">
      <span className="field__label" id={`${id}-label`}>
        {t.create.fileLabel} <span className="field__optional">({t.create.fileOptional})</span>
      </span>
      {file ? (
        <div className="file-chip">
          <Icon name="file" />
          <span className="file-chip__name mono">{file.name}</span>
          <span className="file-chip__size">{formatBytes(file.size, locale)}</span>
          <button
            type="button"
            className="icon-btn"
            onClick={remove}
            disabled={disabled}
            aria-label={fmt(t.create.fileRemove, { name: file.name })}
          >
            <Icon name="close" />
          </button>
        </div>
      ) : (
        <div
          className="drop"
          data-dragging={dragging || undefined}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <span className="drop__text">
            {t.create.fileDrop} <span className="drop__or">{t.create.fileOr}</span>
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          >
            <Icon name="plus" />
            <span>{t.create.fileChoose}</span>
          </button>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-labelledby={`${id}-label`}
        onChange={(e) => {
          accept(e.target.files?.[0]);
          // Permite volver a elegir el mismo archivo tras quitarlo.
          e.target.value = '';
        }}
      />
      <p id={hintId} className="field__hint">
        {fmt(t.create.fileHint, { max })}
      </p>
      {error ? (
        <p id={errorId} className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
