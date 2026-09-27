import { Identicon } from "@/components/visual/Identicon"

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
        className={`shrink-0 rounded-[30%] border object-cover ${className}`}
      />
    )
  }
  // No logo uploaded: draw one from the team's name rather than showing the
  // same grey glyph for every team.
  return <Identicon name={team.name} size={size} shape="square" className={className} />
}
