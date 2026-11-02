// Graba la demostración animada del README recorriendo la app real (crear → revelar → ya no existe).
//
// Uso: sh scripts/demo.sh   (arranca el servidor, graba con Playwright y convierte con ffmpeg)
//
// Solo usa datos de ejemplo inventados.
// Las funciones de `page.evaluate` se ejecutan en el navegador.
/* global document */
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8497';
const OUT = process.argv[3] ?? 'e2e/.demo';
const SIZE = { width: 1100, height: 860 };
/** Origen que enseñan los enlaces (PUBLIC_URL del servidor de la demo): un dominio de ejemplo, nunca uno real. */
const SHOWN = 'https://runa.example';

fs.rmSync(OUT, { recursive: true, force: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: SIZE,
  deviceScaleFactor: 1,
  locale: 'es-ES',
  colorScheme: 'dark',
  recordVideo: { dir: OUT, size: SIZE },
});
const page = await context.newPage();
const t0 = Date.now();
const pause = (ms) => page.waitForTimeout(ms);
// Espera a las tres familias (las fuentes se piden al usarse; `fonts.ready` puede resolverse antes).
const ready = () =>
  page.evaluate(() =>
    Promise.all(['600 1em Cinzel', '1em Inter', '1em "JetBrains Mono"'].map((f) => document.fonts.load(f))).then(() => document.fonts.ready),
  ).then(() => page.waitForTimeout(150));

// 1. Quien comparte escribe el secreto y crea el enlace.
await page.goto(BASE);
await ready();
await pause(400);
// El vídeo empieza al abrir la pestaña: lo de antes (fuentes cargando) se recorta al convertir.
const trim = (Date.now() - t0) / 1000;
await pause(900);
const campo = page.getByLabel('Secreto', { exact: true });
await campo.click();
await campo.pressSequentially('Wi-Fi de la oficina: Runa-7xQ!m2', { delay: 55 });
await pause(700);
await page.getByRole('button', { name: 'Cifrar y crear enlace' }).click();
await page.locator('.linkbox').first().waitFor();
await pause(2600);
const enlace = (await page.locator('.linkbox').first().textContent()).trim().replace(SHOWN, BASE);

// 2. Quien lo recibe abre el enlace y lo revela: el servidor lo destruye.
await page.goto(enlace);
await ready();
await pause(1300);
await page.getByRole('button', { name: 'Revelar secreto' }).click();
await page.getByText('Runa-7xQ!m2').waitFor();
await pause(3000);

// 3. Volver a abrirlo ya no sirve. (Pasar por la portada: si solo cambia el `#`, el navegador no recarga.)
await page.goto(BASE);
await pause(300);
await page.goto(enlace);
await ready();
await pause(900);
await page.getByRole('button', { name: 'Revelar secreto' }).click();
await page.getByRole('heading', { name: 'Este secreto ya no existe' }).waitFor();
await pause(2800);

await context.close();
await browser.close();
const [video] = fs.readdirSync(OUT).filter((f) => f.endsWith('.webm'));
fs.renameSync(`${OUT}/${video}`, `${OUT}/demo.webm`);
fs.writeFileSync(`${OUT}/inicio.txt`, trim.toFixed(2));
console.log(`✓ ${OUT}/demo.webm`);
