import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';

const ID = 'AbCdEfGhIjKlMnOpQrStUv';
const KEY = 'A'.repeat(43);

/** Simula los idiomas del dispositivo (happy-dom dice `en-US`). */
function deviceLangs(list: string[]) {
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => list });
  Object.defineProperty(navigator, 'language', { configurable: true, get: () => list[0] ?? '' });
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ publicUrl: null, createAllowed: true }), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  // Devuelve los valores propios de happy-dom (están en el prototipo).
  delete (navigator as unknown as Record<string, unknown>).languages;
  delete (navigator as unknown as Record<string, unknown>).language;
  history.replaceState(null, '', '/');
});

describe('la web en catalán', () => {
  it('pinta la pantalla de crear en catalán, con <html lang="ca">', async () => {
    render(<App lang="ca" />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Comparteix un secret que s’esborra en llegir-lo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xifrar i crear l’enllaç' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Idioma: Català' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('ca');
    expect(document.title).toBe('RUNA · secrets xifrats que s’autodestrueixen');
  });

  it('pinta la pantalla de revelar en catalán', () => {
    history.replaceState(null, '', `/s/${ID}#v1.${KEY}`);
    render(<App lang="ca" />);
    expect(screen.getByRole('heading', { level: 1, name: 'T’han enviat un secret' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revelar el secret' })).toBeTruthy();
  });

  it('sin elección guardada, un navegador en ca-ES-valencia abre en catalán', () => {
    deviceLangs(['ca-ES-valencia', 'es-ES']);
    render(<App />);
    expect(screen.getByRole('button', { name: 'Xifrar i crear l’enllaç' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('ca');
  });

  it('un navegador en pt-BR abre en portugués de Portugal', () => {
    deviceLangs(['pt-BR']);
    render(<App />);
    expect(screen.getByRole('button', { name: 'Cifrar e criar ligação' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('pt-PT');
  });

  it('la elección guardada manda sobre el navegador', () => {
    deviceLangs(['ca-ES']);
    localStorage.setItem('runa.lang', 'gl');
    render(<App />);
    expect(screen.getByRole('button', { name: 'Cifrar e crear ligazón' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('gl');
  });
});

describe('selector de idioma', () => {
  it('ofrece los cinco idiomas, cada uno con su nombre y su lang', () => {
    render(<App lang="es" />);
    const toggle = screen.getByRole('button', { name: 'Idioma: Español' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByRole('list', { name: 'Idioma' });
    const options = [...list.querySelectorAll('button')];
    expect(options.map((b) => b.textContent)).toEqual(['EspañolES', 'CatalàCA', 'GalegoGL', 'PortuguêsPT', 'EnglishEN']);
    expect(options.map((b) => b.getAttribute('lang'))).toEqual(['es', 'ca', 'gl', 'pt-PT', 'en']);
    expect(options.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false', 'false']);
  });

  it('elegir cambia el idioma, lo guarda, cierra la lista y devuelve el foco', () => {
    render(<App lang="es" />);
    fireEvent.click(screen.getByRole('button', { name: 'Idioma: Español' }));
    fireEvent.click(screen.getByRole('button', { name: 'Galego' }));
    const toggle = screen.getByRole('button', { name: 'Idioma: Galego' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
    expect(localStorage.getItem('runa.lang')).toBe('gl');
    expect(document.documentElement.lang).toBe('gl');
    expect(screen.getByRole('heading', { level: 1, name: 'Comparte un segredo que se borra ao lelo' })).toBeTruthy();
  });

  it('Escape y un clic fuera cierran la lista sin cambiar de idioma', () => {
    render(<App lang="pt" />);
    const toggle = screen.getByRole('button', { name: 'Idioma: Português' });
    fireEvent.click(toggle);
    fireEvent.keyDown(screen.getByRole('button', { name: 'English' }), { key: 'Escape' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);

    fireEvent.click(toggle);
    fireEvent.pointerDown(document.body);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.documentElement.lang).toBe('pt-PT');
    expect(localStorage.getItem('runa.lang')).toBeNull();
  });
});
