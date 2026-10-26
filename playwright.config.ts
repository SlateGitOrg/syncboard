import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config for the offline/online transition spec. This suite is
 * separate from `npm test` (Vitest only): it needs a Chromium binary
 * (`npx playwright install chromium`) plus a live Vite dev server and a
 * live relay, which the config starts itself. CI runs it as a required job.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev:relay',
      port: 1234,
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
