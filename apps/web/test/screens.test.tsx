import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';

const ID = 'AbCdEfGhIjKlMnOpQrStUv';
const KEY = 'A'.repeat(43);

const fetchMock = vi.fn<typeof fetch>();

function at(path: string) {
  history.replaceState(null, '', path);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  at('/');
});

describe('pantalla de revelar', () => {
  it('no llama a la API al cargar', async () => {
    at(`/s/${ID}#v1.${KEY}`);
    render(<App lang="es" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Te han enviado un secreto' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revelar secreto' })).toBeTruthy();
    // Deja correr efectos y microtareas: sigue sin haber peticiones.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(fetchMock).not.toHaveBeenCalled();
    // La clave sigue en la barra hasta revelar.
    expect(location.hash).toBe(`#v1.${KEY}`);
  });

  it('un fragmento no válido muestra el error', () => {
    at(`/s/${ID}#basura`);
    render(<App lang="es" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Enlace incompleto: falta la clave tras #' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revelar secreto' })).toBeNull();
  });

  it('sin fragmento también muestra el error', () => {
    at(`/s/${ID}`);
    render(<App lang="es" />);
    expect(screen.getByText('Enlace incompleto: falta la clave tras #')).toBeTruthy();
  });

  it('pide la contraseña si el enlace la requiere y no llama a la API sin ella', async () => {
    at(`/s/${ID}#v1.${KEY}.p`);
    render(<App lang="es" />);
    const input = screen.getByLabelText('Contraseña');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Revelar secreto' }));
    expect(await screen.findByText('Escribe la contraseña para revelar el secreto.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('404 al revelar: mensaje de inexistente y la clave sale de la barra', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }));
    at(`/s/${ID}#v1.${KEY}`);
    render(<App lang="es" />);
    fireEvent.click(screen.getByRole('button', { name: 'Revelar secreto' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Este secreto ya no existe' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(location.hash).toBe('');
    expect(location.pathname).toBe(`/s/${ID}`);
  });
});

describe('pantalla de crear', () => {
  it('desactiva el envío si no hay texto ni archivo', async () => {
    at('/');
    render(<App lang="es" />);
    const submit = screen.getByRole('button', { name: 'Cifrar y crear enlace' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Secreto'), { target: { value: 'hola' } });
    await waitFor(() => expect(submit.disabled).toBe(false));

    fireEvent.change(screen.getByLabelText('Secreto'), { target: { value: '' } });
    await waitFor(() => expect(submit.disabled).toBe(true));
  });

  it('el área de texto no autocompleta ni corrige', () => {
    at('/');
    render(<App lang="es" />);
    const textarea = screen.getByLabelText('Secreto');
    expect(textarea.getAttribute('autocomplete')).toBe('off');
    expect(textarea.getAttribute('spellcheck')).toBe('false');
    expect(textarea.getAttribute('autocorrect')).toBe('off');
    expect(textarea.getAttribute('autocapitalize')).toBe('off');
  });

  it('cambia de idioma y actualiza <html lang>', async () => {
    at('/');
    render(<App lang="es" />);
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(await screen.findByRole('button', { name: 'Encrypt and create link' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('en');
  });
});
