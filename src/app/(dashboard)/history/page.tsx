import { prisma } from '@/lib/prisma'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams
  const creatorFilter = typeof params.creator === 'string' ? params.creator : undefined
  const tagFilter = typeof params.tag === 'string' ? params.tag : undefined

  const whereClause: any = {}
  if (creatorFilter) {
    whereClause.creator = { contains: creatorFilter }
  }
  if (tagFilter) {
    whereClause.tags = { contains: tagFilter }
  }

  const retros = await prisma.retrospective.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' }
  })

  return (
    <div className="container mx-auto p-8">
      <div className="flex items-center gap-4 mb-8">
        <h1 className="text-3xl font-bold">Retrospective History</h1>
      </div>
      <div className="grid gap-4">
        {retros.map((retro: { id: string; title: string; status: string; createdAt: Date; creator: string; tags: string }) => (
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
                    <span>Status: {retro.status}</span>
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
