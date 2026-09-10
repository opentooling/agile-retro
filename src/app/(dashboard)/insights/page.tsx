import Link from 'next/link'
import { auth } from '@/auth'
import * as db from '@/lib/db'
import { authUserFromSession, canViewBoard } from '@/lib/authz'
import { buildInsights, type TeamInsights } from '@/lib/analytics'
import { SENTIMENT_LABEL, type Sentiment } from '@/lib/column-sentiment'
import { PageShell, PageHeader } from '@/components/PageHeader'
import { TeamPicker } from '@/components/TeamPicker'
import { cn } from '@/lib/utils'

/** A single figure, with the interpretation next to it rather than in a legend. */
function Metric({
  label, value, note, tone = 'neutral',
}: {
  label: string
  value: string
  note?: string
  tone?: 'neutral' | 'good' | 'warn'
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn(
        'mt-0.5 text-2xl font-bold tabular-nums',
        tone === 'good' && 'text-green-700 dark:text-green-400',
        tone === 'warn' && 'text-amber-700 dark:text-amber-400'
      )}>
        {value}
      </div>
      {note && <div className="mt-0.5 text-xs text-muted-foreground">{note}</div>}
    </div>
  )
}

const SENTIMENT_BAR: Record<Sentiment, string> = {
  positive: 'bg-green-500',
  negative: 'bg-red-500',
  improve: 'bg-blue-500',
  risk: 'bg-amber-500',
  neutral: 'bg-slate-400',
}

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
const days = (v: number | null) => (v === null ? '—' : `${Math.round(v)}d`)
const one = (v: number | null) => (v === null ? '—' : v.toFixed(1))

function Insights({ insights }: { insights: TeamInsights }) {
  const a = insights.actions
  const e = insights.engagement

  if (insights.retroCount === 0) {
    return (
      <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
        This team hasn&apos;t run a retrospective yet.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Rhythm</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <Metric label="Retrospectives" value={String(insights.retroCount)} />
          <Metric
            label="Typical gap"
            value={days(insights.medianGapDays)}
            note={insights.medianGapDays === null ? 'Needs two retros' : 'Median between sessions'}
          />
          <Metric
            label="Since the last one"
            value={days(insights.daysSinceLastRetro)}
            tone={
              insights.medianGapDays !== null &&
              insights.daysSinceLastRetro !== null &&
              insights.daysSinceLastRetro > insights.medianGapDays * 2
                ? 'warn'
                : 'neutral'
            }
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Follow-through
        </h2>
        <div className="grid gap-2 sm:grid-cols-4">
          <Metric
            label="Completed"
            value={pct(a.completionRate)}
            note={`${a.done} of ${a.done + a.open}`}
            tone={a.completionRate !== null && a.completionRate >= 0.6 ? 'good' : 'neutral'}
          />
          <Metric label="Still open" value={String(a.open)} />
          <Metric label="Overdue" value={String(a.overdue)} tone={a.overdue > 0 ? 'warn' : 'neutral'} />
          <Metric
            label="Time to close"
            value={days(a.medianDaysToClose)}
            note={
              a.untimedCompletions > 0
                ? `${a.untimedCompletions} closed before this was tracked`
                : 'Median'
            }
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          What the team talks about
        </h2>
        {insights.sentiment.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cards yet.</p>
        ) : (
          <>
            <div className="flex h-3 w-full overflow-hidden rounded-full">
              {insights.sentiment.map((s) => (
                <div
                  key={s.sentiment}
                  className={SENTIMENT_BAR[s.sentiment]}
                  style={{ width: `${s.share * 100}%` }}
                  title={`${SENTIMENT_LABEL[s.sentiment]}: ${s.items}`}
                />
              ))}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {insights.sentiment.map((s) => (
                <li key={s.sentiment} className="flex items-center gap-1.5">
                  <span className={cn('h-2 w-2 rounded-full', SENTIMENT_BAR[s.sentiment])} />
                  {SENTIMENT_LABEL[s.sentiment]} · {s.items} ({Math.round(s.share * 100)}%)
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          How the sessions run
        </h2>
        <div className="grid gap-2 sm:grid-cols-4">
          <Metric label="Cards per retro" value={one(e.avgItemsPerRetro)} note="Average" />
          <Metric
            label="Cards discussed"
            value={pct(e.discussionCoverage)}
            note="Got notes in Review"
          />
          <Metric
            label="Vote concentration"
            value={pct(e.voteConcentration)}
            note="Votes on the top three"
          />
          <Metric
            label="People contributing"
            value={one(e.avgContributors)}
            note="Average, named boards only"
          />
        </div>
        {insights.phases.length > 0 && (
          <div className="mt-2 rounded-lg border bg-card px-4 py-3">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Median time per phase
            </div>
            <ul className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {insights.phases.map((p) => (
                <li key={p.phase}>
                  <span className="font-medium">{p.phase[0] + p.phase.slice(1).toLowerCase()}</span>{' '}
                  <span className="tabular-nums">{p.medianMinutes.toFixed(0)}m</span>{' '}
                  <span className="text-xs text-muted-foreground">({p.samples})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Figures cover this team&apos;s boards that still exist — a board removed by its retention
        setting takes its history with it. Everything here is about the team; nothing reports on
        an individual.
      </p>
    </div>
  )
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  // Deliberately not `teamId`: that is the app-wide team-name filter which the
  // sidebar carries between pages, so using it here would leak a team id into
  // the Dashboard, History, Actions and Teams filters and empty them.
  const requested = typeof params.team === 'string' ? params.team : undefined

  const [session, allTeams, recentRetros] = await Promise.all([
    auth(),
    db.listTeams(),
    // Newest first; used only to pick a sensible default team.
    db.listRetrospectives({}, 50),
  ])
  const authUser = authUserFromSession(session)

  // Only teams whose boards this viewer could open — the aggregates are drawn
  // from those boards, so the same rule has to apply.
  const teams = allTeams.filter((team) =>
    canViewBoard(authUser, { teamId: team.id, creator: '', team })
  )

  // Default to whichever visible team ran a retro most recently. Falling back
  // to the first team in the list means an organisation with many teams opens
  // on whichever one happens to sort first — usually one that has never run a
  // retro at all, so the page greets you with an empty state.
  const visible = new Set(teams.map((t) => t.id))
  const mostRecentTeamId = recentRetros.find((r) => r.teamId && visible.has(r.teamId))?.teamId
  const selected =
    teams.find((t) => t.id === requested) ??
    teams.find((t) => t.id === mostRecentTeamId) ??
    teams[0] ??
    null
  const insights = selected ? buildInsights(await db.teamAnalytics(selected.id)) : null

  return (
    <PageShell>
      <PageHeader title="Insights" />

      {teams.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          You don&apos;t have access to any team&apos;s boards yet.
        </div>
      ) : (
        <>
          <TeamPicker
            teams={teams.map((t) => ({ id: t.id, name: t.name, imageData: t.imageData }))}
            selectedId={selected?.id}
            basePath="/insights"
          />
          {insights && <Insights insights={insights} />}
        </>
      )}
    </PageShell>
  )
}
