'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Search, Tag, Users, UserRound, X } from 'lucide-react'
import { getFilterOptions, getPopularTags } from '@/app/actions'
import { cn } from '@/lib/utils'

type Field = 'team' | 'creator' | 'tag'

const FIELD: Record<Field, { param: string; label: string; placeholder: string; icon: typeof Users }> = {
  team: { param: 'teamId', label: 'Team', placeholder: 'Team', icon: Users },
  creator: { param: 'creator', label: 'Facilitator', placeholder: 'Facilitator', icon: UserRound },
  tag: { param: 'tag', label: 'Tag', placeholder: 'Tag', icon: Tag },
}

/**
 * One filter field, with the values that exist to choose from.
 *
 * The fields are still free text — they match on a substring, so half a name
 * works — but nobody can be expected to remember how a team was spelled or who
 * ran a retro months ago. Typing now offers what is actually there, drawn from
 * the boards this viewer can see, so a suggestion always returns rows.
 *
 * Built to the ARIA combobox pattern rather than a native datalist, which
 * cannot be styled and is skipped by some screen readers: the input owns the
 * listbox, arrow keys walk it, Enter takes the highlighted value, Escape
 * closes it and leaves what was typed.
 */
function FilterField({
  label,
  placeholder,
  icon: Icon,
  value,
  options,
  onChange,
}: {
  label: string
  placeholder: string
  icon: typeof Users
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const listId = useId()
  const box = useRef<HTMLLabelElement | null>(null)

  const needle = value.trim().toLowerCase()
  const matches = options
    .filter((o) => !needle || o.toLowerCase().includes(needle))
    .slice(0, 8)
  const showing = open && matches.length > 0

  // Clicking away closes the list; the value typed so far stays.
  useEffect(() => {
    if (!showing) return
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showing])

  const choose = (option: string) => {
    onChange(option)
    setOpen(false)
    setHighlighted(-1)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!showing) { setOpen(true); return }
      const step = e.key === 'ArrowDown' ? 1 : -1
      setHighlighted((i) => (i + step + matches.length) % matches.length)
      return
    }
    if (e.key === 'Enter' && showing && highlighted >= 0) {
      e.preventDefault()
      choose(matches[highlighted])
      return
    }
    if (e.key === 'Escape' && showing) {
      e.preventDefault()
      setOpen(false)
      setHighlighted(-1)
    }
  }

  return (
    <label
      ref={box}
      className={cn(
        'relative flex h-9 min-w-0 flex-1 basis-40 items-center gap-2 rounded-full border bg-card px-3 text-sm shadow-[var(--shadow-card)] transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-[hsl(var(--ring)/0.35)] @2xl:max-w-56',
        value && 'border-[hsl(var(--primary)/0.5)]',
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="sr-only">{label}</span>
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setHighlighted(-1)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={showing}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showing && highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground focus-visible:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => { onChange(''); setOpen(false) }}
          aria-label={`Clear ${label.toLowerCase()} filter`}
          className="-mr-1 rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      <ul
        id={listId}
        role="listbox"
        aria-label={`${label} suggestions`}
        hidden={!showing}
        className="absolute left-0 top-full z-50 mt-1 max-h-64 w-full min-w-40 overflow-y-auto rounded-xl border bg-popover p-1 shadow-[var(--shadow-lift)]"
      >
        {matches.map((option, i) => (
          <li key={option}>
            <button
              type="button"
              id={`${listId}-${i}`}
              role="option"
              aria-selected={option === value}
              // The input keeps the focus, so choose on mouse-down: a blur
              // between down and up would close the list first.
              onMouseDown={(e) => { e.preventDefault(); choose(option) }}
              onMouseEnter={() => setHighlighted(i)}
              className={cn(
                'w-full truncate rounded-lg px-2.5 py-1.5 text-left text-sm',
                i === highlighted ? 'bg-accent text-foreground' : 'text-muted-foreground',
              )}
            >
              {option}
            </button>
          </li>
        ))}
      </ul>
    </label>
  )
}

/**
 * Filters, next to the list they filter.
 *
 * They used to live in the navigation sidebar, 256px away from the rows they
 * changed and present on pages they did nothing to. They are still URL
 * parameters, so they survive a reload and the rail still carries them from
 * page to page; only where they are typed has moved.
 */
export function ScopeBar({ fields, className }: { fields: Field[]; className?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [popularTags, setPopularTags] = useState<{ tag: string; count: number }[]>([])
  const [options, setOptions] = useState<{ creators: string[]; teamNames: string[]; tags: string[] }>({
    creators: [], teamNames: [], tags: [],
  })
  const wantsTags = fields.includes('tag')

  useEffect(() => {
    if (!wantsTags) return
    const load = () => getPopularTags().then(setPopularTags).catch(() => {})
    load()
    window.addEventListener('retro-created', load)
    return () => window.removeEventListener('retro-created', load)
  }, [wantsTags])

  // What there is to choose from. Reloaded when a board is created, since that
  // is what adds a facilitator, a team or a tag to the list.
  useEffect(() => {
    const load = () => getFilterOptions().then(setOptions).catch(() => {})
    load()
    window.addEventListener('retro-created', load)
    return () => window.removeEventListener('retro-created', load)
  }, [])

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams)
    if (value) params.set(key, value)
    else params.delete(key)
    // Filtering changes the result set, so an old page number no longer means anything.
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`)
  }

  const active = fields.filter((f) => searchParams.get(FIELD[f].param))
  const clearAll = () => {
    const params = new URLSearchParams(searchParams)
    for (const f of fields) params.delete(FIELD[f].param)
    params.delete('page')
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <div role="search" aria-label="Filter" className={cn('@container mb-6', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow mr-1 flex items-center gap-1.5">
          <Search className="h-3.5 w-3.5" aria-hidden /> Filter
        </span>
        {fields.map((f) => {
          const { param, label, placeholder, icon } = FIELD[f]
          const suggestions =
            f === 'team' ? options.teamNames : f === 'creator' ? options.creators : options.tags
          return (
            <FilterField
              key={f}
              label={label}
              placeholder={placeholder}
              icon={icon}
              value={searchParams.get(param) || ''}
              options={suggestions}
              onChange={(value) => setParam(param, value)}
            />
          )
        })}
        {active.length > 1 && (
          <button
            type="button"
            onClick={clearAll}
            className="h-9 rounded-full px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Clear all
          </button>
        )}
      </div>

      {wantsTags && popularTags.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Popular</span>
          {popularTags.map(({ tag, count }) => {
            const on = searchParams.get('tag') === tag
            return (
              <button
                key={tag}
                type="button"
                onClick={() => setParam('tag', on ? '' : tag)}
                aria-pressed={on}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                  on
                    ? 'border-transparent bg-foreground text-background'
                    : 'bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                #{tag}
                <span className="font-normal tabular-nums">{count}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
