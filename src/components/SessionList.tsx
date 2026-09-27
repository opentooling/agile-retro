'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { Trash2, Clock, AlertTriangle, ArrowRight, Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { TeamMark } from '@/components/TeamMark'
import { PhaseBadge, PHASE_TONE } from '@/components/PhaseBadge'
import { PhaseTrack } from '@/components/PhaseTrack'
import { Identicon } from '@/components/visual/Identicon'
import { EmptyState } from '@/components/visual/EmptyState'
import { EmptyBoard } from '@/components/visual/Illustration'
import { deleteRetrospective } from '@/app/actions'
import { cn } from '@/lib/utils'

export type SessionSummary = {
  id: string
  title: string
  status: string
  creator: string
  /** ISO strings — these cross the server/client boundary. */
  createdAt: string
  expiresAt: string | null
  team: { id: string; name: string; imageData?: string | null } | null
  tags: string[]
  /** Whether this viewer may delete the board (facilitator / team-admin / admin). */
  canDelete: boolean
}

/** Short, glanceable retention label — "14d left", "expires today". */
function retentionLabel(expiresAt: string): { text: string; urgent: boolean } {
  const ms = new Date(expiresAt).getTime() - Date.now()
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000))
  if (days <= 0) return { text: 'expires today', urgent: true }
  if (days === 1) return { text: '1d left', urgent: true }
  if (days <= 7) return { text: `${days}d left`, urgent: true }
  return { text: `${days}d left`, urgent: false }
}

// Dates are grouped and printed in UTC so the server render and the browser
// agree on which month a board belongs to — a board list keyed to the viewer's
// zone would regroup itself during hydration.
const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'UTC' })
const weekdayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' })
const fullFmt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: 'UTC' })

