import * as db from '@/lib/db'
import { Check, Calendar, CheckSquare, X } from 'lucide-react'
import { auth } from '@/auth'
import { JiraActionButton } from "@/components/JiraActionButton"
import { reconcileActions } from '@/lib/jira-sync'
import { authUserFromSession, boardScopeFor } from '@/lib/authz'
import { setActionCompleted } from '@/app/actions'
import { TeamMark } from '@/components/TeamMark'
import { Identicon } from '@/components/visual/Identicon'
import { EmptyState } from '@/components/visual/EmptyState'
import { EmptyChecklist } from '@/components/visual/Illustration'

import Link from 'next/link'
import { PageShell } from '@/components/PageHeader'
import { Masthead, Segmented } from '@/components/Masthead'
import { ScopeBar } from '@/components/ScopeBar'
import { Pager, pageFromParams } from '@/components/Pager'
import { cn } from '@/lib/utils'

const DAY = 86_400_000
const dueFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

type Bucket = { key: string; label: string; tone: string }
const BUCKETS: Bucket[] = [
  { key: 'overdue', label: 'Overdue', tone: 'negative' },
  { key: 'week', label: 'Due in the next 7 days', tone: 'risk' },
  { key: 'later', label: 'Due later', tone: 'improve' },
  { key: 'undated', label: 'No due date', tone: 'neutral' },
  { key: 'done', label: 'Done', tone: 'positive' },
]

