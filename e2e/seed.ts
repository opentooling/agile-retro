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

const columnsOf: Record<string, string[]> = {}

async function board(
  title: string,
  status: string,
  cards: [column: number, who: Who, content: string][] = [],
  timer?: { minutesAgo: number; duration: number },
  teamId: string | null = null,
  creator = 'fay',
) {
  const started = timer ? new Date(Date.now() - timer.minutesAgo * 60_000) : new Date()
  const r = await db.createRetrospectiveWithColumns(
    {
      title, tags: 'e2e', creator, teamId,
      inputDuration: timer?.duration ?? 10, votingDuration: 5, reviewDuration: 10,
      isAnonymous: false, blindInput: false, expiresAt: null, phaseStartTime: started,
    },
    CLASSIC,
  )
  if (status !== 'INPUT') await db.updateRetroStatus(r.id, status, started)
  const columns = (await db.getRetroFull(r.id))!.columns
  columnsOf[r.id] = columns.map((c) => c.id)
  const order = new Map<number, number>()
  for (const [col, who, content] of cards) {
    const n = order.get(col) ?? 0
    order.set(col, n + 1)
    await db.createItem({ content, columnId: columns[col].id, userId: USERS[who].email, username: USERS[who].name, order: n })
  }
  return r.id
}

/**
 * A board in Review whose queue has both halves: three cards ranked by votes
 * and one nobody voted for, under "Also raised".
 */
async function reviewBoard(title = 'E2E review queue') {
  const id = await board(title, 'REVIEW', [
    [0, 'ana', 'Queue top'],
    [0, 'ana', 'Queue middle'],
    [0, 'amy', 'Queue bottom'],
    [1, 'amy', 'Queue unvoted'],
    [1, 'ana', 'Queue unvoted two'],
  ])
  const columns = (await db.getRetroFull(id))!.columns
  const byContent = new Map(columns.flatMap((c) => c.items).map((i) => [i.content, i.id]))
  const votes: [string, number][] = [['Queue top', 3], ['Queue middle', 2], ['Queue bottom', 1]]
  for (const [content, count] of votes) {
    await db.createVote({ itemId: byContent.get(content)!, userId: USERS.fay.email, count })
  }
  return id
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
    overtimeAdvance: await board('E2E overtime advance', 'INPUT', [[0, 'ana', 'Before voting']], { minutesAgo: 30, duration: 10 }),
    overtimeReconnect: await board('E2E overtime reconnect', 'INPUT', [[0, 'ana', 'Before voting']], { minutesAgo: 30, duration: 10 }),
    // Freshly started, for the test that skews the browser's clock.
    freshTimer: await board('E2E fresh timer', 'INPUT', [], { minutesAgo: 0, duration: 10 }),
    // A review queue with a voted half and an "Also raised" half.
    review: await reviewBoard(),
    // A second one, so the live test and the solo tests cannot disturb each other.
    live: await reviewBoard('E2E review live'),
    sockets: await board('E2E sockets', 'INPUT', [[0, 'ana', 'Ana socket card']]),
    // A team board none of the seeded users belong to.
    private: await board('E2E private', 'INPUT', [], undefined,
      (await db.createTeam('E2E private team', { createdBy: null, memberGroups: ['/e2e-private'], adminGroups: [] })).id, 'nobody'),
  }
  await db.createItem({ content: 'Private card', columnId: columnsOf[boards.private][0], userId: 'owner@e2e.test', username: 'owner', order: 0 })
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
  const columns = Object.fromEntries(Object.entries(boards).map(([k, id]) => [k, columnsOf[id]]))
  writeFileSync('e2e/.data/seed.json', JSON.stringify({ boards, columns, sessions }, null, 2))
  process.exit(0)
})().catch((e) => { console.error(e); process.exit(1) })
