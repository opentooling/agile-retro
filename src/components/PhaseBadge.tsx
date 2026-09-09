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

const PHASE_STYLE: Record<string, string> = {
  INPUT: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  VOTING: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  REVIEW: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  ACTIONS: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  CLOSED: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
}

export function PhaseBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2 py-0.5 text-center text-xs font-semibold',
        PHASE_STYLE[status] ?? PHASE_STYLE.CLOSED,
        className
      )}
    >
      {PHASE_LABEL[status] ?? status}
    </span>
  )
}
