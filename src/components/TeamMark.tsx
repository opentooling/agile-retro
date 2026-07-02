import { Users } from "lucide-react"

/**
 * Small team badge: shows the team's uploaded logo, or a sensible default icon
 * when none is set. Pure/presentational so it works in server components.
 */
export function TeamMark({
  team,
  size = 20,
  className = "",
}: {
  team: { name: string; imageData?: string | null } | null | undefined
  size?: number
  className?: string
}) {
  if (!team) return null
  const dim = { width: `${size}px`, height: `${size}px` }
  if (team.imageData) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={team.imageData}
        alt=""
        style={dim}
        className={`shrink-0 rounded-full border object-cover ${className}`}
      />
    )
  }
  return (
    <span
      style={dim}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ${className}`}
    >
      <Users style={{ width: `${Math.round(size * 0.58)}px`, height: `${Math.round(size * 0.58)}px` }} />
    </span>
  )
}
