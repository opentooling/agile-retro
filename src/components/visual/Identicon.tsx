/**
 * A generated avatar for a person or a team.
 *
 * The app has no image store for people, and airgapped deployments can't reach
 * Gravatar or any other avatar service, so identity is drawn rather than
 * fetched: a two-stop gradient picked deterministically from the name, with the
 * initials on top. The same name always produces the same mark, which is the
 * point — it makes a list of sessions scannable by who ran them.
 *
 * Decorative: the name it stands for is always written next to it, so the mark
 * is hidden from assistive tech rather than read out twice.
 */
import { cn } from '@/lib/utils'

/** Stable small hash — same name, same colours, on server and client. */
function hash(value: string): number {
  let h = 0
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/[\s._@-]+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

export function Identicon({
  name,
  size = 28,
  shape = 'circle',
  className,
}: {
  name: string
  size?: number
  /** People are circles; teams are rounded squares, so the two never read as each other. */
  shape?: 'circle' | 'square'
  className?: string
}) {
  const h = hash(name || '?')
  // Two hues a step apart on the wheel. Lightness depends on the hue: yellows
  // and greens are far brighter than blues at the same HSL lightness, so they
  // are drawn darker to keep the white initials legible (≥4.5:1 at both ends).
  const hue = h % 360
  const hue2 = (hue + 38) % 360
  const light = (x: number) => (x >= 35 && x <= 195 ? 25 : x > 195 && x < 250 ? 38 : 36)
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center font-semibold text-white',
        shape === 'circle' ? 'rounded-full' : 'rounded-[30%]',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.38)),
        background: `linear-gradient(135deg, hsl(${hue} 62% ${light(hue)}%), hsl(${hue2} 66% ${light(hue2) - 4}%))`,
        boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.25)',
      }}
    >
      {initialsOf(name)}
    </span>
  )
}
