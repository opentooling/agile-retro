import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { E2E_SECRET } from '../playwright.config'

/**
 * Fresh database and sessions for every run. The server is already up (it
 * starts before global setup) and creates its schema lazily, so seeding
 * straight into the same file is safe.
 */
export default function globalSetup() {
  mkdirSync('e2e/.data', { recursive: true })
  execFileSync('npx', ['tsx', 'e2e/seed.ts'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: 'file:./e2e/.data/e2e.db', AUTH_SECRET: E2E_SECRET, NODE_OPTIONS: '--experimental-sqlite' },
  })
  const { sessions } = JSON.parse(readFileSync('e2e/.data/seed.json', 'utf8')) as { sessions: Record<string, string> }
  for (const [who, token] of Object.entries(sessions)) {
    writeFileSync(`e2e/.data/${who}.json`, JSON.stringify({
      cookies: [{ name: 'authjs.session-token', value: token, domain: 'localhost', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }],
      origins: [],
    }))
  }
}
