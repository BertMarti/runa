// Renderiza una página HTML local a PNG a 2x con Chromium (CDP en :9333).
// Uso: node scripts/brand/render.mjs <file:///ruta.html> <salida.png> [ancho] [alto]
import fs from 'node:fs';

const [url, out, width = '1280', height = '640'] = process.argv.slice(2);
const CDP = process.env.CDP ?? 'http://127.0.0.1:9333';
const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => (ws.onopen = resolve));

let seq = 0;
const waiters = new Map();
ws.onmessage = (msg) => {
  const data = JSON.parse(msg.data);
  waiters.get(data.id)?.(data.result);
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    waiters.set(++seq, resolve);
    ws.send(JSON.stringify({ id: seq, method, params }));
  });

await send('Emulation.setDeviceMetricsOverride', { width: +width, height: +height, deviceScaleFactor: 2, mobile: false });
await send('Page.navigate', { url });
await new Promise((resolve) => setTimeout(resolve, 1500));
await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => 1)', awaitPromise: true });
const { data } = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(data, 'base64'));
ws.close();
await fetch(`${CDP}/json/close/${target.id}`);
console.log('✓', out);
