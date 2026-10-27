import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas de extremo a extremo: el servidor real (build de producción, con su CSP y Trusted Types) y Chromium.
 * Base de datos temporal en `e2e/.data` (se borra en cada ejecución).
 */
const PORT = 8499;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'e2e/informe' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'es-ES',
    // La web respeta prefers-reduced-motion: sin animaciones, las pruebas no esperan a que algo «se estabilice».
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'rm -rf e2e/.data && node apps/server/dist/server.js',
    url: `http://localhost:${PORT}/api/config`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: 'e2e/.data', LOG_LEVEL: 'warn' },
  },
});
