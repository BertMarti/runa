import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { HTML_LANG, LANG_NAMES, LANGS, useI18n, type Lang } from '../i18n';
import { Icon } from './Icon';

/**
 * Selector de idioma: un botón con el código del idioma activo que despliega la lista. Cinco botones seguidos no
 * caben a 320 px junto a la marca y el tema. Se cierra con Escape, al elegir, al pulsar fuera o al salir con el
 * tabulador; al cerrar con Escape o al elegir, el foco vuelve al botón.
 */
export function LangPicker() {
  const { t, lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) toggleRef.current?.focus();
  };

  const choose = (code: Lang) => {
    setLang(code);
    close(true);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      close(true);
    }
  };

  const onBlur = (event: FocusEvent) => {
    if (open && !rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
  };

  const label = `${t.header.language}: ${LANG_NAMES[lang]}`;
  return (
    <div className="lang" ref={rootRef} onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={toggleRef}
        type="button"
        className="lang__toggle"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="lang__code" lang={HTML_LANG[lang]} aria-hidden="true">
          {lang.toUpperCase()}
        </span>
        <Icon name="chevron" className="lang__chevron" />
      </button>
      <ul className="lang__menu" id={listId} hidden={!open} aria-label={t.header.language}>
        {LANGS.map((code) => (
          <li key={code}>
            <button
              type="button"
              className="lang__option"
              lang={HTML_LANG[code]}
              aria-pressed={lang === code}
              onClick={() => choose(code)}
            >
              <span className="lang__name">{LANG_NAMES[code]}</span>
              <span className="lang__abbr" aria-hidden="true">
                {code.toUpperCase()}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