/** Deleting a board, confirmed — shared by the ledger and the live cards. */
function useDeleteBoard() {
  const [pending, setPending] = useState<SessionSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDeleting, startDelete] = useTransition()
  const router = useRouter()

  const confirm = () => {
    if (!pending) return
    setError(null)
    startDelete(async () => {
      try {
        await deleteRetrospective(pending.id)
        setPending(null)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to delete the board')
      }
    })
  }

  const request = (session: SessionSummary) => {
    setError(null)
    setPending(session)
  }

  const dialog = (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Delete this board?
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 pt-1">
              <p>
                <span className="font-medium text-foreground">{pending?.title}</span> and
                everything on it — every card, vote, reaction and action item — will be permanently
                deleted.
              </p>
              <p>This cannot be undone.</p>
            </div>
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setPending(null)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={isDeleting}>
            {isDeleting ? 'Deleting…' : 'Delete board'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { request, dialog }
}

function DeleteButton({ session, onRequest, className }: { session: SessionSummary; onRequest: (s: SessionSummary) => void; className?: string }) {
  if (!session.canDelete) return null
  return (
    <button
      type="button"
      aria-label={`Delete ${session.title}`}
      onClick={() => onRequest(session)}
      className={cn(
        'rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus:opacity-100 group-hover:opacity-100',
        className,
      )}
    >
      <Trash2 className="h-4 w-4" />
    </button>
  )
}

/**
 * The session ledger: every board, grouped by the month it ran in.
 *
 * A retro list is searched by time ("the one from March") far more than it is
 * browsed, so the date leads each row as a calendar numeral and the months
 * divide the list. Everything else on a row appears by priority as the row
 * itself widens (container queries, never the window) — team, then retention
 * (actionable: the board will be deleted), then facilitator, then tags.
 */
export function SessionList({
  sessions,
  emptyMessage = 'No retrospectives found.',
  emptyHint = 'Sessions you create or join appear here.',
}: {
  sessions: SessionSummary[]
  emptyMessage?: string
  emptyHint?: string
}) {
  const { request, dialog } = useDeleteBoard()

  if (sessions.length === 0) {
    return (
      <EmptyState
        illustration={<EmptyBoard className="h-24 w-40" />}
        title={emptyMessage}
        hint={emptyHint}
      />
    )
  }

  const months: { label: string; rows: SessionSummary[] }[] = []
  for (const s of sessions) {
    const label = monthFmt.format(new Date(s.createdAt))
    const last = months[months.length - 1]
    if (last && last.label === label) last.rows.push(s)
    else months.push({ label, rows: [s] })
  }

  return (
    <>
      {/* Newspaper columns on a very wide list: sorted, so it has to read
          down one column and then continue down the next. */}
      <div className="@container">
        <div className="@min-[88rem]:columns-2 @min-[88rem]:gap-10">
          {months.map((month) => (
            <section key={month.label} className="mb-6 break-inside-avoid-column">
              <h3 className="eyebrow mb-1 flex items-center gap-3 break-after-avoid">
                {month.label}
                <span className="h-px flex-1 bg-border" aria-hidden />
                <span className="font-medium normal-case tracking-normal tabular-nums">{month.rows.length}</span>
              </h3>
              <ul>
                {month.rows.map((session) => {
                  const retention = session.expiresAt ? retentionLabel(session.expiresAt) : null
                  const created = new Date(session.createdAt)
                  return (
                    <li key={session.id} className="@container group relative break-inside-avoid border-b border-border/70 last:border-b-0">
                      <Link
                        href={`/retro/${session.id}`}
                        className="flex items-center gap-x-4 rounded-lg py-2.5 pl-1 pr-10 transition-colors hover:bg-accent/60"
                      >
                        <span className="flex w-10 shrink-0 flex-col items-center leading-none" title={fullFmt.format(created)}>
                          <span className="text-lg font-semibold tabular-nums">{dayFmt.format(created)}</span>
                          <span className="mt-0.5 text-[11px] text-muted-foreground">{weekdayFmt.format(created)}</span>
                        </span>

                        <span
                          aria-hidden
                          className="h-8 w-1 shrink-0 rounded-full"
                          style={{ background: `hsl(var(--tone-${PHASE_TONE[session.status] ?? 'neutral'}))` }}
                        />

                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{session.title}</span>
                          <span className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                            <PhaseBadge status={session.status} className="shrink-0" />
                            {session.team ? (
                              <span className="flex min-w-0 items-center gap-1.5 @2xl:hidden">
                                <TeamMark team={session.team} size={14} />
                                <span className="truncate">{session.team.name}</span>
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 @2xl:hidden"><Globe className="h-3 w-3" aria-hidden /> Open board</span>
                            )}
                          </span>
                        </span>

                        <span className="hidden w-44 shrink-0 items-center gap-2 text-xs font-medium text-muted-foreground @2xl:flex">
                          {session.team ? (
                            <>
                              <TeamMark team={session.team} size={20} />
                              <span className="truncate">{session.team.name}</span>
                            </>
                          ) : (
                            <>
                              <span className="grid h-5 w-5 place-items-center rounded-[30%] bg-muted"><Globe className="h-3 w-3" aria-hidden /></span>
                              <span className="truncate">Open board</span>
                            </>
                          )}
                        </span>

                        {session.tags.length > 0 && (
                          <span className="hidden w-40 shrink-0 gap-1 overflow-hidden @6xl:flex">
                            {session.tags.slice(0, 2).map((tag) => (
                              <span key={tag} className="truncate rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                                #{tag}
                              </span>
                            ))}
                            {session.tags.length > 2 && (
                              <span className="text-[11px] text-muted-foreground">+{session.tags.length - 2}</span>
                            )}
                          </span>
                        )}

                        {retention && (
                          <span
                            className={cn(
                              'hidden w-24 shrink-0 items-center gap-1 text-[11px] @3xl:flex',
                              retention.urgent ? 'font-semibold text-[hsl(var(--tone-risk-ink))]' : 'text-muted-foreground'
                            )}
                            title={`Automatically deleted on ${new Date(session.expiresAt!).toLocaleDateString()}`}
                            suppressHydrationWarning
                          >
                            <Clock className="h-3 w-3" />
                            {retention.text}
                          </span>
                        )}

                        <span className="hidden w-28 shrink-0 items-center justify-end gap-1.5 text-xs text-muted-foreground @4xl:flex">
                          <Identicon name={session.creator} size={20} />
                          <span className="truncate">{session.creator}</span>
                        </span>
                      </Link>

                      <DeleteButton
                        session={session}
                        onRequest={request}
                        className="absolute right-1 top-1/2 -translate-y-1/2"
                      />
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
      {dialog}
    </>
  )
}

/**
 * Boards that are running now, as cards you can walk into.
 *
 * On the dashboard these lead: in the minutes before a retro, "which board is
 * live and how far along is it" is the only question. The phase track on each
 * card answers the second half without a word.
 */
export function LiveBoards({ sessions }: { sessions: SessionSummary[] }) {
  const { request, dialog } = useDeleteBoard()
  return (
    <>
      <ul className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3 @min-[96rem]:grid-cols-4">
        {sessions.map((session) => {
          const tone = PHASE_TONE[session.status] ?? 'neutral'
          return (
            <li
              key={session.id}
              className="group relative overflow-hidden rounded-xl border bg-card shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-lift)]"
            >
              <span aria-hidden className="block h-1" style={{ background: `hsl(var(--tone-${tone}))` }} />
              <Link href={`/retro/${session.id}`} className="block p-4 pt-3.5">
                <span className="flex items-center justify-between gap-3 pr-7">
                  <PhaseBadge status={session.status} />
                  <span className="truncate text-xs text-muted-foreground" suppressHydrationWarning>
                    {formatDistanceToNow(new Date(session.createdAt), { addSuffix: true })}
                  </span>
                </span>
                <span className="mt-3 line-clamp-2 block text-base font-semibold leading-snug tracking-tight">{session.title}</span>
                <span className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                  {session.team ? (
                    <>
                      <TeamMark team={session.team} size={16} />
                      <span className="truncate">{session.team.name}</span>
                    </>
                  ) : (
                    <>
                      <Globe className="h-3.5 w-3.5" aria-hidden />
                      <span>Open board</span>
                    </>
                  )}
                </span>
                <PhaseTrack status={session.status} size="sm" className="mt-4" />
                <span className="mt-3 flex items-center justify-between gap-3 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                    <Identicon name={session.creator} size={18} />
                    <span className="truncate">{session.creator}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 font-semibold text-primary">
                    Join <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </span>
              </Link>
              <DeleteButton session={session} onRequest={request} className="absolute right-2 top-3" />
            </li>
          )
        })}
      </ul>
      {dialog}
    </>
  )
}
