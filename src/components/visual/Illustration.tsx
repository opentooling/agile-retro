/**
 * Inline SVG scenes, drawn from the theme's tone tokens.
 *
 * Inline rather than image files: they follow the palette (including dark
 * mode) without a second set of assets, they cost no extra request, and there
 * is nothing to fetch on an airgapped network. All decorative — every one sits
 * beside text that carries the meaning.
 */

const tone = (name: string, alpha = 1) =>
  alpha === 1 ? `hsl(var(--tone-${name}))` : `hsl(var(--tone-${name}) / ${alpha})`

/**
 * Soft colour blobs behind a page's top band.
 *
 * `stretch` suits a wide, short band, where distorting the circles reads as a
 * gradient field. A tall panel needs `stretch={false}`, or the same circles
 * become obvious ovals.
 */
export function BlobField({ className, stretch = true }: { className?: string; stretch?: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 400 120"
      preserveAspectRatio={stretch ? 'none' : 'xMidYMid slice'}
      className={className}
    >
      <circle cx="330" cy="20" r="70" fill={tone('improve', 0.35)} />
      <circle cx="380" cy="90" r="55" fill={tone('risk', 0.35)} />
      <circle cx="270" cy="96" r="38" fill={tone('review', 0.3)} />
      <circle cx="200" cy="10" r="30" fill={tone('positive', 0.22)} />
    </svg>
  )
}

/** Nothing here yet — a board waiting for its first card. */
export function EmptyBoard({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 160 110" className={className} fill="none">
      <rect x="10" y="22" width="42" height="72" rx="8" fill={tone('positive', 0.18)} />
      <rect x="59" y="22" width="42" height="72" rx="8" fill={tone('improve', 0.18)} />
      <rect x="108" y="22" width="42" height="72" rx="8" fill={tone('risk', 0.18)} />
      <rect x="17" y="31" width="28" height="7" rx="3.5" fill={tone('positive')} />
      <rect x="66" y="31" width="28" height="7" rx="3.5" fill={tone('improve')} />
      <rect x="115" y="31" width="28" height="7" rx="3.5" fill={tone('risk')} />
      <rect x="17" y="46" width="28" height="16" rx="5" fill="hsl(var(--card))" />
      <rect x="66" y="46" width="28" height="22" rx="5" fill="hsl(var(--card))" />
      <rect x="115" y="46" width="28" height="16" rx="5" fill="hsl(var(--card))" />
      <circle cx="80" cy="12" r="6" fill={tone('review', 0.7)} />
      <path d="M128 12h14M135 5v14" stroke={tone('risk')} strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/** A team gathered round a board — the sign-in and welcome scene. */
export function TeamScene({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 220 150" className={className} fill="none">
      <rect x="34" y="16" width="152" height="92" rx="12" fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="2" />
      <rect x="46" y="28" width="38" height="10" rx="5" fill={tone('positive')} />
      <rect x="91" y="28" width="38" height="10" rx="5" fill={tone('improve')} />
      <rect x="136" y="28" width="38" height="10" rx="5" fill={tone('risk')} />
      <rect x="46" y="46" width="38" height="20" rx="6" fill={tone('positive', 0.25)} />
      <rect x="91" y="46" width="38" height="30" rx="6" fill={tone('improve', 0.25)} />
      <rect x="136" y="46" width="38" height="16" rx="6" fill={tone('risk', 0.25)} />
      <rect x="46" y="72" width="38" height="14" rx="6" fill={tone('positive', 0.16)} />
      <rect x="91" y="82" width="38" height="14" rx="6" fill={tone('improve', 0.16)} />
      <circle cx="40" cy="126" r="14" fill={tone('review')} />
      <circle cx="74" cy="126" r="14" fill={tone('risk')} />
      <circle cx="108" cy="126" r="14" fill={tone('positive')} />
      <circle cx="142" cy="126" r="14" fill={tone('improve')} />
      <circle cx="176" cy="126" r="14" fill={tone('negative')} />
    </svg>
  )
}

/** Not enough history to draw a trend yet. */
export function NoData({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 140 80" className={className} fill="none">
      <path d="M12 68h116" stroke="hsl(var(--border))" strokeWidth="2" strokeLinecap="round" />
      <rect x="22" y="48" width="18" height="20" rx="5" fill={tone('improve', 0.35)} />
      <rect x="48" y="36" width="18" height="32" rx="5" fill={tone('improve', 0.55)} />
      <rect x="74" y="52" width="18" height="16" rx="5" fill={tone('improve', 0.3)} />
      <rect x="100" y="26" width="18" height="42" rx="5" fill={tone('improve', 0.18)} />
      <circle cx="109" cy="18" r="5" fill={tone('risk')} />
    </svg>
  )
}
