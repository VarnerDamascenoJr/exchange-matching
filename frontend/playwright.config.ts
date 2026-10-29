import { defineConfig, devices } from '@playwright/test';
import { createRequire } from 'node:module';

// Share the database E2E guard: browser runs must also use the isolated runner.
createRequire(import.meta.url)('../backend/test/support/database-safety.cjs');
if (process.env.RUN_DATABASE_E2E !== 'true') {
  throw new Error(
    'Use npm run test:e2e to provision isolated browser infrastructure.',
  );
}
const apiPort = Number(process.env.E2E_API_PORT);
const webPort = Number(process.env.E2E_WEB_PORT);
if (
  ![apiPort, webPort].every(
    (port) => Number.isInteger(port) && port >= 1024 && port <= 65535,
  ) ||
  apiPort === webPort
) {
  throw new Error(
    'The isolated runner must supply distinct API and frontend ports.',
  );
}
const apiURL = `http://127.0.0.1:${apiPort}`;
const webURL = `http://127.0.0.1:${webPort}`;
const shutdown = { signal: 'SIGTERM' as const, timeout: 10_000 };

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  globalTimeout: 10 * 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: webURL,
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      name: 'API',
      command: 'node ../backend/dist/src/main.js',
      url: `${apiURL}/health`,
      env: { PORT: String(apiPort) },
      reuseExistingServer: false,
      gracefulShutdown: shutdown,
    },
    {
      name: 'Matching worker',
      command: 'node ../backend/dist/src/worker.js',
      wait: { stdout: /Worker started for queue/ },
      gracefulShutdown: shutdown,
    },
    {
      name: 'Frontend',
      command: `npm run dev -- --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: webURL,
      env: { VITE_API_BASE_URL: apiURL },
      reuseExistingServer: false,
      gracefulShutdown: shutdown,
    },
  ],
});
