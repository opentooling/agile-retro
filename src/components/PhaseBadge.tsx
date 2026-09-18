import { Archive, CheckSquare, MessagesSquare, PenLine, Vote, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A board's phase, styled once.
 *
 * Previously the same fact appeared three ways: a green/grey pill on the
 * dashboard (with no dark-mode variants), the words "Status: INPUT" on the
 * history page, and a bare enum on the board. Phases are also five states, not
 * the open/closed binary the dashboard collapsed them into.
 */
const PHASE_LABEL: Record<string, string> = {
  INPUT: 'Input',
  VOTING: 'Voting',
  REVIEW: 'Review',
  ACTIONS: 'Actions',
  CLOSED: 'Closed',
}

// One tone family per phase. The tokens carry their own dark values, so there
// is no second set of dark: classes to keep in step.
const PHASE_STYLE: Record<string, string> = {
  INPUT: 'bg-[hsl(var(--tone-improve-soft))] text-[hsl(var(--tone-improve-ink))]',
  VOTING: 'bg-[hsl(var(--tone-risk-soft))] text-[hsl(var(--tone-risk-ink))]',
  REVIEW: 'bg-[hsl(var(--tone-review-soft))] text-[hsl(var(--tone-review-ink))]',
  ACTIONS: 'bg-[hsl(var(--tone-positive-soft))] text-[hsl(var(--tone-positive-ink))]',
  CLOSED: 'bg-[hsl(var(--tone-neutral-soft))] text-[hsl(var(--tone-neutral-ink))]',
}

/** An icon per phase, so the state reads before the word does. */
const PHASE_ICON: Record<string, LucideIcon> = {
  INPUT: PenLine,
  VOTING: Vote,
  REVIEW: MessagesSquare,
  ACTIONS: CheckSquare,
  CLOSED: Archive,
}

export function PhaseBadge({ status, className }: { status: string; className?: string }) {
  const Icon = PHASE_ICON[status] ?? PHASE_ICON.CLOSED
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
        PHASE_STYLE[status] ?? PHASE_STYLE.CLOSED,
        className
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {PHASE_LABEL[status] ?? status}
    </span>
  )
}

/** The tone family a phase is drawn in — for rails and accents elsewhere. */
export const PHASE_TONE: Record<string, string> = {
  INPUT: 'improve',
  VOTING: 'risk',
  REVIEW: 'review',
  ACTIONS: 'positive',
  CLOSED: 'neutral',
}
