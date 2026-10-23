/** Iconos de trazo en una caja de 24×24. Siempre decorativos: el texto va al lado. */
const ICONS = {
  copy: 'M9 9h10v10H9zM5 15V5h10',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  eye: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12zM12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z',
  eyeOff: 'M3 3l18 18M10.6 5.6A10 10 0 0 1 12 5.5C18.4 5.5 22 12 22 12a17 17 0 0 1-3 3.8M6.6 6.7C3.7 8.4 2 12 2 12s3.6 6.5 10 6.5c1.7 0 3.2-.5 4.5-1.1M9.9 9.9a2.8 2.8 0 0 0 4 4',
  share: 'M12 15V3M7.5 7.5L12 3l4.5 4.5M5 12v8h14v-8',
  file: 'M14 3H6v18h12V7zM14 3v4h4',
  close: 'M6 6l12 12M18 6L6 18',
  download: 'M12 3v12M7.5 10.5L12 15l4.5-4.5M5 20h14',
  flame: 'M12 21c-4 0-7-2.8-7-6.6 0-3.4 2.6-5.4 4-8.4.7 2 1.8 3 3 3.6 0-2.4.8-4.6 2.6-6.6.4 3.6 4.4 6 4.4 11.4 0 3.8-3 6.6-7 6.6z',
  dice: 'M4 4h16v16H4zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01',
  plus: 'M12 5v14M5 12h14',
  lock: 'M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={className ? `icon ${className}` : 'icon'} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICONS[name]} />
    </svg>
  );
}
