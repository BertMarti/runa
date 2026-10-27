import { expect, test, type Page } from '@playwright/test';

/** Cualquier error de consola o excepción (incluidas violaciones de CSP o Trusted Types) hace fallar la prueba. */
function vigilarConsola(page: Page): string[] {
  const errores: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errores.push(m.text());
  });
  page.on('pageerror', (e) => errores.push(e.message));
  return errores;
}

const enlaceDe = async (page: Page, n = 0) => (await page.locator('.linkbox').nth(n).textContent())!.trim();

/** Abre un enlace como una visita nueva (como en otra pestaña). Si solo cambia el `#`, el navegador no recarga. */
async function abrir(page: Page, url: string) {
  await page.goto('about:blank');
  await page.goto(url);
}

test('crear → revelar → al reabrir ya no existe', async ({ page }) => {
  const errores = vigilarConsola(page);
  const res = await page.goto('/');
  expect(res?.headers()['content-security-policy']).toContain("trusted-types 'none'");

  await page.getByLabel('Secreto', { exact: true }).fill('contraseña del router: Lr7#q2!x');
  await page.getByRole('button', { name: 'Cifrar y crear enlace' }).click();
  const enlace = await enlaceDe(page);
  expect(enlace).toMatch(/\/s\/[A-Za-z0-9_-]{22}#v1\.[A-Za-z0-9_-]{43}$/);

  await abrir(page, enlace);
  await page.getByRole('button', { name: 'Revelar secreto' }).click();
  await expect(page.getByText('contraseña del router: Lr7#q2!x')).toBeVisible();
  // La clave sale de la barra de direcciones en cuanto se usa.
  await expect.poll(() => new URL(page.url()).hash).toBe('');

  await abrir(page, enlace);
  await page.getByRole('button', { name: 'Revelar secreto' }).click();
  await expect(page.getByRole('heading', { name: 'Este secreto ya no existe' })).toBeVisible();
  expect(errores.filter((e) => !e.includes('404'))).toEqual([]);
});

test('pedir un secreto → otra persona lo envía → quien lo pidió lo recoge una vez', async ({ page, browser }) => {
  const errores = vigilarConsola(page);
  await page.goto('/');
  await page.getByRole('radio', { name: 'Pedir un secreto' }).check();
  await page.getByRole('button', { name: 'Crear petición' }).click();
  const envio = await enlaceDe(page, 0);
  const recogida = await enlaceDe(page, 1);
  expect(envio).toMatch(/\/r\/[A-Za-z0-9_-]{22}#v1\.[A-Za-z0-9_-]{43}$/);
  expect(recogida).toMatch(/\/p\/[A-Za-z0-9_-]{22}#v1\.[A-Za-z0-9_-]{64}$/);

  // Quien envía usa otro navegador (otro contexto: sin nada en común con quien pide).
  const otro = await browser.newContext({ locale: 'es-ES', reducedMotion: 'reduce' });
  const remitente = await otro.newPage();
  const erroresRemitente = vigilarConsola(remitente);
  await remitente.goto(envio);
  await remitente.getByLabel('Secreto', { exact: true }).fill('API key: sk-prueba-123');
  await remitente.getByRole('button', { name: 'Cifrar y enviar' }).click();
  await expect(remitente.getByRole('heading', { name: 'Enviado' })).toBeVisible();
  expect(new URL(remitente.url()).hash).toBe('');
  // El enlace de envío no se puede reutilizar.
  await abrir(remitente, envio);
  await remitente.getByLabel('Secreto', { exact: true }).fill('otro');
  await remitente.getByRole('button', { name: 'Cifrar y enviar' }).click();
  await expect(remitente.getByText(/ya recibió un secreto/)).toBeVisible();
  await otro.close();

  await abrir(page, recogida);
  await page.getByRole('button', { name: 'Comprobar y abrir' }).click();
  await expect(page.getByText('API key: sk-prueba-123')).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe('');

  await abrir(page, recogida);
  await page.getByRole('button', { name: 'Comprobar y abrir' }).click();
  await expect(page.getByText(/no existe, ya se usó o caducó/)).toBeVisible();

  const esperados = (e: string) => e.includes('404') || e.includes('409');
  expect([...errores, ...erroresRemitente].filter((e) => !esperados(e))).toEqual([]);
});

test('una petición sin rellenar se queda esperando y se puede cancelar', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Pedir un secreto' }).check();
  await page.getByRole('button', { name: 'Crear petición' }).click();
  const recogida = await enlaceDe(page, 1);
  await abrir(page, recogida);
  await page.getByRole('button', { name: 'Comprobar y abrir' }).click();
  await expect(page.getByText(/Todavía no te lo han enviado/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar la petición' }).click();
  await expect(page.getByText(/Petición cancelada/)).toBeVisible();
});
