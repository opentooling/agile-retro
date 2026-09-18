import * as db from '@/lib/db'
import Link from 'next/link'
import { auth } from '@/auth'
import { authUserFromSession, canAdministerBoard, boardScopeFor } from '@/lib/authz'
import { CreateRetroDialog } from '@/components/CreateRetroDialog'
import { SessionList, type SessionSummary } from '@/components/SessionList'
import { PageShell } from '@/components/PageHeader'
import { PageHero, HeroStat } from '@/components/PageHero'
import { LayoutDashboard, ListTodo, Users, Sparkles } from 'lucide-react'

export default async function Home({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams
  const creatorFilter = typeof params.creator === 'string' ? params.creator : undefined
  const tagFilter = typeof params.tag === 'string' ? params.tag : undefined
  const teamIdFilter = typeof params.teamId === 'string' ? params.teamId : undefined

  const filter: db.RetroFilter = {}
  if (creatorFilter) filter.creatorContains = creatorFilter
  if (tagFilter) filter.tagsContains = tagFilter
  // Free-text team search by name (still supports old links that pass a team name).
  if (teamIdFilter) filter.teamNameContains = teamIdFilter

  // The open-actions count is limited to boards the viewer can see, so it
  // agrees with what the Actions page it links to will actually list.
  const session = await auth()
  const actionScope = boardScopeFor(authUserFromSession(session), await db.listTeams())

  const [recentRetros, totalRetros, activeCount, openActions] = await Promise.all([
    db.listRetrospectives(filter, 20),
    db.countRetrospectives(filter),
    // Counted in the database, not from the 20 rows above — otherwise the tile
    // silently under-reports as soon as there are more than 20 boards.
    db.countRetrospectives({ ...filter, statusNot: 'CLOSED' }),
    db.countOpenActions({ ...filter, scope: actionScope }),
  ])

  // Delete is limited to whoever may already manage the board — its creator,
  // a team-admin of its team, or a global admin. Resolved server-side so the
  // control only reaches people the server action would actually allow.
  const authUser = authUserFromSession(session)
  const sessions: SessionSummary[] = recentRetros.map((retro) => ({
    id: retro.id,
    title: retro.title,
    status: retro.status,
    creator: retro.creator,
    createdAt: retro.createdAt.toISOString(),
    expiresAt: retro.expiresAt ? retro.expiresAt.toISOString() : null,
    team: retro.team ? { id: retro.team.id, name: retro.team.name, imageData: retro.team.imageData } : null,
    tags: retro.tags ? retro.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    canDelete: canAdministerBoard(authUser, {
      teamId: retro.teamId,
      creator: retro.creator,
      team: retro.team,
    }),
  }))

  const isFiltered = Boolean(creatorFilter || tagFilter || teamIdFilter)

  return (
    <PageShell width="wide">
      <PageHero
        icon={Sparkles}
        title="Dashboard"
        subtitle="What your teams are reflecting on right now."
        action={<CreateRetroDialog />}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <HeroStat href="/history" icon={LayoutDashboard} tone="improve" label="retrospectives" value={totalRetros} />
          <HeroStat href="/history?status=active" icon={Users} tone="positive" label="active now" value={activeCount} />
          <HeroStat href="/actions" icon={ListTodo} tone="risk" label="open actions" value={openActions} />
        </div>
      </PageHero>

      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Recent sessions
        </h2>
        {totalRetros > sessions.length && (
          <Link href="/history" className="text-xs font-medium text-primary hover:underline">
            View all {totalRetros}
          </Link>
        )}
      </div>

      <SessionList
        sessions={sessions}
        emptyMessage={
          isFiltered
            ? 'No retrospectives match these filters.'
            : 'No retrospectives yet — create your first session.'
        }
      />
    </PageShell>
  )
}
