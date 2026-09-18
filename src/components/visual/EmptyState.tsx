import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** An empty list, said with a picture rather than a grey sentence. */
export function EmptyState({
  illustration,
  title,
  hint,
  action,
  className,
}: {
  illustration: ReactNode
  title: string
  hint?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center', className)}>
      {illustration}
      <div>
        <p className="font-medium text-foreground">{title}</p>
        {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
  )
}
