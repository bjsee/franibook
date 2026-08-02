import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

const FIXTURES = resolve('tests/parity/fixtures');
const CACHE = resolve('tests/parity/.cache');
const OUT = resolve('tests/parity/.out');

/**
 * Der Parity-Test braucht beide Prozesse: den Server, der importiert und
 * PDFs schreibt, und den Vite-Dev-Server, der die Vorschau ausliefert.
 *
 * Beide arbeiten gegen die Fixtures, nicht gegen den echten Bestand – der
 * Test muss deterministisch und ohne NAS-Zugriff laufen.
 */
export default defineConfig({
  testDir: './tests/parity',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: process.env['CI'] ? 'github' : 'list',
  timeout: 120_000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    // Ein fester Skalierungsfaktor: Der Screenshot muss exakt so viele
    // Gerätepixel haben wie CSS-Pixel, sonst vergleicht der Test zwei
    // verschiedene Maßstäbe.
    deviceScaleFactor: 1,
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'pnpm --filter @franibook/server start',
      url: 'http://127.0.0.1:5174/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      env: {
        FRANIBOOK_SOURCE: FIXTURES,
        FRANIBOOK_CACHE: CACHE,
        FRANIBOOK_OUT: OUT,
        PORT: '5174',
      },
    },
    {
      command: 'pnpm --filter @franibook/web dev',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
