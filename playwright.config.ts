import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests: the real server, a real browser, a throwaway database.
 *
 * `e2e/global-setup.ts` seeds a fresh SQLite file with one board per scenario
 * and mints signed-in sessions for three users, using a secret that exists only
 * for this run. Nothing here touches a real identity provider or database.
 *
 *   npm run test:e2e
 */
const PORT = 3000
export const E2E_SECRET = 'e2e-only-secret-not-used-anywhere-else'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // One shared server and database; each spec owns its own boards, but running
  // them one at a time keeps socket broadcasts easy to reason about.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The dev server compiles each route on first visit.
    navigationTimeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    // Start from an empty database every run. It is cleared here, before the
    // server starts, rather than in global setup: the server is already running
    // by then, and deleting a SQLite file out from under an open connection
    // leaves the server on the old one.
    command: `node -e "const f=require('fs');f.rmSync('e2e/.data',{recursive:true,force:true});f.mkdirSync('e2e/.data',{recursive:true})" && npm run dev`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: 'file:./e2e/.data/e2e.db',
      AUTH_SECRET: E2E_SECRET,
      AUTH_URL: `http://localhost:${PORT}`,
      AUTH_TRUST_HOST: 'true',
      NODE_OPTIONS: '--experimental-sqlite',
    },
  },
})
