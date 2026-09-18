import { PHASE_ICON, PHASE_LABEL, PHASE_TONE } from '@/components/PhaseBadge'
import { cn } from '@/lib/utils'

/** The four live phases, in order. A closed board has been through all of them. */
export const LIVE_PHASES = ['INPUT', 'VOTING', 'REVIEW', 'ACTIONS'] as const
export type LivePhase = (typeof LIVE_PHASES)[number]

/**
 * Where a board is in its session, drawn as a track of four segments.
 *
 * Replaces a row of pill labels. The track reads as progress — done segments
 * are solid, the current one fills as its time is spent, the rest wait — so
 * the state of the room is legible at a glance and from across it.
 *
 * `progress` is the share of the current phase's time used (0–1), or null when
 * the phase is untimed; an untimed current phase is drawn full.
 */
export function PhaseTrack({
  status,
  progress = null,
  size = 'md',
  className,
}: {
  status: string
  progress?: number | null
  size?: 'sm' | 'md'
  className?: string
}) {
  const closed = status === 'CLOSED'
  const current = closed ? LIVE_PHASES.length : LIVE_PHASES.indexOf(status as LivePhase)

  if (size === 'sm') {
    return (
      <div className={cn('flex items-center gap-1', className)}>
        <span className="sr-only">
          {closed ? 'Closed' : `${PHASE_LABEL[status] ?? status}, phase ${current + 1} of 4`}
        </span>
        {LIVE_PHASES.map((phase, i) => {
          const tone = PHASE_TONE[phase]
          const done = i < current
          const now = i === current
          return (
            <span
              key={phase}
              aria-hidden
              className={cn('h-1.5 flex-1 rounded-full', !done && !now && 'bg-border')}
              style={done || now ? { background: `hsl(var(--tone-${tone})${done && !closed ? ' / 0.55' : ''})` } : undefined}
            />
          )
        })}
      </div>
    )
  }

  return (
    <ol aria-label="Retrospective phase" className={cn('grid grid-cols-4 gap-1.5', className)}>
      {LIVE_PHASES.map((phase, i) => {
        const tone = PHASE_TONE[phase]
        const Icon = PHASE_ICON[phase]
        const state = i < current ? 'done' : i === current ? 'current' : 'upcoming'
        const fill = state === 'done' ? 1 : state === 'current' ? (progress === null ? 1 : Math.min(1, Math.max(0.04, progress))) : 0
        return (
          <li key={phase} aria-current={state === 'current' ? 'step' : undefined} className="min-w-0">
            <span className="relative block h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
              <span
                className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out"
                style={{
                  width: `${fill * 100}%`,
                  background: `hsl(var(--tone-${tone})${state === 'done' ? ' / 0.6' : ''})`,
                }}
              />
            </span>
            <span
              className={cn(
                'mt-1.5 flex items-center gap-1 truncate text-xs',
                state === 'current' ? 'font-semibold' : 'font-medium text-muted-foreground',
              )}
              style={state === 'current' ? { color: `hsl(var(--tone-${tone}-ink))` } : undefined}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{PHASE_LABEL[phase]}</span>
              {state === 'done' && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
