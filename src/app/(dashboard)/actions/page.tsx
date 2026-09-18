import * as db from '@/lib/db'
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckCircle, Circle, User as UserIcon, Calendar, ListTodo } from 'lucide-react'
import { auth } from '@/auth'
import { JiraActionButton } from "@/components/JiraActionButton"
import { reconcileActions } from '@/lib/jira-sync'
import { authUserFromSession, boardScopeFor } from '@/lib/authz'
import { setActionCompleted } from '@/app/actions'
import { TeamMark } from '@/components/TeamMark'

import Link from 'next/link'
import { PageShell } from '@/components/PageHeader'
import { PageHero } from '@/components/PageHero'
import { Pager, pageFromParams } from '@/components/Pager'

export default async function ActionsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const session = await auth()
  const params = await searchParams
  const statusFilter = typeof params.status === 'string' ? params.status : 'open'
  const teamIdFilter = typeof params.teamId === 'string' ? params.teamId : undefined
  const creatorFilter = typeof params.creator === 'string' ? params.creator : undefined
  const assigneeFilter = typeof params.assignee === 'string' ? params.assignee : undefined
  const retroIdFilter = typeof params.retroId === 'string' ? params.retroId : undefined

  // Only actions from boards this viewer could open. Filtered in the query, so
  // paging and the total stay right. Until this, every signed-in user saw every
  // team's actions here.
  const scope = boardScopeFor(authUserFromSession(session), await db.listTeams())
  const filter: db.ActionFilter = { scope }

  if (statusFilter === 'open') {
    filter.completed = false
  } else if (statusFilter === 'closed') {
    filter.completed = true
  }

  if (teamIdFilter) filter.teamNameContains = teamIdFilter
  if (creatorFilter) filter.creatorContains = creatorFilter
  if (assigneeFilter) filter.assigneeContains = assigneeFilter
  if (retroIdFilter) filter.retrospectiveId = retroIdFilter

  const PAGE_SIZE = 25
  const total = await db.countActionItems(filter)
  const page = pageFromParams(params.page, total, PAGE_SIZE)
  const window = { ...filter, take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE }

  // Poll-on-open: pull the latest done state from linked Jira issues, but only
  // for the actions on this page. Reconciling everything ever created meant
  // outbound Jira calls proportional to the whole history on every render.
  await reconcileActions(await db.listActionItems(window))

  // Re-read: the reconcile above may have flipped completed flags.
  const actions = await db.listActionItems(window)

  return (
    <PageShell width="wide">
      <PageHero
        icon={ListTodo}
        title="Action items"
        subtitle="What the team agreed to do — and whether it happened."
        action={
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
        }
      />

      {assigneeFilter && (
        <div className="mb-4 text-sm text-muted-foreground">
          Filtered by assignee: <span className="font-semibold text-foreground">{assigneeFilter}</span>{' '}
          <Link href="/actions" className="text-primary hover:underline">clear</Link>
        </div>
      )}

      {/* Columns follow the list's own width (a container query), not the
          window's — an open sidebar takes 256px the viewport can't see. */}
      <div className="@container">
      <div className="grid gap-2 @min-[88rem]:grid-cols-2">
        {actions.map((action) => {
            const team = action.retrospective.team
            const isOwner = session?.user?.name === action.retrospective.creator
            const jiraConfigured = Boolean(
              team?.jiraBaseUrl && team?.jiraProjectKey && team?.jiraEmail && team?.jiraApiToken
            )

            return (
                <Card key={action.id} className="gap-0 border-l-4 border-l-primary py-0">
                    <CardContent className="p-3 flex items-center justify-between gap-4">
                        <div className="flex flex-col gap-1">
                            <span className="whitespace-pre-wrap font-medium">{action.content}</span>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                <Link href={`/actions?retroId=${action.retrospectiveId}`} className="hover:underline hover:text-primary">
                                    <span>Retro: {action.retrospective.title}</span>
                                </Link>
                                {team && (
                                    <Link href={`/actions?teamId=${encodeURIComponent(team.name)}`} className="inline-flex items-center gap-1.5 hover:underline hover:text-primary">
                                        <TeamMark team={team} size={16} />
                                        <span className="font-semibold text-primary">{team.name}</span>
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
                                <form action={setActionCompleted.bind(null, action.id, !action.completed)}>
                                    <Button size="sm" variant="outline" className={action.completed
                                        ? "gap-2 hover:border-[hsl(var(--tone-risk)/0.5)] hover:bg-[hsl(var(--tone-risk-soft))] hover:text-[hsl(var(--tone-risk-ink))]"
                                        : "gap-2 hover:border-[hsl(var(--tone-positive)/0.5)] hover:bg-[hsl(var(--tone-positive-soft))] hover:text-[hsl(var(--tone-positive-ink))]"}>
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
      <Pager
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        basePath="/actions"
        params={params}
      />
    </PageShell>
  )
}
