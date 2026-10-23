import type { CSSProperties } from 'react';
import { Rune, type RuneName } from './runes';

const ROW: RuneName[] = ['kaunan', 'isaz', 'perthro', 'hagalaz', 'eihwaz', 'raido'];

/** Indicador de trabajo: una hilera de runas que parpadean en cascada. */
export function RuneScramble({ className }: { className?: string }) {
  return (
    <span className={`scramble ${className ?? ''}`} aria-hidden="true">
      {ROW.map((name, i) => (
        <span key={name} className="scramble__cell" style={{ '--i': i } as CSSProperties}>
          <Rune name={name} />
        </span>
      ))}
    </span>
  );
}
