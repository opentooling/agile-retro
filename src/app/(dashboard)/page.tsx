import * as db from '@/lib/db'
import Link from 'next/link'
import { auth } from '@/auth'
import { authUserFromSession, canAdministerBoard, boardScopeFor } from '@/lib/authz'
import { CreateRetroDialog } from '@/components/CreateRetroDialog'
import { SessionList, LiveBoards, type SessionSummary } from '@/components/SessionList'
import { PageShell } from '@/components/PageHeader'
import { Masthead, Figures, Figure, SectionTitle } from '@/components/Masthead'
import { ScopeBar } from '@/components/ScopeBar'
import { EmptyState } from '@/components/visual/EmptyState'
import { EmptyBoard, EmptyChecklist } from '@/components/visual/Illustration'
import { Identicon } from '@/components/visual/Identicon'
import { ArrowRight, Calendar, Home as HomeIcon, Radio } from 'lucide-react'
import { cn } from '@/lib/utils'

const dateline = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

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

  const [recentRetros, totalRetros, activeCount, openActions, owed] = await Promise.all([
    db.listRetrospectives(filter, 20),
    db.countRetrospectives(filter),
    // Counted in the database, not from the 20 rows above — otherwise the tile
    // silently under-reports as soon as there are more than 20 boards.
    db.countRetrospectives({ ...filter, statusNot: 'CLOSED' }),
    db.countOpenActions({ ...filter, scope: actionScope }),
    // A glance at what is still owed, from the same boards the count covers.
    db.listActionItems({
      scope: actionScope,
      completed: false,
      teamNameContains: teamIdFilter,
      creatorContains: creatorFilter,
      take: 6,
    }),
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
  const live = sessions.filter((s) => s.status !== 'CLOSED')
  const past = sessions.filter((s) => s.status === 'CLOSED')

  const isFiltered = Boolean(creatorFilter || tagFilter || teamIdFilter)
  const firstName = session?.user?.name?.split(/[\s@.]/)[0]
  const now = new Date()

  return (
    <PageShell width="wide">
      <Masthead
        eyebrow={dateline.format(now)}
        icon={HomeIcon}
        title={firstName ? `Hello, ${firstName}` : 'Home'}
        lede="What your teams are reflecting on right now — and what they still owe."
        actions={<CreateRetroDialog />}
      >
        <Figures>
          <Figure href="/history?status=active" tone="positive" label="Live now" value={activeCount} />
          <Figure href="/actions" tone="risk" label="Open actions" value={openActions} />
          <Figure href="/history" tone="improve" label="Retrospectives" value={totalRetros} />
        </Figures>
      </Masthead>

      <ScopeBar fields={['team', 'creator', 'tag']} />

      <div className="@container">
        <section aria-labelledby="live-heading" className="mb-10">
          <SectionTitle
            id="live-heading"
            aside={
              activeCount > live.length ? (
                <Link href="/history?status=active" className="font-medium text-primary hover:underline">
                  All {activeCount} live
                </Link>
              ) : undefined
            }
          >
            <span className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-[hsl(var(--tone-positive-ink))]" aria-hidden />
              Live now
            </span>
          </SectionTitle>
          {live.length > 0 ? (
            <LiveBoards sessions={live} />
          ) : (
            <EmptyState
              illustration={<EmptyBoard className="h-20 w-32" />}
              title={isFiltered ? 'No live board matches these filters.' : 'No board is running right now.'}
              hint="Start a session and it appears here for everyone on the team."
              className="py-8"
            />
          )}
        </section>

        <div className="grid gap-10 @min-[64rem]:grid-cols-[minmax(0,1fr)_22rem]">
          <section aria-labelledby="recent-heading" className="min-w-0">
            <SectionTitle
              id="recent-heading"
              aside={
                totalRetros > sessions.length ? (
                  <Link href="/history" className="font-medium text-primary hover:underline">
                    Full history
                  </Link>
                ) : undefined
              }
            >
              Recently closed
            </SectionTitle>
            <SessionList
              sessions={past}
              emptyMessage={
                isFiltered
                  ? 'No closed retrospectives match these filters.'
                  : 'Nothing closed yet — finished sessions are kept here.'
              }
            />
          </section>

          <section aria-labelledby="owed-heading" className="min-w-0">
            <SectionTitle
              id="owed-heading"
              aside={
                <Link href="/actions" className="font-medium text-primary hover:underline">
                  All actions
                </Link>
              }
            >
              Still owed
            </SectionTitle>
            {owed.length === 0 ? (
              <EmptyState
                illustration={<EmptyChecklist className="h-16 w-28" />}
                title="Nothing outstanding."
                hint="Actions agreed in a retro show up here until they’re done."
                className="py-8"
              />
            ) : (
              <ul className="rounded-xl border bg-card shadow-[var(--shadow-card)]">
                {owed.map((action) => {
                  const overdue = action.dueDate ? new Date(action.dueDate) < now : false
                  return (
                    <li key={action.id} className="border-b last:border-b-0">
                      <Link
                        href={`/actions?retroId=${action.retrospectiveId}`}
                        className="flex gap-3 px-4 py-3 transition-colors hover:bg-accent/60"
                      >
                        <span aria-hidden className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-[hsl(var(--tone-positive))]" />
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-sm font-medium leading-snug">{action.content}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                            {action.assignee && (
                              <span className="flex items-center gap-1">
                                <Identicon name={action.assignee} size={14} />
                                {action.assignee}
                              </span>
                            )}
                            {action.dueDate && (
                              <span className={cn('flex items-center gap-1', overdue && 'font-semibold text-destructive')}>
                                <Calendar className="h-3 w-3" aria-hidden />
                                {overdue ? 'Overdue · ' : 'Due '}{shortDate.format(new Date(action.dueDate))}
                              </span>
                            )}
                            <span className="truncate">{action.retrospective.title}</span>
                          </span>
                        </span>
                      </Link>
                    </li>
                  )
                })}
                {openActions > owed.length && (
                  <li>
                    <Link href="/actions" className="flex items-center justify-between px-4 py-2.5 text-sm font-medium text-primary hover:bg-accent/60">
                      {openActions - owed.length} more open
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </section>
        </div>
      </div>
    </PageShell>
  )
}
