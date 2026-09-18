import { cn } from '@/lib/utils'

/**
 * The product mark: four bars stepping up, one per phase, in the phase tones.
 * A retrospective is a climb through Input → Voting → Review → Actions, and the
 * mark says so without a word. Drawn inline so it follows the theme and needs
 * nothing fetched.
 */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <rect x="0" y="0" width="32" height="32" rx="9" fill="hsl(var(--rail-hover))" />
      <rect x="6" y="18" width="4" height="8" rx="2" fill="hsl(var(--tone-improve))" />
      <rect x="11.5" y="14" width="4" height="12" rx="2" fill="hsl(var(--tone-risk))" />
      <rect x="17" y="10" width="4" height="16" rx="2" fill="hsl(var(--tone-review))" />
      <rect x="22.5" y="6" width="4" height="20" rx="2" fill="hsl(var(--tone-positive))" />
    </svg>
  )
}
