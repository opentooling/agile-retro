import * as db from '@/lib/db'
import { auth } from '@/auth'
import { authUserFromSession, canAdministerBoard } from '@/lib/authz'
import { SessionList, type SessionSummary } from '@/components/SessionList'
import { PageShell } from '@/components/PageHeader'
import { Masthead, Segmented } from '@/components/Masthead'
import { ScopeBar } from '@/components/ScopeBar'
import { Archive } from 'lucide-react'
import { Pager, pageFromParams } from '@/components/Pager'

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const session = await auth()
  const params = await searchParams
  const creatorFilter = typeof params.creator === 'string' ? params.creator : undefined
  const tagFilter = typeof params.tag === 'string' ? params.tag : undefined
  const teamIdFilter = typeof params.teamId === 'string' ? params.teamId : undefined
  const statusFilter = typeof params.status === 'string' ? params.status : undefined
  const myBoardsFilter = typeof params.myBoards === 'string' ? params.myBoards === 'true' : false

  const filter: db.RetroFilter = {}
  if (creatorFilter) filter.creatorContains = creatorFilter
  if (tagFilter) filter.tagsContains = tagFilter
  if (teamIdFilter) filter.teamNameContains = teamIdFilter
  if (statusFilter === 'active') filter.statusNot = 'CLOSED'
  // "My boards" overrides the creator filter with an exact match.
  if (myBoardsFilter && session?.user?.name) {
    filter.creatorEquals = session.user.name
    delete filter.creatorContains
  }

  // This page used to load every board ever created. A team running
  // fortnightly retros produces ~26 a year, so an established org reaches
  // thousands — all of them queried, serialised and rendered at once.
  const PAGE_SIZE = 25
  const total = await db.countRetrospectives(filter)
  const page = pageFromParams(params.page, total, PAGE_SIZE)
  const retros = await db.listRetrospectives(filter, PAGE_SIZE, (page - 1) * PAGE_SIZE)

  const authUser = authUserFromSession(session)
  const sessions: SessionSummary[] = retros.map((retro) => ({
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

  // The view switch keeps the cross-page filters but swaps the view's own key.
  const viewHref = (view: 'all' | 'live' | 'mine') => {
    const next = new URLSearchParams()
    for (const key of ['teamId', 'creator', 'tag']) {
      const value = params[key]
      if (typeof value === 'string' && value) next.set(key, value)
    }
    if (view === 'live') next.set('status', 'active')
    if (view === 'mine') next.set('myBoards', 'true')
    const qs = next.toString()
    return qs ? `/history?${qs}` : '/history'
  }
  const view = myBoardsFilter ? 'mine' : statusFilter === 'active' ? 'live' : 'all'

  return (
    <PageShell width="wide">
      <Masthead
        eyebrow="Archive"
        icon={Archive}
        title="History"
        lede={`Every session your teams have run — ${total} ${total === 1 ? 'board' : 'boards'}${view === 'all' ? '' : ' in this view'}.`}
        actions={
          <Segmented
            label="Which boards"
            items={[
              { href: viewHref('all'), label: 'All boards', active: view === 'all' },
              { href: viewHref('live'), label: 'Live', active: view === 'live' },
              { href: viewHref('mine'), label: 'My boards', active: view === 'mine' },
            ]}
          />
        }
      />
      <ScopeBar fields={['team', 'creator', 'tag']} />
      <SessionList
        sessions={sessions}
        emptyMessage="No retrospectives found matching your filters."
        emptyHint="Try clearing a filter, or switch to All boards."
      />
      <Pager
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        basePath="/history"
        params={params}
      />
    </PageShell>
  )
}
