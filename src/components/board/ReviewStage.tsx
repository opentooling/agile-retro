'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, GripVertical, MessageSquareText, RotateCcw, Star } from 'lucide-react'
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { MentionText } from '@/components/Mentions'
import { cn } from '@/lib/utils'
import { ReactionBar, SummaryEditor, columnIcon, toneOf } from './parts'
import type { BoardItem, BoardColumn } from './types'

export type ReviewEntry = { item: BoardItem; column: BoardColumn; total: number }

/** Is the keyboard focus somewhere that types? Then J/K are letters, not navigation. */
function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

type DragHandle = { ref: (el: HTMLElement | null) => void; props: Record<string, unknown> }

/**
 * A queue row that can be dragged to a new place.
 *
 * The handle is separate from the row's own click target — the whole row
 * selects the topic — so picking a card up and choosing one stay different
 * gestures. With dragging off, this is a plain list item.
 */
function SortableRow({
  id,
  disabled,
  children,
}: {
  id: string
  disabled: boolean
  children: (handle: DragHandle | null) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled })
  return (
    <li
      ref={setNodeRef}
      className="relative"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 10 : undefined,
      }}
    >
      {children(disabled ? null : { ref: setActivatorNodeRef, props: { ...attributes, ...listeners } })}
    </li>
  )
}

/**
 * Review, as a discussion queue.
 *
 * Every card is pooled and ranked by votes (nothing is dropped — cards nobody
 * voted for sit under "Also raised"). The queue runs down one side; the topic
 * on the table sits in a spotlight beside it, in type big enough to read off a
 * shared screen, with its reactions and the notes being taken. Walk it with
 * Next / Previous or J and K.
 *
 * Which topic is in the spotlight is each viewer's own choice — the facilitator
 * usually shares their screen, and anyone else can look ahead without moving
 * the room.
 *
 * The order of the queue, by contrast, is the room's: the facilitator can lift
 * a topic up or drop it down — within its own half, so nothing crosses the
 * "Also raised" line and disappears — and everyone's queue moves with it. The
 * reset puts the vote ranking back.
 */
