import { defineConfig } from '@playwright/test';

const PORT = 4399;

// Browser journeys run against the production build (`npm run build` first);
// tests/e2e/global-setup.ts starts and stops the engine.
// The installed Microsoft Edge is used, so no browser download is needed.
export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.VECTORA_E2E_CHANNEL ?? 'msedge',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 }, hasTouch: true }, grep: /@responsive/ },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, grep: /@responsive/ },
  ],
});
