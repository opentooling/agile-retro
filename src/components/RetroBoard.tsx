'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { io, Socket } from 'socket.io-client'
import Link from 'next/link'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Play, Eye, ListTodo, Archive, Download, ArrowLeft, Check, X, Pencil, Send, EyeOff,
  Globe, Star, Type, Users, ArrowRight, ShieldAlert, GripVertical, MoreHorizontal,
  ArrowUp, ArrowDown, CornerDownRight, Trash2,
} from 'lucide-react'
import { cn } from "@/lib/utils"
import { MentionInput, MentionText } from "@/components/Mentions"
import { PhaseTrack, LIVE_PHASES, type LivePhase } from "@/components/PhaseTrack"
import { PHASE_ICON, PHASE_LABEL, PHASE_TONE } from "@/components/PhaseBadge"
import { TeamMark } from "@/components/TeamMark"
import { Identicon } from "@/components/visual/Identicon"
import { LogoMark } from "@/components/visual/Logo"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  ReactionBar, VoteMeter, ActionCard, ActionComposer, CarriedOverPanel, toneOf,
  type ActionData,
} from "@/components/board/parts"
import { Lane, LaneRow, Author, ArchivedItem } from "@/components/board/Lanes"
import { ReviewStage, type ReviewEntry } from "@/components/board/ReviewStage"
import type { BoardColumn, BoardItem } from "@/components/board/types"
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  DragEndEvent
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { placeBefore, neighbourFor } from '@/lib/board-order'
import { clockOffset } from '@/lib/phase-timer'
import { isCustomOrder, orderedForReview } from '@/lib/review-order'

// Re-exported: these moved into ./board/parts, and are imported from here by
// tests and callers.
export { columnAccent, columnIcon, SummaryEditor } from "@/components/board/parts"

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
  columns: BoardColumn[]
  actions: ActionData[]
  inputDuration?: number | null
  votingDuration?: number | null
  reviewDuration?: number | null
  phaseStartTime?: string | null // Dates come as strings from JSON
  isAnonymous: boolean
  blindInput?: boolean
}

/** What the console says the room should be doing, per phase. */
const PHASE_HINT: Record<string, string> = {
  INPUT: 'Add cards to any lane. Mark yourself ready when you’re done.',
  VOTING: 'Spend up to 10 votes on what you most want to talk about.',
  REVIEW: 'Talk through the top cards and capture notes as you go.',
  ACTIONS: 'Agree who does what, and by when.',
}

/** The facilitator's one button, per phase. */
const NEXT_STEP: Record<string, { to: string; label: string; icon: typeof Play }> = {
  INPUT: { to: 'VOTING', label: 'Start voting', icon: Play },
  VOTING: { to: 'REVIEW', label: 'Start review', icon: Eye },
  REVIEW: { to: 'ACTIONS', label: 'Start actions', icon: ListTodo },
  ACTIONS: { to: 'CLOSED', label: 'Close retro', icon: Archive },
}

type DragHandle = { ref: (el: HTMLElement | null) => void; props: Record<string, unknown> }

/**
 * A card that can be dragged — by its handle only.
 *
 * The whole card used to be the drag surface, with nothing to say so: you
 * could not select its text, and nobody could tell it moved at all. The handle
 * is visible, and it is also where keyboard dragging lives (Space to pick up,
 * arrows to move, Space to drop). The card menu offers the same moves without
 * dragging, for touch screens and anyone who would rather not.
 */
function SortableItem({ id, children, disabled }: { id: string, disabled?: boolean, children: (handle: DragHandle | null) => React.ReactNode }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="rounded-xl">
      {children(disabled ? null : { ref: setActivatorNodeRef, props: { ...attributes, ...listeners } })}
    </div>
  );
}

/**
 * A lane's card list as a drop target. Without it a card could only land by
 * being dropped on another card, so an empty column could never receive one.
 */
function LaneDropZone({ id, children, enabled }: { id: string, children: React.ReactNode, enabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !enabled });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'min-h-16 space-y-2 rounded-xl transition-colors',
        isOver && 'bg-card/50 outline-dashed outline-2 outline-offset-2 outline-[hsl(var(--primary)/0.5)]',
      )}
    >
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

type Participant = { userId: string, username: string, isReady: boolean }

/**
 * Who is in the room: a stack of faces, each with a tick once they're ready.
 * The full list opens on demand — it used to be a permanent 224px rail.
 */
