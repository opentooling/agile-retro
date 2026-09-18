/**
 * Inline SVG scenes, drawn from the theme's tone tokens.
 *
 * Inline rather than image files: they follow the palette (including dark
 * mode) without a second set of assets, they cost no extra request, and there
 * is nothing to fetch on an airgapped network. All decorative — every one sits
 * beside text that carries the meaning.
 *
 * They share one motif with the product itself: tinted lanes of paper cards,
 * and the four-segment phase track.
 */

const tone = (name: string, alpha = 1) =>
  alpha === 1 ? `hsl(var(--tone-${name}))` : `hsl(var(--tone-${name}) / ${alpha})`

/** Nothing here yet — three empty lanes waiting for their first card. */
export function EmptyBoard({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 160 100" className={className} fill="none">
      {(['positive', 'negative', 'improve'] as const).map((t, i) => (
        <g key={t} transform={`translate(${8 + i * 50} 10)`}>
          <rect width="44" height="80" rx="9" fill={tone(t, 0.22)} />
          <rect x="7" y="8" width="18" height="5" rx="2.5" fill={tone(t)} />
          <rect x="6" y="20" width="32" height={i === 1 ? 20 : 14} rx="4" fill="hsl(var(--card))" />
          {i !== 2 && <rect x="6" y={i === 1 ? 44 : 38} width="32" height="12" rx="4" fill="hsl(var(--card))" opacity="0.7" />}
          <rect x="6" y="66" width="32" height="8" rx="4" fill="none" stroke={tone(t, 0.7)} strokeDasharray="3 3" />
        </g>
      ))}
    </svg>
  )
}

/** Nothing owed — a short checklist, all ticked. */
export function EmptyChecklist({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 140 90" className={className} fill="none">
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(18 ${14 + i * 24})`}>
          <circle cx="8" cy="8" r="8" fill={tone('positive', i === 2 ? 0.35 : 1)} />
          <path d="M4.5 8.2l2.3 2.3 4.7-4.9" stroke="hsl(var(--card))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="24" y="4" width={i === 1 ? 58 : 82} height="8" rx="4" fill="hsl(var(--border))" />
        </g>
      ))}
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
      <rect x="100" y="26" width="18" height="42" rx="5" fill="none" stroke={tone('improve', 0.6)} strokeDasharray="4 3" />
    </svg>
  )
}

/**
 * The stage, in miniature: a board mid-session — phase track across the top,
 * three tinted lanes of cards, the console docked underneath. Drawn for an ink
 * background (the sign-in panel), in both themes.
 */
export function StageScene({ className }: { className?: string }) {
  const lanes = [
    { t: 'positive', cards: [30, 22, 26] },
    { t: 'negative', cards: [22, 34] },
    { t: 'improve', cards: [26, 20, 18] },
  ] as const
  return (
    <svg aria-hidden viewBox="0 0 480 330" className={className} fill="none">
      {/* Window */}
      <rect x="0.5" y="0.5" width="479" height="329" rx="18" fill="hsl(var(--rail-hover))" stroke="hsl(var(--rail-border))" />
      {/* Title and phase track */}
      <rect x="24" y="22" width="120" height="10" rx="5" fill="hsl(var(--rail-foreground) / 0.85)" />
      <rect x="24" y="38" width="70" height="7" rx="3.5" fill="hsl(var(--rail-muted) / 0.6)" />
      {(['improve', 'risk', 'review', 'positive'] as const).map((t, i) => (
        <g key={t}>
          <rect x={250 + i * 54} y="27" width="48" height="6" rx="3" fill="hsl(var(--rail-border))" />
          {i < 2 && <rect x={250 + i * 54} y="27" width={i === 0 ? 48 : 30} height="6" rx="3" fill={tone(t, i === 0 ? 0.6 : 1)} />}
        </g>
      ))}
      {/* Lanes */}
      {lanes.map((lane, i) => {
        let y = 90
        return (
          <g key={lane.t}>
            <rect x={24 + i * 148} y="62" width="136" height="196" rx="14" fill={tone(lane.t, 0.2)} />
            <rect x={36 + i * 148} y="74" width="52" height="7" rx="3.5" fill={tone(lane.t)} />
            {lane.cards.map((h, j) => {
              const card = (
                <g key={j}>
                  <rect x={34 + i * 148} y={y} width="116" height={h + 16} rx="9" fill="hsl(var(--note))" />
                  <rect x={44 + i * 148} y={y + 9} width={j % 2 ? 70 : 90} height="5" rx="2.5" fill="hsl(var(--border))" />
                  {h > 24 && <rect x={44 + i * 148} y={y + 19} width="60" height="5" rx="2.5" fill="hsl(var(--border))" />}
                  {i === 1 && j === 0 && (
                    <g>
                      {Array.from({ length: 10 }, (_, k) => (
                        <rect key={k} x={44 + i * 148 + k * 9.5} y={y + h + 2} width="7.5" height="5" rx="1.5" fill={k < 6 ? tone('risk') : 'hsl(var(--border))'} />
                      ))}
                    </g>
                  )}
                </g>
              )
              y += h + 24
              return card
            })}
          </g>
        )
      })}
      {/* Console */}
      <rect x="24" y="272" width="432" height="38" rx="12" fill="hsl(var(--rail))" stroke="hsl(var(--rail-border))" />
      <circle cx="46" cy="291" r="7" fill={tone('risk')} />
      <rect x="62" y="286" width="54" height="10" rx="5" fill="hsl(var(--rail-muted) / 0.6)" />
      <text x="150" y="297" fontFamily="var(--font-geist-mono), monospace" fontSize="17" fontWeight="700" fill="hsl(var(--rail-foreground))">04:25</text>
      {Array.from({ length: 5 }, (_, k) => (
        <circle key={k} cx={300 + k * 16} cy="291" r="7" fill={[tone('review'), tone('improve'), tone('positive'), tone('negative'), tone('risk')][k]} stroke="hsl(var(--rail))" strokeWidth="2" />
      ))}
      <rect x="386" y="280" width="58" height="22" rx="8" fill="hsl(var(--rail-active))" />
    </svg>
  )
}
