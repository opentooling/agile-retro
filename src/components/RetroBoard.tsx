'use client'

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Star, ThumbsUp, Send, LayoutDashboard, Play, Eye, ListTodo, Archive, Download, Users, Calendar, User as UserIcon, ExternalLink, Pencil, Check, X, SmilePlus, EyeOff, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from "@/lib/utils"
import { columnSentiment } from "@/lib/column-sentiment"
import { MentionInput, MentionText } from "@/components/Mentions"
import { createExternalTaskForAction, getCarriedOverActions, completeCarriedOverAction, type CarriedAction } from "@/app/actions"
import {
  DndContext, 
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type RetroData = {
  id: string
  title: string
  creator: string
  status: string
  team?: {
    id: string
    name: string
    imageData?: string | null
    jiraConfigured?: boolean
  } | null
  columns: {
    id: string
    title: string
    type: string
    // Set by the server under blind input: how many of this column's items are
    // withheld from this viewer.
    hiddenItemCount?: number
    items: {
      id: string
      content: string
      summary: string | null
      userId?: string
      username: string
      votes: { userId: string, count: number }[]
      reactions?: { userId: string, emoji: string }[]
    }[]
  }[]
  actions: {
    id: string
    content: string
    completed: boolean
    assignee?: string | null
    dueDate?: string | null
    externalUrl?: string | null
    externalKey?: string | null
  }[]
  inputDuration?: number | null
  votingDuration?: number | null
  reviewDuration?: number | null
  phaseStartTime?: string | null // Dates come as strings from JSON
  isAnonymous: boolean
  blindInput?: boolean
}





type ActionData = {
  id: string
  content: string
  completed: boolean
  assignee?: string | null
  dueDate?: string | null
  externalUrl?: string | null
  externalKey?: string | null
}

/**
 * Colour accent for a column type, so an item stays recognisable once it's
 * lifted out of its column (the review list mixes all three together).
 */
const ACCENT_PALETTE = {
  positive: {
    badge: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800',
    border: 'border-l-green-500',
  },
  negative: {
    badge: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800',
    border: 'border-l-red-500',
  },
  improve: {
    badge: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800',
    border: 'border-l-blue-500',
  },
  risk: {
    badge: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800',
    border: 'border-l-amber-500',
  },
  neutral: {
    badge: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    border: 'border-l-slate-400',
  },
} as const

export function columnAccent(type: string): { badge: string; border: string } {
  // Sentiment lives in lib/column-sentiment.ts so analytics buckets a column
  // exactly the way the board colours it.
  return ACCENT_PALETTE[columnSentiment(type)]
}

/**
 * One card, read-only. Used by the closed-board archive, where nothing can be
 * added, edited, voted on or reacted to.
 */
function ArchivedItem({
  item,
  column,
  showVotes,
  names,
  anonymous,
}: {
  item: { id: string; content: string; summary: string | null; username: string; votes: { count: number }[]; reactions?: { userId: string; emoji: string }[] }
  column: { title: string; type: string }
  showVotes: boolean
  names: string[]
  anonymous: boolean
}) {
  const accent = columnAccent(column.type)
  const total = item.votes.reduce((acc, v) => acc + v.count, 0)
  return (
    <Card className={cn('gap-0 border-l-4 py-0 shadow-none', accent.border)}>
      <CardContent className="space-y-1.5 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={cn('rounded-full border px-2 py-0.5 text-xs font-bold uppercase tracking-wider', accent.badge)}>
                {column.title}
              </span>
              <span className="text-xs text-muted-foreground">{anonymous ? 'Anonymous' : item.username}</span>
            </div>
            <div className="whitespace-pre-wrap text-sm font-medium leading-snug">
              <MentionText text={item.content} names={names} />
            </div>
          </div>
          {showVotes && (
            <div className={cn(
              'flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-sm font-bold',
              total > 0 ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400' : 'text-muted-foreground'
            )}>
              <Star className={cn('h-3.5 w-3.5', total > 0 && 'fill-current')} /> {total}
            </div>
          )}
        </div>
        <ReactionBar reactions={item.reactions ?? []} userId="" onToggle={() => {}} readOnly />
        {item.summary && (
          <div className="whitespace-pre-wrap rounded-md bg-muted/50 px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground">
            {item.summary}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Board phases in order, with the labels people actually say out loud. */
const PHASES = [
  { id: 'INPUT', label: 'Input' },
  { id: 'VOTING', label: 'Voting' },
  { id: 'REVIEW', label: 'Review' },
  { id: 'ACTIONS', label: 'Actions' },
] as const

/**
 * Where the board is, and what comes next. Replaces a raw status enum in the
 * header — in a live retro this is the fact the whole room is looking for, and
 * it needs to be readable from the back of a room on a projector.
 */
function PhaseStepper({ status }: { status: string }) {
  if (status === 'CLOSED') {
    return (
      <span className="rounded-full bg-muted px-3 py-1 text-sm font-semibold text-muted-foreground">
        Closed
      </span>
    )
  }
  const current = PHASES.findIndex((p) => p.id === status)
  return (
    <ol className="flex items-center gap-1" aria-label="Retrospective phase">
      {PHASES.map((phase, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'upcoming'
        return (
          <li key={phase.id} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden className="h-px w-3 bg-border sm:w-4" />}
            <span
              aria-current={state === 'current' ? 'step' : undefined}
              className={cn(
                'rounded-full px-2.5 py-1 text-sm font-semibold transition-colors sm:px-3',
                state === 'current' && 'bg-primary text-primary-foreground',
                state === 'done' && 'text-muted-foreground',
                state === 'upcoming' && 'text-muted-foreground/50'
              )}
            >
              {phase.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

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
function ReactionBar({
  reactions,
  userId,
  onToggle,
  readOnly,
}: {
  reactions: { userId: string; emoji: string }[]
  userId: string
  onToggle: (emoji: string) => void
  readOnly?: boolean
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
            'flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs leading-none transition-colors',
            mine
              ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300'
              : 'border-transparent bg-muted hover:bg-accent',
            readOnly && 'cursor-default'
          )}
          aria-label={`${emoji} ${count}`}
          aria-pressed={mine}
        >
          <span>{emoji}</span>
          <span className="font-medium tabular-nums">{count}</span>
        </button>
      ))}

      {!readOnly && (
        <div className="relative">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setPickerOpen((o) => !o)}
            className="flex items-center rounded-full border border-transparent bg-muted/60 px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Add reaction"
            aria-expanded={pickerOpen}
          >
            <SmilePlus className="h-3.5 w-3.5" />
          </button>
          {pickerOpen && (
            <div
              className="absolute bottom-full left-0 z-30 mb-1 flex gap-0.5 rounded-md border bg-popover p-1 shadow-md"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {REACTION_EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="rounded px-1.5 py-0.5 text-base leading-none hover:bg-accent"
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
}: {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
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
      <div className="whitespace-pre-wrap rounded-md bg-muted/50 px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground">
        {value}
      </div>
    )
  }

  return (
    <Textarea
      ref={textarea}
      rows={draft ? undefined : 1}
      placeholder="Notes from the discussion…"
      value={draft}
      onChange={(e) => edit(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        flush()
      }}
      className="min-h-0 resize-none overflow-hidden bg-muted/40 px-2.5 py-1.5 text-xs leading-relaxed"
    />
  )
}

/**
 * Open actions this team still owes from its previous retros.
 *
 * Agreeing actions and never revisiting them is the main way retros lose their
 * credibility, so the board opens with whatever is outstanding and lets anyone
 * tick items off in place. Collapsed by default once there's nothing overdue to
 * shout about; hidden entirely for open boards, which have no team history.
 */
function CarriedOverPanel({ retroId, names }: { retroId: string; names: string[] }) {
  const [actions, setActions] = useState<CarriedAction[] | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

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
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
          <ListTodo className="h-4 w-4" />
          {actions.length} open action{actions.length === 1 ? '' : 's'} from previous retros
          {overdue > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700 dark:bg-red-900/40 dark:text-red-300">
              {overdue} overdue
            </span>
          )}
        </span>
        <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
          {collapsed ? 'Show' : 'Hide'}
        </span>
      </button>

      {!collapsed && (
        <ul className="space-y-1 px-3 pb-3">
          {actions.map((action) => {
            const isOverdue = action.dueDate ? new Date(action.dueDate) < new Date() : false
            return (
              <li
                key={action.id}
                className="flex items-start gap-2 rounded-md bg-white/70 px-2.5 py-1.5 dark:bg-slate-900/50"
              >
                <input
                  type="checkbox"
                  checked={false}
                  disabled={busy === action.id}
                  onChange={() => complete(action.id)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-green-700 dark:text-green-400"
                  aria-label={`Mark "${action.content}" done`}
                />
                <div className="min-w-0 flex-1">
                  <div className="whitespace-pre-wrap text-sm leading-snug">
                    <MentionText text={action.content} names={names} />
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                    <Link href={`/retro/${action.retroId}`} className="hover:underline">
                      {action.retroTitle}
                    </Link>
                    {action.assignee && (
                      <span className="flex items-center gap-1">
                        <UserIcon className="h-3 w-3" /> {action.assignee}
                      </span>
                    )}
                    {action.dueDate && (
                      <span className={cn('flex items-center gap-1', isOverdue && 'font-semibold text-red-600 dark:text-red-400')}>
                        <Calendar className="h-3 w-3" /> Due {new Date(action.dueDate).toLocaleDateString()}
                      </span>
                    )}
                    {action.externalUrl && action.externalKey && (
                      <a
                        href={action.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-blue-600 hover:underline"
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
    </div>
  )
}

/** Compact input row for a new action item: content + assignee + due date. */
function ActionComposer({
  suggestions,
  onAdd,
}: {
  suggestions: string[]
  onAdd: (content: string, assignee: string | null, dueDate: string | null) => void
}) {
  const [content, setContent] = useState('')
  const [assignee, setAssignee] = useState('')
  const [dueDate, setDueDate] = useState('')

  const submit = () => {
    if (!content.trim()) return
    onAdd(content.trim(), assignee.trim() || null, dueDate || null)
    setContent('')
    setAssignee('')
    setDueDate('')
  }

  return (
    <div className="flex flex-col gap-2 bg-card p-3 rounded-xl shadow-sm border">
      <MentionInput
        multiline
        value={content}
        onChange={setContent}
        suggestions={suggestions}
        placeholder="New action item… (@ to mention · Shift+Enter for a new line)"
        className="min-h-[60px] resize-y"
        onEnter={submit}
      />
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex-1 min-w-[160px]">
          <MentionInput
            value={assignee}
            onChange={setAssignee}
            suggestions={suggestions}
            placeholder="Assignee (optional)"
          />
        </div>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          aria-label="Due date"
        />
        <Button onClick={submit} disabled={!content.trim()}>Add</Button>
      </div>
    </div>
  )
}

/** Display card for an action item, with assignee, due date and Jira link. */
function ActionCard({
  action,
  names,
  jiraConfigured,
  readOnly,
  onToggle,
}: {
  action: ActionData
  names: string[]
  jiraConfigured: boolean
  readOnly?: boolean
  onToggle?: () => void
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

  return (
    <Card className="gap-0 border-l-4 border-l-green-500 py-0 shadow-sm">
      <CardContent className="p-3 flex flex-col gap-1.5">
        <div className="flex items-start gap-3">
          {onToggle && (
            <input
              type="checkbox"
              checked={action.completed}
              className="mt-1 w-5 h-5 rounded border-gray-300 text-green-700 dark:text-green-400 focus:ring-green-500"
              onChange={onToggle}
            />
          )}
          <span className={cn(
            'whitespace-pre-wrap font-medium',
            action.completed && 'line-through text-muted-foreground'
          )}>
            <MentionText text={action.content} names={names} />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground pl-0">
          {action.assignee && (
            <span className="flex items-center gap-1 bg-secondary px-2 py-0.5 rounded-full">
              <UserIcon className="w-3 h-3" /> {action.assignee}
            </span>
          )}
          {action.dueDate && (
            <span className="flex items-center gap-1 bg-secondary px-2 py-0.5 rounded-full">
              <Calendar className="w-3 h-3" /> Due {new Date(action.dueDate).toLocaleDateString()}
            </span>
          )}
          {link ? (
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-blue-600 hover:underline"
            >
              <ExternalLink className="w-3 h-3" /> {link.key}
            </a>
          ) : (
            jiraConfigured && !readOnly && (
              <Button size="sm" variant="outline" className="h-6 px-2 gap-1" onClick={createInJira} disabled={busy}>
                <ExternalLink className="w-3 h-3" /> {busy ? 'Creating…' : 'Create in Jira'}
              </Button>
            )
          )}
          {error && <span className="text-red-500">{error}</span>}
        </div>
      </CardContent>
    </Card>
  )
}

function SortableItem({ id, children, disabled }: { id: string, children: React.ReactNode, disabled?: boolean }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    touchAction: 'none' // Prevent scrolling on mobile while dragging
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="touch-none">
      {children}
    </div>
  );
}

type Viewer = {
  id: string
  name: string | null
  isAdmin: boolean
  canManage: boolean
}

export default function RetroBoard({ initialData, user, viewer }: { initialData: RetroData, user?: { name?: string | null, email?: string | null }, viewer?: Viewer }) {
  const [retro, setRetro] = useState<RetroData>(initialData)
  const [socket, setSocket] = useState<Socket | null>(null)
  const [newItemContent, setNewItemContent] = useState<Record<string, string>>({})
  const [userId, setUserId] = useState<string>('')
  const [username, setUsername] = useState<string>('')
  const [isJoined, setIsJoined] = useState(false)
  // Inline item editing: itemId -> draft content while editing.
  const [editingItems, setEditingItems] = useState<Record<string, string>>({})
  const [accessDenied, setAccessDenied] = useState(false)

  // Can the current viewer edit this specific item (content or notes)?
  // Mirrors the server policy: author, facilitator, team-admin or admin.
  const canEditItem = (item: { userId?: string; username: string }) => {
    if (!viewer) return false
    if (viewer.isAdmin || viewer.canManage) return true
    if (item.userId && viewer.id && item.userId === viewer.id) return true
    if (viewer.name && item.username === viewer.name) return true
    return false
  }

  const [participants, setParticipants] = useState<{ userId: string, username: string, isReady: boolean }[]>([])
  const [isReady, setIsReady] = useState(false)
  const [isWarningDismissed, setIsWarningDismissed] = useState(false)
  const [participantsCollapsed, setParticipantsCollapsed] = useState(false)
  // Which phase's layout a closed board is being read through. A closed board
  // holds its final content; the phases differ in how that content is arranged,
  // which is the part worth revisiting.
  const [archiveView, setArchiveView] = useState<'INPUT' | 'VOTING' | 'REVIEW' | 'ACTIONS'>('REVIEW')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Re-arm the extend prompt on a phase change, and again each time the
  // deadline moves — extending is a snooze, so it should warn again as the new
  // deadline approaches.
  const phaseDeadline = useMemo(() => {
    const duration =
      retro.status === 'INPUT' ? retro.inputDuration :
      retro.status === 'VOTING' ? retro.votingDuration :
      retro.status === 'REVIEW' ? retro.reviewDuration : null
    if (!duration || !retro.phaseStartTime) return null
    return new Date(retro.phaseStartTime).getTime() + duration * 60 * 1000
  }, [retro.status, retro.inputDuration, retro.votingDuration, retro.reviewDuration, retro.phaseStartTime])

  useEffect(() => {
    setIsWarningDismissed(false)
  }, [retro.status, phaseDeadline])

  useEffect(() => {
    // Identity: when authenticated, use the server-side viewer id so votes and
    // reactions (now keyed by the authenticated user) line up with the UI.
    // Fall back to a stored random id for anonymous/legacy use.
    let storedUserId = localStorage.getItem('retro-user-id')
    if (!storedUserId) {
      storedUserId = crypto.randomUUID()
      localStorage.setItem('retro-user-id', storedUserId)
    }
    storedUserId = viewer?.id || storedUserId
    setUserId(storedUserId)

    if (user?.name) {
      setUsername(user.name)
      setIsJoined(true)
    } else {
      const storedUsername = localStorage.getItem('retro-username')
      if (storedUsername) {
        setUsername(storedUsername)
        setIsJoined(true)
      }
    }

    const socketInstance = io()
    setSocket(socketInstance)

    // Join with user info
    // We need to wait for username to be set if not logged in
    // But for now, let's just emit if we have it, or re-emit when we join
    if (isJoined && username) {
        socketInstance.emit('join-retro', { retroId: retro.id, userId: storedUserId, username })
    }

    socketInstance.on('retro-updated', (updatedRetro: RetroData) => {
      setRetro(updatedRetro)
      // Reset local ready state if phase changed (we can infer from server reset, but good to sync)
      // Actually server resets it, so we should listen to participants update
    })

    socketInstance.on('participants-updated', (updatedParticipants: any[]) => {
        setParticipants(updatedParticipants)
        // Update local ready state based on server (in case of reconnect or reset)
        const myId = viewer?.id || storedUserId
        const myParticipant = updatedParticipants.find(p => p.userId === myId)
        if (myParticipant) {
            setIsReady(myParticipant.isReady)
        }
    })

    // The server rejects actions the viewer isn't authorized for.
    socketInstance.on('access-denied', () => {
        setAccessDenied(true)
    })

    socketInstance.on('connect_error', (err: Error) => {
        if (err?.message === 'unauthorized') setAccessDenied(true)
    })

    return () => {
      socketInstance.disconnect()
    }
  }, [retro.id, user, viewer]) // We might need to re-run if isJoined changes

  // Re-emit join when isJoined becomes true
  useEffect(() => {
      if (isJoined && socket && username) {
          socket.emit('join-retro', { retroId: retro.id, userId, username })
      }
  }, [isJoined, socket, username])

  // Timer update effect
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  /**
   * Timing for the current phase.
   *
   * The clock deliberately keeps running past the deadline rather than moving
   * the board on by itself: a phase ends when the facilitator says it does, so
   * a discussion in full flow isn't cut off mid-sentence. `remaining` goes
   * negative once the phase is in overtime.
   */
  const remainingSeconds = useMemo(
    () => (phaseDeadline === null || now === null ? null : Math.ceil((phaseDeadline - now) / 1000)),
    [phaseDeadline, now]
  )

  const isOvertime = remainingSeconds !== null && remainingSeconds < 0

  const handleAddItem = (columnId: string) => {
    const content = newItemContent[columnId]
    if (!socket || !content?.trim()) return
    socket.emit('add-item', { retroId: retro.id, columnId, content: content, userId, username })
    setNewItemContent(prev => ({ ...prev, [columnId]: '' }))
  }

  const startEditItem = (itemId: string, current: string) => {
    setEditingItems(prev => ({ ...prev, [itemId]: current }))
  }
  const cancelEditItem = (itemId: string) => {
    setEditingItems(prev => {
      const next = { ...prev }
      delete next[itemId]
      return next
    })
  }
  const saveEditItem = (itemId: string) => {
    const content = editingItems[itemId]
    if (!socket || content === undefined || !content.trim()) return
    socket.emit('edit-item', { retroId: retro.id, itemId, content: content.trim() })
    cancelEditItem(itemId)
  }

  const handleVote = (itemId: string, delta: number) => {
    if (!socket) return
    socket.emit('vote', { retroId: retro.id, itemId, userId, delta })
  }

  const handleSetVote = (itemId: string, count: number) => {
    if (!socket) return
    // Calculate delta needed to reach target count
    // This logic is a bit complex because the server expects a delta.
    // Ideally server should support 'set-vote' but for now we can't change server easily without checking it.
    // Actually, let's just emit multiple votes or a new event if we could.
    // But wait, the user asked for "10 star review style".
    // If I click 5 stars, I want 5 votes.
    // I need to know my current votes for this item.
    
    // Let's find current votes
    let currentVotes = 0
    retro.columns.forEach(col => {
        const item = col.items.find(i => i.id === itemId)
        if (item) {
            const userVote = item.votes.find(v => v.userId === userId)
            currentVotes = userVote?.count || 0
        }
    })

    const delta = count - currentVotes
    if (delta !== 0) {
        socket.emit('vote', { retroId: retro.id, itemId, userId, delta })
    }
  }



  const handleUpdateStatus = (status: string) => {
    if (!socket) return
    socket.emit('update-status', { retroId: retro.id, status })
  }

  const handleToggleReaction = (itemId: string, emoji: string) => {
    if (!socket) return
    socket.emit('toggle-reaction', { retroId: retro.id, itemId, emoji })
  }

  const handleUpdateSummary = (itemId: string, summary: string) => {
    if (!socket) return
    socket.emit('update-item-summary', { retroId: retro.id, itemId, summary })
  }

  const handleAddActionItem = (
    content: string,
    assignee?: string | null,
    dueDate?: string | null
  ) => {
    if (!socket || !content.trim()) return
    socket.emit('add-action-item', {
      retroId: retro.id,
      content,
      assignee: assignee || null,
      dueDate: dueDate || null,
    })
  }

  const handleToggleReady = () => {
      if (!socket) return
      const newReadyState = !isReady
      setIsReady(newReadyState)
      socket.emit('user-ready', { retroId: retro.id, isReady: newReadyState })
  }

  const handleExportPDF = () => {
    // Trigger download from API
    window.open(`/api/retro/${retro.id}/export`, '_blank')
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || !socket) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    // Find source and destination columns
    let sourceColumnId = '';
    let destColumnId = '';
    let activeItem: any = null;

    retro.columns.forEach(col => {
        const item = col.items.find(i => i.id === activeId);
        if (item) {
            sourceColumnId = col.id;
            activeItem = item;
        }
    });

    // Check if over is a column or an item
    const overColumn = retro.columns.find(col => col.id === overId);
    if (overColumn) {
        destColumnId = overColumn.id;
    } else {
        // Over is likely an item, find its column
        retro.columns.forEach(col => {
            if (col.items.find(i => i.id === overId)) {
                destColumnId = col.id;
            }
        });
    }

    if (!sourceColumnId || !destColumnId) return;

    const sourceCol = retro.columns.find(c => c.id === sourceColumnId);
    const destCol = retro.columns.find(c => c.id === destColumnId);

    if (!sourceCol || !destCol || !activeItem) return;

    // Calculate new index
    let newIndex = 0;
    if (overColumn) {
        // Dropped on a column container -> append to end
        newIndex = destCol.items.length;
    } else {
        // Dropped on an item -> find its index
        const overItemIndex = destCol.items.findIndex(i => i.id === overId);
        newIndex = overItemIndex >= 0 ? overItemIndex : destCol.items.length;
    }

    // Optimistic update
    const newRetro = { ...retro };
    const newSourceCol = newRetro.columns.find(c => c.id === sourceColumnId)!;
    const newDestCol = newRetro.columns.find(c => c.id === destColumnId)!;

    if (sourceColumnId === destColumnId) {
        // Reordering within same column
        const oldIndex = newSourceCol.items.findIndex(i => i.id === activeId);
        newSourceCol.items = arrayMove(newSourceCol.items, oldIndex, newIndex);
    } else {
        // Moving to different column
        newSourceCol.items = newSourceCol.items.filter(i => i.id !== activeId);
        // Insert at new index
        newDestCol.items.splice(newIndex, 0, activeItem);
    }

    setRetro(newRetro);

    // Emit move event
    socket.emit('move-item', { 
        retroId: retro.id, 
        itemId: activeId, 
        targetColumnId: destColumnId,
        newIndex 
    });
  }

  const totalVotesUsed = useMemo(() => {
    let count = 0
    retro.columns.forEach(col => {
      col.items.forEach(item => {
        const userVote = item.votes.find(v => v.userId === userId)
        if (userVote) count += userVote.count
      })
    })
    return count
  }, [retro, userId])

  const votesRemaining = 10 - totalVotesUsed
  // Management rights come from the server (facilitator / team-admin / admin).
  // Fall back to the name-based creator check for anonymous/legacy use.
  const isOwner = viewer ? viewer.canManage : retro.creator === username

  // Names available for @mentions and action assignment: live participants,
  // the current user, the creator, and (when not anonymous) item authors.
  const mentionNames = useMemo(() => {
    const names = new Set<string>()
    participants.forEach(p => { if (p.username) names.add(p.username) })
    if (username) names.add(username)
    if (retro.creator) names.add(retro.creator)
    if (!retro.isAnonymous) {
      retro.columns.forEach(c => c.items.forEach(i => { if (i.username) names.add(i.username) }))
    }
    return Array.from(names)
  }, [participants, username, retro])

  if (!isJoined) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 dark:bg-slate-950">
        <Card className="w-[400px] shadow-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold text-slate-900 dark:text-slate-50">Join Session</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid w-full items-center gap-4">
              <div className="flex flex-col space-y-1.5">
                <Input 
                  placeholder="Enter your name" 
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="h-11"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && username.trim()) {
                      localStorage.setItem('retro-username', username)
                      setIsJoined(true)
                    }
                  }}
                />
              </div>
              <Button 
                className="h-11 bg-primary text-primary-foreground hover:bg-primary/90 text-white transition-colors"
                disabled={!username.trim()}
                onClick={() => {
                  localStorage.setItem('retro-username', username)
                  setIsJoined(true)
                }}
              >
                Join
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex h-dvh bg-background">
      {/* Main Board Area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4 lg:p-6">
        <div className="mx-auto flex w-full min-h-0 max-w-7xl flex-1 flex-col">
            {accessDenied && (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                That action wasn&apos;t permitted. You may not have the right access on this board.
              </div>
            )}
            {/* Open actions the team still owes from earlier retros. */}
            {retro.team && retro.status !== 'CLOSED' && (
              <CarriedOverPanel retroId={retro.id} names={mentionNames} />
            )}

            {retro.blindInput && retro.status === 'INPUT' && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50/60 px-4 py-2.5 text-sm dark:border-indigo-900 dark:bg-indigo-950/20">
                <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
                <p className="text-indigo-900 dark:text-indigo-200">
                  <span className="font-semibold">Blind input.</span>{' '}
                  You can only see your own cards until the input phase ends — so nobody&apos;s
                  thinking is anchored by what has already been written.
                </p>
              </div>
            )}

            <div className="flex justify-between items-center gap-4 mb-4 bg-white dark:bg-slate-900 px-5 py-3 rounded-lg shadow-sm border border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{retro.title}</h1>
                    {retro.team && (
                        <div className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                            {retro.team.imageData ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={retro.team.imageData} alt="" className="w-5 h-5 rounded-full object-cover border" />
                            ) : (
                                <Users className="w-4 h-4" />
                            )}
                            {retro.team.name}
                        </div>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-6">
                <PhaseStepper status={retro.status} />
                
                {/* Timer. Runs past zero into overtime; only the facilitator
                    moves the phase on. */}
                {remainingSeconds !== null && (() => {
                    const over = remainingSeconds < 0
                    const abs = Math.abs(remainingSeconds)
                    const minutes = Math.floor(abs / 60)
                    const seconds = abs % 60
                    const isLowTime = !over && remainingSeconds < 60
                    // Doubles as a snooze: dismissing hides it until the
                    // deadline moves, extending pushes the deadline out 5 min.
                    const showPrompt = isOwner && (isLowTime || over) && !isWarningDismissed

                    return (
                        <div className="flex flex-col items-end relative">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                {over ? 'Overtime' : 'Time Remaining'}
                            </span>
                            <span className={cn(
                                "font-mono text-3xl font-black tabular-nums leading-none sm:text-4xl",
                                over ? "text-red-600 dark:text-red-400" :
                                isLowTime ? "text-red-500 animate-pulse" : "text-gray-700 dark:text-gray-300"
                            )}>
                                {over ? '-' : ''}{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
                            </span>
                            {showPrompt && (
                                <div className="absolute top-full right-0 z-50 mt-2 w-72 rounded-lg border border-red-200 bg-white p-4 shadow-xl dark:border-red-900 dark:bg-slate-900 animate-in fade-in slide-in-from-top-2">
                                    <div className="mb-2 flex items-start justify-between gap-2">
                                        <p className="font-semibold text-red-600 dark:text-red-400">
                                            {over ? 'This phase is in overtime' : 'Less than a minute left'}
                                        </p>
                                        <button
                                            onClick={() => setIsWarningDismissed(true)}
                                            className="-mr-1 -mt-1 rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                                        >
                                            <span className="sr-only">Dismiss</span>
                                            <X className="h-4 w-4" />
                                        </button>
                                    </div>
                                    <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
                                        {over
                                            ? 'The board stays here until you move it on. Snooze for another 5 minutes if the discussion needs it.'
                                            : 'The board will stay on this phase when the time runs out — you decide when to move on.'}
                                    </p>
                                    <Button
                                        variant="outline"
                                        className="w-full font-semibold"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            if (socket) {
                                                socket.emit('extend-timer', { retroId: retro.id })
                                                setIsWarningDismissed(true)
                                            }
                                        }}
                                    >
                                        Snooze 5 minutes
                                    </Button>
                                </div>
                            )}
                        </div>
                    )
                })()}

                {retro.status === 'VOTING' && (
                <div className="flex flex-col items-end">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Votes Remaining</span>
                    <span className={cn("text-2xl font-black", votesRemaining > 0 ? "text-blue-600 dark:text-blue-400" : "text-slate-400")}>
                    {votesRemaining}
                    </span>
                </div>
                )}

                <div className="h-8 w-px bg-gray-200 dark:bg-gray-800 mx-2" />

                {retro.status === 'INPUT' && (
                    <div className="flex gap-2">
                        <Button 
                            variant={isReady ? "default" : "outline"}
                            className={cn(isReady && "bg-green-600 hover:bg-green-700 text-white")}
                            onClick={handleToggleReady}
                        >
                            {isReady ? "I'm Ready!" : "Mark as Ready"}
                        </Button>
                        {isOwner && (
                            <Button onClick={() => handleUpdateStatus('VOTING')} className={cn('bg-primary text-primary-foreground hover:bg-primary/90 gap-2', isOvertime && 'ring-2 ring-red-400 ring-offset-2 dark:ring-offset-slate-900')}>
                                <Play className="w-4 h-4" /> Start Voting
                            </Button>
                        )}
                    </div>
                )}
                {retro.status === 'VOTING' && (
                    <div className="flex gap-2">
                        <Button 
                            variant={isReady ? "default" : "outline"}
                            className={cn(isReady && "bg-green-600 hover:bg-green-700 text-white")}
                            onClick={handleToggleReady}
                        >
                            {isReady ? "I'm Ready!" : "Mark as Ready"}
                        </Button>
                        {isOwner && (
                            <Button onClick={() => handleUpdateStatus('REVIEW')} className={cn('bg-primary text-primary-foreground hover:bg-primary/90 gap-2', isOvertime && 'ring-2 ring-red-400 ring-offset-2 dark:ring-offset-slate-900')}>
                                <Eye className="w-4 h-4" /> Start Review
                            </Button>
                        )}
                    </div>
                )}
                {retro.status === 'REVIEW' && isOwner && (
                <Button onClick={() => handleUpdateStatus('ACTIONS')} className={cn('bg-primary text-primary-foreground hover:bg-primary/90 gap-2', isOvertime && 'ring-2 ring-red-400 ring-offset-2 dark:ring-offset-slate-900')}>
                    <ListTodo className="w-4 h-4" /> Start Actions
                </Button>
                )}
                {retro.status === 'ACTIONS' && isOwner && (
                <Button variant="destructive" onClick={() => handleUpdateStatus('CLOSED')} className="gap-2">
                    <Archive className="w-4 h-4" /> Close Retro
                </Button>
                )}
            </div>
            </div>


            {retro.status === 'REVIEW' ? (
            (() => {
                // Everything is on one vote-sorted list so the highest-voted
                // items lead the discussion — but nothing is dropped, and the
                // items nobody voted for are grouped under their own heading so
                // they're easy to pick up once the top of the list is done.
                const entries = retro.columns
                    .flatMap(col => col.items.map(item => ({ item, column: col })))
                    .map(entry => ({
                        ...entry,
                        total: entry.item.votes.reduce((acc, v) => acc + v.count, 0),
                    }))
                    .sort((a, b) => b.total - a.total)
                const voted = entries.filter(e => e.total > 0)
                const unvoted = entries.filter(e => e.total === 0)

                const renderEntry = ({ item, column, total }: (typeof entries)[number]) => {
                    const accent = columnAccent(column.type)
                    return (
                        <Card key={item.id} className={cn('gap-0 border-l-4 py-0 shadow-none', accent.border)}>
                            <CardContent className="p-3 space-y-2">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1 space-y-1">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <span className={cn(
                                                'rounded-full border px-2 py-0.5 text-xs font-bold uppercase tracking-wider',
                                                accent.badge
                                            )}>
                                                {column.title}
                                            </span>
                                            <span className="text-[11px] text-muted-foreground">
                                                {retro.isAnonymous ? 'Anonymous' : item.username}
                                            </span>
                                        </div>
                                        <div className="whitespace-pre-wrap text-sm font-medium leading-snug">
                                            <MentionText text={item.content} names={mentionNames} />
                                        </div>
                                    </div>
                                    <div className={cn(
                                        'flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-sm font-bold',
                                        total > 0
                                            ? 'bg-yellow-50 text-amber-700 dark:text-amber-400 dark:bg-yellow-900/20'
                                            : 'text-muted-foreground'
                                    )}>
                                        <Star className={cn('h-3.5 w-3.5', total > 0 && 'fill-current')} /> {total}
                                    </div>
                                </div>
                                <ReactionBar
                                    reactions={item.reactions ?? []}
                                    userId={userId}
                                    onToggle={(emoji) => handleToggleReaction(item.id, emoji)}
                                />
                                <SummaryEditor
                                    value={item.summary || ''}
                                    onChange={(summary) => handleUpdateSummary(item.id, summary)}
                                    readOnly={!canEditItem(item)}
                                />
                            </CardContent>
                        </Card>
                    )
                }

                return (
                    <div
                        // w-full matters: this is a flex item now, and a flex
                        // item with auto cross-axis margins does NOT stretch —
                        // it shrinks to its content and centres. Without an
                        // explicit width the review cards collapse to the
                        // width of the shortest card's text.
                        className="mx-auto w-full max-w-5xl space-y-2"
                    >
                        {voted.map(renderEntry)}
                        {unvoted.length > 0 && (
                            <div className="flex items-center gap-3 pt-3 pb-1">
                                <div className="h-px flex-1 bg-border" />
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    Also raised · {unvoted.length} with no votes
                                </span>
                                <div className="h-px flex-1 bg-border" />
                            </div>
                        )}
                        {unvoted.map(renderEntry)}
                        {entries.length === 0 && (
                            <div className="rounded-lg border border-dashed p-6 text-center italic text-muted-foreground">
                                No items were raised in this retro.
                            </div>
                        )}
                    </div>
                )
            })()
            ) : retro.status === 'ACTIONS' ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="space-y-6">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                    <Star className="w-6 h-6 text-amber-600 dark:text-amber-400 fill-yellow-500" />
                    Top 5 Items
                </h2>
                <div className="space-y-4">
                {retro.columns
                    .flatMap(col => col.items)
                    .sort((a, b) => {
                    const votesA = a.votes.reduce((acc, v) => acc + v.count, 0)
                    const votesB = b.votes.reduce((acc, v) => acc + v.count, 0)
                    return votesB - votesA
                    })
                    .slice(0, 5)
                    .map((item) => {
                    const totalVotes = item.votes.reduce((acc, v) => acc + v.count, 0)
                    return (
                        <Card key={item.id} className="gap-0 border-l-4 border-l-yellow-500 py-0 shadow-sm">
                        <CardContent className="p-3">
                            <div className="flex justify-between items-start">
                            <div className="font-medium text-lg"><MentionText text={item.content} names={mentionNames} /></div>
                            <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400 font-bold">
                                <Star className="w-4 h-4 fill-current" /> {totalVotes}
                            </div>
                            </div>
                            {item.summary && (
                            <div className="mt-3 text-sm text-muted-foreground bg-muted p-3 rounded-md italic">
                                {item.summary}
                            </div>
                            )}
                        </CardContent>
                        </Card>
                    )
                    })}
                </div>
                </div>
                <div className="space-y-6">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                    <ThumbsUp className="w-6 h-6 text-green-500" />
                    Action Items
                </h2>
                <div className="space-y-4">
                    {retro.actions?.map((action) => (
                    <ActionCard
                        key={action.id}
                        action={action}
                        names={mentionNames}
                        jiraConfigured={Boolean(retro.team?.jiraConfigured)}
                    />
                    ))}
                </div>
                <ActionComposer suggestions={mentionNames} onAdd={handleAddActionItem} />
                </div>
            </div>
            ) : retro.status === 'CLOSED' ? (
            // A closed board keeps its final content. The phases differ in how
            // that content is arranged, and that arrangement is the part worth
            // revisiting — so the archive is readable through each of them
            // rather than only the pooled Review layout.
            <div className="mx-auto w-full max-w-6xl space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3">
                    <div>
                        <h2 className="font-semibold">This retrospective is closed</h2>
                        <p className="text-sm text-muted-foreground">
                            Kept as a read-only record. Action items can still be ticked off.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Link href="/history">
                            <Button variant="outline" size="sm" className="gap-2">
                                <LayoutDashboard className="h-4 w-4" /> All retrospectives
                            </Button>
                        </Link>
                        <Button size="sm" onClick={handleExportPDF} className="gap-2">
                            <Download className="h-4 w-4" /> Export report
                        </Button>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <div className="flex gap-1" role="tablist" aria-label="View this retrospective as">
                        {PHASES.map((phase) => (
                            <button
                                key={phase.id}
                                type="button"
                                role="tab"
                                aria-selected={archiveView === phase.id}
                                onClick={() => setArchiveView(phase.id)}
                                className={cn(
                                    'rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                    archiveView === phase.id
                                        ? 'bg-primary text-primary-foreground'
                                        : 'text-muted-foreground hover:bg-accent'
                                )}
                            >
                                {phase.label}
                            </button>
                        ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Shows the final content in each phase&apos;s layout — not a snapshot of that moment.
                    </p>
                </div>

                {(archiveView === 'INPUT' || archiveView === 'VOTING') ? (
                    // As raised: cards stay in their columns, in the order the
                    // team put them in.
                    <div className={cn(
                        'grid grid-cols-1 gap-4',
                        retro.columns.length >= 4 ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-3'
                    )}>
                        {retro.columns.map((column) => (
                            <div key={column.id} className="space-y-2">
                                <h3 className={cn(
                                    'w-fit rounded-full border px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider',
                                    columnAccent(column.type).badge
                                )}>
                                    {column.title}
                                    <span className="ml-1.5 font-normal opacity-70">{column.items.length}</span>
                                </h3>
                                {column.items.map((item) => (
                                    <ArchivedItem
                                        key={item.id}
                                        item={item}
                                        column={column}
                                        showVotes={archiveView === 'VOTING'}
                                        names={mentionNames}
                                        anonymous={retro.isAnonymous}
                                    />
                                ))}
                                {column.items.length === 0 && (
                                    <p className="rounded-lg border border-dashed p-3 text-center text-xs italic text-muted-foreground">
                                        Nothing raised here
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                ) : archiveView === 'REVIEW' ? (
                    // As discussed: pooled across columns, highest-voted first.
                    <div className="mx-auto w-full max-w-4xl space-y-2">
                        {retro.columns
                            .flatMap(col => col.items.map(item => ({ item, column: col })))
                            .map(entry => ({ ...entry, total: entry.item.votes.reduce((acc, v) => acc + v.count, 0) }))
                            .sort((a, b) => b.total - a.total)
                            .map(({ item, column }) => (
                                <ArchivedItem
                                    key={item.id}
                                    item={item}
                                    column={column}
                                    showVotes
                                    names={mentionNames}
                                    anonymous={retro.isAnonymous}
                                />
                            ))}
                        {retro.columns.every(c => c.items.length === 0) && (
                            <div className="rounded-lg border border-dashed p-6 text-center text-sm italic text-muted-foreground">
                                No cards were raised in this retrospective.
                            </div>
                        )}
                    </div>
                ) : (
                    // What the team agreed to do about it.
                    <div className="mx-auto w-full max-w-3xl space-y-2">
                        {retro.actions && retro.actions.length > 0 ? (
                            retro.actions.map((action) => (
                                <ActionCard
                                    key={action.id}
                                    action={action}
                                    names={mentionNames}
                                    jiraConfigured={Boolean(retro.team?.jiraConfigured)}
                                    // Still togglable: actions outlive the
                                    // session that produced them.
                                    onToggle={() => {
                                        if (socket) {
                                            socket.emit('toggle-action-item', { retroId: retro.id, actionId: action.id })
                                        }
                                    }}
                                />
                            ))
                        ) : (
                            <div className="rounded-lg border border-dashed p-6 text-center text-sm italic text-muted-foreground">
                                No action items recorded.
                            </div>
                        )}
                    </div>
                )}
            </div>
            ) : (
            <DndContext 
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragEnd={handleDragEnd}
            >
            <div className={cn(
                // Fills whatever the header and banners leave, rather than
                // guessing at a fixed offset. min-h-0 lets the columns scroll
                // internally instead of stretching the page.
                "grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden",
                retro.columns.length >= 4
                    // Four columns only once there's genuinely room: at 1280
                    // with both rails they'd be ~172px wide, about 19
                    // characters a line.
                    ? "md:grid-cols-2 2xl:grid-cols-4"
                    : "md:grid-cols-3"
            )}>
            {retro.columns.map((column) => (
                <Card key={column.id} className="h-full flex flex-col gap-0 py-0 bg-slate-50/50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 shadow-none">
                <CardHeader className="py-2 px-3 [.border-b]:pb-2 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-t-lg">
                    <CardTitle className={cn(
                        "text-xs font-bold uppercase tracking-wider py-0.5 px-2.5 rounded-full w-fit border",
                        columnAccent(column.type).badge
                    )}>
                        {column.title}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 overflow-y-auto space-y-2 p-2.5">
                    <SortableContext 
                        items={column.items.map(i => i.id)} 
                        strategy={verticalListSortingStrategy}
                        disabled={retro.status !== 'INPUT'} // Only allow drag in INPUT phase? Or maybe VOTING too? Let's say INPUT for now.
                    >
                    {column.items.map((item) => {
                        const userVote = item.votes.find(v => v.userId === userId)
                        const userVoteCount = userVote?.count || 0
                        const totalItemVotes = item.votes.reduce((acc, v) => acc + v.count, 0)

                        return (
                        <SortableItem key={item.id} id={item.id} disabled={retro.status !== 'INPUT'}>
                        <Card className="gap-0 py-0 bg-white dark:bg-gray-800 shadow-sm hover:shadow-md transition-shadow duration-200 border-0">
                            <CardContent className="p-2.5 space-y-1.5">
                            {editingItems[item.id] !== undefined ? (
                              <div className="flex flex-col gap-2" onPointerDown={(e) => e.stopPropagation()}>
                                <Textarea
                                  value={editingItems[item.id]}
                                  onChange={(e) => setEditingItems(prev => ({ ...prev, [item.id]: e.target.value }))}
                                  className="min-h-[70px] text-sm"
                                  autoFocus
                                />
                                <div className="flex gap-2 justify-end">
                                  <Button size="sm" variant="ghost" onClick={() => cancelEditItem(item.id)}>
                                    <X className="w-4 h-4" />
                                  </Button>
                                  <Button size="sm" onClick={() => saveEditItem(item.id)} disabled={!editingItems[item.id]?.trim()}>
                                    <Check className="w-4 h-4" />
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-start justify-between gap-2 group">
                                <div className="whitespace-pre-wrap text-sm leading-relaxed flex-1"><MentionText text={item.content} names={mentionNames} /></div>
                                {retro.status !== 'CLOSED' && retro.status !== 'ACTIONS' && canEditItem(item) && (
                                  <button
                                    type="button"
                                    aria-label="Edit item"
                                    className="-m-1 shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-focus-within:opacity-100 group-hover:opacity-100"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={() => startEditItem(item.id, item.content)}
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            )}
                            <div className="flex flex-col gap-1.5 pt-1.5 border-t border-gray-100 dark:border-gray-700">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="text-[11px] font-medium text-muted-foreground truncate">
                                        {retro.isAnonymous ? "Anonymous" : item.username}
                                    </div>
                                    {retro.status !== 'INPUT' && retro.status !== 'VOTING' && (
                                    <div className="flex shrink-0 items-center gap-1 text-xs font-bold text-amber-700 dark:text-amber-400">
                                        <Star className="w-3 h-3 fill-current" /> {totalItemVotes}
                                    </div>
                                    )}
                                </div>

                                {retro.status !== 'INPUT' && (
                                <ReactionBar
                                    reactions={item.reactions ?? []}
                                    userId={userId}
                                    onToggle={(emoji) => handleToggleReaction(item.id, emoji)}
                                    readOnly={retro.status === 'CLOSED'}
                                />
                                )}

                                {retro.status === 'VOTING' && (
                                // Stars, but each one padded out to a 24px hit
                                // target (WCAG 2.5.8) instead of a bare 16px
                                // icon 2px from its neighbours. They wrap onto
                                // a second row in a narrow column rather than
                                // shrinking further.
                                <div className="flex flex-col gap-1">
                                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                        Your votes
                                        {userVoteCount > 0 && (
                                          <span className="ml-1 font-bold text-amber-700 dark:text-amber-400">{userVoteCount}</span>
                                        )}
                                    </span>
                                    <div
                                        className="flex flex-wrap gap-0.5"
                                        role="group"
                                        aria-label="Your votes for this item"
                                        onPointerDown={(e) => e.stopPropagation()}
                                    >
                                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => {
                                            const filled = star <= userVoteCount
                                            // Clicking the star you're already on steps back down,
                                            // so you can reach zero without hunting for a control.
                                            const target = star === userVoteCount ? star - 1 : star
                                            // Only block increases you can't afford.
                                            const cost = target - userVoteCount
                                            const unaffordable = cost > 0 && votesRemaining < cost
                                            return (
                                                <button
                                                    key={star}
                                                    type="button"
                                                    disabled={unaffordable}
                                                    aria-label={
                                                        star === userVoteCount
                                                            ? `Reduce to ${star - 1} votes`
                                                            : `Give ${star} vote${star === 1 ? '' : 's'}`
                                                    }
                                                    aria-pressed={filled}
                                                    onClick={() => handleSetVote(item.id, target)}
                                                    className={cn(
                                                        "flex h-6 w-6 items-center justify-center rounded transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                                        filled ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground/40",
                                                        unaffordable
                                                            ? "cursor-not-allowed opacity-40"
                                                            : "cursor-pointer hover:scale-110 hover:text-amber-500"
                                                    )}
                                                >
                                                    <Star className={cn("h-4 w-4", filled && "fill-current")} />
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                                )}
                            </div>
                            
                            </CardContent>
                        </Card>
                        </SortableItem>
                        )
                    })}
                    </SortableContext>
                    
                    {retro.blindInput && retro.status === 'INPUT' && (column.hiddenItemCount ?? 0) > 0 && (
                        <div className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-indigo-300 bg-indigo-50/50 py-1.5 text-xs font-medium text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/20 dark:text-indigo-300">
                            <EyeOff className="h-3.5 w-3.5" />
                            {column.hiddenItemCount} hidden card{column.hiddenItemCount === 1 ? '' : 's'} from others
                        </div>
                    )}

                    {retro.status === 'INPUT' && (
                        <div className="pt-2">
                        <div className="relative">
                            <MentionInput
                            multiline
                            placeholder="Add a new item... (use @ to mention)"
                            value={newItemContent[column.id] || ''}
                            onChange={(v) => setNewItemContent(prev => ({ ...prev, [column.id]: v }))}
                            suggestions={mentionNames}
                            className="min-h-[80px] pr-12 resize-none shadow-sm focus-visible:ring-indigo-500"
                            onEnter={() => handleAddItem(column.id)}
                            />
                            <Button
                                size="icon"
                                className="absolute bottom-2 right-2 h-8 w-8 bg-primary text-primary-foreground hover:bg-primary/90"
                                onClick={() => handleAddItem(column.id)}
                                disabled={!newItemContent[column.id]?.trim()}
                            >
                                <Send className="w-4 h-4" />
                            </Button>
                        </div>
                        </div>
                    )}
                </CardContent>
                </Card>
            ))}
            </div>
            </DndContext>
            )}
        </div>
      </div>

      {/* Participants rail. Collapsible, because on a 1280px laptop it and the
          global nav together take 512px from the columns. Collapsed it keeps
          the same information as a stacked avatar strip. */}
      <div className={cn(
          "flex flex-col border-l bg-card transition-all duration-200",
          participantsCollapsed ? "w-14 p-2" : "w-56 p-3"
      )}>
        <div className={cn("mb-2 flex items-center gap-1", participantsCollapsed ? "justify-center" : "justify-between")}>
            {!participantsCollapsed && (
              <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Participants
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-bold text-foreground">{participants.length}</span>
              </h2>
            )}
            <button
              type="button"
              onClick={() => setParticipantsCollapsed((c) => !c)}
              aria-label={participantsCollapsed ? 'Expand participants' : 'Collapse participants'}
              aria-expanded={!participantsCollapsed}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {participantsCollapsed
                ? <ChevronLeft className="h-4 w-4" />
                : <ChevronRight className="h-4 w-4" />}
            </button>
        </div>
        <div className={cn("flex-1 overflow-y-auto", participantsCollapsed ? "space-y-1.5" : "space-y-1")}>
            {participants.map((p) => (
                <div
                  key={p.userId}
                  title={participantsCollapsed ? `${p.username}${p.isReady ? ' · ready' : ''}` : p.username}
                  className={cn(
                    "flex items-center rounded-md transition-colors hover:bg-accent",
                    participantsCollapsed ? "justify-center p-1" : "justify-between gap-2 p-1.5"
                  )}
                >
                    <div className="flex min-w-0 items-center gap-2">
                        <div className={cn(
                          "relative flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-purple-400 text-xs font-bold text-white",
                          participantsCollapsed ? "h-8 w-8" : "h-7 w-7"
                        )}>
                            {p.username.substring(0, 2).toUpperCase()}
                            {participantsCollapsed && p.isReady && (
                              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-green-500" />
                            )}
                        </div>
                        {!participantsCollapsed && (
                          <span className="truncate text-sm font-medium">{p.username}</span>
                        )}
                    </div>
                    {!participantsCollapsed && p.isReady && (
                        <span className="shrink-0 rounded-full bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                            Ready
                        </span>
                    )}
                </div>
            ))}
        </div>
      </div>


    </div>
  )
}
