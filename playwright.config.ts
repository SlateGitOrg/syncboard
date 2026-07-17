import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config for the offline/online transition spec. This suite is
 * intentionally NOT part of `npm test` (which only runs Vitest unit
 * tests) — it needs real browser binaries (`npx playwright install`)
 * plus a live Vite dev server AND a live relay process, none of which
 * are guaranteed to be available in a sandboxed CI/verification
 * environment. Run it explicitly with `npm run e2e` once
 * `npx playwright install chromium` has been run locally.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
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
