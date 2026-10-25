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

describe('despliegue con lectura pública (v0.2)', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('si el servidor no deja crear desde aquí, lo explica y no deja enviar', async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input) === '/api/config' ? json({ publicUrl: null, createAllowed: false }) : json({}, 500),
    );
    at('/');
    render(<App lang="es" />);
    expect(await screen.findByText(/solo se pueden crear secretos desde la red de casa/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Secreto'), { target: { value: 'hola' } });
    const submit = screen.getByRole('button', { name: 'Cifrar y crear enlace' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('el enlace usa el dominio público aunque se cree desde casa', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/config') return json({ publicUrl: 'https://runa.example.com', createAllowed: true });
      if (url === '/api/secrets') return json({ id: ID, expiresAt: '2026-10-25T10:00:00.000Z' }, 201);
      return json({}, 500);
    });
    at('/');
    render(<App lang="es" />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    fireEvent.change(screen.getByLabelText('Secreto'), { target: { value: 'hola' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cifrar y crear enlace' }));
    const enlace = await screen.findByText(/^https:\/\/runa\.example\.com\/s\/AbCdEfGhIjKlMnOpQrStUv#v1\./, {}, { timeout: 5000 });
    expect(enlace).toBeTruthy();
  });

  it('un origen no seguro en publicUrl se ignora', async () => {
    const { getConfig } = await import('../src/api');
    fetchMock.mockResolvedValue(json({ publicUrl: 'javascript:alert(1)', createAllowed: true }));
    expect(await getConfig()).toEqual({ publicUrl: null, createAllowed: true });
    fetchMock.mockResolvedValue(json({ publicUrl: 'http://runa.example.com', createAllowed: false }));
    expect(await getConfig()).toEqual({ publicUrl: null, createAllowed: false });
    fetchMock.mockRejectedValue(new TypeError('sin red'));
    expect(await getConfig()).toEqual({ publicUrl: null, createAllowed: true });
  });
});

describe('revisión externa (R2, R4)', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('R4: fuera de HTTPS avisa de que hace falta para cifrar', () => {
    vi.stubGlobal('isSecureContext', false);
    at('/');
    render(<App lang="es" />);
    expect(screen.getByText(/RUNA necesita HTTPS/)).toBeTruthy();
  });

  it('R4: en un contexto seguro no hay aviso', () => {
    vi.stubGlobal('isSecureContext', true);
    at('/');
    render(<App lang="es" />);
    expect(screen.queryByText(/RUNA necesita HTTPS/)).toBeNull();
  });

  it('R2: con un archivo de más de 1 MB no se ofrece caducar en 7 días', async () => {
    fetchMock.mockImplementation(async () => json({ publicUrl: null, createAllowed: true }));
    at('/');
    const { container } = render(<App lang="es" />);
    expect(screen.getByLabelText('7 días')).toBeTruthy();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(2 * 1024 * 1024)], 'grande.bin')] } });
    expect(await screen.findByText(/la caducidad máxima es 1 día/)).toBeTruthy();
    expect(screen.queryByLabelText('7 días')).toBeNull();
    expect((screen.getByLabelText('1 día') as HTMLInputElement).checked).toBe(true);
  });

  it('R2: si se agota la cuota, dice cuántos minutos esperar', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/config') return json({ publicUrl: null, createAllowed: true });
      if (url === '/api/secrets') return json({ error: 'quota_exceeded', retryAfterSeconds: 1800 }, 429);
      return json({}, 500);
    });
    at('/');
    render(<App lang="es" />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    fireEvent.change(screen.getByLabelText('Secreto'), { target: { value: 'hola' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cifrar y crear enlace' }));
    expect(await screen.findByText(/Vuelve a intentarlo en 30 min/, {}, { timeout: 5000 })).toBeTruthy();
  });
});
