'use client'

import { useEffect, useState, useMemo } from 'react'
import { io, Socket } from 'socket.io-client'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Star, ThumbsUp, Send, LayoutDashboard, Play, Eye, ListTodo, Archive, Download, Users } from 'lucide-react'
import { cn } from "@/lib/utils"
import { ModeToggle } from "@/components/mode-toggle"
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
  }
  columns: {
    id: string
    title: string
    type: string
    items: {
      id: string
      content: string
      summary: string | null
      username: string
      votes: { userId: string, count: number }[]
      reactions?: { userId: string, emoji: string }[]
    }[]
  }[]
  actions: {
    id: string
    content: string
    completed: boolean
  }[]
  inputDuration?: number | null
  votingDuration?: number | null
  reviewDuration?: number | null
  phaseStartTime?: string | null // Dates come as strings from JSON
  isAnonymous: boolean
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

export default function RetroBoard({ initialData, user }: { initialData: RetroData, user?: { name?: string | null, email?: string | null } }) {
  const [retro, setRetro] = useState<RetroData>(initialData)
  const [socket, setSocket] = useState<Socket | null>(null)
  const [newItemContent, setNewItemContent] = useState<Record<string, string>>({})
  const [userId, setUserId] = useState<string>('')
  const [username, setUsername] = useState<string>('')
  const [isJoined, setIsJoined] = useState(false)

  const [participants, setParticipants] = useState<{ userId: string, username: string, isReady: boolean }[]>([])
  const [isReady, setIsReady] = useState(false)
  const [isWarningDismissed, setIsWarningDismissed] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Reset warning dismissal on phase change
  useEffect(() => {
    setIsWarningDismissed(false)
  }, [retro.status])

  useEffect(() => {
    // Generate or retrieve userId
    let storedUserId = localStorage.getItem('retro-user-id')
    if (!storedUserId) {
      storedUserId = crypto.randomUUID()
      localStorage.setItem('retro-user-id', storedUserId)
    }
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
        const myParticipant = updatedParticipants.find(p => p.userId === storedUserId)
        if (myParticipant) {
            setIsReady(myParticipant.isReady)
        }
    })

    return () => {
      socketInstance.disconnect()
    }
  }, [retro.id, user]) // We might need to re-run if isJoined changes

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

  // Auto-advance logic
  const hasAutoAdvancedRef = useMemo(() => ({ current: false }), [retro.status]) // Reset on status change

  useEffect(() => {
      if (!isJoined || !retro.phaseStartTime || !now) return

      const currentDuration = 
          retro.status === 'INPUT' ? retro.inputDuration :
          retro.status === 'VOTING' ? retro.votingDuration :
          retro.status === 'REVIEW' ? retro.reviewDuration : null;

      if (currentDuration) {
          const startTime = new Date(retro.phaseStartTime).getTime();
          const endTime = startTime + currentDuration * 60 * 1000;
          const diff = Math.ceil((endTime - now) / 1000);
          
          if (diff <= 0 && !hasAutoAdvancedRef.current) {
              // Time is up!
              // Only owner triggers the advance to avoid race conditions
              if (retro.creator === username) {
                  hasAutoAdvancedRef.current = true;
                  
                  let nextStatus = '';
                  if (retro.status === 'INPUT') nextStatus = 'VOTING';
                  else if (retro.status === 'VOTING') nextStatus = 'REVIEW';
                  else if (retro.status === 'REVIEW') nextStatus = 'ACTIONS';
                  
                  if (nextStatus && socket) {
                      socket.emit('update-status', { retroId: retro.id, status: nextStatus });
                  }
              }
          }
      }
  }, [now, retro, username, isJoined, socket, hasAutoAdvancedRef])

  const handleAddItem = (columnId: string) => {
    const content = newItemContent[columnId]
    if (!socket || !content?.trim()) return
    socket.emit('add-item', { retroId: retro.id, columnId, content: content, userId, username })
    setNewItemContent(prev => ({ ...prev, [columnId]: '' }))
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

  const handleUpdateSummary = (itemId: string, summary: string) => {
    if (!socket) return
    socket.emit('update-item-summary', { retroId: retro.id, itemId, summary })
  }

  const handleAddActionItem = (content: string) => {
    if (!socket || !content.trim()) return
    socket.emit('add-action-item', { retroId: retro.id, content })
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
  const isOwner = retro.creator === username

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
                className="h-11 bg-blue-600 hover:bg-blue-700 text-white transition-colors"
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex">
      {/* Main Board Area */}
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-8 bg-white dark:bg-slate-900 p-6 rounded-lg shadow-sm border border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50">{retro.title}</h1>
                    {retro.team && (
                        <div className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                            <Users className="w-4 h-4" />
                            {retro.team.name}
                        </div>
                    )}
                </div>
                <ModeToggle />
            </div>
            <div className="flex items-center gap-6">
                <div className="flex flex-col items-end">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</span>
                    <span className="text-lg font-bold">{retro.status}</span>
                </div>
                
                {/* Timer Display */}
                {(() => {
                    const currentDuration = 
                        retro.status === 'INPUT' ? retro.inputDuration :
                        retro.status === 'VOTING' ? retro.votingDuration :
                        retro.status === 'REVIEW' ? retro.reviewDuration : null;
                    
                    if (currentDuration && retro.phaseStartTime && now) {
                        const startTime = new Date(retro.phaseStartTime).getTime();
                        const endTime = startTime + currentDuration * 60 * 1000;
                        const diff = Math.max(0, Math.ceil((endTime - now) / 1000));
                        
                        const minutes = Math.floor(diff / 60);
                        const seconds = diff % 60;
                        const isLowTime = diff < 60 && diff > 0;
                        const isTimeUp = diff === 0;

                        // Auto-advance logic for owner
                        if (isOwner && isTimeUp && retro.status !== 'ACTIONS' && retro.status !== 'CLOSED') {
                             // Logic handled in useEffect
                        }

                        return (
                            <div className="flex flex-col items-end relative">
                                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Time Remaining</span>
                                <span className={cn(
                                    "text-2xl font-black font-mono",
                                    isLowTime ? "text-red-500 animate-pulse" : 
                                    isTimeUp ? "text-red-600" : "text-gray-700 dark:text-gray-300"
                                )}>
                                    {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
                                </span>
                                {isOwner && isLowTime && !isWarningDismissed && (
                                    <div className="absolute top-full mt-4 right-0 w-80 bg-white dark:bg-slate-900 p-6 rounded-xl shadow-2xl border-2 border-red-200 dark:border-red-900 z-50 animate-in fade-in slide-in-from-top-4 zoom-in-95">
                                        <div className="flex justify-between items-start mb-4">
                                            <div className="flex items-center gap-2">
                                                <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-full">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-600 dark:text-red-400"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                                </div>
                                                <p className="text-lg font-bold text-red-600 dark:text-red-400">Time is running out!</p>
                                            </div>
                                            <button 
                                                onClick={() => setIsWarningDismissed(true)}
                                                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
                                            >
                                                <span className="sr-only">Dismiss</span>
                                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 18 12"/></svg>
                                            </button>
                                        </div>
                                        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                                            Less than 1 minute remaining in this phase. Would you like to extend the time?
                                        </p>
                                        <Button 
                                            size="lg" 
                                            variant="destructive"
                                            className="w-full h-12 text-base font-bold shadow-md hover:shadow-lg transition-all"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (socket) {
                                                    socket.emit('extend-timer', { retroId: retro.id });
                                                    setIsWarningDismissed(true); // Dismiss after extending
                                                }
                                            }}
                                        >
                                            Extend by 5 Minutes
                                        </Button>
                                    </div>
                                )}
                            </div>
                        );
                    }
                    return null;
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
                            <Button onClick={() => handleUpdateStatus('VOTING')} className="bg-blue-600 hover:bg-blue-700 gap-2">
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
                            <Button onClick={() => handleUpdateStatus('REVIEW')} className="bg-blue-600 hover:bg-blue-700 gap-2">
                                <Eye className="w-4 h-4" /> Start Review
                            </Button>
                        )}
                    </div>
                )}
                {retro.status === 'REVIEW' && isOwner && (
                <Button onClick={() => handleUpdateStatus('ACTIONS')} className="bg-blue-600 hover:bg-blue-700 gap-2">
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
            <div className="space-y-6 max-w-4xl mx-auto">
                {retro.columns
                .flatMap(col => col.items)
                .sort((a, b) => {
                    const votesA = a.votes.reduce((acc, v) => acc + v.count, 0)
                    const votesB = b.votes.reduce((acc, v) => acc + v.count, 0)
                    return votesB - votesA
                })
                .map((item) => {
                    const totalVotes = item.votes.reduce((acc, v) => acc + v.count, 0)
                    return (
                    <Card key={item.id} className="shadow-sm hover:shadow-md transition-shadow duration-300 border-l-4 border-l-blue-500">
                        <CardContent className="p-6">
                        <div className="flex justify-between items-start mb-4">
                            <div className="text-xl font-medium leading-relaxed">{item.content}</div>
                            <div className="flex items-center gap-1 text-yellow-500 font-bold bg-yellow-50 dark:bg-yellow-900/20 px-3 py-1 rounded-full">
                            <Star className="w-5 h-5 fill-current" /> {totalVotes}
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Summary / Notes</label>
                            <Textarea 
                            placeholder="Add summary..." 
                            value={item.summary || ''}
                            onChange={(e) => handleUpdateSummary(item.id, e.target.value)}
                            className="min-h-[100px] resize-y"
                            />
                        </div>
                        </CardContent>
                    </Card>
                    )
                })}
            </div>

            ) : retro.status === 'ACTIONS' ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="space-y-6">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                    <Star className="w-6 h-6 text-yellow-500 fill-yellow-500" />
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
                        <Card key={item.id} className="border-l-4 border-l-yellow-500 shadow-sm">
                        <CardContent className="p-5">
                            <div className="flex justify-between items-start">
                            <div className="font-medium text-lg">{item.content}</div>
                            <div className="flex items-center gap-1 text-yellow-600 font-bold">
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
                    <Card key={action.id} className="border-l-4 border-l-green-500 shadow-sm">
                        <CardContent className="p-5 font-medium">
                        {action.content}
                        </CardContent>
                    </Card>
                    ))}
                </div>
                <div className="flex gap-3 bg-white dark:bg-gray-900 p-4 rounded-xl shadow-sm border">
                    <Input 
                    placeholder="New action item..." 
                    className="flex-1"
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                        handleAddActionItem(e.currentTarget.value)
                        e.currentTarget.value = ''
                        }
                    }}
                    />
                    <Button 
                    onClick={(e) => {
                    const input = e.currentTarget.previousElementSibling as HTMLInputElement
                    handleAddActionItem(input.value)
                    input.value = ''
                    }}>Add</Button>
                </div>
                </div>
            </div>
            ) : retro.status === 'CLOSED' ? (
            <div className="space-y-8">
                <div className="bg-gray-100 dark:bg-gray-800 p-8 rounded-2xl text-center border-2 border-dashed border-gray-300 dark:border-gray-700">
                <h2 className="text-3xl font-bold text-gray-500">Retrospective Closed</h2>
                <p className="text-muted-foreground mt-2">This session is read-only.</p>
                <div className="mt-6">
                    <Link href="/">
                        <Button variant="outline" className="gap-2">
                            <LayoutDashboard className="w-4 h-4" />
                            Return to Dashboard
                        </Button>
                    </Link>
                    <Button onClick={handleExportPDF} className="gap-2 ml-4">
                        <Download className="w-4 h-4" />
                        Export Full Report
                    </Button>
                </div>
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div>
                    <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                        <ThumbsUp className="w-5 h-5 text-green-500" />
                        Action Items
                    </h3>
                    <div className="space-y-4">
                    {retro.actions && retro.actions.length > 0 ? (
                        retro.actions.map((action) => (
                        <Card key={action.id} className="border-l-4 border-l-green-500">
                            <CardContent className="p-4 font-medium flex items-center gap-3">
                                <input 
                                    type="checkbox" 
                                    checked={action.completed} 
                                    className="w-5 h-5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                                    onChange={() => {
                                        if (socket) {
                                            socket.emit('toggle-action-item', { retroId: retro.id, actionId: action.id })
                                        }
                                    }}
                                />
                                <span className={cn(action.completed && "line-through text-muted-foreground")}>
                                    {action.content}
                                </span>
                            </CardContent>
                        </Card>
                        ))
                    ) : (
                        <div className="text-muted-foreground italic p-4 border border-dashed rounded-lg text-center">
                            No action items recorded.
                        </div>
                    )}
                    </div>
                </div>
                <div>
                    <h3 className="text-xl font-bold mb-4">Summary</h3>
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
                            <Card key={item.id}>
                                <CardContent className="p-4">
                                <div className="flex justify-between items-start">
                                    <div className="font-medium">{item.content}</div>
                                    <div className="flex items-center gap-1 text-yellow-600 font-bold">
                                    <Star className="w-4 h-4 fill-current" /> {totalVotes}
                                    </div>
                                </div>
                                {item.summary && (
                                    <div className="mt-2 text-sm text-muted-foreground bg-muted p-2 rounded">
                                    {item.summary}
                                    </div>
                                )}
                                </CardContent>
                            </Card>
                            )
                        })}
                    </div>
                </div>
                </div>
            </div>
            ) : (
            <DndContext 
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragEnd={handleDragEnd}
            >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[calc(100vh-180px)]">
            {retro.columns.map((column) => (
                <Card key={column.id} className="h-full flex flex-col bg-slate-50/50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 shadow-none">
                <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-t-lg">
                    <CardTitle className={cn(
                        "text-sm font-bold uppercase tracking-wider py-1 px-3 rounded-full w-fit border",
                        (column.type === 'START' || column.type === 'WHAT_WENT_WELL') && "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800",
                        (column.type === 'STOP' || column.type === 'WHAT_DIDNT_GO_WELL') && "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800",
                        (column.type === 'CONTINUE' || column.type === 'WHAT_SHOULD_BE_IMPROVED') && "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800",
                    )}>
                        {column.title}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 overflow-y-auto space-y-4 p-4">
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
                        <Card className="bg-white dark:bg-gray-800 shadow-sm hover:shadow-md transition-shadow duration-200 border-0">
                            <CardContent className="p-4 space-y-3">
                            <div className="whitespace-pre-wrap text-sm leading-relaxed">{item.content}</div>
                            <div className="flex flex-col gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
                                <div className="text-xs font-medium text-muted-foreground bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-full w-fit">
                                    {retro.isAnonymous ? "Anonymous" : item.username}
                                </div>
                                
                                {retro.status === 'VOTING' ? (
                                <div className="flex flex-col gap-1 w-full">
                                    <span className="text-[10px] uppercase font-bold text-muted-foreground">Your Votes</span>
                                    <div className="flex flex-wrap gap-1">
                                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => (
                                            <button
                                                key={star}
                                                onClick={() => {
                                                    // If clicking the same star count, maybe toggle off? Or just set.
                                                    // Let's just set.
                                                    // Check if we have enough votes remaining to increase
                                                    const diff = star - userVoteCount
                                                    if (diff > 0 && votesRemaining < diff) return // Not enough votes
                                                    handleSetVote(item.id, star)
                                                }}
                                                disabled={votesRemaining <= 0 && star > userVoteCount}
                                                className={cn(
                                                    "transition-transform hover:scale-110 focus:outline-none",
                                                    star <= userVoteCount ? "text-yellow-500" : "text-gray-300 dark:text-gray-600",
                                                    (votesRemaining <= 0 && star > userVoteCount) ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:text-yellow-400"
                                                )}
                                                onPointerDown={(e) => e.stopPropagation()} // Prevent drag start on vote click
                                            >
                                                <Star className={cn("w-4 h-4", star <= userVoteCount && "fill-current")} />
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                ) : retro.status !== 'INPUT' && (
                                <div className="flex items-center gap-1 text-sm font-bold text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20 px-2 py-1 rounded-md w-fit">
                                    <Star className="w-3 h-3 fill-current" /> {totalItemVotes}
                                </div>
                                )}
                            </div>
                            
                            </CardContent>
                        </Card>
                        </SortableItem>
                        )
                    })}
                    </SortableContext>
                    
                    {retro.status === 'INPUT' && (
                        <div className="pt-2">
                        <div className="relative">
                            <Textarea 
                            placeholder="Add a new item..." 
                            value={newItemContent[column.id] || ''}
                            onChange={(e) => setNewItemContent(prev => ({ ...prev, [column.id]: e.target.value }))}
                            className="min-h-[80px] pr-12 resize-none shadow-sm focus-visible:ring-indigo-500"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault()
                                    handleAddItem(column.id)
                                }
                            }}
                            />
                            <Button 
                                size="icon"
                                className="absolute bottom-2 right-2 h-8 w-8 bg-blue-600 hover:bg-blue-700"
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

      {/* Participants Sidebar */}
      <div className="w-64 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 p-4 flex flex-col">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            Participants
            <span className="bg-gray-100 dark:bg-gray-800 text-xs px-2 py-1 rounded-full">{participants.length}</span>
        </h2>
        <div className="space-y-2 overflow-y-auto flex-1">
            {participants.map((p) => (
                <div key={p.userId} className="flex items-center justify-between p-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-400 flex items-center justify-center text-white font-bold text-xs">
                            {p.username.substring(0, 2).toUpperCase()}
                        </div>
                        <span className="text-sm font-medium truncate max-w-[100px]" title={p.username}>{p.username}</span>
                    </div>
                    {p.isReady && (
                        <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-2 py-1 rounded-full font-medium">
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
