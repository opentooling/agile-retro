import type { ReactNode } from 'react'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The top of a desk page: an eyebrow naming the section, a large title, one
 * line saying what the page is for, and the page's own controls on the right —
 * closed by a hairline, not boxed in a coloured band.
 *
 * Replaces the gradient hero. The page's colour now comes from what it shows
 * (phases, sentiments, figures) instead of a decorative field at the top.
 */
export function Masthead({
  eyebrow,
  icon: Icon,
  title,
  lede,
  actions,
  children,
  className,
}: {
  eyebrow: string
  icon?: LucideIcon
  title: ReactNode
  lede?: ReactNode
  /** The page's own controls — a primary action, a view switch. */
  actions?: ReactNode
  /** Figures or a scope bar that belong to the header. */
  children?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('@container mb-8', className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b pb-6">
        <div className="min-w-0 max-w-3xl">
          <p className="eyebrow flex items-center gap-1.5">
            {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
            {eyebrow}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em] text-foreground @2xl:text-4xl">
            {title}
          </h1>
          {lede && <p className="mt-2 text-base text-muted-foreground">{lede}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  )
}

type Tone = 'positive' | 'improve' | 'risk' | 'review' | 'negative' | 'neutral'

/**
 * A row of headline numbers, separated by hairlines rather than boxed — the
 * figure is the content, so it gets the size a box would have taken.
 */
export function Figures({ children, className, columns = 3 }: { children: ReactNode; className?: string; columns?: 3 | 5 }) {
  return (
    <dl
      className={cn(
        columns === 3
          ? 'grid grid-cols-3 divide-x border-b'
          // Five figures sit on one row, with hairlines between them, once the
          // header is wide enough; before that they fall into two columns with
          // no hairlines — a divider down a wrapped grid separates nothing,
          // and the offset it brings knocks the second row out of line.
          : 'grid grid-cols-2 gap-x-6 border-b @2xl:grid-cols-5 @2xl:gap-x-0 @2xl:divide-x [&>*]:!pl-0 @2xl:[&>*:not(:first-child)]:!pl-6',
        className,
      )}
    >
      {children}
    </dl>
  )
}

export function Figure({
  value,
  label,
  tone = 'neutral',
  href,
}: {
  value: ReactNode
  label: string
  tone?: Tone
  href?: string
}) {
  const body = (
    <>
      <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground @xl:text-sm">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: `hsl(var(--tone-${tone}))` }} />
        <span className="truncate">{label}</span>
      </dt>
      <dd className="mt-1 text-3xl font-semibold tabular-nums tracking-tight @xl:text-5xl">{value}</dd>
    </>
  )
  return (
    <div className="min-w-0 first:pl-0 [&:not(:first-child)]:pl-4 @xl:[&:not(:first-child)]:pl-6">
      {href ? (
        <Link
          href={href}
          className="group block rounded-md py-4 pr-2 transition-colors hover:text-primary @xl:py-5"
        >
          {body}
        </Link>
      ) : (
        <div className="py-4 pr-2 @xl:py-5">{body}</div>
      )}
    </div>
  )
}

/** A section heading on a desk page, with an optional link on the right. */
export function SectionTitle({
  children,
  aside,
  id,
  className,
}: {
  children: ReactNode
  aside?: ReactNode
  id?: string
  className?: string
}) {
  return (
    <div className={cn('mb-3 flex items-baseline justify-between gap-3', className)}>
      <h2 id={id} className="text-lg font-semibold tracking-tight">{children}</h2>
      {aside && <div className="shrink-0 text-sm">{aside}</div>}
    </div>
  )
}

/**
 * A segmented control made of links — the view switches on list pages (All /
 * Live / Mine, Open / Done / All). Links, not buttons, so every view has a URL.
 */
export function Segmented({
  label,
  items,
}: {
  label: string
  items: { href: string; label: string; active: boolean }[]
}) {
  return (
    <nav aria-label={label} className="inline-flex rounded-lg border bg-card p-0.5 shadow-[var(--shadow-card)]">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            item.active
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
