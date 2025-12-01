'use client'

import * as React from 'react'
import { useState, useEffect } from "react"
import { useRouter } from 'next/navigation'
import { createRetrospective, getUniqueTags } from '@/app/actions'
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

export function CreateRetroDialog() {
  const [open, setOpen] = useState(false)
  const [tags, setTags] = useState<string[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [openCombobox, setOpenCombobox] = useState(false)
  const [creator, setCreator] = useState("")
  const router = useRouter()
  const { data: session } = useSession()

  useEffect(() => {
    if (session?.user?.name) {
      setCreator(session.user.name)
    } else {
      const stored = localStorage.getItem('retro-username')
      if (stored) setCreator(stored)
    }
    
    getUniqueTags().then((tags: string[]) => setTags(tags))
  }, [session])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    // Append selected tags to formData
    formData.set('tags', selectedTags.join(', '))
    
    try {
      const retro = await createRetrospective(formData)
      setOpen(false)
      router.push(`/retro/${retro.id}`)
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Create New Session
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] overflow-visible">
        <DialogHeader>
          <DialogTitle>Create Retrospective</DialogTitle>
          <DialogDescription>
            Start a new retrospective session. Give it a meaningful title.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="title" className="text-right">
                Title
              </Label>
              <Input
                id="title"
                name="title"
                placeholder="Sprint 42 Retro"
                className="col-span-3"
                required
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">
                Tags
              </Label>
              <div className="col-span-3 flex flex-col gap-2">
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
                              keywords={[tag]}
                              onSelect={() => {
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
                            <span key={tag} className="bg-secondary text-secondary-foreground px-2 py-1 rounded-md text-xs flex items-center gap-1">
                                {tag}
                                <span className="cursor-pointer hover:text-destructive" onClick={() => toggleTag(tag)}>×</span>
                            </span>
                        ))}
                    </div>
                )}
              </div>
            </div>
            
            <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right col-span-1">Phase Timers (min)</Label>
                <div className="col-span-3 flex gap-2">
                    <div className="flex flex-col gap-1">
                        <Label htmlFor="inputDuration" className="text-xs text-muted-foreground">Input</Label>
                        <Input type="number" id="inputDuration" name="inputDuration" defaultValue="10" min="0" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label htmlFor="votingDuration" className="text-xs text-muted-foreground">Voting</Label>
                        <Input type="number" id="votingDuration" name="votingDuration" defaultValue="5" min="0" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label htmlFor="reviewDuration" className="text-xs text-muted-foreground">Review</Label>
                        <Input type="number" id="reviewDuration" name="reviewDuration" defaultValue="10" min="0" />
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="isAnonymous" className="text-right">Anonymous</Label>
                <div className="col-span-3 flex items-center space-x-2">
                    <Switch id="isAnonymous" name="isAnonymous" />
                    <Label htmlFor="isAnonymous" className="font-normal text-muted-foreground">
                        Hide usernames on cards
                    </Label>
                </div>
            </div>

            <input type="hidden" name="creator" value={creator} />
          </div>
          <DialogFooter>
            <Button type="submit">Create Session</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
