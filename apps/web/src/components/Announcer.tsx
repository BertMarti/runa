import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

/** Región `aria-live` única para avisos breves (copiado, archivo adjunto…). */
const AnnounceContext = createContext<(message: string) => void>(() => {});

export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const [tick, setTick] = useState(0);

  const announce = useCallback((next: string) => {
    setMessage(next);
    // Cambia la clave para que se repita aunque el texto sea el mismo.
    setTick((n) => n + 1);
  }, []);

  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        <span key={tick}>{message}</span>
      </div>
    </AnnounceContext.Provider>
  );
}

export function useAnnounce(): (message: string) => void {
  return useContext(AnnounceContext);
}
