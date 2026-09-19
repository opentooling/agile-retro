/**
 * Seeds the e2e database and mints sessions. Run by global-setup through tsx,
 * which resolves the app's "@/" imports the same way the server does.
 *
 * Every scenario gets its own board, so specs never depend on each other's
 * leftovers. Writes the ids and cookies to e2e/.data/seed.json.
 */
import { writeFileSync } from 'node:fs'
import * as NextAuthJwt from 'next-auth/jwt'
// Ships at runtime but not in the type declarations — the same gap server.ts
// works around for getToken.
const encode = (NextAuthJwt as unknown as { encode: (p: object) => Promise<string> }).encode
import * as db from '../src/lib/db'

const CLASSIC = [
  { title: 'What went well', type: 'WHAT_WENT_WELL' },
  { title: "What didn't go well", type: 'WHAT_DIDNT_GO_WELL' },
  { title: 'What should be improved', type: 'WHAT_SHOULD_BE_IMPROVED' },
]
export const USERS = {
  fay: { email: 'fay@e2e.test', name: 'fay' }, // facilitator of every seeded board
  ana: { email: 'ana@e2e.test', name: 'ana' },
  amy: { email: 'amy@e2e.test', name: 'amy' },
} as const
type Who = keyof typeof USERS

async function board(
  title: string,
  status: string,
  cards: [column: number, who: Who, content: string][] = [],
  timer?: { minutesAgo: number; duration: number },
) {
  const started = timer ? new Date(Date.now() - timer.minutesAgo * 60_000) : new Date()
  const r = await db.createRetrospectiveWithColumns(
    {
      title, tags: 'e2e', creator: 'fay', teamId: null,
      inputDuration: timer?.duration ?? 10, votingDuration: 5, reviewDuration: 10,
      isAnonymous: false, blindInput: false, expiresAt: null, phaseStartTime: started,
    },
    CLASSIC,
  )
  if (status !== 'INPUT') await db.updateRetroStatus(r.id, status, started)
  const columns = (await db.getRetroFull(r.id))!.columns
  const order = new Map<number, number>()
  for (const [col, who, content] of cards) {
    const n = order.get(col) ?? 0
    order.set(col, n + 1)
    await db.createItem({ content, columnId: columns[col].id, userId: USERS[who].email, username: USERS[who].name, order: n })
  }
  return r.id
}

;(async () => {
  const mine: [number, Who, string][] = [[0, 'ana', 'Ana first'], [0, 'ana', 'Ana second'], [0, 'amy', 'Amy card']]
  const boards = {
    move: await board('E2E move', 'INPUT', mine),
    reorder: await board('E2E reorder', 'INPUT', mine),
    drag: await board('E2E drag', 'INPUT', mine),
    remove: await board('E2E delete', 'INPUT', mine),
    permissions: await board('E2E permissions', 'INPUT', mine),
    voting: await board('E2E voting', 'VOTING', mine),
    realtime: await board('E2E realtime', 'INPUT'),
    actions: await board('E2E actions', 'ACTIONS'),
    closed: await board('E2E closed', 'CLOSED'),
    overtime: await board('E2E overtime', 'INPUT', [], { minutesAgo: 67, duration: 10 }),
  }
  for (const [key, content] of [['actions', 'Fix the flaky test'], ['actions', 'Book the next retro'], ['closed', 'Archived action']] as const) {
    await db.createActionItem({ content, retrospectiveId: boards[key], assignee: 'amy', dueDate: null })
  }

  const secret = process.env.AUTH_SECRET!
  const sessions: Record<string, string> = {}
  for (const [who, u] of Object.entries(USERS)) {
    sessions[who] = await encode({
      token: { sub: u.email, email: u.email, name: u.name, groups: [] },
      secret,
      salt: 'authjs.session-token',
    })
  }
  writeFileSync('e2e/.data/seed.json', JSON.stringify({ boards, sessions }, null, 2))
  process.exit(0)
})().catch((e) => { console.error(e); process.exit(1) })
