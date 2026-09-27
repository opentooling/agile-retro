import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests against a *deployed* stack: the production image, behind
 * its Ingress, on PostgreSQL, signing in through a real Keycloak.
 *
 * The main suite (playwright.config.ts) runs against the dev server on SQLite
 * with sessions minted directly — fast, and right for testing the app's
 * behaviour. This one tests what that cannot: that the pieces a deployment
 * assembles actually fit — the OIDC redirect and issuer, the groups claim,
 * the Ingress and WebSockets, the database the chart wires up.
 *
 * Point DEPLOYED_URL at any install whose Keycloak has the demo realm from
 * deploy/local/keycloak-realm.json. deploy/local/deploy.sh runs it for you.
 */
export default defineConfig({
  testDir: './e2e-deployed',
  // One browser at a time: the tests share one deployed database, and some
  // steps watch another user's screen for a change.
  workers: 1,
  // No retries. A retry that passes would hide exactly the intermittent
  // failure — a dropped socket, a slow sign-in — this suite exists to find.
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  outputDir: 'test-results/deployed',
  use: {
    baseURL: process.env.DEPLOYED_URL ?? 'http://retro.localhost:8089',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
