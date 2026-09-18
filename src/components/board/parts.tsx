'use client'

/**
 * The small pieces the stage is built from: accents, reactions, notes, the
 * vote meter, action cards and the carried-over lane. Kept apart from
 * RetroBoard, which owns the session state and the socket.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, Calendar, ChevronDown, ExternalLink, History as HistoryIcon, Lightbulb,
  SmilePlus, StickyNote, ThumbsDown, ThumbsUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MentionInput, MentionText } from '@/components/Mentions'
import { Identicon } from '@/components/visual/Identicon'
import { columnSentiment } from '@/lib/column-sentiment'
import { cn } from '@/lib/utils'
import {
  createExternalTaskForAction,
  getCarriedOverActions,
  completeCarriedOverAction,
  type CarriedAction,
} from '@/app/actions'

/**
 * Colour accent for a column type, so an item stays recognisable once it's
 * lifted out of its column (the review queue mixes all of them together).
 * Tone tokens, not fixed palettes: they carry their own dark values.
 */
const ACCENT_PALETTE = {
  positive: {
    badge: 'bg-[hsl(var(--tone-positive-soft))] text-[hsl(var(--tone-positive-ink))] border-[hsl(var(--tone-positive)/0.4)]',
    border: 'border-l-[hsl(var(--tone-positive))]',
  },
  negative: {
    badge: 'bg-[hsl(var(--tone-negative-soft))] text-[hsl(var(--tone-negative-ink))] border-[hsl(var(--tone-negative)/0.4)]',
    border: 'border-l-[hsl(var(--tone-negative))]',
  },
  improve: {
    badge: 'bg-[hsl(var(--tone-improve-soft))] text-[hsl(var(--tone-improve-ink))] border-[hsl(var(--tone-improve)/0.4)]',
    border: 'border-l-[hsl(var(--tone-improve))]',
  },
  risk: {
    badge: 'bg-[hsl(var(--tone-risk-soft))] text-[hsl(var(--tone-risk-ink))] border-[hsl(var(--tone-risk)/0.4)]',
    border: 'border-l-[hsl(var(--tone-risk))]',
  },
  neutral: {
    badge: 'bg-[hsl(var(--tone-neutral-soft))] text-[hsl(var(--tone-neutral-ink))] border-[hsl(var(--tone-neutral)/0.4)]',
    border: 'border-l-[hsl(var(--tone-neutral))]',
  },
} as const

/** The icon a column wears: the sentiment, drawn. */
const SENTIMENT_ICON = {
  positive: ThumbsUp,
  negative: ThumbsDown,
  improve: Lightbulb,
  risk: AlertTriangle,
  neutral: StickyNote,
} as const

export function columnIcon(type: string) {
  return SENTIMENT_ICON[columnSentiment(type)]
}

export function columnAccent(type: string): { badge: string; border: string } {
  // Sentiment lives in lib/column-sentiment.ts so analytics buckets a column
  // exactly the way the board colours it.
  return ACCENT_PALETTE[columnSentiment(type)]
}

/** The tone family a column is drawn in, for inline styles. */
export const toneOf = (type: string) => columnSentiment(type)

/** Emoji offered for item reactions. Kept short so the row stays one line. */
const REACTION_EMOJI = ['👍', '🎉', '🤔', '😟', '🔥'] as const

/**
 * Reaction row for an item. Only emoji that someone has actually used are
 * shown; the palette is revealed on demand, so an item with no reactions costs
 * a single small button of vertical space.
 *
 * Reactions are open to everyone who can see the board — unlike votes they
 * aren't budgeted, so people who have run out of votes can still register an
 * opinion during review.
 */