export function ReviewStage({
  entries,
  anonymous,
  names,
  userId,
  canEdit,
  onReact,
  onSummary,
  canReorder = false,
  customOrder = false,
  onReorder,
  onDropBefore,
  onResetOrder,
}: {
  entries: ReviewEntry[]
  anonymous: boolean
  names: string[]
  userId: string
  canEdit: (item: BoardItem) => boolean
  onReact: (itemId: string, emoji: string) => void
  onSummary: (itemId: string, summary: string) => void
  /** Only whoever is running the session arranges the queue. */
  canReorder?: boolean
  /** Is the queue in the facilitator's order rather than the vote ranking? */
  customOrder?: boolean
  onReorder?: (itemId: string, delta: -1 | 1) => void
  /** A drag: put this card in front of that one, or last (null). */
  onDropBefore?: (itemId: string, beforeItemId: string | null) => void
  onResetOrder?: () => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const index = Math.max(0, entries.findIndex((e) => e.item.id === selectedId))
  const current = entries[index]
  const voted = useMemo(() => entries.filter((e) => e.total > 0), [entries])
  const unvoted = useMemo(() => entries.filter((e) => e.total === 0), [entries])

  const sensors = useSensors(
    // 8px before a drag starts, so a click on a row still selects the topic.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  /**
   * A card was dropped. Send where it landed as "in front of this one", which
   * survives the board changing under the drag; the server decides whether the
   * move is allowed and tells everyone. Nothing moves optimistically — a
   * refused drop should spring back, not settle and then jump.
   */
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const ids = entries.map((e) => e.item.id)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from === -1 || to === -1) return
    const rest = ids.filter((id) => id !== String(active.id))
    const landing = rest.indexOf(String(over.id)) + (from < to ? 1 : 0)
    onDropBefore?.(String(active.id), rest[landing] ?? null)
  }

  const go = (delta: number) => {
    const next = entries[Math.min(entries.length - 1, Math.max(0, index + delta))]
    if (next) setSelectedId(next.item.id)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'j' || e.key === 'J') { e.preventDefault(); go(1) }
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); go(-1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (entries.length === 0) {
    return (
      <div className="mx-auto w-full max-w-xl rounded-2xl border border-dashed p-10 text-center text-muted-foreground">
        No items were raised in this retro.
      </div>
    )
  }

  const who = (item: BoardItem) => (anonymous ? 'Anonymous' : item.username)
  const tone = toneOf(current.column.type)
  const Icon = columnIcon(current.column.type)

  /** `place` is where the row sits inside its own half of the queue. */
  const row = (entry: ReviewEntry, rank: number, place: number, groupSize: number) => {
    const selected = entry.item.id === current.item.id
    const t = toneOf(entry.column.type)
    const reactions = new Map<string, number>()
    for (const r of entry.item.reactions ?? []) reactions.set(r.emoji, (reactions.get(r.emoji) ?? 0) + 1)
    return (
      <SortableRow key={entry.item.id} id={entry.item.id} disabled={!canReorder}>
        {(handle) => (<>
        <div
          className={cn(
            'flex gap-3 rounded-xl border px-3 py-2.5 transition-colors',
            selected ? 'border-transparent bg-card shadow-[var(--shadow-lift)]' : 'border-transparent hover:bg-card/70',
          )}
          style={selected ? { boxShadow: `inset 3px 0 0 hsl(var(--tone-${t})), var(--shadow-lift)` } : undefined}
        >
          {handle && (
            <button
              type="button"
              ref={handle.ref}
              {...handle.props}
              aria-label={`Drag to reorder topic ${rank}`}
              title="Drag to reorder"
              className="relative z-10 -my-1 -ml-1 grid h-7 w-5 shrink-0 cursor-grab touch-none place-items-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            >
              <GripVertical className="h-4 w-4" aria-hidden />
            </button>
          )}
          <span className="w-5 shrink-0 pt-0.5 text-right font-mono text-xs tabular-nums text-muted-foreground">{rank}</span>
          <div className="min-w-0 flex-1">
            <div className={cn('line-clamp-2 whitespace-pre-wrap text-sm leading-snug', selected ? 'font-semibold' : 'font-medium')}>
              <MentionText text={entry.item.content} names={names} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: `hsl(var(--tone-${t}))` }} />
                <span>{entry.column.title}</span>
              </span>
              {entry.item.summary && (
                <span className="flex items-center gap-1 text-[hsl(var(--tone-positive-ink))]">
                  <MessageSquareText className="h-3 w-3" aria-hidden /> Notes
                </span>
              )}
              {[...reactions.entries()].slice(0, 3).map(([emoji, n]) => (
                <span key={emoji} className="tabular-nums">{emoji} {n}</span>
              ))}
            </div>
          </div>
          <span className={cn(
            'flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-bold tabular-nums',
            entry.total > 0 ? 'bg-[hsl(var(--tone-risk-soft))] text-[hsl(var(--tone-risk-ink))]' : 'text-muted-foreground',
          )}>
            <Star className={cn('h-3 w-3', entry.total > 0 && 'fill-current')} aria-hidden /> {entry.total}
          </span>
          {canReorder && (
            // Above the click-anywhere overlay below, or these would never be
            // reachable by mouse.
            <div className="relative z-10 -my-1 flex shrink-0 flex-col">
              {([-1, 1] as const).map((delta) => {
                const Arrow = delta === -1 ? ChevronUp : ChevronDown
                const stuck = delta === -1 ? place === 0 : place === groupSize - 1
                return (
                  <button
                    key={delta}
                    type="button"
                    disabled={stuck}
                    onClick={() => onReorder?.(entry.item.id, delta)}
                    aria-label={`Move topic ${rank} ${delta === -1 ? 'up' : 'down'}`}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                  >
                    <Arrow className="h-4 w-4" aria-hidden />
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setSelectedId(entry.item.id)}
          aria-current={selected ? 'true' : undefined}
          aria-label={`Discuss topic ${rank}`}
          className="absolute inset-0 rounded-xl"
        />
        </>)}
      </SortableRow>
    )
  }

  return (
    <div
      data-review-queue
      className="grid w-full min-h-0 gap-4 @min-[60rem]/stage:h-full @min-[60rem]/stage:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]"
    >
      {/* The topic on the table. */}
      <section
        aria-label="Now discussing"
        className="flex min-h-0 flex-col rounded-2xl border bg-card shadow-[var(--shadow-card)] @min-[60rem]/stage:order-2"
      >
        <div className="h-1.5 rounded-t-2xl" style={{ background: `hsl(var(--tone-${tone}))` }} aria-hidden />
        <div key={current.item.id} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span
              className="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{ background: `hsl(var(--tone-${tone}-soft))`, color: `hsl(var(--tone-${tone}-ink))` }}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {`${current.column.title} · ${who(current.item)}`}
            </span>
            <span className="eyebrow">Topic {index + 1} of {entries.length}</span>
          </div>

          <div className="whitespace-pre-wrap text-[length:var(--spot-text)] font-medium leading-snug tracking-tight">
            <MentionText text={current.item.content} names={names} />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold tabular-nums',
              current.total > 0 ? 'bg-[hsl(var(--tone-risk-soft))] text-[hsl(var(--tone-risk-ink))]' : 'bg-muted text-muted-foreground',
            )}>
              <Star className={cn('h-4 w-4', current.total > 0 && 'fill-current')} aria-hidden />
              {current.total} vote{current.total === 1 ? '' : 's'}
            </span>
            <ReactionBar
              reactions={current.item.reactions ?? []}
              userId={userId}
              onToggle={(emoji) => onReact(current.item.id, emoji)}
              size="lg"
            />
          </div>

          <div className="flex flex-1 flex-col gap-2">
            <label htmlFor={`notes-${current.item.id}`} className="eyebrow flex items-center gap-1.5">
              <MessageSquareText className="h-3.5 w-3.5" aria-hidden /> Discussion notes
            </label>
            <SummaryEditor
              key={current.item.id}
              id={`notes-${current.item.id}`}
              value={current.item.summary || ''}
              onChange={(summary) => onSummary(current.item.id, summary)}
              readOnly={!canEdit(current.item)}
              className="min-h-24 text-base"
            />
            {!canEdit(current.item) && !current.item.summary && (
              <p className="text-sm text-muted-foreground">No notes yet.</p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t pt-4">
            <Button variant="outline" onClick={() => go(-1)} disabled={index === 0} className="gap-1.5">
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <span className="hidden text-xs text-muted-foreground sm:block">
              <kbd className="rounded border bg-muted px-1.5 font-mono">K</kbd> / <kbd className="rounded border bg-muted px-1.5 font-mono">J</kbd> to move
            </span>
            <Button onClick={() => go(1)} disabled={index >= entries.length - 1} className="gap-1.5">
              Next topic <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* The queue. */}
      <nav aria-label="Discussion queue" className="flex min-h-0 flex-col @min-[60rem]/stage:order-1">
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <p className="eyebrow">Queue · {customOrder ? 'your order' : 'by votes'}</p>
          {canReorder && customOrder && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onResetOrder?.()}
              className="h-6 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reset order
            </Button>
          )}
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={entries.map((e) => e.item.id)} strategy={verticalListSortingStrategy}>
        <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto pb-2 pr-1">
          {voted.map((entry, i) => row(entry, i + 1, i, voted.length))}
          {unvoted.length > 0 && (
            <li role="presentation" className="flex items-center gap-3 px-1 pb-1 pt-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Also raised · {unvoted.length} with no votes
              </span>
              <span className="h-px flex-1 bg-border" />
            </li>
          )}
          {unvoted.map((entry, i) => row(entry, voted.length + i + 1, i, unvoted.length))}
        </ol>
        </SortableContext>
        </DndContext>
      </nav>
    </div>
  )
}
