import { useSyncExternalStore, type MouseEvent } from 'react';

/** Enrutador mínimo sobre la History API: `/` crea, `/s/:id` revela. */
export type Route = { name: 'create' } | { name: 'reveal'; id: string };

const NAV_EVENT = 'runa:navigate';

export function matchRoute(pathname: string): Route {
  const reveal = /^\/s\/([^/]+)\/?$/.exec(pathname);
  // Sin decodificar: un id válido nunca lleva `%`, y así no hay excepciones.
  if (reveal) return { name: 'reveal', id: reveal[1]! };
  return { name: 'create' };
}

export function navigate(path: string): void {
  if (path === location.pathname + location.search + location.hash) return;
  history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAV_EVENT));
  window.scrollTo({ top: 0 });
}

/** Para `<a href>` internos: navega sin recargar salvo con modificadores. */
export function onLinkClick(event: MouseEvent<HTMLAnchorElement>): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  event.preventDefault();
  navigate(event.currentTarget.getAttribute('href') ?? '/');
}

/**
 * Cada enlace distinto que se pega a mano en la misma pestaña (mismo id, otro
 * `#`) es una visita nueva y reinicia la pantalla. Quitar la clave con
 * `replaceState` deja el fragmento vacío y no cuenta, así que no la desmonta.
 * Solo se guarda un contador: la clave nunca acaba en una `key` de React.
 */
let visit = 0;
let lastHash = '';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener('hashchange', onChange);
  window.addEventListener(NAV_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener(NAV_EVENT, onChange);
  };
}

function getSnapshot(): string {
  const hash = location.hash;
  if (hash.length > 1 && hash !== lastHash) {
    lastHash = hash;
    visit++;
  }
  return `${visit}|${location.pathname}`;
}

export function useRoute(): Route & { visit: number } {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const sep = snapshot.indexOf('|');
  return { ...matchRoute(snapshot.slice(sep + 1)), visit: Number(snapshot.slice(0, sep)) };
}
