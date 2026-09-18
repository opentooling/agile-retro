import type { TeamInsights } from '@/lib/analytics'
import type { TeamTrends } from '@/lib/trends'
import { SENTIMENT_LABEL, type Sentiment } from '@/lib/column-sentiment'
import { InsightsTrends } from '@/components/InsightsTrends'
import { CalendarClock, CircleCheckBig, MessagesSquare, Gauge, type LucideIcon } from 'lucide-react'
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
    <div
      className="rounded-lg border bg-card px-4 py-3 shadow-[var(--shadow-card)]"
      style={{
        borderLeftWidth: 3,
        borderLeftColor: `hsl(var(--tone-${tone === 'good' ? 'positive' : tone === 'warn' ? 'risk' : 'improve'}))`,
      }}
    >
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn(
        'mt-0.5 text-2xl font-bold tabular-nums',
        tone === 'good' && 'text-[hsl(var(--tone-positive-ink))]',
        tone === 'warn' && 'text-[hsl(var(--tone-risk-ink))]'
      )}>
        {value}
      </div>
      {note && <div className="mt-0.5 text-xs text-muted-foreground">{note}</div>}
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

/** A section's heading: a tone-coloured icon chip and the title. */
function SectionHeading({ icon: Icon, tone, children }: { icon: LucideIcon; tone: string; children: React.ReactNode }) {
  return (
    <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      <span
        className="grid h-6 w-6 place-items-center rounded-lg"
        style={{ background: `hsl(var(--tone-${tone}-soft))`, color: `hsl(var(--tone-${tone}-ink))` }}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      {children}
    </h2>
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
      <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
        This team hasn&apos;t run a retrospective yet.
      </div>
    )
  }

  return (
    <div className="@container space-y-6">
      {/* On a wide screen the four sections pair up, 3 tiles beside 4, with the
          columns split 3:4 so every tile ends up the same width and the second
          row's tiles line up under the first's. Stretching them full width
          instead would give a 560px box holding the number "2".
          Gated on the view's own width (container query), at 1648px: any
          narrower and pairing squeezes tiles below ~227px and wraps their labels
          — narrower than the single column it replaces. The view's width, not
          the window's, because an open sidebar takes 256px of the window. */}
      <div className="space-y-6 @min-[1648px]:grid @min-[1648px]:grid-cols-[3fr_4fr] @min-[1648px]:gap-x-6 @min-[1648px]:gap-y-6 @min-[1648px]:space-y-0">
      <section>
        <SectionHeading icon={CalendarClock} tone="improve">Rhythm</SectionHeading>
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
        <SectionHeading icon={CircleCheckBig} tone="positive">Follow-through</SectionHeading>
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
        <SectionHeading icon={MessagesSquare} tone="review">What the team talks about</SectionHeading>
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
        <SectionHeading icon={Gauge} tone="risk">How the sessions run</SectionHeading>
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

      </div>

      {trends && <InsightsTrends trends={trends} />}

      <p className="text-xs text-muted-foreground">
        Figures cover this team&apos;s boards that still exist — a board removed by its retention
        setting takes its history with it. Everything here is about the team; nothing reports on
        an individual.
      </p>
    </div>
  )
}
