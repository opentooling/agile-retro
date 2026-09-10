'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TeamMark } from '@/components/TeamMark'
import { cn } from '@/lib/utils'

export type PickableTeam = { id: string; name: string; imageData?: string | null }

/**
 * Above this many teams the row of chips stops being a shortcut and starts
 * being the page — it wraps unbounded and pushes the figures below the fold.
 * An organisation with a handful of teams keeps one-click switching; one with
 * fifty gets a searchable control of constant height.
 */
const CHIP_LIMIT = 8

export function TeamPicker({
  teams,
  selectedId,
  basePath,
}: {
  teams: PickableTeam[]
  selectedId?: string
  basePath: string
}) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const selected = teams.find((t) => t.id === selectedId)

  if (teams.length <= CHIP_LIMIT) {
    return (
      <div className="mb-5 flex flex-wrap gap-1.5">
        {teams.map((team) => (
          <Link
            key={team.id}
            href={`${basePath}?team=${team.id}`}
            aria-current={team.id === selectedId ? 'page' : undefined}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              team.id === selectedId
                ? 'border-primary bg-primary/10 font-medium text-foreground'
                : 'text-muted-foreground hover:bg-accent'
            )}
          >
            <TeamMark team={team} size={16} />
            {team.name}
          </Link>
        ))}
      </div>
    )
  }

  return (
    <div className="mb-5 flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between sm:w-80"
          >
            <span className="flex min-w-0 items-center gap-2 truncate">
              {selected && <TeamMark team={selected} size={16} />}
              {selected?.name ?? 'Select a team'}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0 sm:w-80">
          <Command>
            <CommandInput placeholder="Search teams…" />
            <CommandList>
              <CommandEmpty>No team found.</CommandEmpty>
              <CommandGroup>
                {teams.map((team) => (
                  <CommandItem
                    key={team.id}
                    value={team.name.toLowerCase()}
                    onSelect={() => {
                      setOpen(false)
                      router.push(`${basePath}?team=${team.id}`)
                    }}
                  >
                    <Check className={cn('mr-2 h-4 w-4', team.id === selectedId ? 'opacity-100' : 'opacity-0')} />
                    <TeamMark team={team} size={16} className="mr-2" />
                    {team.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <span className="hidden text-xs text-muted-foreground sm:block">
        {teams.length} teams
      </span>
    </div>
  )
}
