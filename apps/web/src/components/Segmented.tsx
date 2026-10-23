import { useId } from 'react';

interface Option<T> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string | number> {
  legend: string;
  name: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}

/** Grupo de radios nativos con aspecto de selector segmentado (teclado y lector de pantalla gratis). */
export function Segmented<T extends string | number>({ legend, name, value, options, onChange, disabled }: SegmentedProps<T>) {
  const id = useId();
  return (
    <fieldset className="segmented" disabled={disabled}>
      <legend className="field__label">{legend}</legend>
      <div className="segmented__track">
        {options.map((opt) => {
          const optId = `${id}-${opt.value}`;
          return (
            <span key={String(opt.value)} className="segmented__item">
              <input
                id={optId}
                type="radio"
                name={name}
                className="segmented__input"
                checked={opt.value === value}
                onChange={() => onChange(opt.value)}
              />
              <label htmlFor={optId} className="segmented__label">
                {opt.label}
              </label>
            </span>
          );
        })}
      </div>
    </fieldset>
  );
}