function Presence({ participants }: { participants: Participant[] }) {
  const ready = participants.filter((p) => p.isReady).length
  const shown = participants.slice(0, 5)
  return (
    <Popover>
      <PopoverTrigger
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm hover:bg-accent"
        aria-label={`${participants.length} in the room, ${ready} ready — show everyone`}
      >
        <span className="flex -space-x-1.5" aria-hidden>
          {shown.length === 0 && (
            <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-dashed bg-muted">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          )}
          {shown.map((p) => (
            <span key={p.userId} className="relative rounded-full ring-2 ring-background">
              <Identicon name={p.username} size={28} />
              {p.isReady && (
                <span className="absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-[hsl(var(--tone-positive-ink))] text-background ring-2 ring-background">
                  <Check className="h-2.5 w-2.5" strokeWidth={3} />
                </span>
              )}
            </span>
          ))}
        </span>
        <span className="hidden whitespace-nowrap font-medium tabular-nums sm:inline">
          {participants.length > shown.length && `+${participants.length - shown.length} · `}
          {ready}/{participants.length} ready
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <p className="eyebrow px-2 pb-1 pt-1">In the room · {participants.length}</p>
        <ul className="max-h-72 overflow-y-auto">
          {participants.map((p) => (
            <li key={p.userId} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5">
              <span className="flex min-w-0 items-center gap-2">
                <Identicon name={p.username} size={24} />
                <span className="truncate text-sm font-medium">{p.username}</span>
              </span>
              {p.isReady ? (
                <span className="shrink-0 rounded-full bg-[hsl(var(--tone-positive-soft))] px-2 py-0.5 text-xs font-semibold text-[hsl(var(--tone-positive-ink))]">Ready</span>
              ) : (
                <span className="shrink-0 text-xs text-muted-foreground">Still going</span>
              )}
            </li>
          ))}
          {participants.length === 0 && <li className="px-2 py-1.5 text-sm text-muted-foreground">Nobody has joined yet.</li>}
        </ul>
      </PopoverContent>
    </Popover>
  )
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

  const [participants, setParticipants] = useState<Participant[]>([])
  const [isReady, setIsReady] = useState(false)
  const [isWarningDismissed, setIsWarningDismissed] = useState(false)
  // Which phase's layout a closed board is being read through. A closed board
  // holds its final content; the phases differ in how that content is arranged,
  // which is the part worth revisiting.
  const [archiveView, setArchiveView] = useState<LivePhase>('REVIEW')
  // Larger type for a projector or a shared screen. A per-viewer preference.
  const [largeText, setLargeText] = useState(false)
  // "Turn this card into an action" seeds the composer.
  const [actionSeed, setActionSeed] = useState<{ text: string; nonce: number } | null>(null)

  useEffect(() => {
    try { setLargeText(localStorage.getItem('retro-stage-text') === 'large') } catch {}
  }, [])
  const toggleLargeText = () => {
    setLargeText((v) => {
      try { localStorage.setItem('retro-stage-text', v ? 'normal' : 'large') } catch {}
      return !v
    })
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const phaseDuration =
    retro.status === 'INPUT' ? retro.inputDuration :
    retro.status === 'VOTING' ? retro.votingDuration :
    retro.status === 'REVIEW' ? retro.reviewDuration : null

  // Re-arm the extend prompt on a phase change, and again each time the
  // deadline moves — extending is a snooze, so it should warn again as the new
  // deadline approaches.
  const phaseDeadline = useMemo(() => {
    if (!phaseDuration || !retro.phaseStartTime) return null
    return new Date(retro.phaseStartTime).getTime() + phaseDuration * 60 * 1000
  }, [phaseDuration, retro.phaseStartTime])

  useEffect(() => {
    setIsWarningDismissed(false)
  }, [retro.status, phaseDeadline])

  // Who to join the board as, readable from the socket's connect handler, which
  // is set up once and would otherwise only ever see the first render's values.
  const joinAs = useRef<{ userId: string; username: string } | null>(null)

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

    // Join on every connection, not just the first. Socket.IO reconnects on its
    // own after a dropped connection — a laptop lid, a proxy timeout, a
    // redeploy — but the server sees a brand-new socket outside the board's
    // room. Actions still reached the server, so the phase moved for everyone
    // else, while this page never heard back: "Start voting" appeared to do
    // nothing, and it was always the long-open, gone-into-overtime board that
    // had lived through a reconnect. Rejoining also brings the page's board up
    // to date (the server sends current state on join).
    socketInstance.on('connect', () => {
      if (joinAs.current) {
        socketInstance.emit('join-retro', { retroId: retro.id, ...joinAs.current })
      }
    })

    socketInstance.on('retro-updated', (updatedRetro: RetroData) => {
      setRetro(updatedRetro)
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
      joinAs.current = isJoined && username ? { userId, username } : null
      if (isJoined && socket && username) {
          socket.emit('join-retro', { retroId: retro.id, userId, username })
      }
  }, [isJoined, socket, username, userId, retro.id])

  // Timer update effect
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  /**
   * How far this device's clock sits from the server's, in milliseconds.
   *
   * Phase starts are stamped by the server, so the clock has to be read
   * against the server's time. Otherwise a device — or a server — whose clock
   * is off shows a timer wrong by exactly that difference: a server running
   * behind opens a brand-new board deep in overtime, and a laptop running fast
   * watches every phase end early. Measured on every connect, because a
   * machine that has slept can come back with a different answer.
   */
  const [skew, setSkew] = useState(0)
  useEffect(() => {
    if (!socket) return
    const ask = () => socket.emit('time-check', { sentAt: Date.now() })
    const answer = ({ sentAt, serverTime }: { sentAt?: number; serverTime?: number }) => {
      if (typeof sentAt !== 'number' || typeof serverTime !== 'number') return
      setSkew(clockOffset(sentAt, serverTime, Date.now()))
    }
    socket.on('time-reply', answer)
    socket.on('connect', ask)
    if (socket.connected) ask()
    return () => {
      socket.off('time-reply', answer)
      socket.off('connect', ask)
    }
  }, [socket])

  /**
   * Timing for the current phase.
   *
   * The clock deliberately keeps running past the deadline rather than moving
   * the board on by itself: a phase ends when the facilitator says it does, so
   * a discussion in full flow isn't cut off mid-sentence. `remaining` goes
   * negative once the phase is in overtime.
   */
  const remainingSeconds = useMemo(
    () => (phaseDeadline === null || now === null ? null : Math.ceil((phaseDeadline - (now + skew)) / 1000)),
    [phaseDeadline, now, skew]
  )

  const isOvertime = remainingSeconds !== null && remainingSeconds < 0
  const phaseProgress =
    remainingSeconds === null || !phaseDuration ? null : 1 - remainingSeconds / (phaseDuration * 60)

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

  // The vote control sets an absolute count; the server takes a delta, so
  // work out the difference from this viewer's current votes on the item.
  const handleSetVote = (itemId: string, count: number) => {
    if (!socket) return
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

  /**
   * Move a card, optimistically, then tell the server. The position is "before
   * this card" (or the end) — see lib/board-order for why not an index.
   */
  const moveItem = (itemId: string, targetColumnId: string, beforeItemId: string | null) => {
    if (!socket) return
    setRetro((prev) => {
      const item = prev.columns.flatMap((c) => c.items).find((i) => i.id === itemId)
      if (!item) return prev
      const columns = prev.columns.map((c) => ({ ...c, items: c.items.filter((i) => i.id !== itemId) }))
      const target = columns.find((c) => c.id === targetColumnId)
      if (!target) return prev
      const byId = new Map([...target.items, item].map((i) => [i.id, i]))
      target.items = placeBefore(target.items.map((i) => i.id), itemId, beforeItemId).map((id) => byId.get(id)!)
      return { ...prev, columns }
    })
    socket.emit('move-item', { retroId: retro.id, itemId, targetColumnId, beforeItemId })
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    if (activeId === overId) return

    const overColumn = retro.columns.find((c) => c.id === overId)
    const dest = overColumn ?? retro.columns.find((c) => c.items.some((i) => i.id === overId))
    if (!dest) return

    let beforeItemId: string | null = null
    if (!overColumn) {
      const ids = dest.items.map((i) => i.id)
      const overIndex = ids.indexOf(overId)
      const activeIndex = ids.indexOf(activeId)
      // Dragging down within a column settles after the card you let go on —
      // that is what the sortable preview shows. Otherwise, before it.
      beforeItemId = activeIndex !== -1 && activeIndex < overIndex ? (ids[overIndex + 1] ?? null) : overId
    }
    moveItem(activeId, dest.id, beforeItemId)
  }

  const [pendingDelete, setPendingDelete] = useState<BoardItem | null>(null)
  const confirmDeleteItem = () => {
    if (!pendingDelete || !socket) return
    const id = pendingDelete.id
    setRetro((prev) => ({ ...prev, columns: prev.columns.map((c) => ({ ...c, items: c.items.filter((i) => i.id !== id) })) }))
    socket.emit('delete-item', { retroId: retro.id, itemId: id })
    setPendingDelete(null)
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

  // Every card, pooled and ranked — Review, Actions and the record use it. By
  // votes, unless the facilitator has arranged the review queue by hand.
  const ranked: ReviewEntry[] = useMemo(
    () =>
      orderedForReview(
        retro.columns
          .flatMap(col => col.items.map(item => ({ item, column: col })))
          .map(entry => ({
            ...entry,
            id: entry.item.id,
            total: entry.item.votes.reduce((acc, v) => acc + v.count, 0),
            reviewOrder: entry.item.reviewOrder,
          })),
      ),
    [retro.columns]
  )
  const queueIsArranged = useMemo(() => isCustomOrder(ranked.map((e) => e.item)), [ranked])

  const handleReorderReview = (itemId: string, delta: -1 | 1) => {
    socket?.emit('reorder-review', { retroId: retro.id, itemId, delta })
  }
  const handleDropInReview = (itemId: string, beforeItemId: string | null) => {
    socket?.emit('reorder-review', { retroId: retro.id, itemId, beforeItemId })
  }
  const handleResetReviewOrder = () => {
    socket?.emit('reset-review-order', { retroId: retro.id })
  }

  if (!isJoined) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background p-6">
        <div className="w-full max-w-sm">
          <LogoMark className="h-10 w-10" />
          <h1 className="mt-6 text-3xl font-semibold tracking-tight">Join the session</h1>
          <p className="mt-2 text-muted-foreground">Your name is shown on your cards, unless the board is anonymous.</p>
          <div className="mt-6 grid gap-3">
            <Input
              placeholder="Enter your name"
              aria-label="Your name"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="h-12 bg-card text-base"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && username.trim()) {
                  localStorage.setItem('retro-username', username)
                  setIsJoined(true)
                }
              }}
            />
            <Button
              className="h-12 gap-2 text-base"
              disabled={!username.trim()}
              onClick={() => {
                localStorage.setItem('retro-username', username)
                setIsJoined(true)
              }}
            >
              Join <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const status = retro.status
  const closed = status === 'CLOSED'
  const phaseTone = PHASE_TONE[status] ?? 'neutral'
  const PhaseIcon = PHASE_ICON[status] ?? Archive
  const next = NEXT_STEP[status]
  const readyCount = participants.filter((p) => p.isReady).length
  const laneFill = status === 'INPUT' || status === 'VOTING' || status === 'REVIEW'

  // --- The phase content -----------------------------------------------------

  const renderLiveCard = (item: BoardItem, column: BoardColumn) => {
    const mine = item.votes.find(v => v.userId === userId)?.count || 0
    const editing = editingItems[item.id] !== undefined
    // Moving and deleting belong to the Input phase, and to the people who
    // may edit the card. The server enforces the same rule.
    const canArrange = status === 'INPUT' && canEditItem(item)
    const visibleIds = column.items.map((i) => i.id)
    const up = neighbourFor(visibleIds, item.id, 'up')
    const down = neighbourFor(visibleIds, item.id, 'down')
    const otherColumns = retro.columns.filter((c) => c.id !== column.id)
    const preview = item.content.length > 40 ? `${item.content.slice(0, 40)}…` : item.content
    return (
      <SortableItem key={item.id} id={item.id} disabled={!canArrange}>
        {(handle) => (
        <article
          className={cn(
            'group space-y-2 rounded-xl bg-note p-2.5 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-lift)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95',
            status === 'VOTING' && mine > 0 && 'ring-2 ring-[hsl(var(--vote))]',
          )}
        >
          {editing ? (
            <div className="flex flex-col gap-2" onPointerDown={(e) => e.stopPropagation()}>
              <Textarea
                value={editingItems[item.id]}
                onChange={(e) => setEditingItems(prev => ({ ...prev, [item.id]: e.target.value }))}
                className="min-h-[70px] text-sm"
                aria-label="Edit card"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => cancelEditItem(item.id)} aria-label="Cancel edit">
                  <X className="h-4 w-4" />
                </Button>
                <Button size="sm" onClick={() => saveEditItem(item.id)} disabled={!editingItems[item.id]?.trim()} aria-label="Save card">
                  <Check className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="whitespace-pre-wrap px-0.5 text-[length:var(--card-text)] leading-snug">
              <MentionText text={item.content} names={mentionNames} />
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <Author name={item.username} anonymous={retro.isAnonymous} />
            {!editing && canArrange && (
              // Always visible, not on hover: moving a card was possible
              // before, and nobody could find it.
              <div className="-my-1 -mr-1 flex shrink-0 items-center">
                {handle && (
                  <button
                    type="button"
                    ref={handle.ref}
                    {...handle.props}
                    aria-label={`Drag to move: ${preview}`}
                    title="Drag to move"
                    className="grid h-7 w-7 cursor-grab touch-none place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                  >
                    <GripVertical className="h-4 w-4" />
                  </button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Card options: ${preview}`}
                      title="Edit, move or delete"
                      className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onSelect={() => startEditItem(item.id, item.content)}>
                      <Pencil className="mr-2 h-4 w-4" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={up === undefined} onSelect={() => up !== undefined && moveItem(item.id, column.id, up)}>
                      <ArrowUp className="mr-2 h-4 w-4" /> Move up
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={down === undefined} onSelect={() => down !== undefined && moveItem(item.id, column.id, down)}>
                      <ArrowDown className="mr-2 h-4 w-4" /> Move down
                    </DropdownMenuItem>
                    {otherColumns.length > 0 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground">Move to</DropdownMenuLabel>
                        {otherColumns.map((c) => (
                          <DropdownMenuItem key={c.id} onSelect={() => moveItem(item.id, c.id, null)}>
                            <CornerDownRight className="mr-2 h-4 w-4" /> {c.title}
                          </DropdownMenuItem>
                        ))}
                      </>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => setPendingDelete(item)}
                      className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
            {!editing && !canArrange && canEditItem(item) && (
              <button
                type="button"
                aria-label="Edit item"
                className="-m-1 shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
                onClick={() => startEditItem(item.id, item.content)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {status === 'VOTING' && (
            <>
              <ReactionBar
                reactions={item.reactions ?? []}
                userId={userId}
                onToggle={(emoji) => handleToggleReaction(item.id, emoji)}
              />
              <VoteMeter mine={mine} remaining={votesRemaining} onSet={(n) => handleSetVote(item.id, n)} />
            </>
          )}
        </article>
        )}
      </SortableItem>
    )
  }

  const lanes = (
    <>
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <LaneRow fill>
        {retro.columns.map((column) => (
          <Lane
            key={column.id}
            column={column}
            scroll
            hiddenCount={retro.blindInput && status === 'INPUT' ? column.hiddenItemCount : undefined}
            footer={status === 'INPUT' ? (
              <div className="relative">
                <MentionInput
                  multiline
                  placeholder="Add a card… (@ to mention)"
                  ariaLabel={`Add a card to ${column.title}`}
                  menuPlacement="above"
                  value={newItemContent[column.id] || ''}
                  onChange={(v) => setNewItemContent(prev => ({ ...prev, [column.id]: v }))}
                  suggestions={mentionNames}
                  className="min-h-[72px] resize-none rounded-xl border-transparent bg-card pr-12 shadow-[var(--shadow-card)]"
                  onEnter={() => handleAddItem(column.id)}
                />
                <Button
                  size="icon"
                  className="absolute bottom-2 right-2 h-8 w-8 rounded-lg"
                  onClick={() => handleAddItem(column.id)}
                  disabled={!newItemContent[column.id]?.trim()}
                  aria-label={`Add card to ${column.title}`}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            ) : undefined}
          >
            <LaneDropZone id={column.id} enabled={status === 'INPUT'}>
              <SortableContext
                items={column.items.map(i => i.id)}
                strategy={verticalListSortingStrategy}
                disabled={status !== 'INPUT'}
              >
                {column.items.map((item) => renderLiveCard(item, column))}
              </SortableContext>
            </LaneDropZone>
            {column.items.length === 0 && status !== 'INPUT' && (
              <p className="rounded-xl border border-dashed border-foreground/15 p-3 text-center text-xs text-muted-foreground">
                Nothing raised here
              </p>
            )}
          </Lane>
        ))}
      </LaneRow>
    </DndContext>
    <Dialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete this card?</DialogTitle>
          <DialogDescription>It disappears for everyone on the board. This can&apos;t be undone.</DialogDescription>
        </DialogHeader>
        {pendingDelete && (
          <blockquote className="whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm">{pendingDelete.content}</blockquote>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setPendingDelete(null)}>Keep it</Button>
          <Button variant="destructive" onClick={confirmDeleteItem} className="gap-2">
            <Trash2 className="h-4 w-4" /> Delete card
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )

  const actionsStage = (
    <div className="grid gap-6 @min-[60rem]/stage:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <section aria-labelledby="top-heading" className="min-w-0">
        <h2 id="top-heading" className="mb-3 flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Star className="h-5 w-5 fill-[hsl(var(--tone-risk))] text-[hsl(var(--tone-risk))]" aria-hidden />
          What rose to the top
        </h2>
        <ol className="space-y-2">
          {ranked.slice(0, 5).map(({ item, column, total }, i) => {
            const tone = toneOf(column.type)
            return (
              <li
                key={item.id}
                className="group rounded-xl bg-card p-3 shadow-[var(--shadow-card)]"
                style={{ boxShadow: `inset 3px 0 0 hsl(var(--tone-${tone})), var(--shadow-card)` }}
              >
                <div className="flex items-start gap-3">
                  <span className="pt-0.5 font-mono text-sm font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="whitespace-pre-wrap text-[length:var(--card-text)] font-medium leading-snug">
                      <MentionText text={item.content} names={mentionNames} />
                    </div>
                    {item.summary && (
                      <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted px-2.5 py-1.5 text-sm text-muted-foreground">{item.summary}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-1 text-xs font-bold tabular-nums text-[hsl(var(--tone-risk-ink))]">
                        <Star className="h-3 w-3 fill-current" aria-hidden /> {total} vote{total === 1 ? '' : 's'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setActionSeed({ text: item.content, nonce: Date.now() })}
                        className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-primary hover:bg-accent"
                      >
                        Turn into an action <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
          {ranked.length === 0 && (
            <li className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No cards were raised.</li>
          )}
        </ol>
      </section>
      <section aria-labelledby="do-heading" className="min-w-0">
        <h2 id="do-heading" className="mb-3 flex items-center gap-2 text-lg font-semibold tracking-tight">
          <ListTodo className="h-5 w-5 text-[hsl(var(--tone-positive-ink))]" aria-hidden />
          What we&apos;ll do
          <span className="ml-auto text-sm font-medium tabular-nums text-muted-foreground">{retro.actions?.length ?? 0} agreed</span>
        </h2>
        <ActionComposer suggestions={mentionNames} onAdd={handleAddActionItem} seed={actionSeed} />
        <ul className="mt-3 space-y-2">
          {retro.actions?.map((action, i) => (
            <ActionCard
              key={action.id}
              action={action}
              index={i + 1}
              names={mentionNames}
              jiraConfigured={Boolean(retro.team?.jiraConfigured)}
              // Editable while the team is still drafting the list; after the
              // phase it is the record.
              onUpdate={status === 'ACTIONS' ? (data) => socket?.emit('update-action-item', { retroId: retro.id, actionId: action.id, ...data }) : undefined}
              onDelete={status === 'ACTIONS' ? () => socket?.emit('delete-action-item', { retroId: retro.id, actionId: action.id }) : undefined}
            />
          ))}
        </ul>
      </section>
    </div>
  )

  // A closed board keeps its final content. The phases differ in how that
  // content is arranged, and that arrangement is the part worth revisiting —
  // so the record is readable through each of them rather than only the
  // pooled Review layout.
  const totalVotes = ranked.reduce((acc, e) => acc + e.total, 0)
  const doneActions = retro.actions?.filter((a) => a.completed).length ?? 0
  const record = (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <section className="rounded-2xl border bg-card p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow flex items-center gap-1.5"><Archive className="h-3.5 w-3.5" aria-hidden /> The record</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">This retrospective is closed</h2>
            <p className="text-sm text-muted-foreground">
              Kept as a read-only record. Action items can still be ticked off.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-2" asChild>
              <Link href="/history"><ArrowLeft className="h-4 w-4" /> All retrospectives</Link>
            </Button>
            <Button size="sm" onClick={handleExportPDF} className="gap-2">
              <Download className="h-4 w-4" /> Export report
            </Button>
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-3 divide-x border-t pt-4">
          {[
            { label: 'Cards', value: ranked.length },
            { label: 'Votes', value: totalVotes },
            { label: 'Actions done', value: `${doneActions}/${retro.actions?.length ?? 0}` },
          ].map((f) => (
            <div key={f.label} className="px-4 first:pl-0">
              <dt className="text-xs font-medium text-muted-foreground">{f.label}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{f.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border bg-card p-0.5 shadow-[var(--shadow-card)]" role="tablist" aria-label="View this retrospective as">
          {LIVE_PHASES.map((phase) => (
            <button
              key={phase}
              type="button"
              role="tab"
              aria-selected={archiveView === phase}
              onClick={() => setArchiveView(phase)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                archiveView === phase
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {PHASE_LABEL[phase]}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Shows the final content in each phase&apos;s layout — not a snapshot of that moment.
        </p>
      </div>

      <div role="tabpanel" aria-label={PHASE_LABEL[archiveView]}>
        {(archiveView === 'INPUT' || archiveView === 'VOTING') ? (
          // As raised: cards stay in their lanes, in the order the team put them in.
          <LaneRow>
            {retro.columns.map((column) => (
              <Lane key={column.id} column={column}>
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
                  <p className="rounded-xl border border-dashed border-foreground/15 p-3 text-center text-xs text-muted-foreground">
                    Nothing raised here
                  </p>
                )}
              </Lane>
            ))}
          </LaneRow>
        ) : archiveView === 'REVIEW' ? (
          // As discussed: pooled across columns, highest-voted first.
          <div className="mx-auto w-full max-w-3xl space-y-2">
            {ranked.map(({ item, column }) => (
              <ArchivedItem
                key={item.id}
                item={item}
                column={column}
                showVotes
                showColumn
                names={mentionNames}
                anonymous={retro.isAnonymous}
              />
            ))}
            {ranked.length === 0 && (
              <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                No cards were raised in this retrospective.
              </div>
            )}
          </div>
        ) : (
          // What the team agreed to do about it.
          <div className="mx-auto w-full max-w-3xl">
            {retro.actions && retro.actions.length > 0 ? (
              <ul className="space-y-2">
                {retro.actions.map((action) => (
                  <ActionCard
                    key={action.id}
                    action={action}
                    names={mentionNames}
                    jiraConfigured={Boolean(retro.team?.jiraConfigured)}
                    // Still togglable: actions outlive the session that produced them.
                    onToggle={() => {
                      if (socket) {
                        socket.emit('toggle-action-item', { retroId: retro.id, actionId: action.id })
                      }
                    }}
                  />
                ))}
              </ul>
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                No action items recorded.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )

  // --- The clock --------------------------------------------------------------

  const clock = remainingSeconds !== null && (() => {
    const over = remainingSeconds < 0
    const abs = Math.abs(remainingSeconds)
    const minutes = Math.floor(abs / 60)
    const seconds = abs % 60
    const isLowTime = !over && remainingSeconds < 60
    // Doubles as a snooze: dismissing hides it until the deadline moves;
    // snoozing gives five minutes from the later of the deadline and now, so
    // in overtime it means five minutes from now (lib/phase-timer).
    const showPrompt = isOwner && (isLowTime || over) && !isWarningDismissed

    return (
      // Not positioned: the snooze prompt anchors to the console, so it can
      // never hang off the side of a narrow screen.
      <div className="flex flex-col">
        <span className={cn('eyebrow', over && '!text-destructive')}>
          {over ? 'Overtime' : 'Time Remaining'}
        </span>
        <span
          role="timer"
          className={cn(
            'font-mono text-3xl font-bold leading-none tabular-nums tracking-tight',
            over ? 'text-destructive' : isLowTime ? 'text-destructive motion-safe:animate-pulse' : 'text-foreground'
          )}
        >
          {over ? '-' : ''}{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </span>
        {showPrompt && (
          <div className="absolute bottom-full left-4 z-50 mb-3 w-80 max-w-[calc(100%-2rem)] rounded-2xl sm:left-6 border bg-popover p-4 shadow-[var(--shadow-lift)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2">
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="font-semibold text-destructive">
                {over ? 'This phase is in overtime' : 'Less than a minute left'}
              </p>
              <button
                onClick={() => setIsWarningDismissed(true)}
                className="-mr-1 -mt-1 rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
  })()

  const NextIcon = next?.icon

  return (
    <div
      className="flex h-dvh flex-col bg-background"
      style={{
        ['--card-text' as string]: largeText ? '1.125rem' : '0.9375rem',
        ['--spot-text' as string]: largeText ? '2.5rem' : 'clamp(1.5rem, 2.2vw, 2rem)',
      }}
    >
      {/* The stage header: what this is, where it is, who is here. The top
          edge carries the phase's colour so the room can tell from afar. */}
      <header
        className="border-b bg-card/70 px-4 py-3 backdrop-blur sm:px-6"
        style={{ boxShadow: `inset 0 3px 0 hsl(var(--tone-${phaseTone}))` }}
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-1 basis-72 items-center gap-3">
            <Link
              href="/"
              aria-label="Back to home"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{retro.title}</h1>
              <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {retro.team ? (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <TeamMark team={retro.team} size={18} />
                    <span className="truncate">{retro.team.name}</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5"><Globe className="h-4 w-4" aria-hidden /> Open board</span>
                )}
                {retro.isAnonymous && (
                  <span className="flex items-center gap-1 text-xs"><EyeOff className="h-3.5 w-3.5" aria-hidden /> Anonymous board</span>
                )}
              </p>
            </div>
          </div>

          {closed ? (
            <span className="rounded-full bg-[hsl(var(--tone-neutral-soft))] px-3 py-1 text-sm font-semibold text-[hsl(var(--tone-neutral-ink))]">
              Closed
            </span>
          ) : (
            <PhaseTrack status={status} progress={phaseProgress} className="w-full max-w-md basis-80" />
          )}

          <div className="flex items-center gap-1">
            {!closed && <Presence participants={participants} />}
            <button
              type="button"
              onClick={toggleLargeText}
              aria-pressed={largeText}
              aria-label="Larger text for a shared screen"
              title="Larger text for a shared screen"
              className={cn(
                'grid h-9 w-9 place-items-center rounded-lg transition-colors',
                largeText ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Type className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {accessDenied && (
        <div role="alert" className="flex items-center gap-2 border-b bg-[hsl(var(--tone-negative-soft))] px-4 py-2.5 text-sm font-medium text-[hsl(var(--tone-negative-ink))] sm:px-6">
          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
          That action wasn&apos;t permitted. You may not have the right access on this board.
        </div>
      )}

      {/* The stage itself. Every layout decision below is a container query
          on this box — the rail's state changes its width, the window's
          doesn't tell you anything. */}
      <div className="@container/stage min-h-0 flex-1 overflow-y-auto">
        <div className={cn(
          'mx-auto flex max-w-[120rem] flex-col gap-4 p-4 sm:p-6',
          laneFill && '@min-[64rem]/stage:h-full',
          '@min-[64rem]/stage:flex-row',
        )}>
          {/* Open actions the team still owes from earlier retros. */}
          {retro.team && !closed && (
            <CarriedOverPanel retroId={retro.id} names={mentionNames} />
          )}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            {retro.blindInput && status === 'INPUT' && (
              <p className="flex items-start gap-2 rounded-xl bg-[hsl(var(--tone-review-soft))] px-3 py-2 text-sm text-[hsl(var(--tone-review-ink))]">
                <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  <span className="font-semibold">Blind input.</span>{' '}
                  You can only see your own cards until the input phase ends — so nobody&apos;s
                  thinking is anchored by what has already been written.
                </span>
              </p>
            )}

            {status === 'REVIEW' ? (
              <ReviewStage
                entries={ranked}
                anonymous={retro.isAnonymous}
                names={mentionNames}
                userId={userId}
                canEdit={canEditItem}
                onReact={handleToggleReaction}
                onSummary={handleUpdateSummary}
                canReorder={isOwner}
                customOrder={queueIsArranged}
                onReorder={handleReorderReview}
                onDropBefore={handleDropInReview}
                onResetOrder={handleResetReviewOrder}
              />
            ) : status === 'ACTIONS' ? actionsStage : closed ? record : lanes}
          </div>
        </div>
      </div>

      {/* The console: the clock and every control the phase needs, docked
          where the eye returns to. Nothing to control on a closed board. */}
      {!closed && (
        <footer aria-label="Session controls" className="relative border-t bg-card px-4 py-3 shadow-[0_-8px_24px_-20px_rgb(0_0_0/0.5)] sm:px-6">
          <div className="mx-auto flex max-w-[120rem] flex-wrap items-center gap-x-8 gap-y-3">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
                style={{ background: `hsl(var(--tone-${phaseTone}-soft))`, color: `hsl(var(--tone-${phaseTone}-ink))` }}
              >
                <PhaseIcon className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {PHASE_LABEL[status] ?? status}
                  <span className="font-normal text-muted-foreground"> · step {LIVE_PHASES.indexOf(status as LivePhase) + 1} of 4</span>
                </p>
                <p className="hidden max-w-xs text-xs text-muted-foreground lg:block">{PHASE_HINT[status]}</p>
              </div>
            </div>

            {clock}

            {status === 'VOTING' && (
              <div className="flex flex-col gap-1.5">
                <span className="eyebrow">Your votes left</span>
                <span className="flex items-center gap-2">
                  <span className="flex gap-0.5" aria-hidden>
                    {Array.from({ length: 10 }, (_, i) => (
                      <span
                        key={i}
                        className={cn('h-4 w-2 rounded-sm', i < votesRemaining ? 'bg-[hsl(var(--vote))]' : 'bg-muted-foreground/20')}
                      />
                    ))}
                  </span>
                  <span className={cn('text-lg font-bold tabular-nums leading-none', votesRemaining > 0 ? 'text-[hsl(var(--tone-risk-ink))]' : 'text-muted-foreground')}>
                    {votesRemaining}
                    <span className="sr-only"> of 10 votes remaining</span>
                  </span>
                </span>
              </div>
            )}

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {(status === 'INPUT' || status === 'VOTING') && (
                <Button
                  variant="outline"
                  aria-pressed={isReady}
                  className={cn(
                    'gap-2',
                    isReady && 'border-transparent bg-[hsl(var(--tone-positive-soft))] text-[hsl(var(--tone-positive-ink))] hover:bg-[hsl(var(--tone-positive-soft))] hover:text-[hsl(var(--tone-positive-ink))]',
                  )}
                  onClick={handleToggleReady}
                >
                  <Check className={cn('h-4 w-4', !isReady && 'opacity-40')} />
                  {isReady ? "I'm ready" : 'Mark me ready'}
                </Button>
              )}
              {isOwner && next && NextIcon && (
                <>
                  {(status === 'INPUT' || status === 'VOTING') && participants.length > 0 && (
                    <span className="hidden px-2 text-sm tabular-nums text-muted-foreground sm:inline">
                      <span className="font-semibold text-foreground">{readyCount}</span> of {participants.length} ready
                    </span>
                  )}
                  <Button
                    variant={status === 'ACTIONS' ? 'destructive' : 'default'}
                    onClick={() => handleUpdateStatus(next.to)}
                    className={cn('h-10 gap-2 px-4', isOvertime && 'ring-2 ring-destructive ring-offset-2 ring-offset-card')}
                  >
                    <NextIcon className="h-4 w-4" /> {next.label}
                  </Button>
                </>
              )}
            </div>
          </div>
        </footer>
      )}
    </div>
  )
}
