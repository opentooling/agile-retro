/**
 * Load-test fixtures: boards and 200 signed-in users.
 *
 * Runs inside the app's pod, where DATABASE_URL and AUTH_SECRET already point at
 * the deployment under test:
 *
 *   kubectl exec <pod> -- mkdir -p /opt/app-root/src/loadtest
 *   kubectl cp loadtest/seed.ts <pod>:/opt/app-root/src/loadtest/seed.ts
 *   kubectl exec <pod> -- sh -c 'cd /opt/app-root/src && npx tsx loadtest/seed.ts'
 *   kubectl cp <pod>:/tmp/loadtest-data.json loadtest/data.json
 *   kubectl exec <pod> -- sh -c 'cd /opt/app-root/src && npx tsx loadtest/seed.ts --cleanup'
 *
 * Every board it makes is titled "[load] …" and is an open board (no team), so
 * the synthetic users need no group memberships, and --cleanup can find and
 * delete exactly what it made. Sessions are minted with the deployment's own
 * AUTH_SECRET — the only way a load test can present as signed-in users without
 * a real identity provider — so only run this against a test deployment.
 */
import { writeFileSync } from 'node:fs'
import * as NextAuthJwt from 'next-auth/jwt'
import * as db from '../src/lib/db'

const encode = (NextAuthJwt as unknown as { encode: (p: object) => Promise<string> }).encode
const PREFIX = '[load]'
const USERS = Number(process.env.LOAD_USERS ?? 200)
const TEAM_BOARDS = Number(process.env.LOAD_TEAM_BOARDS ?? 20)
const CLASSIC = [
  { title: 'What went well', type: 'WHAT_WENT_WELL' },
  { title: "What didn't go well", type: 'WHAT_DIDNT_GO_WELL' },
  { title: 'What should be improved', type: 'WHAT_SHOULD_BE_IMPROVED' },
]

async function board(title: string) {
  const r = await db.createRetrospectiveWithColumns(
    {
      title: `${PREFIX} ${title}`, tags: 'loadtest', creator: 'load-facilitator', teamId: null,
      inputDuration: 60, votingDuration: 10, reviewDuration: 10,
      isAnonymous: false, blindInput: false, expiresAt: null, phaseStartTime: new Date(),
    },
    CLASSIC,
  )
  return { id: r.id, columns: (await db.getRetroFull(r.id))!.columns.map((c) => c.id) }
}

async function cleanup() {
  const mine = (await db.listRetrospectives({}, 10_000)).filter((r) => r.title.startsWith(PREFIX))
  for (const r of mine) await db.deleteRetro(r.id)
  console.error(`deleted ${mine.length} ${PREFIX} boards`)
}

;(async () => {
  if (process.argv.includes('--cleanup')) return cleanup()
  const teams = []
  for (let i = 1; i <= TEAM_BOARDS; i++) teams.push(await board(`Team ${String(i).padStart(2, '0')}`))
  const allhands = await board('All hands')
  const tokens: string[] = []
  for (let i = 1; i <= USERS; i++) {
    const name = `lt-${String(i).padStart(3, '0')}`
    tokens.push(await encode({
      token: { sub: `${name}@load.test`, email: `${name}@load.test`, name, groups: [] },
      secret: process.env.AUTH_SECRET!,
      salt: 'authjs.session-token',
    }))
  }
  // To a file, not stdout: process.exit() does not wait for a pipe to drain,
  // and 200 tokens is well past what gets through before it closes.
  const out = process.env.LOAD_OUT ?? '/tmp/loadtest-data.json'
  writeFileSync(out, JSON.stringify({ teams, allhands, tokens }))
  console.error(`wrote ${out}: ${teams.length} team boards, 1 all-hands board, ${tokens.length} users`)
})()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1) })
