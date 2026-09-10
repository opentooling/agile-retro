/**
 * Seed demonstration data.
 *
 * Creates three teams with deliberately different working habits so the
 * Insights page shows contrast rather than one shape repeated. This is a
 * development aid — it writes real rows through the normal data layer and is
 * not safe to point at a production database.
 *
 *   npm run db:seed-demo                     add the demo teams
 *   npm run db:seed-demo -- --reset          remove them first, then re-add
 *   npm run db:seed-demo -- --reset --scale 3
 *       multiply each team's retro count, for filling enough history to
 *       exercise paging. Scaling reaches further back in time; it does not
 *       change each team's cadence or habits.
 *
 * Rows are created through src/lib/db so there is no second copy of the
 * schema. Dates are then backdated with a direct connection, because the
 * normal API has no reason to let a caller choose when something was created.
 */
import * as db from '../src/lib/db'
import { templateById } from '../src/lib/retro-templates'

const DAY = 86_400_000
const MIN = 60_000
const TAG = 'demo-data'

/** Deterministic pseudo-randomness, so repeated runs look the same. */
let seed = 20260909
const rnd = () => {
    // Math.imul keeps the multiply in 32-bit integer space; a plain float
    // multiply loses precision here and skews the distribution badly enough
    // that the profiles missed their intended completion rates.
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
    return seed / 0x7fffffff
}
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]
const between = (lo: number, hi: number) => Math.floor(lo + rnd() * (hi - lo + 1))

// ---------------------------------------------------------------------------
// Backdating. Everything else goes through the data layer.
// ---------------------------------------------------------------------------

const isPostgres = /^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL ?? '')

type Backdater = {
  set: (table: string, column: string, id: string, when: Date | null) => Promise<void>
  close: () => Promise<void>
}

async function backdater(): Promise<Backdater> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')

  if (isPostgres) {
    const { Pool } = await import('pg')
    const pool = new Pool({ connectionString: url, max: 1 })
    return {
      set: async (table, column, id, when) => {
        await pool.query(`UPDATE "${table}" SET "${column}" = $2 WHERE "id" = $1`, [id, when])
      },
      close: () => pool.end(),
    }
  }

  const { DatabaseSync } = await import('node:sqlite')
  const file = url.replace(/^file:/, '')
  const sqlite = new DatabaseSync(file)
  return {
    set: async (table, column, id, when) => {
      sqlite.prepare(`UPDATE "${table}" SET "${column}" = ? WHERE "id" = ?`)
        .run(when ? when.toISOString() : null, id)
    },
    close: async () => sqlite.close(),
  }
}

// ---------------------------------------------------------------------------
// Team profiles
// ---------------------------------------------------------------------------

const GOOD = [
  'Pairing on the release cut went smoothly', 'CI stayed green all sprint',
  'The new runbook actually got used', 'Good turnout at the design review',
  'Shipped the migration with no rollback', 'Onboarding docs paid off this week',
]
const BAD = [
  'Flaky integration tests again', 'Deploy blocked for two days on approvals',
  'Requirements changed mid-sprint', 'On-call was brutal on Tuesday',
  'Nobody knew who owned the alert', 'Standup ran to 40 minutes',
]
const IMPROVE = [
  'Write down the release checklist', 'Rotate on-call more evenly',
  'Trim the standup agenda', 'Automate the staging refresh',
  'Agree a definition of done', 'Book the retro earlier in the week',
]
const ACTIONS = [
  'Fix the flaky payment test', 'Document the deploy approval path',
  'Set up an alert owner rota', 'Automate the staging data refresh',
  'Book retros as a recurring invite', 'Split the release checklist into steps',
  'Add a dashboard for queue depth', 'Review the on-call handover notes',
]
const PEOPLE = ['ana', 'bo', 'cy', 'dev', 'eve', 'fin']

type Profile = {
  name: string
  note: string
  retros: number
  gapDays: number[]
  template: string
  mix: { good: number; bad: number; improve: number }
  summaryRate: number
  actionsPerRetro: [number, number]
  completionRate: number
  contributors: [number, number]
  phaseMinutes: { INPUT: number; VOTING: number; REVIEW: number }
}

const PROFILES: Profile[] = [
  {
    name: 'Platform Engineering',
    note: 'healthy: steady fortnightly cadence, actions get closed',
    retros: 8, gapDays: [14], template: 'classic',
    mix: { good: 4, bad: 3, improve: 3 },
    summaryRate: 0.65, actionsPerRetro: [2, 3], completionRate: 0.78,
    contributors: [4, 6], phaseMinutes: { INPUT: 12, VOTING: 6, REVIEW: 20 },
  },
  {
    name: 'Trading Systems',
    note: 'struggling: irregular cadence, negative-heavy, actions pile up',
    retros: 6, gapDays: [10, 38, 12, 55, 15], template: 'start-stop-continue',
    mix: { good: 2, bad: 6, improve: 2 },
    summaryRate: 0.2, actionsPerRetro: [3, 5], completionRate: 0.22,
    contributors: [2, 3], phaseMinutes: { INPUT: 15, VOTING: 5, REVIEW: 38 },
  },
  {
    name: 'Data Services',
    note: 'new: two sessions so far, nothing closed yet',
    retros: 2, gapDays: [14], template: 'four-ls',
    mix: { good: 3, bad: 2, improve: 2 },
    summaryRate: 0.4, actionsPerRetro: [1, 2], completionRate: 0,
    contributors: [3, 3], phaseMinutes: { INPUT: 10, VOTING: 5, REVIEW: 15 },
  },
]

