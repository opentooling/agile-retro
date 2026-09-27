'use client'

import type { ReactNode } from 'react'
import { EyeOff, Star } from 'lucide-react'
import { MentionText } from '@/components/Mentions'
import { Identicon } from '@/components/visual/Identicon'
import { cn } from '@/lib/utils'
import { ReactionBar, columnIcon, toneOf } from './parts'
import type { BoardColumn, BoardItem } from './types'

/**
 * The row of lanes. Lanes never shrink below a readable width: when they run
 * out of room the row scrolls sideways inside the stage (never the page), and
 * on a narrow stage each lane takes most of the width and snaps into place.
 */
export function LaneRow({ children, fill }: { children: ReactNode; fill?: boolean }) {
  return (
    <div
      className={cn(
        'flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1',
        '@min-[40rem]/stage:grid @min-[40rem]/stage:snap-none @min-[40rem]/stage:grid-flow-col @min-[40rem]/stage:auto-cols-[minmax(17rem,1fr)]',
        fill && '@min-[64rem]/stage:h-full',
      )}
    >
      {children}
    </div>
  )
}

/**
 * One column of the board, drawn as a lane: its sentiment tone floods the
 * lane, and cards sit on it like paper. The composer is docked at the lane's
 * foot so it never scrolls away from the person typing.
 */
export function Lane({
  column,
  children,
  footer,
  hiddenCount,
  scroll,
}: {
  column: BoardColumn
  children: ReactNode
  footer?: ReactNode
  hiddenCount?: number
  /** Scroll inside the lane on a wide stage (live phases); the record flows instead. */
  scroll?: boolean
}) {
  const tone = toneOf(column.type)
  const Icon = columnIcon(column.type)
  const headingId = `lane-${column.id}`
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'flex w-[85%] shrink-0 snap-start flex-col rounded-2xl @min-[40rem]/stage:w-auto',
        scroll && '@min-[64rem]/stage:min-h-0',
      )}
      style={{ background: `hsl(var(--tone-${tone}-soft) / 0.7)` }}
    >
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-card/80"
          style={{ color: `hsl(var(--tone-${tone}-ink))` }}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <h2 id={headingId} className="min-w-0 truncate text-[15px] font-semibold" style={{ color: `hsl(var(--tone-${tone}-ink))` }}>
          {column.title}
        </h2>
        <span className="ml-auto rounded-full bg-card/80 px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
          {column.items.length}
        </span>
      </header>
      {hiddenCount !== undefined && hiddenCount > 0 && (
        <div className="mx-2 mb-2 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-[hsl(var(--tone-review)/0.6)] bg-card/60 py-1.5 text-xs font-medium text-[hsl(var(--tone-review-ink))]">
          <EyeOff className="h-3.5 w-3.5" aria-hidden />
          {hiddenCount} hidden card{hiddenCount === 1 ? '' : 's'} from others
        </div>
      )}
      <div className={cn('min-h-16 flex-1 space-y-2 px-1.5 pb-1.5', scroll && '@min-[64rem]/stage:min-h-0 @min-[64rem]/stage:overflow-y-auto')}>
        {children}
      </div>
      {footer && <div className="px-1.5 pb-1.5">{footer}</div>}
    </section>
  )
}

/** Who wrote a card, as the card's footer shows it. */
export function Author({ name, anonymous }: { name: string; anonymous: boolean }) {
  if (anonymous) {
    return <span className="truncate text-xs font-medium text-muted-foreground">Anonymous</span>
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <Identicon name={name} size={18} />
      <span className="truncate">{name}</span>
    </span>
  )
}

/**
 * One card, read-only. Used by the closed board's record, where nothing can be
 * added, edited, voted on or reacted to.
 */
export function ArchivedItem({
  item,
  column,
  showVotes,
  showColumn,
  names,
  anonymous,
}: {
  item: BoardItem
  column: { title: string; type: string }
  showVotes: boolean
  /** In the pooled view, say which column the card came from. */
  showColumn?: boolean
  names: string[]
  anonymous: boolean
}) {
  const tone = toneOf(column.type)
  const total = item.votes.reduce((acc, v) => acc + v.count, 0)
  return (
    <article
      className="space-y-2 rounded-xl bg-note p-3 shadow-[var(--shadow-card)]"
      style={showColumn ? { boxShadow: `inset 3px 0 0 hsl(var(--tone-${tone})), var(--shadow-card)` } : undefined}
    >
      {showColumn && (
        <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: `hsl(var(--tone-${tone}-ink))` }}>
          {column.title}
        </span>
      )}
      <div className="whitespace-pre-wrap text-[length:var(--card-text)] leading-snug">
        <MentionText text={item.content} names={names} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <Author name={item.username} anonymous={anonymous} />
        {showVotes && (
          <span className={cn(
            'flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums',
            total > 0 ? 'bg-[hsl(var(--tone-risk-soft))] text-[hsl(var(--tone-risk-ink))]' : 'text-muted-foreground'
          )}>
            <Star className={cn('h-3 w-3', total > 0 && 'fill-current')} aria-hidden /> {total}
          </span>
        )}
      </div>
      <ReactionBar reactions={item.reactions ?? []} userId="" onToggle={() => {}} readOnly />
      {item.summary && (
        <div className="whitespace-pre-wrap rounded-lg bg-muted px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground">
          {item.summary}
        </div>
      )}
    </article>
  )
}
