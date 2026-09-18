'use client'

import * as React from 'react'
import { useState, useEffect } from "react"
import { useRouter } from 'next/navigation'
import { createRetrospective, getUniqueTags, getTeams } from '@/app/actions'
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Plus, ChevronsUpDown, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

import { useSession } from "next-auth/react"
import { TeamMark } from "@/components/TeamMark"
import { RETRO_TEMPLATES, DEFAULT_TEMPLATE_ID } from "@/lib/retro-templates"
import { columnSentiment } from "@/lib/column-sentiment"
import { RETENTION_OPTIONS, DEFAULT_RETENTION } from "@/lib/retention"

export function CreateRetroDialog({ preselectedTeamId }: { preselectedTeamId?: string }) {
  const [open, setOpen] = useState(false)
  const [tags, setTags] = useState<string[]>([])
  const [teams, setTeams] = useState<{id: string, name: string, imageData?: string | null}[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState<string>(preselectedTeamId || "")
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [openCombobox, setOpenCombobox] = useState(false)
  const [openTeamCombobox, setOpenTeamCombobox] = useState(false)
  const [templateId, setTemplateId] = useState<string>(DEFAULT_TEMPLATE_ID)
    const [retention, setRetention] = useState<string>(DEFAULT_RETENTION)
  const [mounted, setMounted] = useState(false)
  const router = useRouter()
  const { data: session } = useSession()

  useEffect(() => {
    setMounted(true)
    getUniqueTags().then((tags: string[]) => setTags(tags))
    getTeams().then(setTeams)

    const handleTeamUpdate = () => {
        getTeams().then(setTeams)
    }

    window.addEventListener('team-updated', handleTeamUpdate)
    return () => window.removeEventListener('team-updated', handleTeamUpdate)
  }, [session])

  useEffect(() => {
    if (preselectedTeamId) {
        setSelectedTeamId(preselectedTeamId)
    }
  }, [preselectedTeamId])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    // Team is optional. Leaving it unset creates an "open board" that any
    // authenticated user can view and join. Selecting a team makes the board
    // access-controlled (only team members / team-admins / admins).
    const formData = new FormData(event.currentTarget)
    formData.set('teamId', selectedTeamId)
    formData.set('template', templateId)
    formData.set('retentionDays', retention)
    // Append selected tags to formData
    formData.set('tags', selectedTags.join(', '))

    try {
      const retro = await createRetrospective(formData)
      if (!retro?.id) {
        throw new Error('Create returned no retrospective id')
      }
      // Notify the sidebar, then navigate to the new session. Navigation is
      // initiated before closing the dialog so nothing about the dialog
      // teardown can pre-empt the route change (this is the bug where creating
      // from a team card didn't open the new session).
      window.dispatchEvent(new Event('retro-created'))
      router.push(`/retro/${retro.id}`)
      setOpen(false)
    } catch (error) {
      console.error("Error creating retro:", error)
    }
  }

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) 
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    )
  }

  if (!mounted) {
    return (
      <Button className="gap-2" size={preselectedTeamId ? "sm" : "default"} variant={preselectedTeamId ? "outline" : "default"}>
        <Plus className="h-4 w-4" />
        New session
      </Button>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2" variant={preselectedTeamId ? "outline" : "default"} size={preselectedTeamId ? "sm" : "default"}>
          <Plus className="h-4 w-4" />
          New session
        </Button>
      </DialogTrigger>
      {/* Header and footer stay put; only the fields scroll. The form grew
          (format, retention, blind input) until it no longer fit shorter
          screens, and the whole-dialog scroll it used to have was switched off
          by an `overflow-visible` meant to keep the dropdowns unclipped — which
          they never were: they render in a portal, outside the dialog. */}
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden sm:max-w-[520px]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-xl tracking-tight">New retrospective</DialogTitle>
          <DialogDescription>
            Name it, choose who can join and how the board is laid out. Format and privacy are fixed once it starts.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          {/* Bleeds to the dialog's edges so the scrollbar sits at the border
              and focus rings on the fields aren't clipped by the scroll box. */}
          <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label htmlFor="title">
                Title
              </Label>
              <Input
                id="title"
                name="title"
                placeholder="Sprint 42 Retro"
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="teamId">
                Team
              </Label>
              <div>
                  <Popover open={openTeamCombobox} onOpenChange={setOpenTeamCombobox}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={openTeamCombobox}
                        className="w-full justify-between"
                      >
                        <span className="flex items-center gap-2 min-w-0 truncate">
                          {selectedTeamId && (
                            <TeamMark team={teams.find((team) => team.id === selectedTeamId)} size={18} />
                          )}
                          {selectedTeamId ? teams.find((team) => team.id === selectedTeamId)?.name : "No team (open board)"}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0">
                      <Command>
                        <CommandInput placeholder="Search teams..." />
                        <CommandList>
                          <CommandEmpty>No team found.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              key="__no_team__"
                              value="no team open board"
                              onSelect={() => {
                                setSelectedTeamId("")
                                setOpenTeamCombobox(false)
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectedTeamId === "" ? "opacity-100" : "opacity-0"
                                )}
                              />
                              No team (open board)
                            </CommandItem>
                            {teams.map((team) => (
                              <CommandItem
                                key={team.id}
                                value={team.name.toLowerCase()}
                                onSelect={() => {
                                  setSelectedTeamId(team.id)
                                  setOpenTeamCombobox(false)
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    selectedTeamId === team.id ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                <TeamMark team={team} size={18} className="mr-2" />
                                {team.name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <input type="hidden" name="teamId" value={selectedTeamId} />
                  <p className="text-xs text-muted-foreground mt-1">
                    {selectedTeamId
                      ? "Access-controlled: only this team's members, team-admins and admins."
                      : "Open board: any signed-in user can view and join."}
                  </p>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>
                Format
              </Label>
              <div>
                {/* Formats as tiles rather than a dropdown: the choice is about
                    the columns, so each tile shows them, in their colours. */}
                <div role="radiogroup" aria-label="Format" className="grid grid-cols-2 gap-2">
                  {RETRO_TEMPLATES.map((template) => {
                    const selected = templateId === template.id
                    return (
                      <button
                        key={template.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setTemplateId(template.id)}
                        className={cn(
                          "flex flex-col gap-2 rounded-lg border p-2.5 text-left transition-colors",
                          selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent",
                        )}
                      >
                        <span className="flex gap-1" aria-hidden>
                          {template.columns.map((c) => (
                            <span key={c.type} className="h-1.5 flex-1 rounded-full" style={{ background: `hsl(var(--tone-${columnSentiment(c.type)}))` }} />
                          ))}
                        </span>
                        <span className="text-sm font-medium leading-tight">{template.name}</span>
                      </button>
                    )
                  })}
                </div>
                <input type="hidden" name="template" value={templateId} />
                <p className="mt-1 text-xs text-muted-foreground">
                  {RETRO_TEMPLATES.find((t) => t.id === templateId)?.columns.map((c) => c.title).join(" · ")}
                </p>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label>
                Tags
              </Label>
              <div className="flex flex-col gap-2">
                <Popover open={openCombobox} onOpenChange={setOpenCombobox}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={openCombobox}
                      className="justify-between"
                    >
                      {selectedTags.length > 0 
                        ? `${selectedTags.length} tags selected` 
                        : "Select tags..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0">
                    <Command>
                      <CommandInput placeholder="Search tags..." onValueChange={setTagInput} />
                      <CommandList>
                        <CommandEmpty>
                            {tagInput && (
                                <div 
                                    className="flex items-center gap-2 p-2 text-sm rounded-sm cursor-pointer hover:bg-accent hover:text-accent-foreground"
                                    onClick={() => {
                                        toggleTag(tagInput)
                                        setTagInput('')
                                        setOpenCombobox(false)
                                    }}
                                >
                                    <Plus className="h-4 w-4" />
                                    Create tag "{tagInput}"
                                </div>
                            )}
                        </CommandEmpty>
                        <CommandGroup>
                            {tags.map((tag) => (
                              <CommandItem
                                key={tag}
                                value={tag.toLowerCase()}
                                onSelect={(currentValue) => {
                                  // currentValue is lowercased by cmdk, but we need the original tag
                                  // Since we don't have the original tag in the callback if we rely on value,
                                  // we can just use the tag from the closure since we are mapping.
                                  console.log("Selected tag:", tag, "Current Value:", currentValue)
                                  toggleTag(tag)
                                  setOpenCombobox(false)
                                }}
                              >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectedTags.includes(tag) ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {tag}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {selectedTags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                        {selectedTags.map(tag => (
                            <span key={tag} className="flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                                {tag}
                                <button type="button" aria-label={`Remove tag ${tag}`} className="rounded-full px-0.5 hover:text-destructive" onClick={() => toggleTag(tag)}>×</button>
                            </span>
                        ))}
                    </div>
                )}
              </div>
            </div>
            
            <div className="grid gap-1.5">
                <Label>Phase timers (minutes)</Label>
                <div className="grid grid-cols-3 gap-2">
                    <div className="flex flex-col gap-1">
                        <Label htmlFor="inputDuration" className="text-xs text-muted-foreground">Input</Label>
                        <Input type="number" id="inputDuration" name="inputDuration" defaultValue="10" min="2" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label htmlFor="votingDuration" className="text-xs text-muted-foreground">Voting</Label>
                        <Input type="number" id="votingDuration" name="votingDuration" defaultValue="5" min="2" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label htmlFor="reviewDuration" className="text-xs text-muted-foreground">Review</Label>
                        <Input type="number" id="reviewDuration" name="reviewDuration" defaultValue="10" min="2" />
                    </div>
                </div>
            </div>

            <div className="grid gap-1.5">
                <Label htmlFor="isAnonymous">Anonymous</Label>
                <div className="flex items-center gap-2">
                    <Switch id="isAnonymous" name="isAnonymous" />
                    <Label htmlFor="isAnonymous" className="font-normal text-muted-foreground">
                        Hide usernames on cards
                    </Label>
                </div>
            </div>

            <div className="grid gap-1.5">
                <Label htmlFor="retentionDays">Retention</Label>
                <div className="flex flex-col gap-1">
                    <select
                        id="retentionDays"
                        name="retentionDays"
                        value={retention}
                        onChange={(e) => setRetention(e.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm shadow-xs"
                    >
                        {RETENTION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                        {retention === 'never'
                            ? 'The board is kept until someone deletes it.'
                            : 'The board and everything on it is deleted automatically. This cannot be undone.'}
                    </p>
                </div>
            </div>

            <div className="grid gap-1.5">
                <Label htmlFor="blindInput">Blind input</Label>
                <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                        <Switch id="blindInput" name="blindInput" />
                        <Label htmlFor="blindInput" className="font-normal text-muted-foreground">
                            Hide others&apos; cards until input ends
                        </Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Stops the first few cards from anchoring everyone else&apos;s thinking.
                    </p>
                </div>
            </div>

          </div>
          </div>
          <DialogFooter className="shrink-0 border-t pt-4">
            <Button type="submit">Create and open</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