function bucketOf(action: { completed: boolean; dueDate: Date | null }, now: number): string {
  if (action.completed) return 'done'
  if (!action.dueDate) return 'undated'
  const due = new Date(action.dueDate).getTime()
  if (due < now) return 'overdue'
  if (due < now + 7 * DAY) return 'week'
  return 'later'
}

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

  // Grouped by what needs doing first. Grouping is presentation only: the page
  // is still the same 25 rows in the same order, split under headings.
  const now = new Date().getTime()
  const groups = BUCKETS
    .map((bucket) => ({ ...bucket, rows: actions.filter((a) => bucketOf(a, now) === bucket.key) }))
    .filter((g) => g.rows.length > 0)

  // Links that change one key and keep the rest of the view.
  const hrefWith = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams()
    for (const key of ['status', 'teamId', 'creator', 'assignee', 'retroId']) {
      const value = params[key]
      if (typeof value === 'string' && value) next.set(key, value)
    }
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    const qs = next.toString()
    return qs ? `/actions?${qs}` : '/actions'
  }

  const statusLabel = statusFilter === 'closed' ? 'done' : statusFilter === 'all' ? '' : 'open'

  return (
    <PageShell width="wide">
      <Masthead
        eyebrow="Follow-through"
        icon={CheckSquare}
        title="Actions"
        lede={`What the team agreed to do — and whether it happened. ${total} ${statusLabel ? `${statusLabel} ` : ''}${total === 1 ? 'action' : 'actions'}.`}
        actions={
          <Segmented
            label="Which actions"
            items={[
              { href: hrefWith({ status: 'open' }), label: 'Open', active: statusFilter === 'open' },
              { href: hrefWith({ status: 'closed' }), label: 'Done', active: statusFilter === 'closed' },
              { href: hrefWith({ status: 'all' }), label: 'All', active: statusFilter === 'all' },
            ]}
          />
        }
      />

      <ScopeBar fields={['team', 'creator']} className="mb-4" />

      {(assigneeFilter || retroIdFilter) && (
        <div className="mb-6 flex flex-wrap gap-2 text-sm">
          {assigneeFilter && (
            <Link
              href={hrefWith({ assignee: null })}
              className="inline-flex items-center gap-1.5 rounded-full border bg-card py-1 pl-1.5 pr-2.5 hover:bg-accent"
              aria-label={`Clear assignee filter: ${assigneeFilter}`}
            >
              <Identicon name={assigneeFilter} size={18} />
              Assigned to <span className="font-semibold">{assigneeFilter}</span>
              <X className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            </Link>
          )}
          {retroIdFilter && (
            <Link
              href={hrefWith({ retroId: null })}
              className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 hover:bg-accent"
              aria-label="Clear retrospective filter"
            >
              From one retrospective
              <X className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            </Link>
          )}
        </div>
      )}

      {actions.length === 0 ? (
        <EmptyState
          illustration={<EmptyChecklist className="h-20 w-32" />}
          title="No action items found."
          hint={statusFilter === 'open' ? 'Nothing open here — or try clearing a filter.' : 'Try another view or clear a filter.'}
        />
      ) : (
        <div className="@container">
          <div className="grid gap-x-10 gap-y-8 @min-[88rem]:grid-cols-2">
            {groups.map((group) => (
              <section key={group.key} aria-labelledby={`bucket-${group.key}`} className="min-w-0">
                <h2 id={`bucket-${group.key}`} className="eyebrow mb-1 flex items-center gap-2">
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: `hsl(var(--tone-${group.tone}))` }} />
                  {group.label}
                  <span className="font-medium tabular-nums normal-case tracking-normal">{group.rows.length}</span>
                  <span className="h-px flex-1 bg-border" aria-hidden />
                </h2>
                <ul>
                  {group.rows.map((action) => {
                    const team = action.retrospective.team
                    const isOwner = session?.user?.name === action.retrospective.creator
                    const jiraConfigured = Boolean(
                      team?.jiraBaseUrl && team?.jiraProjectKey && team?.jiraEmail && team?.jiraApiToken
                    )
                    const overdue = group.key === 'overdue'

                    return (
                      <li key={action.id} className="flex items-start gap-3 border-b border-border/70 py-3 last:border-b-0">
                        {isOwner ? (
                          <form action={setActionCompleted.bind(null, action.id, !action.completed)} className="shrink-0">
                            <button
                              type="submit"
                              title={action.completed ? 'Reopen' : 'Mark done'}
                              className={cn(
                                'mt-0.5 grid h-6 w-6 place-items-center rounded-full border-2 transition-colors',
                                action.completed
                                  ? 'border-[hsl(var(--tone-positive-ink))] bg-[hsl(var(--tone-positive-ink))] text-card hover:opacity-80'
                                  : 'border-[hsl(var(--tone-positive-ink))] text-transparent hover:bg-[hsl(var(--tone-positive-soft))] hover:text-[hsl(var(--tone-positive-ink))]',
                              )}
                            >
                              <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                              <span className="sr-only">{action.completed ? 'Reopen' : 'Mark done'}: {action.content}</span>
                            </button>
                          </form>
                        ) : (
                          <span
                            className={cn(
                              'mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full',
                              action.completed ? 'bg-[hsl(var(--tone-positive-ink))] text-card' : 'border-2 border-dashed border-muted-foreground',
                            )}
                            title={action.completed ? 'Done' : 'Open — only the facilitator can tick it off here'}
                          >
                            {action.completed && <Check className="h-3 w-3" strokeWidth={3} aria-hidden />}
                            <span className="sr-only">{action.completed ? 'Done' : 'Open'}</span>
                          </span>
                        )}

                        <div className="min-w-0 flex-1">
                          <p className={cn(
                            'whitespace-pre-wrap text-[15px] font-medium leading-snug',
                            action.completed && 'text-muted-foreground line-through decoration-muted-foreground/50',
                          )}>
                            {action.content}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            {action.assignee && (
                              <Link href={`/actions?assignee=${encodeURIComponent(action.assignee)}`} className="flex items-center gap-1.5 font-medium text-foreground hover:underline">
                                <Identicon name={action.assignee} size={18} />
                                <span className="sr-only">Assignee: </span>{action.assignee}
                              </Link>
                            )}
                            {action.dueDate && (
                              <span className={cn(
                                'flex items-center gap-1 rounded-full px-2 py-0.5',
                                overdue
                                  ? 'bg-[hsl(var(--tone-negative-soft))] font-semibold text-[hsl(var(--tone-negative-ink))]'
                                  : 'bg-muted',
                              )}>
                                <Calendar className="h-3 w-3" aria-hidden /> {overdue ? 'Was due' : 'Due'} {dueFmt.format(new Date(action.dueDate))}
                              </span>
                            )}
                            <Link href={`/actions?retroId=${action.retrospectiveId}`} className="max-w-[18rem] truncate hover:text-foreground hover:underline">
                              <span className="sr-only">Retro: </span>{action.retrospective.title}
                            </Link>
                            {team && (
                              <Link href={`/actions?teamId=${encodeURIComponent(team.name)}`} className="inline-flex items-center gap-1.5 hover:text-foreground hover:underline">
                                <TeamMark team={team} size={14} />
                                <span>{team.name}</span>
                              </Link>
                            )}
                            <Link href={`/actions?creator=${encodeURIComponent(action.retrospective.creator)}`} className="hover:text-foreground hover:underline">
                              Facilitator: {action.retrospective.creator}
                            </Link>
                          </div>
                        </div>

                        {(jiraConfigured || action.externalUrl) && (
                          <div className="shrink-0 pt-0.5">
                            <JiraActionButton
                              actionId={action.id}
                              externalUrl={action.externalUrl}
                              externalKey={action.externalKey}
                            />
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
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
