import * as db from '@/lib/db'
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckCircle, Circle, User as UserIcon, Calendar } from 'lucide-react'
import { auth } from '@/auth'
import { revalidatePath } from 'next/cache'
import { JiraActionButton } from "@/components/JiraActionButton"
import { reconcileAllLinkedActions, pushActionDoneState } from '@/lib/jira-sync'

import Link from 'next/link'

export default async function ActionsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const session = await auth()
  const params = await searchParams
  const statusFilter = typeof params.status === 'string' ? params.status : 'open'
  const teamIdFilter = typeof params.teamId === 'string' ? params.teamId : undefined
  const creatorFilter = typeof params.creator === 'string' ? params.creator : undefined
  const assigneeFilter = typeof params.assignee === 'string' ? params.assignee : undefined
  const retroIdFilter = typeof params.retroId === 'string' ? params.retroId : undefined

  const filter: db.ActionFilter = {}

  if (statusFilter === 'open') {
    filter.completed = false
  } else if (statusFilter === 'closed') {
    filter.completed = true
  }

  if (teamIdFilter) filter.teamNameContains = teamIdFilter
  if (creatorFilter) filter.creatorContains = creatorFilter
  if (assigneeFilter) filter.assigneeContains = assigneeFilter
  if (retroIdFilter) filter.retrospectiveId = retroIdFilter

  // Poll-on-open: pull the latest done state from linked Jira issues before
  // listing, so the page reflects changes made in Jira.
  await reconcileAllLinkedActions()

  const actions = await db.listActionItems(filter)

  async function toggleAction(actionId: string, completed: boolean) {
    'use server'
    await db.updateActionCompleted(actionId, completed)
    // Mirror the change to the linked Jira issue (best-effort).
    await pushActionDoneState(actionId, completed)
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

      {assigneeFilter && (
        <div className="mb-4 text-sm text-muted-foreground">
          Filtered by assignee: <span className="font-semibold text-foreground">{assigneeFilter}</span>{' '}
          <Link href="/actions" className="text-blue-600 hover:underline">clear</Link>
        </div>
      )}

      <div className="grid gap-4">
        {actions.map((action) => {
            const team = action.retrospective.team
            const isOwner = session?.user?.name === action.retrospective.creator
            const jiraConfigured = Boolean(
              team?.jiraBaseUrl && team?.jiraProjectKey && team?.jiraEmail && team?.jiraApiToken
            )

            return (
                <Card key={action.id} className="border-l-4 border-l-blue-500">
                    <CardContent className="p-4 flex items-center justify-between gap-4">
                        <div className="flex flex-col gap-1">
                            <span className="font-medium text-lg">{action.content}</span>
                            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                                <Link href={`/actions?retroId=${action.retrospectiveId}`} className="hover:underline hover:text-primary">
                                    <span>Retro: {action.retrospective.title}</span>
                                </Link>
                                {team && (
                                    <Link href={`/actions?teamId=${encodeURIComponent(team.name)}`} className="hover:underline hover:text-primary">
                                        <span className="font-semibold text-primary">Team: {team.name}</span>
                                    </Link>
                                )}
                                <Link href={`/actions?creator=${encodeURIComponent(action.retrospective.creator)}`} className="hover:underline hover:text-primary">
                                    <span>Owner: {action.retrospective.creator}</span>
                                </Link>
                                {action.assignee && (
                                    <Link href={`/actions?assignee=${encodeURIComponent(action.assignee)}`} className="flex items-center gap-1 hover:underline hover:text-primary">
                                        <UserIcon className="w-3.5 h-3.5" /> Assignee: {action.assignee}
                                    </Link>
                                )}
                                {action.dueDate && (
                                    <span className="flex items-center gap-1">
                                        <Calendar className="w-3.5 h-3.5" /> Due {new Date(action.dueDate).toLocaleDateString()}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                            {(jiraConfigured || action.externalUrl) && (
                                <JiraActionButton
                                    actionId={action.id}
                                    externalUrl={action.externalUrl}
                                    externalKey={action.externalKey}
                                />
                            )}
                            {isOwner && (
                                <form action={toggleAction.bind(null, action.id, !action.completed)}>
                                    <Button size="sm" variant="outline" className={action.completed ? "gap-2 hover:bg-yellow-50 hover:text-yellow-600 hover:border-yellow-200" : "gap-2 hover:bg-green-50 hover:text-green-600 hover:border-green-200"}>
                                        {action.completed ? <Circle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                                        {action.completed ? "Reopen" : "Mark Done"}
                                    </Button>
                                </form>
                            )}
                        </div>
                    </CardContent>
                </Card>
            )
        })}
        {actions.length === 0 && (
            <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
                No action items found.
            </div>
        )}
      </div>
    </div>
  )
}
