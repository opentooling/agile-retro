import { prisma } from '@/lib/prisma'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { auth } from '@/auth'

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const session = await auth()
  const params = await searchParams
  const creatorFilter = typeof params.creator === 'string' ? params.creator : undefined
  const tagFilter = typeof params.tag === 'string' ? params.tag : undefined
  const teamIdFilter = typeof params.teamId === 'string' ? params.teamId : undefined
  const statusFilter = typeof params.status === 'string' ? params.status : undefined
  const myBoardsFilter = typeof params.myBoards === 'string' ? params.myBoards === 'true' : false

  const whereClause: any = {}
  if (creatorFilter) {
    whereClause.creator = { contains: creatorFilter }
  }
  if (tagFilter) {
    whereClause.tags = { contains: tagFilter }
  }
  if (teamIdFilter) {
    whereClause.team = {
        name: {
            contains: teamIdFilter
        }
    }
  }
  if (statusFilter === 'active') {
    whereClause.status = { not: 'CLOSED' }
  }
  if (myBoardsFilter && session?.user?.name) {
    whereClause.creator = session.user.name
  }

  const retros = await prisma.retrospective.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    include: { team: true }
  })

  return (
    <div className="container mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Retrospective History</h1>
        <div className="flex gap-2">
            <Link href="/history">
                <Button variant={!myBoardsFilter ? 'default' : 'outline'}>All Boards</Button>
            </Link>
            <Link href="/history?myBoards=true">
                <Button variant={myBoardsFilter ? 'default' : 'outline'}>My Boards</Button>
            </Link>
        </div>
      </div>
      <div className="grid gap-4">
        {retros.map((retro) => (
          <Link key={retro.id} href={`/retro/${retro.id}`}>
            <Card className="hover:bg-accent transition-colors">
              <CardHeader>
                <CardTitle className="flex justify-between items-center">
                  <span>{retro.title}</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {formatDistanceToNow(retro.createdAt, { addSuffix: true })}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <div className="flex gap-4">
                        <span>Status: {retro.status}</span>
                        {retro.team && (
                            <span className="font-semibold text-primary">Team: {retro.team.name}</span>
                        )}
                    </div>
                    <span>Created by: {retro.creator}</span>
                  </div>
                  {retro.tags && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {retro.tags.split(',').map(tag => tag.trim()).filter(Boolean).map(tag => (
                        <span key={tag} className="px-2 py-1 bg-secondary text-secondary-foreground rounded-md text-xs">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {retros.length === 0 && (
           <div className="col-span-full text-center py-12 text-muted-foreground">
             No retrospectives found matching your filters.
           </div>
        )}
      </div>
    </div>
  )
}
