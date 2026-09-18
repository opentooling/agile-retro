import type { TeamTrends } from '@/lib/trends'
import { TrendChart, type TrendDatum } from '@/components/TrendChart'

// Formatted on the server in one locale and zone, so the tooltip, the table
// and the axis all agree with each other and with the UTC month buckets.
const monthHeading = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayHeading = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/**
 * The tiles above say where the team is; these say which way it is heading.
 * Each chart is one measure on its own axis — never two scales on one plot.
 */
export function InsightsTrends({ trends }: { trends: TeamTrends }) {
  const { from, to } = trends

  const months: TrendDatum[] = trends.months.map((m) => ({
    x: m.start,
    heading: monthHeading.format(m.start),
    note: m.partial ? 'So far this month' : undefined,
    partial: m.partial,
    values: { retros: m.retros, agreed: m.agreed, closed: m.closed },
  }))

  const sessions: TrendDatum[] = trends.sessions.map((s) => ({
    x: s.at,
    heading: `${dayHeading.format(s.at)} · ${s.title}`,
    note: s.contributors === null ? 'Anonymous board — people not counted' : undefined,
    values: { cards: s.cards, discussed: s.discussed, contributors: s.contributors },
  }))

  const untimed = trends.untimedClosures
  const actionsNote =
    'Per month. While closed sits below agreed, the backlog is growing.' +
    (untimed > 0
      ? ` Not shown: ${untimed} closed before completion dates were tracked.`
      : '')

  return (
    <section>
      <header className="mb-4 flex items-baseline gap-3">
        <span className="font-mono text-sm font-semibold tabular-nums text-muted-foreground">05</span>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Over time</h2>
          <p className="text-sm text-muted-foreground">The figures above say where the team is; these say which way it is heading.</p>
        </div>
      </header>
      {/* Charts get ~380px or more each: 2 across from 768px, 3 from 1200px of the view's own width. */}
      <div className="grid gap-3 @3xl:grid-cols-2 @min-[75rem]:grid-cols-3">
        <TrendChart
          title="Sessions per month"
          description="How regularly the team meets."
          kind="columns" unit="count" from={from} to={to}
          series={[{ key: 'retros', label: 'Sessions', tone: 1 }]}
          data={months}
        />
        <TrendChart
          title="Actions agreed and closed"
          description={actionsNote}
          kind="lines" unit="count" from={from} to={to}
          series={[
            { key: 'agreed', label: 'Agreed', tone: 1 },
            { key: 'closed', label: 'Closed', tone: 2 },
          ]}
          data={months}
        />
        <TrendChart
          title="Cards per session"
          description="How much gets raised. Empty boards are left out."
          kind="lines" unit="count" from={from} to={to}
          series={[{ key: 'cards', label: 'Cards', tone: 1 }]}
          data={sessions}
        />
        <TrendChart
          title="People contributing"
          description="Distinct people who added cards. Anonymous boards are never counted."
          kind="lines" unit="count" from={from} to={to}
          series={[{ key: 'contributors', label: 'People', tone: 1 }]}
          data={sessions}
          emptyMessage="Not enough named sessions yet — anonymous boards aren't counted."
        />
        <TrendChart
          title="Cards discussed"
          description="Share of each session's cards that got notes in Review."
          kind="lines" unit="percent" from={from} to={to}
          series={[{ key: 'discussed', label: 'Discussed', tone: 1 }]}
          data={sessions}
        />
      </div>
    </section>
  )
}
