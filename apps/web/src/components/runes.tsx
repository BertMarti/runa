/**
 * Futhark antiguo dibujado como trazos en una caja de 8×14.
 * Se dibujan a mano en vez de usar una fuente: casi ningún sistema trae
 * glifos rúnicos y la CSP no permite fuentes externas.
 */
export const RUNES = {
  fehu: 'M2 14V0M2 5L7 1M2 9L7 5',
  uruz: 'M1 14V0L7 4V14',
  thurisaz: 'M2 0V14M2 4L6 7L2 10',
  ansuz: 'M2 0V14M2 0L7 4M2 4L7 8',
  raido: 'M2 14V0L6 3.5L2 7L6 14',
  kaunan: 'M6 3L2 7L6 11',
  gebo: 'M0 0L8 14M8 0L0 14',
  wunjo: 'M2 14V0L6 3.5L2 7',
  hagalaz: 'M1 0V14M7 0V14M1 5L7 9',
  naudiz: 'M4 0V14M1 5L7 9',
  isaz: 'M4 0V14',
  jera: 'M3 2L0 5L3 8M5 6L8 9L5 12',
  eihwaz: 'M4 0V14M4 0L7 3M4 14L1 11',
  perthro: 'M2 0V14M2 0L6 4M2 14L6 10',
  algiz: 'M4 14V0M4 6L0 1M4 6L8 1',
  sowilo: 'M6 0L1 4L7 10L2 14',
  tiwaz: 'M4 14V0L0 5M4 0L8 5',
  berkanan: 'M2 14V0L6 3.5L2 7L6 10.5L2 14',
  ehwaz: 'M1 14V0L4 4L7 0V14',
  mannaz: 'M1 14V0M7 14V0M1 0L7 7M7 0L1 7',
  laguz: 'M2 14V0L7 4',
  ingwaz: 'M4 0L8 7L4 14L0 7Z',
  dagaz: 'M0 0V14M8 0V14M0 0L8 14M8 0L0 14',
  othala: 'M4 0L8 5L1 14M4 0L0 5L7 14',
} as const;

export type RuneName = keyof typeof RUNES;

/** Orden tradicional del futhark: alrededor del sello. */
export const FUTHARK = Object.keys(RUNES) as RuneName[];

/** «RUNA» escrito con runas: raido, uruz, naudiz, ansuz. */
export const RUNA_WORD: RuneName[] = ['raido', 'uruz', 'naudiz', 'ansuz'];

interface RuneProps {
  name: RuneName;
  className?: string;
  /** Si no se da, la runa es decorativa y se oculta a lectores de pantalla. */
  title?: string;
}

export function Rune({ name, className, title }: RuneProps) {
  return (
    <svg
      className={className ? `rune ${className}` : 'rune'}
      viewBox="-1.5 -1.5 11 17"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <path d={RUNES[name]} />
    </svg>
  );
}