async function removeDemoData() {
  const teams = await db.listTeams()
  const targets = teams.filter((t) => PROFILES.some((p) => p.name === t.name))
  let removed = 0
  for (const team of targets) {
    const retros = await db.listRetrospectives({ teamNameContains: team.name })
    for (const r of retros) {
      await db.deleteRetro(r.id)
      removed += 1
    }
  }
  console.log(`[seed] removed ${removed} demo board(s) (teams are left in place)`)
}

function scaleArg(): number {
    const i = process.argv.indexOf('--scale')
    if (i === -1) return 1
    const n = Number(process.argv[i + 1])
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
  if (process.argv.includes('--reset')) await removeDemoData()
  const scale = scaleArg()

  const back = await backdater()
  const now = Date.now()

  try {
    for (const profile of PROFILES) {
      const existing = (await db.listTeams()).find((t) => t.name === profile.name)
      const team = existing ?? (await db.createTeam(profile.name, {
        createdBy: 'ana@example.com',
        // Bound to the same group the demo user is in, so the seeded teams are
        // actually visible rather than failing closed.
        memberGroups: ['/Platform'],
        adminGroups: ['/Platform'],
      }))

      // Walk backwards from today so the most recent retro is a few days old.
      const offsets: number[] = []
      let cursor = between(2, 6)
      const retroCount = profile.retros * scale
      for (let i = 0; i < retroCount; i++) {
        offsets.push(cursor)
        cursor += profile.gapDays[i % profile.gapDays.length]
      }

      for (const [index, daysAgo] of offsets.entries()) {
        const created = new Date(now - daysAgo * DAY)
        const tpl = templateById(profile.template)
        const retro = await db.createRetrospectiveWithColumns(
          {
            title: `${profile.name} — Sprint ${offsets.length - index}`,
            tags: TAG,
            creator: 'ana',
            teamId: team.id,
            inputDuration: 10, votingDuration: 5, reviewDuration: 15,
            isAnonymous: false, blindInput: false, expiresAt: null,
            phaseStartTime: created,
          },
          tpl.columns
        )
        await back.set('Retrospective', 'createdAt', retro.id, created)

        const full = await db.getRetroFull(retro.id)
        const people = PEOPLE.slice(0, between(profile.contributors[0], profile.contributors[1]))

        for (const column of full!.columns) {
          const sentiment = column.type.includes('WELL') || column.type === 'START' || column.type.endsWith('_POSITIVE')
            ? 'good'
            : column.type.includes('DIDNT') || column.type === 'STOP' || column.type.endsWith('_NEGATIVE')
              ? 'bad'
              : 'improve'
          const pool = sentiment === 'good' ? GOOD : sentiment === 'bad' ? BAD : IMPROVE
          const count = profile.mix[sentiment as 'good' | 'bad' | 'improve']

          for (let n = 0; n < count; n++) {
            const author = pick(people)
            const item = await db.createItem({
              content: pick(pool),
              columnId: column.id,
              userId: author,
              username: author,
              order: n,
            })
            await back.set('Item', 'createdAt', item.id, new Date(created.getTime() + n * MIN))
            if (rnd() < profile.summaryRate) {
              await db.updateItemSummary(item.id, 'Discussed — agreed to keep an eye on this.')
            }
            // Votes cluster on a few cards, as they do in a real session.
            const votes = n === 0 ? between(4, 8) : n === 1 ? between(2, 4) : between(0, 1)
            if (votes > 0) await db.createVote({ itemId: item.id, userId: pick(people), count: votes })
          }
        }

        // Phase transitions, so time-per-phase is real rather than configured.
        // Everything but the most recent session is also closed: leaving a
        // year of retros sitting in ACTIONS is not what a real board list looks
        // like, and it left nothing to demonstrate the read-only archive with.
        const isMostRecent = index === 0
        const phases = isMostRecent
          ? (['VOTING', 'REVIEW', 'ACTIONS'] as const)
          : (['VOTING', 'REVIEW', 'ACTIONS', 'CLOSED'] as const)
        let at = created.getTime()
        for (const phase of phases) {
          const prev = phase === 'VOTING' ? 'INPUT' : phase === 'REVIEW' ? 'VOTING'
            : phase === 'ACTIONS' ? 'REVIEW' : 'ACTIONS'
          at += (profile.phaseMinutes[prev as keyof typeof profile.phaseMinutes] ?? 10) * MIN
          await db.updateRetroStatus(retro.id, phase, new Date(at))
        }

        for (let n = 0; n < between(profile.actionsPerRetro[0], profile.actionsPerRetro[1]); n++) {
          const action = await db.createActionItem({
            content: pick(ACTIONS),
            retrospectiveId: retro.id,
            assignee: pick(people),
            dueDate: new Date(created.getTime() + between(7, 21) * DAY),
          })
          await back.set('ActionItem', 'createdAt', action.id, created)
          if (rnd() < profile.completionRate) {
            await db.updateActionCompleted(action.id, true)
            const closed = new Date(created.getTime() + between(2, 18) * DAY)
            await back.set('ActionItem', 'completedAt', action.id, closed > new Date() ? new Date() : closed)
          }
        }
      }
      console.log(`[seed] ${profile.name}: ${retroCount} retros — ${profile.note}`)
    }
  } finally {
    await back.close()
  }
  console.log('[seed] done — open /insights and switch between the teams')
}

main().then(() => process.exit(0)).catch((err) => { console.error('[seed] failed:', err); process.exit(1) })
