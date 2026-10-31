// @vitest-environment node
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  accessProof,
  createRequestKeys,
  openSecret,
  parseFragment,
  parsePickupFragment,
  parseSendFragment,
  preparePickup,
  sealForRequest,
  sealSecret,
} from '../src/crypto';

/**
 * Interoperabilidad en vivo entre la CLI en Go y el código de la web, contra un servidor real.
 * Solo se ejecuta con RUNA_E2E_URL (servidor) y RUNA_CLI (binario de la CLI); lo lanza scripts/cli-e2e.sh.
 *
 * La web y la CLI se pasan enlaces en los dos sentidos: lo que cifra una lo abre la otra.
 */
const SERVER = process.env.RUNA_E2E_URL ?? '';
const CLI = process.env.RUNA_CLI ?? '';

function runa(args: string[], stdin = ''): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(CLI, args, { env: { PATH: process.env.PATH ?? '', RUNA_SERVER: SERVER } }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stdout, stderr });
    });
    child.stdin?.end(stdin);
  });
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(SERVER + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.status === 204 ? {} : ((await res.json()) as Record<string, unknown>);
}

describe.runIf(SERVER && CLI)('interoperabilidad en vivo: CLI ⇄ web', () => {
  it('lo que crea la web lo abre la CLI', async () => {
    const text = 'de la web a la CLI · ñandú 😀';
    const sealed = await sealSecret({ text, file: { name: 'nota.txt', type: 'text/plain', data: new Uint8Array([104, 105]) } });
    const created = await post('/api/secrets', {
      ciphertext: sealed.ciphertext,
      verifier: sealed.verifier,
      linkVerifier: sealed.linkVerifier,
      ttl: 3600,
      views: 1,
    });
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'runa-interop-'));
    const r = await runa(['open', '--out', out, `${SERVER}/s/${String(created.id)}#${sealed.fragment}`]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(text);
    expect(fs.readFileSync(path.join(out, 'nota.txt'), 'utf8')).toBe('hi');
    expect(r.stderr).not.toContain(sealed.fragment);
  });

  it('lo que crea la CLI lo abre la web', async () => {
    const text = 'de la CLI a la web\nsegunda línea';
    const r = await runa(['send', '--ttl', '5m'], text);
    expect(r.code).toBe(0);
    const link = new URL(r.stdout.trim());
    const key = parseFragment(link.hash);
    expect(key).not.toBeNull();
    const id = link.pathname.split('/')[2]!;
    const opened = await post(`/api/secrets/${id}/open`, await accessProof(key!));
    expect((await openSecret(String(opened.ciphertext), key!)).text).toBe(text);
  });

  it('petición creada en la web, respondida por la CLI y recogida en la web', async () => {
    const keys = await createRequestKeys();
    const created = await post('/api/requests', { sendVerifier: keys.sendVerifier, openVerifier: keys.openVerifier, ttl: 3600 });
    const r = await runa(['reply', `${SERVER}/r/${String(created.id)}#${keys.sendFragment}`], 'credenciales: ana / 1234');
    expect(r.code).toBe(0);
    const handle = await preparePickup(parsePickupFragment(keys.pickupFragment)!);
    const picked = await post(`/api/requests/${String(created.id)}/open`, { proof: handle.proof });
    expect(picked.status).toBe('ready');
    expect((await handle.open(String(picked.ciphertext), String(picked.ephemeral))).text).toBe('credenciales: ana / 1234');
  });

  it('petición creada por la CLI, respondida en la web y recogida por la CLI', async () => {
    const r = await runa(['request', '--ttl', '1h']);
    expect(r.code).toBe(0);
    const [sendLine, pickupLine] = r.stdout.trim().split('\n');
    const sendUrl = new URL(sendLine!.replace(/^envío: /, ''));
    const id = sendUrl.pathname.split('/')[2]!;
    const sealed = await sealForRequest({ text: 'desde la web para la CLI' }, parseSendFragment(sendUrl.hash)!);
    await post(`/api/requests/${id}/fill`, sealed);
    const picked = await runa(['pickup', pickupLine!.replace(/^recogida: /, '')]);
    expect(picked.code).toBe(0);
    expect(picked.stdout).toBe('desde la web para la CLI');
  });
});
