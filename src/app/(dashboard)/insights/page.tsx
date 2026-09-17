import { auth } from '@/auth'
import * as db from '@/lib/db'
import { authUserFromSession, canViewBoard } from '@/lib/authz'
import { buildInsights } from '@/lib/analytics'
import { buildTrends } from '@/lib/trends'
import { InsightsView } from '@/components/InsightsView'
import { PageShell, PageHeader } from '@/components/PageHeader'
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
          {insights && <InsightsView insights={insights} trends={trends} />}
        </>
      )}
    </PageShell>
  )
}
