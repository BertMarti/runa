import path from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { SecretStore } from './store.js';

const PURGE_INTERVAL_MS = 60_000;

const config = loadConfig();
const store = new SecretStore(path.join(config.dataDir, 'runa.db'));
const app = await buildApp(config, store);

store.purgeExpired();
const purge = setInterval(() => {
  const removed = store.purgeExpired();
  if (removed > 0) app.log.info({ removed }, 'secretos caducados eliminados');
}, PURGE_INTERVAL_MS);
purge.unref();

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'apagando');
  clearInterval(purge);
  await app.close();
  store.close();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.host, port: config.port });
