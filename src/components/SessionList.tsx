'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { Trash2, Clock, AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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
import { PhaseBadge } from '@/components/PhaseBadge'
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

/**
 * Dense list of retrospective sessions.
 *
 * One row per board rather than a card grid: a retro list is scanned ("which
 * one was that?") far more often than it is browsed, and the previous cards
 * spent most of their height on padding. Everything on a row is one line at
 * desktop widths; the secondary metadata wraps underneath on narrow screens.
 */
export function SessionList({
  sessions,
  emptyMessage = 'No retrospectives found.',
}: {
  sessions: SessionSummary[]
  emptyMessage?: string
}) {
  const [pendingDelete, setPendingDelete] = useState<SessionSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDeleting, startDelete] = useTransition()
  const router = useRouter()

  const confirmDelete = () => {
    if (!pendingDelete) return
    setError(null)
    startDelete(async () => {
      try {
        await deleteRetrospective(pendingDelete.id)
        setPendingDelete(null)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to delete the board')
      }
    })
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    )
  }

  return (
    <>
      <ul className="divide-y rounded-lg border bg-card">
        {sessions.map((session) => {
          const retention = session.expiresAt ? retentionLabel(session.expiresAt) : null
          return (
            <li key={session.id} className="group relative">
              <Link
                href={`/retro/${session.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 transition-colors hover:bg-accent/60 sm:flex-nowrap"
              >
                <PhaseBadge status={session.status} className="w-16 shrink-0" />

                <span className="min-w-0 flex-1 truncate text-sm font-medium">{session.title}</span>

                {session.team && (
                  <span className="hidden shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground sm:flex">
                    <TeamMark team={session.team} size={16} />
                    <span className="max-w-[10rem] truncate">{session.team.name}</span>
                  </span>
                )}

                {session.tags.length > 0 && (
                  <span className="hidden shrink-0 gap-1 lg:flex">
                    {session.tags.slice(0, 2).map((tag) => (
                      <Badge key={tag} variant="secondary" className="font-normal">{tag}</Badge>
                    ))}
                    {session.tags.length > 2 && (
                      <span className="text-[11px] text-muted-foreground">+{session.tags.length - 2}</span>
                    )}
                  </span>
                )}

                {retention && (
                  <span
                    className={cn(
                      'hidden shrink-0 items-center gap-1 text-[11px] sm:flex',
                      retention.urgent ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
                    )}
                    title={`Automatically deleted on ${new Date(session.expiresAt!).toLocaleDateString()}`}
                  >
                    <Clock className="h-3 w-3" />
                    {retention.text}
                  </span>
                )}

                <span className="hidden w-32 shrink-0 truncate text-right text-xs text-muted-foreground md:block">
                  {session.creator}
                </span>
                <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(session.createdAt), { addSuffix: true })}
                </span>
                {/* Reserve the action column so rows don't shift on hover. */}
                <span className="w-7 shrink-0" aria-hidden />
              </Link>

              {session.canDelete && (
                <button
                  type="button"
                  aria-label={`Delete ${session.title}`}
                  onClick={() => {
                    setError(null)
                    setPendingDelete(session)
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          )
        })}
      </ul>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete this board?
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 pt-1">
                <p>
                  <span className="font-medium text-foreground">{pendingDelete?.title}</span> and
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
            <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting…' : 'Delete board'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
