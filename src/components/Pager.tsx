import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Prev/next paging for the list pages.
 *
 * Deliberately not infinite scroll: History and Actions are reference surfaces
 * people search, link to and come back to. Infinite scroll breaks the back
 * button and makes "the retro from March" harder to reach, not easier.
 *
 * Every existing query parameter is carried through, so paging never drops the
 * filters the sidebar is holding.
 */
export function Pager({
  page,
  pageSize,
  total,
  basePath,
  params,
}: {
  /** 1-based. */
  page: number
  pageSize: number
  total: number
  basePath: string
  params: Record<string, string | string[] | undefined>
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null

  const href = (target: number) => {
    const next = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (key === 'page') continue
      if (typeof value === 'string' && value) next.set(key, value)
    }
    if (target > 1) next.set('page', String(target))
    const qs = next.toString()
    return qs ? `${basePath}?${qs}` : basePath
  }

  const first = (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)

  const step = (target: number, label: string, icon: React.ReactNode, enabled: boolean) =>
    enabled ? (
      <Link
        href={href(target)}
        rel={label === 'Previous' ? 'prev' : 'next'}
        aria-label={label}
        className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {icon}
      </Link>
    ) : (
      <span
        aria-disabled="true"
        className={cn('flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm opacity-40')}
      >
        {icon}
      </span>
    )

  return (
    <nav className="mt-3 flex items-center justify-between gap-3" aria-label="Pagination">
      <p className="text-xs text-muted-foreground tabular-nums">
        {first}–{last} of {total}
      </p>
      <div className="flex items-center gap-1.5">
        {step(page - 1, 'Previous', <><ChevronLeft className="h-4 w-4" /> Previous</>, page > 1)}
        <span className="px-1 text-xs text-muted-foreground tabular-nums">
          {page} / {lastPage}
        </span>
        {step(page + 1, 'Next', <>Next <ChevronRight className="h-4 w-4" /></>, page < lastPage)}
      </div>
    </nav>
  )
}

/** Clamp a `?page=` value to something sane. */
export function pageFromParams(raw: unknown, total: number, pageSize: number): number {
  const lastPage = Math.max(1, Math.ceil(total / pageSize))
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : 1
  if (!Number.isFinite(parsed) || parsed < 1) return 1
  return Math.min(parsed, lastPage)
}
