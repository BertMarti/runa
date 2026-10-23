// Comprobación de salud para Docker: la imagen distroless no tiene curl ni shell.
const port = process.env.PORT ?? '8080';

try {
  const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(3000) });
  process.exit(res.ok ? 0 : 1);
} catch {
  process.exit(1);
}