export function ReactionBar({
  reactions,
  userId,
  onToggle,
  readOnly,
  size = 'sm',
}: {
  reactions: { userId: string; emoji: string }[]
  userId: string
  onToggle: (emoji: string) => void
  readOnly?: boolean
  size?: 'sm' | 'lg'
}) {
  const [pickerOpen, setPickerOpen] = useState(false)

  const used = useMemo(() => {
    const counts = new Map<string, { count: number; mine: boolean }>()
    for (const r of reactions) {
      const entry = counts.get(r.emoji) ?? { count: 0, mine: false }
      entry.count += 1
      if (r.userId === userId) entry.mine = true
      counts.set(r.emoji, entry)
    }
    return [...counts.entries()].sort((a, b) => b[1].count - a[1].count)
  }, [reactions, userId])

  if (readOnly && used.length === 0) return null
  const big = size === 'lg'

  return (
    <div className="flex flex-wrap items-center gap-1">
      {used.map(([emoji, { count, mine }]) => (
        <button
          key={emoji}
          type="button"
          disabled={readOnly}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onToggle(emoji)}
          className={cn(
            'flex items-center gap-1 rounded-full border leading-none transition-colors',
            big ? 'px-2.5 py-1 text-sm' : 'px-1.5 py-0.5 text-xs',
            mine
              ? 'border-[hsl(var(--tone-review)/0.6)] bg-[hsl(var(--tone-review-soft))] text-[hsl(var(--tone-review-ink))]'
              : 'border-transparent bg-muted hover:bg-accent',
            readOnly && 'cursor-default'
          )}
          aria-label={`${emoji} ${count}`}
          aria-pressed={mine}
        >
          <span>{emoji}</span>
          <span className="font-semibold tabular-nums">{count}</span>
        </button>
      ))}

      {!readOnly && (
        <div className="relative">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setPickerOpen((o) => !o)}
            className={cn(
              'flex items-center rounded-full border border-dashed text-muted-foreground transition-colors hover:border-solid hover:bg-accent hover:text-foreground',
              big ? 'px-2.5 py-1' : 'px-1.5 py-0.5',
            )}
            aria-label="Add reaction"
            aria-expanded={pickerOpen}
          >
            <SmilePlus className={big ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
          </button>
          {pickerOpen && (
            <div
              className="absolute bottom-full left-0 z-30 mb-1 flex gap-0.5 rounded-full border bg-popover p-1 shadow-[var(--shadow-lift)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {REACTION_EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="rounded-full px-1.5 py-0.5 text-lg leading-none transition-transform hover:scale-125 hover:bg-accent"
                  onClick={() => {
                    onToggle(emoji)
                    setPickerOpen(false)
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Summary/notes editor for an item during review.
 *
 * Typing here used to send every keystroke straight to the server, which
 * broadcast the whole board back and re-rendered this field from server state —
 * resetting the caret to the end mid-sentence. So the draft is local, sends are
 * debounced, and an incoming value is only adopted while the field is idle
 * (not focused, nothing pending), which leaves the caret alone.
 */
export function SummaryEditor({
  value,
  onChange,
  readOnly,
  className,
  id,
}: {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
  /** Extra classes for the field — the review spotlight uses a larger one. */
  className?: string
  id?: string
}) {
  const [draft, setDraft] = useState(value)
  const [focused, setFocused] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textarea = useRef<HTMLTextAreaElement | null>(null)

  // Grow with the content instead of reserving a fixed block of empty space.
  const autoGrow = useCallback(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [])
  useEffect(autoGrow, [draft, autoGrow])

  useEffect(() => {
    if (focused || timer.current) return
    setDraft(value)
  }, [value, focused])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const edit = (next: string) => {
    setDraft(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      onChange(next)
    }, 500)
  }

  const flush = () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (draft !== value) onChange(draft)
  }

  if (readOnly) {
    if (!value) return null
    return (
      <div className={cn('whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm leading-relaxed text-muted-foreground', className)}>
        {value}
      </div>
    )
  }

  return (
    <Textarea
      ref={textarea}
      id={id}
      rows={draft ? undefined : 1}
      placeholder="Notes from the discussion…"
      value={draft}
      onChange={(e) => edit(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        flush()
      }}
      className={cn('min-h-0 resize-none overflow-hidden bg-muted/50 px-3 py-2 text-sm leading-relaxed', className)}
    />
  )
}

/**
 * Your votes on one card, as a ten-segment meter.
 *
 * Each segment is a 24px target (WCAG 2.5.8) that sets your count for this
 * card; pressing the one you're already on steps back down, so zero is
 * reachable without a separate control. Segments you can't afford are
 * disabled rather than hidden, so the budget stays visible.
 */
export function VoteMeter({
  mine,
  remaining,
  onSet,
}: {
  mine: number
  remaining: number
  onSet: (count: number) => void
}) {
  return (
    <div className="flex flex-col gap-1" onPointerDown={(e) => e.stopPropagation()}>
      <span className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        Your votes
        <span className={cn('tabular-nums', mine > 0 && 'font-bold text-[hsl(var(--tone-risk-ink))]')}>{mine}</span>
      </span>
      <div className="flex flex-wrap" role="group" aria-label="Your votes for this item">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((star) => {
          const filled = star <= mine
          // Clicking the segment you're already on steps back down.
          const target = star === mine ? star - 1 : star
          // Only block increases you can't afford.
          const cost = target - mine
          const unaffordable = cost > 0 && remaining < cost
          return (
            <button
              key={star}
              type="button"
              disabled={unaffordable}
              aria-label={star === mine ? `Reduce to ${star - 1} votes` : `Give ${star} vote${star === 1 ? '' : 's'}`}
              aria-pressed={filled}
              onClick={() => onSet(target)}
              className={cn(
                'group/seg flex h-6 w-6 items-center justify-center rounded',
                unaffordable ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
              )}
            >
              <span
                className={cn(
                  'block h-3 w-[18px] rounded-[3px] transition-colors',
                  filled
                    ? 'bg-[hsl(var(--vote))] group-hover/seg:opacity-80'
                    : 'bg-muted-foreground/25 group-enabled/seg:group-hover/seg:bg-[hsl(var(--vote)/0.5)]',
                )}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}

export type ActionData = {
  id: string
  content: string
  completed: boolean
  assignee?: string | null
  dueDate?: string | null
  externalUrl?: string | null
  externalKey?: string | null
}

const dueFmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

/** Compact composer for a new action item: content + assignee + due date. */
export function ActionComposer({
  suggestions,
  onAdd,
  seed,
}: {
  suggestions: string[]
  onAdd: (content: string, assignee: string | null, dueDate: string | null) => void
  /** Pre-fill from elsewhere on the stage ("turn this card into an action"). */
  seed?: { text: string; nonce: number } | null
}) {
  const [content, setContent] = useState('')
  const [assignee, setAssignee] = useState('')
  const [dueDate, setDueDate] = useState('')
  const box = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!seed) return
    setContent(seed.text)
    box.current?.querySelector('textarea')?.focus()
  }, [seed])

  const submit = () => {
    if (!content.trim()) return
    onAdd(content.trim(), assignee.trim() || null, dueDate || null)
    setContent('')
    setAssignee('')
    setDueDate('')
  }

  return (
    <div ref={box} className="flex flex-col gap-2 rounded-2xl border bg-card p-3 shadow-[var(--shadow-card)]">
      <MentionInput
        multiline
        value={content}
        onChange={setContent}
        suggestions={suggestions}
        ariaLabel="New action item"
        placeholder="What will we do? (@ to mention · Shift+Enter for a new line)"
        className="min-h-[64px] resize-y border-0 bg-transparent text-base shadow-none focus-visible:ring-0"
        onEnter={submit}
      />
      <div className="flex flex-wrap items-center gap-2 border-t pt-2">
        <div className="min-w-[10rem] flex-1">
          <MentionInput
            value={assignee}
            onChange={setAssignee}
            suggestions={suggestions}
            ariaLabel="Assignee"
            placeholder="Who? (optional)"
          />
        </div>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="h-9 rounded-md border border-input bg-card px-3 py-1 text-sm"
          aria-label="Due date"
        />
        <Button onClick={submit} disabled={!content.trim()}>Add action</Button>
      </div>
    </div>
  )
}

/** One action item, with assignee, due date and Jira link. */
export function ActionCard({
  action,
  names,
  jiraConfigured,
  readOnly,
  onToggle,
  index,
}: {
  action: ActionData
  names: string[]
  jiraConfigured: boolean
  readOnly?: boolean
  onToggle?: () => void
  /** Shown as the item's number when it has no checkbox. */
  index?: number
}) {
  const [link, setLink] = useState<{ url: string; key: string } | null>(
    action.externalUrl && action.externalKey
      ? { url: action.externalUrl, key: action.externalKey }
      : null
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createInJira = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await createExternalTaskForAction(action.id, 'jira')
      setLink(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create Jira issue')
    } finally {
      setBusy(false)
    }
  }

  const overdue = !action.completed && action.dueDate ? new Date(action.dueDate) < new Date() : false

  return (
    <li className="flex items-start gap-3 rounded-xl border bg-card px-3 py-2.5 shadow-[var(--shadow-card)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1">
      {onToggle ? (
        <input
          type="checkbox"
          checked={action.completed}
          className="mt-0.5 h-5 w-5 shrink-0 rounded accent-[hsl(var(--tone-positive-ink))]"
          onChange={onToggle}
          aria-label={`Done: ${action.content}`}
        />
      ) : (
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[hsl(var(--tone-positive-soft))] font-mono text-xs font-semibold text-[hsl(var(--tone-positive-ink))]">
          {index ?? '•'}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className={cn('whitespace-pre-wrap font-medium leading-snug', action.completed && 'text-muted-foreground line-through')}>
          <MentionText text={action.content} names={names} />
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {action.assignee && (
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <Identicon name={action.assignee} size={18} /> {action.assignee}
            </span>
          )}
          {action.dueDate && (
            <span className={cn(
              'flex items-center gap-1 rounded-full px-2 py-0.5',
              overdue ? 'bg-[hsl(var(--tone-negative-soft))] font-semibold text-[hsl(var(--tone-negative-ink))]' : 'bg-muted',
            )}>
              <Calendar className="h-3 w-3" /> Due {dueFmt(action.dueDate)}
            </span>
          )}
          {link ? (
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--tone-improve-soft))] px-2 py-0.5 font-semibold text-[hsl(var(--tone-improve-ink))] hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> {link.key}
            </a>
          ) : (
            jiraConfigured && !readOnly && (
              <Button size="sm" variant="outline" className="h-6 gap-1 rounded-full px-2" onClick={createInJira} disabled={busy}>
                <ExternalLink className="h-3 w-3" /> {busy ? 'Creating…' : 'Create in Jira'}
              </Button>
            )
          )}
          {error && <span className="text-destructive">{error}</span>}
        </div>
      </div>
    </li>
  )
}

/**
 * Open actions this team still owes from its previous retros — "From last
 * time", a lane at the stage's left edge.
 *
 * Agreeing actions and never revisiting them is the main way retros lose their
 * credibility, so the board opens with whatever is outstanding and lets anyone
 * tick items off in place. It used to be a banner across the top of the board,
 * which with five overdue items took a third of the screen from the columns.
 * Hidden entirely for open boards, which have no team history.
 */
export function CarriedOverPanel({ retroId, names }: { retroId: string; names: string[] }) {
  const [actions, setActions] = useState<CarriedAction[] | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const panel = useRef<HTMLElement | null>(null)
  const sized = useRef(false)

  // On a narrow stage the lane would sit on top of the board, so it starts
  // folded there; beside the lanes (64rem of stage and up) it starts open.
  // Measured from the stage, not the window, like every other layout choice.
  useEffect(() => {
    if (sized.current || !panel.current) return
    sized.current = true
    const width = panel.current.parentElement?.clientWidth ?? 0
    if (width > 0 && width < 1024) setCollapsed(true)
  })

  useEffect(() => {
    let cancelled = false
    getCarriedOverActions(retroId)
      .then((rows) => { if (!cancelled) setActions(rows) })
      .catch(() => { if (!cancelled) setActions([]) })
    return () => { cancelled = true }
  }, [retroId])

  const complete = async (id: string) => {
    setBusy(id)
    try {
      await completeCarriedOverAction(id, true)
      setActions((prev) => prev?.filter((a) => a.id !== id) ?? null)
    } catch {
      // Leave the row in place; the server rejected it.
    } finally {
      setBusy(null)
    }
  }

  if (!actions || actions.length === 0) return null

  const overdue = actions.filter((a) => a.dueDate && new Date(a.dueDate) < new Date()).length

  return (
    <aside
      ref={panel}
      aria-label="Actions from previous retros"
      className={cn(
        'flex shrink-0 flex-col rounded-2xl border border-dashed bg-card/60',
        collapsed
          ? '@min-[64rem]/stage:w-14'
          : 'max-h-64 @min-[64rem]/stage:max-h-none @min-[64rem]/stage:w-72',
      )}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className={cn(
          'flex w-full items-start gap-2 rounded-2xl p-3 text-left hover:bg-accent/50',
          collapsed && '@min-[64rem]/stage:h-full @min-[64rem]/stage:flex-col @min-[64rem]/stage:items-center',
        )}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[hsl(var(--tone-risk-soft))] text-[hsl(var(--tone-risk-ink))]">
          <HistoryIcon className="h-4 w-4" aria-hidden />
        </span>
        <span className={cn('min-w-0 flex-1', collapsed && '@min-[64rem]/stage:[writing-mode:vertical-rl]')}>
          <span className="eyebrow block">From last time</span>
          <span className="mt-0.5 block text-sm font-semibold leading-snug">
            {actions.length} open action{actions.length === 1 ? '' : 's'} from previous retros
          </span>
          {overdue > 0 && (
            <span className="mt-1 inline-block rounded-full bg-[hsl(var(--tone-negative-soft))] px-2 py-0.5 text-xs font-bold text-[hsl(var(--tone-negative-ink))]">
              {overdue} overdue
            </span>
          )}
        </span>
        <ChevronDown className={cn('mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform', !collapsed && 'rotate-180')} aria-hidden />
        <span className="sr-only">{collapsed ? 'Show' : 'Hide'}</span>
      </button>

      {!collapsed && (
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-2">
          {actions.map((action) => {
            const isOverdue = action.dueDate ? new Date(action.dueDate) < new Date() : false
            return (
              <li key={action.id} className="flex items-start gap-2.5 rounded-xl bg-card px-2.5 py-2 shadow-[var(--shadow-card)]">
                <input
                  type="checkbox"
                  checked={false}
                  disabled={busy === action.id}
                  onChange={() => complete(action.id)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded accent-[hsl(var(--tone-positive-ink))]"
                  aria-label={`Mark "${action.content}" done`}
                />
                <div className="min-w-0 flex-1">
                  <div className="whitespace-pre-wrap text-sm leading-snug">
                    <MentionText text={action.content} names={names} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                    {action.assignee && (
                      <span className="flex items-center gap-1 font-medium text-foreground">
                        <Identicon name={action.assignee} size={14} /> {action.assignee}
                      </span>
                    )}
                    {action.dueDate && (
                      <span className={cn('flex items-center gap-1', isOverdue && 'font-semibold text-[hsl(var(--tone-negative-ink))]')}>
                        <Calendar className="h-3 w-3" /> {dueFmt(action.dueDate)}
                      </span>
                    )}
                    <Link href={`/retro/${action.retroId}`} className="truncate hover:text-foreground hover:underline">
                      {action.retroTitle}
                    </Link>
                    {action.externalUrl && action.externalKey && (
                      <a
                        href={action.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 font-semibold text-[hsl(var(--tone-improve-ink))] hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" /> {action.externalKey}
                      </a>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
