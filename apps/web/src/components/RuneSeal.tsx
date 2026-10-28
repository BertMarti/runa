import { useId, type CSSProperties } from 'react';
import { FUTHARK, RUNES } from './runes';

export type SealState = 'idle' | 'working' | 'sealed' | 'open' | 'burned';

const RING_RADIUS = 96;
const EMBERS = 14;

/** Variables CSS por elemento (CSSOM: compatible con `style-src 'self'`). */
const vars = (v: Record<string, string | number>) => v as CSSProperties;

/**
 * El sello: el futhark completo girando alrededor de raido (R).
 * Gira despacio en reposo, deprisa mientras se cifra y se deshace en ascuas
 * cuando el secreto se destruye. Puramente decorativo.
 */
export function RuneSeal({ state, className }: { state: SealState; className?: string }) {
  // `useId` puede contener caracteres no válidos en `url(#…)`.
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const grad = `seal-grad-${uid}`;
  const core = `seal-core-${uid}`;

  return (
    <div className={`seal seal--${state}${className ? ` ${className}` : ''}`} aria-hidden="true">
      <svg className="seal__svg" viewBox="-120 -120 240 240" focusable="false">
        <defs>
          <linearGradient id={grad} x1="-1" y1="-1" x2="1" y2="1" gradientUnits="objectBoundingBox">
            <stop className="seal__stop seal__stop--a" offset="0.25" />
            <stop className="seal__stop seal__stop--b" offset="0.75" />
          </linearGradient>
          <radialGradient id={core} r="0.5">
            <stop className="seal__stop seal__stop--core-in" offset="0" />
            <stop className="seal__stop seal__stop--core-out" offset="1" />
          </radialGradient>
        </defs>

        <circle className="seal__halo" r="112" />
        <circle className="seal__hair" r="110" />
        <circle className="seal__hair seal__hair--inner" r="82" />

        <g className="seal__spin">
          <g className="seal__ring">
            {/* Caja simétrica: con `transform-box: fill-box` el giro queda centrado. */}
            <circle className="seal__bbox" r="110" />
            {FUTHARK.map((name, i) => (
              <g key={name} transform={`rotate(${(i * 360) / FUTHARK.length}) translate(0 ${-RING_RADIUS})`}>
                <g className="seal__rune" style={vars({ '--i': i })}>
                  <path d={RUNES[name]} transform="translate(-4 -7)" />
                </g>
              </g>
            ))}
          </g>
        </g>

        <circle className="seal__core" r="70" fill={`url(#${core})`} stroke={`url(#${grad})`} />
        <circle className="seal__hair seal__hair--dash" r="60" />
        <g className="seal__mark">
          <path d={RUNES.raido} transform="translate(-14 -24.5) scale(3.5)" stroke={`url(#${grad})`} />
        </g>

        <g className="seal__embers">
          {Array.from({ length: EMBERS }, (_, i) => (
            <circle
              key={i}
              className="seal__ember"
              r={1.2 + (i % 3) * 0.6}
              cx={Math.round(Math.sin(i * 2.4) * 70)}
              cy={Math.round(Math.cos(i * 2.4) * 40) + 20}
              style={vars({ '--i': i })}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
