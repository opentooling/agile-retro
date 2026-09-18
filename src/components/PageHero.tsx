import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { BlobField } from '@/components/visual/Illustration'
import { cn } from '@/lib/utils'

/**
 * The band at the top of a page: a coloured field, the page's icon, its title
 * and a one-line explanation, with the primary action on the right.
 *
 * Replaces a bare `<h1>` on a flat background. It gives every screen an anchor
 * you can recognise before reading, and it is where the theme's colour lives —
 * the content below stays calm because the top of the page is not.
 */
export function PageHero({
  icon: Icon,
  title,
  subtitle,
  action,
  children,
  className,
}: {
  icon: LucideIcon
  title: string
  subtitle?: string
  action?: ReactNode
  /** Stat chips or filters that belong to the page, shown inside the band. */
  children?: ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        'relative mb-6 overflow-hidden rounded-2xl border bg-gradient-to-br from-[hsl(var(--tone-improve-soft))] via-[hsl(var(--accent))] to-[hsl(var(--tone-review-soft))] px-5 py-5 sm:px-6',
        className,
      )}
    >
      <BlobField className="pointer-events-none absolute inset-y-0 right-0 h-full w-2/3 opacity-70" />
      <div className="relative flex flex-wrap items-center gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-md">
          <Icon className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children && <div className="relative mt-5">{children}</div>}
    </header>
  )
}

/** A headline figure inside the hero: coloured icon chip, number, label. */
export function HeroStat({
  icon: Icon,
  value,
  label,
  tone,
  href,
}: {
  icon: LucideIcon
  value: number | string
  label: string
  tone: 'positive' | 'improve' | 'risk' | 'review' | 'negative'
  href?: string
}) {
  const Wrapper = href ? 'a' : 'div'
  return (
    <Wrapper
      {...(href ? { href } : {})}
      className={cn(
        'flex items-center gap-3 rounded-xl border bg-card/80 px-4 py-3 backdrop-blur transition-transform',
        href && 'hover:-translate-y-0.5 hover:shadow-md',
      )}
    >
      <span
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
        style={{ background: `hsl(var(--tone-${tone}-soft))`, color: `hsl(var(--tone-${tone}-ink))` }}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-bold leading-none tabular-nums">{value}</span>
        <span className="block truncate text-xs text-muted-foreground">{label}</span>
      </span>
    </Wrapper>
  )
}
