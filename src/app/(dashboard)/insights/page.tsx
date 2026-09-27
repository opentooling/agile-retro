import { auth } from '@/auth'
import * as db from '@/lib/db'
import { authUserFromSession, canViewBoard } from '@/lib/authz'
import { buildInsights } from '@/lib/analytics'
import { buildTrends } from '@/lib/trends'
import { InsightsView } from '@/components/InsightsView'
import { PageShell } from '@/components/PageHeader'
import { Masthead } from '@/components/Masthead'
import { EmptyState } from '@/components/visual/EmptyState'
import { NoData } from '@/components/visual/Illustration'
import { TrendingUp } from 'lucide-react'
import { TeamPicker } from '@/components/TeamPicker'

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
  const raw = selected ? await db.teamAnalytics(selected.id) : null
  const insights = raw ? buildInsights(raw) : null
  const trends = raw ? buildTrends(raw) : null

  return (
    <PageShell width="wide">
      <Masthead
        eyebrow="Analytics"
        icon={TrendingUp}
        title={selected ? <>Insights <span className="text-muted-foreground">· {selected.name}</span></> : 'Insights'}
        lede="How this team's retrospectives are going, and which way they're heading."
      />

      {teams.length === 0 ? (
        <EmptyState
          illustration={<NoData className="h-20 w-36" />}
          title="You don't have access to any team's boards yet."
          hint="Insights are per team. Ask a team admin to add your group."
        />
      ) : (
        <>
          <TeamPicker
            teams={teams.map((t) => ({ id: t.id, name: t.name, imageData: t.imageData }))}
            selectedId={selected?.id}
            basePath="/insights"
          />
          {insights && <InsightsView insights={insights} trends={trends} />}
        </>
      )}
    </PageShell>
  )
}
