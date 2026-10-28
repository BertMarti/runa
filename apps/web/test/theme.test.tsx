import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { applyTheme, nextTheme, readTheme, saveTheme } from '../src/lib/theme';

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('tema', () => {
  it('el ciclo es automático → claro → oscuro → automático', () => {
    expect(nextTheme('auto')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('auto');
  });

  it('se guarda, se aplica con data-theme y «automático» no deja rastro', () => {
    saveTheme('light');
    expect(readTheme()).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    saveTheme('auto');
    expect(readTheme()).toBe('auto');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('runa.theme')).toBeNull();
  });

  it('un valor guardado desconocido vale como automático', () => {
    localStorage.setItem('runa.theme', '<script>');
    expect(readTheme()).toBe('auto');
    applyTheme(readTheme());
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('el botón de la cabecera cambia de tema y lo anuncia', () => {
    render(<App lang="es" />);
    const btn = screen.getByRole('button', { name: /Tema: automático/ });
    fireEvent.click(btn);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByRole('button', { name: /Tema: claro/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Tema: claro/ }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
