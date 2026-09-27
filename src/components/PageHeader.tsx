import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The one page shell.
 *
 * Every screen had rolled its own — `p-8` vs `container mx-auto p-8` vs
 * `max-w-4xl mx-auto`, with h1s ranging from `text-2xl` to `text-4xl`. Same
 * shape, five spellings. This is the shape.
 */
/**
 * How wide the page is allowed to get.
 *
 * `default` is the reading width the app was built at. `wide` is for screens
 * whose content genuinely scales — lists and card grids that gain a column
 * instead of just stretching. Metric tiles and prose do not, so they stay put:
 * three numbers spread across 1700px is worse than three numbers across 1150px.
 *
 * This is a prop rather than a `className` override because the wide value is
 * set under a `2xl:` variant, and tailwind-merge does not de-duplicate across
 * variant prefixes — a caller passing `max-w-3xl` would beat the base class and
 * still inherit `2xl:max-w-[1700px]`, silently going wide on a large monitor.
 */
const SHELL_WIDTHS = {
  default: 'max-w-6xl',
  wide: 'max-w-6xl 2xl:max-w-[1700px]',
  prose: 'max-w-3xl',
} as const

export function PageShell({
  children,
  className,
  width = 'default',
}: {
  children: ReactNode
  className?: string
  width?: keyof typeof SHELL_WIDTHS
}) {
  return <div className={cn('mx-auto px-4 py-8 sm:px-8 sm:py-10', SHELL_WIDTHS[width], className)}>{children}</div>
}
