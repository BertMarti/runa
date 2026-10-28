// Genera las capturas del README recorriendo la app real con Chromium (CDP).
//
// Uso:
//   1. Arranca RUNA (p. ej. `docker compose up -d`, queda en :8484).
//   2. chromium --headless=new --remote-debugging-port=9333 --user-data-dir=/tmp/runa-cdp
//   3. node scripts/capture.mjs [http://127.0.0.1:8484] [docs/assets]
//
// Solo usa datos de ejemplo inventados.
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8484';
const OUT = process.argv[3] ?? 'docs/assets';
const CDP = process.env.CDP ?? 'http://127.0.0.1:9333';

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openTab() {
  const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(data.error.message));
      else resolve(data.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const close = async () => {
    ws.close();
    await fetch(`${CDP}/json/close/${target.id}`);
  };
  return { send, close };
}

const tab = await openTab();
const { send } = tab;
// Las capturas principales, en el tema oscuro de siempre.
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? expression);
  return res.result.value;
}

async function viewport(width, height, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
}

async function go(url) {
  await send('Page.navigate', { url });
  await sleep(1500);
  await evaluate('document.fonts.ready.then(() => true)');
}

async function shot(name, clip) {
  const params = { format: 'png', captureBeyondViewport: false };
  if (clip) params.clip = { ...clip, scale: 1 };
  const { data } = await send('Page.captureScreenshot', params);
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
  console.log('✓', name);
}

/** Recorta un elemento (por selector) con un margen. */
async function shotOf(name, selector, pad = 24) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
  await sleep(400);
  const r = await evaluate(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: b.x + scrollX, y: b.y + scrollY, width: b.width, height: b.height }; })()`);
  await shot(name, { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.width + pad * 2, height: r.height + pad * 2 });
}

async function type(selector, text) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  await send('Input.insertText', { text });
}

async function clickText(text) {
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(text)})).click()`);
}

await send('Page.enable');
await send('Runtime.enable');

// 1. Portada
await viewport(1280, 860);
await go(`${BASE}/`);
await shot('captura-inicio.png');

// 2. Cómo funciona
await shotOf('captura-como-funciona.png', 'section.how');

// 3. Crear un secreto con contraseña
await go(`${BASE}/`);
await type('textarea', 'Wifi de invitados\nRed: Casa-Invitados\nClave: Aurora-Boreal-2026!');
await type('input[type="password"]', 'fiordo-azul');
await sleep(300);
await shotOf('captura-formulario.png', 'form');
await clickText('Cifrar y crear enlace');
await sleep(3000);
await evaluate('window.scrollTo(0, 0)');
await sleep(500);
await shot('captura-enlace.png');
const link = await evaluate(`(document.body.innerText.match(/https?:\\/\\/\\S+\\/s\\/\\S+/) || [])[0]`);
if (!link) throw new Error('No se encontró el enlace');

// 4. Lo que ve el servidor
await shotOf('captura-servidor.png', 'section.server');

// 5. Recibir y revelar
await go('about:blank');
await go(link);
await shot('captura-recibir.png');
await type('input[type="password"]', 'fiordo-azul');
await clickText('Revelar secreto');
await sleep(3500);
await evaluate('window.scrollTo(0, 0)');
await sleep(300);
await shot('captura-revelado.png');

// 6. Ya no existe
await go('about:blank');
await go(link);
await type('input[type="password"]', 'fiordo-azul');
await clickText('Revelar secreto');
await sleep(3000);
await evaluate('window.scrollTo(0, 0)');
await shot('captura-destruido.png');

// 7. Pedir un secreto: los dos enlaces
await viewport(1280, 860);
await go('about:blank');
await go(`${BASE}/`);
await evaluate(`[...document.querySelectorAll('label')].find(l => l.textContent.trim() === 'Pedir un secreto').click()`);
await sleep(300);
await clickText('Crear petición');
await sleep(2500);
await evaluate('window.scrollTo(0, 0)');
await sleep(300);
await shot('captura-pedir.png');

// 8. Móvil (oscuro y «Alba», el tema claro)
await viewport(390, 844, true);
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await go(`${BASE}/`);
await shot('captura-movil.png');
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await go(`${BASE}/`);
await shot('captura-movil-claro.png');

await tab.close();
