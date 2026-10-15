import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests (`pnpm test:e2e`): the demo pages in a real browser,
 * driven with a real mouse, with physics checked through the page's own
 * cavijs objects. Separate from the Vitest unit tests (`pnpm test`).
 *
 * Uses the locally installed Google Chrome (`channel: 'chrome'`), so no
 * Playwright browser download is needed; set PW_CHANNEL= (empty) to use
 * Playwright's own Chromium instead (after `npx playwright install chromium`).
 */
const PORT = 5190;

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/cavijs/`,
    channel: process.env.PW_CHANNEL ?? 'chrome',
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/cavijs/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
