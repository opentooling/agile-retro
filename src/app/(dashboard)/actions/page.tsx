import { prisma } from '@/lib/prisma'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckCircle, Circle, Trash2 } from 'lucide-react'
import { auth } from '@/auth'
import { revalidatePath } from 'next/cache'

import Link from 'next/link'

export default async function ActionsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const session = await auth()
  const params = await searchParams
  const statusFilter = typeof params.status === 'string' ? params.status : 'open'
  const teamIdFilter = typeof params.teamId === 'string' ? params.teamId : undefined
  const creatorFilter = typeof params.creator === 'string' ? params.creator : undefined
  const retroIdFilter = typeof params.retroId === 'string' ? params.retroId : undefined

  const whereClause: any = {}
  
  if (statusFilter === 'open') {
    whereClause.completed = false
  } else if (statusFilter === 'closed') {
    whereClause.completed = true
  }

  if (teamIdFilter || creatorFilter) {
    whereClause.retrospective = {}
    
    if (teamIdFilter) {
        whereClause.retrospective.team = {
            name: {
                contains: teamIdFilter
            }
        }
    }

    if (creatorFilter) {
        whereClause.retrospective.creator = {
            contains: creatorFilter
        }
    }
  }

  if (retroIdFilter) {
      whereClause.retrospectiveId = retroIdFilter
  }

  const actions = await prisma.actionItem.findMany({
    where: whereClause,
    include: {
        retrospective: {
            include: {
                team: true
            }
        }
    },
    orderBy: {
        retrospective: {
            createdAt: 'desc'
        }
    }
  })

  async function toggleAction(actionId: string, completed: boolean) {
    'use server'
    await prisma.actionItem.update({
        where: { id: actionId },
        data: { completed }
    })
    revalidatePath('/actions')
  }

  return (
    <div className="container mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Action Items</h1>
        <div className="flex gap-2">
            <Link href="/actions?status=open">
                <Button variant={statusFilter === 'open' ? 'default' : 'outline'}>Open</Button>
            </Link>
            <Link href="/actions?status=closed">
                <Button variant={statusFilter === 'closed' ? 'default' : 'outline'}>Closed</Button>
            </Link>
            <Link href="/actions?status=all">
                <Button variant={statusFilter === 'all' ? 'default' : 'outline'}>All</Button>
            </Link>
        </div>
      </div>
      
      <div className="grid gap-4">
        {actions.map((action) => {
            const isOwner = session?.user?.name === action.retrospective.creator
            
            return (
                <Card key={action.id} className="border-l-4 border-l-blue-500">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div className="flex flex-col gap-1">
                            <span className="font-medium text-lg">{action.content}</span>
                            <div className="flex gap-4 text-sm text-muted-foreground">
                                <Link href={`/actions?retroId=${action.retrospectiveId}`} className="hover:underline hover:text-primary">
                                    <span>Retro: {action.retrospective.title}</span>
                                </Link>
                                {action.retrospective.team && (
                                    <Link href={`/actions?teamId=${encodeURIComponent(action.retrospective.team.name)}`} className="hover:underline hover:text-primary">
                                        <span className="font-semibold text-primary">Team: {action.retrospective.team.name}</span>
                                    </Link>
                                )}
                                <Link href={`/actions?creator=${encodeURIComponent(action.retrospective.creator)}`} className="hover:underline hover:text-primary">
                                    <span>Owner: {action.retrospective.creator}</span>
                                </Link>
                            </div>
                        </div>
                        {isOwner && (
                            <form action={toggleAction.bind(null, action.id, !action.completed)}>
                                <Button size="sm" variant="outline" className={action.completed ? "gap-2 hover:bg-yellow-50 hover:text-yellow-600 hover:border-yellow-200" : "gap-2 hover:bg-green-50 hover:text-green-600 hover:border-green-200"}>
                                    {action.completed ? <Circle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                                    {action.completed ? "Reopen" : "Mark Done"}
                                </Button>
                            </form>
                        )}
                    </CardContent>
                </Card>
            )
        })}
        {actions.length === 0 && (
            <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
                No open action items found.
            </div>
        )}
      </div>
    </div>
  )
}
