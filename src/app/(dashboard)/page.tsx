import * as db from '@/lib/db'
import Link from 'next/link'
import { auth } from '@/auth'
import { authUserFromSession, canManageBoard } from '@/lib/authz'
import { CreateRetroDialog } from '@/components/CreateRetroDialog'
import { SessionList, type SessionSummary } from '@/components/SessionList'
import { PageShell, PageHeader } from '@/components/PageHeader'
import { LayoutDashboard, ListTodo, Users } from 'lucide-react'

/** One compact metric. Three of these replace three full-height cards. */
function Stat({
  href,
  icon: Icon,
  label,
  value,
}: {
  href: string
  icon: typeof LayoutDashboard
  label: string
  value: number
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5 transition-colors hover:bg-accent/60"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="text-2xl font-bold tabular-nums leading-none">{value}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </Link>
  )
}

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

  const [session, recentRetros, totalRetros, activeCount, openActions] = await Promise.all([
    auth(),
    db.listRetrospectives(filter, 20),
    db.countRetrospectives(filter),
    // Counted in the database, not from the 20 rows above — otherwise the tile
    // silently under-reports as soon as there are more than 20 boards.
    db.countRetrospectives({ ...filter, statusNot: 'CLOSED' }),
    db.countOpenActions(filter),
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
    canDelete: canManageBoard(authUser, {
      teamId: retro.teamId,
      creator: retro.creator,
      team: retro.team,
    }),
  }))

  const isFiltered = Boolean(creatorFilter || tagFilter || teamIdFilter)

  return (
    <PageShell>
      <PageHeader title="Dashboard" action={<CreateRetroDialog />} />

      <div className="mb-5 grid gap-2 sm:grid-cols-3">
        <Stat href="/history" icon={LayoutDashboard} label="retrospectives" value={totalRetros} />
        <Stat href="/history?status=active" icon={Users} label="active now" value={activeCount} />
        <Stat href="/actions" icon={ListTodo} label="open actions" value={openActions} />
      </div>

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
