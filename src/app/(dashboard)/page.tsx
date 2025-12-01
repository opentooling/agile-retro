import { prisma } from '@/lib/prisma'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { CreateRetroDialog } from '@/components/CreateRetroDialog'
import { LayoutDashboard, ListTodo, Users } from 'lucide-react'

export default async function Home({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
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

  const recentRetros = await prisma.retrospective.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    take: 20
  })

  // Analytics
  const totalRetros = await prisma.retrospective.count()
  const totalItems = await prisma.item.count()
  // This is a rough estimate of active users based on unique userIds in votes/items would be better but expensive
  // For now, let's just show total retros as a placeholder or maybe something else simple
  
  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-bold mb-2">Dashboard</h1>
          <p className="text-muted-foreground">Welcome back! Here's what's happening.</p>
        </div>
        <CreateRetroDialog />
      </div>

      {/* Analytics Widgets */}
      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Retrospectives</CardTitle>
            <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalRetros}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Items</CardTitle>
            <ListTodo className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalItems}</div>
          </CardContent>
        </Card>
         <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Sessions</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {recentRetros.filter((r: { status: string }) => r.status !== 'CLOSED').length}
            </div>
            <p className="text-xs text-muted-foreground">Currently open</p>
          </CardContent>
        </Card>
      </div>

      <h2 className="text-2xl font-bold mb-4">Recent Sessions</h2>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {recentRetros.map((retro: { id: string; title: string; status: string; createdAt: Date; tags: string | null; creator: string }) => (
          <Link key={retro.id} href={`/retro/${retro.id}`}>
            <Card className="hover:bg-accent transition-colors h-full flex flex-col">
              <CardHeader>
                <CardTitle className="flex justify-between items-start gap-2">
                  <span className="truncate">{retro.title}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1">
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center text-sm text-muted-foreground">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      retro.status === 'CLOSED' ? 'bg-gray-200 text-gray-800' : 'bg-green-100 text-green-800'
                    }`}>
                      {retro.status}
                    </span>
                    <span>{formatDistanceToNow(retro.createdAt, { addSuffix: true })}</span>
                  </div>
                  {retro.tags && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {retro.tags.split(',').map((tag: string, i: number) => (
                        <span key={i} className="text-xs bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">
                          {tag.trim()}
                        </span>
                      ))}
                    </div>
                  )}
                   <div className="text-xs text-muted-foreground mt-2">
                      Created by: {retro.creator}
                   </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {recentRetros.length === 0 && (
           <div className="col-span-full text-center py-12 text-muted-foreground">
             No retrospectives found matching your filters.
           </div>
        )}
      </div>
    </div>
  )
}
