import * as db from '@/lib/db'
import { Button } from "@/components/ui/button"
import Link from 'next/link'
import { auth } from '@/auth'
import { authUserFromSession, canAdministerBoard } from '@/lib/authz'
import { SessionList, type SessionSummary } from '@/components/SessionList'
import { PageShell, PageHeader } from '@/components/PageHeader'
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

  return (
    <PageShell>
      <PageHeader
        title="Retrospective history"
        action={
          <div className="flex gap-2">
            <Link href="/history">
                <Button variant={!myBoardsFilter ? 'default' : 'outline'}>All Boards</Button>
            </Link>
            <Link href="/history?myBoards=true">
                <Button variant={myBoardsFilter ? 'default' : 'outline'}>My Boards</Button>
            </Link>
          </div>
        }
      />
      <SessionList
        sessions={sessions}
        emptyMessage="No retrospectives found matching your filters."
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
