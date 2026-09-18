'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Search, Tag, Users, UserRound, X } from 'lucide-react'
import { getPopularTags } from '@/app/actions'
import { cn } from '@/lib/utils'

type Field = 'team' | 'creator' | 'tag'

const FIELD: Record<Field, { param: string; label: string; placeholder: string; icon: typeof Users }> = {
  team: { param: 'teamId', label: 'Team', placeholder: 'Team', icon: Users },
  creator: { param: 'creator', label: 'Facilitator', placeholder: 'Facilitator', icon: UserRound },
  tag: { param: 'tag', label: 'Tag', placeholder: 'Tag', icon: Tag },
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
  const wantsTags = fields.includes('tag')

  useEffect(() => {
    if (!wantsTags) return
    const load = () => getPopularTags().then(setPopularTags).catch(() => {})
    load()
    window.addEventListener('retro-created', load)
    return () => window.removeEventListener('retro-created', load)
  }, [wantsTags])

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams)
    if (value) {
      if (key === 'tag' && params.get('tag') === value) params.delete(key)
      else params.set(key, value)
    } else {
      params.delete(key)
    }
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
          const { param, label, placeholder, icon: Icon } = FIELD[f]
          const value = searchParams.get(param) || ''
          return (
            <label
              key={f}
              className={cn(
                'flex h-9 min-w-0 flex-1 basis-40 items-center gap-2 rounded-full border bg-card px-3 text-sm shadow-[var(--shadow-card)] transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-[hsl(var(--ring)/0.35)] @2xl:max-w-56',
                value && 'border-[hsl(var(--primary)/0.5)]',
              )}
            >
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="sr-only">{label}</span>
              <input
                value={value}
                onChange={(e) => setParam(param, e.target.value)}
                placeholder={placeholder}
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground focus-visible:outline-none"
              />
              {value && (
                <button
                  type="button"
                  onClick={() => setParam(param, '')}
                  aria-label={`Clear ${label.toLowerCase()} filter`}
                  className="-mr-1 rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
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
                onClick={() => setParam('tag', tag)}
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
