import type { TeamInsights } from '@/lib/analytics'
import type { TeamTrends } from '@/lib/trends'
import { SENTIMENT_LABEL, type Sentiment } from '@/lib/column-sentiment'
import { InsightsTrends } from '@/components/InsightsTrends'
import { PHASE_TONE } from '@/components/PhaseBadge'
import { EmptyState } from '@/components/visual/EmptyState'
import { NoData } from '@/components/visual/Illustration'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'

type Tone = 'neutral' | 'good' | 'warn'

/**
 * One figure in the scorecard: a large number, what it is, and the
 * interpretation beside it rather than in a legend. Cells sit in a hairline
 * grid — the numbers carry the page, so they are not boxed.
 */
function Metric({ label, value, note, tone = 'neutral' }: { label: string; value: string; note?: string; tone?: Tone }) {
  return (
    <div className="min-w-0 border-t py-4 pr-4">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1">
        <span
          className={cn(
            'flex items-center gap-1.5 text-4xl font-semibold tabular-nums tracking-tight',
            tone === 'good' && 'text-[hsl(var(--tone-positive-ink))]',
            tone === 'warn' && 'text-[hsl(var(--tone-risk-ink))]',
          )}
        >
          {value}
          {tone === 'good' && <><ArrowUpRight className="h-6 w-6" aria-hidden /><span className="sr-only">(healthy)</span></>}
          {tone === 'warn' && <><ArrowDownRight className="h-6 w-6" aria-hidden /><span className="sr-only">(needs attention)</span></>}
        </span>
        {note && <span className="mt-1 block text-xs text-muted-foreground">{note}</span>}
      </dd>
    </div>
  )
}

const SENTIMENT_BAR: Record<Sentiment, string> = {
  positive: 'bg-[hsl(var(--tone-positive))]',
  negative: 'bg-[hsl(var(--tone-negative))]',
  improve: 'bg-[hsl(var(--tone-improve))]',
  risk: 'bg-[hsl(var(--tone-risk))]',
  neutral: 'bg-[hsl(var(--tone-neutral))]',
}

/** A numbered section of the report, so the page reads in order. */
function Chapter({ n, title, lede, children }: { n: string; title: string; lede: string; children: React.ReactNode }) {
  return (
    <section className="@container min-w-0">
      <header className="mb-3 flex items-baseline gap-3">
        <span className="font-mono text-sm font-semibold tabular-nums text-muted-foreground">{n}</span>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="text-sm text-muted-foreground">{lede}</p>
        </div>
      </header>
      {children}
    </section>
  )
}

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
const days = (v: number | null) => (v === null ? '—' : `${Math.round(v)}d`)
const one = (v: number | null) => (v === null ? '—' : v.toFixed(1))

export function InsightsView({ insights, trends }: { insights: TeamInsights; trends: TeamTrends | null }) {
  const a = insights.actions
  const e = insights.engagement

  if (insights.retroCount === 0) {
    return (
      <EmptyState
        illustration={<NoData className="h-20 w-36" />}
        title="This team hasn't run a retrospective yet."
        hint="Figures appear after the first session."
      />
    )
  }

  const longestPhase = Math.max(1, ...insights.phases.map((p) => p.medianMinutes))

  return (
    <div className="@container space-y-12">
      {/* On a wide view the four chapters pair up. Gated on the view's own
          width (container query) so an open rail can't squeeze the figures. */}
      <div className="grid gap-x-12 gap-y-12 @min-[72rem]:grid-cols-2">
        <Chapter n="01" title="Rhythm" lede="How often the team stops to look back.">
          <dl className="grid grid-cols-2 @lg:grid-cols-3">
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
          </dl>
        </Chapter>

        <Chapter n="02" title="Follow-through" lede="Whether agreed actions actually get done.">
          <dl className="grid grid-cols-2 @lg:grid-cols-4">
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
          </dl>
        </Chapter>

        <Chapter n="03" title="What the team talks about" lede="Every card ever raised, by the sentiment of its column.">
          {insights.sentiment.length === 0 ? (
            <p className="text-sm text-muted-foreground">No cards yet.</p>
          ) : (
            <>
              <div className="flex h-5 w-full gap-0.5 overflow-hidden rounded-md">
                {insights.sentiment.map((s) => (
                  <div
                    key={s.sentiment}
                    className={SENTIMENT_BAR[s.sentiment]}
                    style={{ width: `${s.share * 100}%` }}
                    title={`${SENTIMENT_LABEL[s.sentiment]}: ${s.items}`}
                  />
                ))}
              </div>
              <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 @lg:grid-cols-4">
                {insights.sentiment.map((s) => (
                  <li key={s.sentiment} className="border-t pt-2">
                    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <span className={cn('h-2.5 w-2.5 rounded-sm', SENTIMENT_BAR[s.sentiment])} aria-hidden />
                      {SENTIMENT_LABEL[s.sentiment]}
                    </span>
                    <span className="mt-0.5 block text-2xl font-semibold tabular-nums">
                      {Math.round(s.share * 100)}%
                      <span className="ml-1.5 text-sm font-normal text-muted-foreground">{s.items} cards</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Chapter>

        <Chapter n="04" title="How the sessions run" lede="Participation, focus, and where the time goes.">
          <dl className="grid grid-cols-2 @lg:grid-cols-4">
            <Metric label="Cards per retro" value={one(e.avgItemsPerRetro)} note="Average" />
            <Metric label="Cards discussed" value={pct(e.discussionCoverage)} note="Got notes in Review" />
            <Metric label="Vote concentration" value={pct(e.voteConcentration)} note="Votes on the top three" />
            <Metric label="People contributing" value={one(e.avgContributors)} note="Average, named boards only" />
          </dl>
          {insights.phases.length > 0 && (
            <div className="mt-4 border-t pt-4">
              <p className="text-sm font-medium text-muted-foreground">Median time per phase</p>
              <ul className="mt-3 space-y-2">
                {insights.phases.map((p) => {
                  const tone = PHASE_TONE[p.phase] ?? 'neutral'
                  return (
                    <li key={p.phase} className="grid grid-cols-[5rem_1fr_auto] items-center gap-3 text-sm">
                      <span className="font-medium">{p.phase[0] + p.phase.slice(1).toLowerCase()}</span>
                      <span className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${(p.medianMinutes / longestPhase) * 100}%`, background: `hsl(var(--tone-${tone}))` }}
                        />
                      </span>
                      <span className="tabular-nums">
                        {p.medianMinutes.toFixed(0)}m{' '}
                        <span className="text-xs text-muted-foreground">({p.samples} sessions)</span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </Chapter>
      </div>

      {trends && <InsightsTrends trends={trends} />}

      <p className="border-t pt-4 text-xs text-muted-foreground">
        Figures cover this team&apos;s boards that still exist — a board removed by its retention
        setting takes its history with it. Everything here is about the team; nothing reports on
        an individual.
      </p>
    </div>
  )
}
