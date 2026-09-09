import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The one page shell.
 *
 * Every screen had rolled its own — `p-8` vs `container mx-auto p-8` vs
 * `max-w-4xl mx-auto`, with h1s ranging from `text-2xl` to `text-4xl`. Same
 * shape, five spellings. This is the shape.
 */
export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto max-w-6xl p-6', className)}>{children}</div>
}

/** Page title plus its primary action, on one row. */
export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-bold">{title}</h1>
      {action}
    </div>
  )
}
