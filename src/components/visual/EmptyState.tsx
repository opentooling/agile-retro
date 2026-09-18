import type { ReactNode } from 'react'

/** An empty list, said with a picture rather than a grey sentence. */
export function EmptyState({
  illustration,
  title,
  hint,
  action,
}: {
  illustration: ReactNode
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card/60 px-6 py-10 text-center">
      {illustration}
      <div>
        <p className="font-medium text-foreground">{title}</p>
        {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
  )
}
