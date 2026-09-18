'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

/**
 * A small time-series chart for the Insights trends: monthly columns or
 * per-session lines on a shared month axis.
 *
 * Hand-built SVG rather than a chart library. The marks are simple, the app
 * ships to airgapped networks behind a CVE gate, and the specs below (thin
 * marks, rounded data ends, hairline grid, surface rings) are easier to hold
 * exactly than to coax out of a library's defaults.
 *
 * Every value is reachable three ways: hover, keyboard (focus the chart, then
 * arrow keys), and the table view. The tooltip never gates anything.
 */

export type TrendSeries = {
  key: string
  label: string
  /** 1 = steel, 2 = copper. Validated as a pair for colour-vision separation. */
  tone: 1 | 2
}

export type TrendDatum = {
  /** Epoch ms. For columns, the start of the month the column covers. */
  x: number
  /** Tooltip / table heading, formatted on the server so both agree. */
  heading: string
  /** Secondary tooltip line, e.g. "so far" or why a value is missing. */
  note?: string
  /** An incomplete period — drawn lighter / hollow so a low value isn't read as a slump. */
  partial?: boolean
  values: Record<string, number | null>
}

export type TrendChartProps = {
  title: string
  description: string
  kind: 'columns' | 'lines'
  unit: 'count' | 'percent'
  /** Shared x-domain, epoch ms: first month start → the following month's start. */
  from: number
  to: number
  series: TrendSeries[]
  data: TrendDatum[]
  /** Fewer plotted values than this and the chart says so instead of drawing a line. */
  minPoints?: number
  emptyMessage?: string
}

const TONE = { 1: 'hsl(var(--chart-3))', 2: 'hsl(var(--chart-2))' } as const

// Geometry. The container height is fixed and includes the x-axis band, so the
// chart never jumps when it measures itself or scrolls inside its card.
const TOP = 10
const PLOT_H = 128
const AXIS_H = 22
const LEFT = 36
const HEIGHT = TOP + PLOT_H + AXIS_H
const BAR_MAX = 24
const R = 4

const monthLabel = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' })

function nextMonth(t: number): number {
  const d = new Date(t)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
}

function format(unit: TrendChartProps['unit'], v: number | null): string {
  if (v === null || Number.isNaN(v)) return '—'
  if (unit === 'percent') return `${Math.round(v * 100)}%`
  return Number.isInteger(v) ? v.toLocaleString('en-GB') : v.toFixed(1)
}

/** Clean y ticks: 0 / 1 / 2, 0 / 5 / 10, 0% / 50% / 100%. */
function yTicks(unit: TrendChartProps['unit'], max: number): number[] {
  if (unit === 'percent') return [0, 0.5, 1]
  if (max <= 0) return [0, 1]
  if (max <= 4) return Array.from({ length: Math.ceil(max) + 1 }, (_, i) => i)
  const rough = max / 3
  const mag = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= rough)!
  const top = Math.ceil(max / step) * step
  return Array.from({ length: top / step + 1 }, (_, i) => i * step)
}

/** A column with a 4px rounded data end and a square foot on the baseline. */
function columnPath(x0: number, x1: number, y: number, base: number): string {
  const r = Math.min(R, (x1 - x0) / 2, base - y)
  return `M${x0},${base}V${y + r}Q${x0},${y} ${x0 + r},${y}H${x1 - r}Q${x1},${y} ${x1},${y + r}V${base}Z`
}

export function TrendChart({
  title, description, kind, unit, from, to, series, data, minPoints = 2, emptyMessage,
}: TrendChartProps) {
  const [width, setWidth] = useState(0)
  const [active, setActive] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const descId = useId()

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [asTable])

  const multi = series.length > 1
  const plotted = data.filter((d) => series.some((s) => d.values[s.key] != null)).length
  const enough = kind === 'columns' ? data.length > 0 : plotted >= minPoints

  // Room on the right for end labels: the latest value on a single line, the
  // series names on a multi-line chart.
  const right = kind === 'lines' ? (multi ? 60 : 36) : 8
  const plotW = Math.max(0, width - LEFT - right)

  const layout = useMemo(() => {
    const span = to - from || 1
    const xAt = (t: number) => LEFT + ((t - from) / span) * plotW
    const values = data.flatMap((d) => series.map((s) => d.values[s.key])).filter((v): v is number => v != null)
    const ticks = yTicks(unit, Math.max(0, ...values))
    const top = ticks[ticks.length - 1] || 1
    const yAt = (v: number) => TOP + PLOT_H - (v / top) * PLOT_H

    // Month axis, shared by both kinds: labels centred on each month.
    const months: { mid: number; date: Date }[] = []
    for (let m = from; m < to; m = nextMonth(m)) {
      months.push({ mid: xAt(m + (nextMonth(m) - m) / 2), date: new Date(m) })
    }
    // Thin labels until they fit (sized for the longest, year-bearing form),
    // always keeping the latest month. The year goes on the first label that
    // is actually shown and on each January — attaching it to the first month
    // loses it whenever thinning hides that month.
    const band = months.length ? plotW / months.length : plotW
    const every = Math.max(1, Math.ceil(58 / Math.max(band, 1)))
    const shown = months
      .filter((_, i) => (months.length - 1 - i) % every === 0)
      .map((m, i) => {
        const short = monthLabel.format(m.date)
        const withYear = i === 0 || m.date.getUTCMonth() === 0
        return { mid: m.mid, label: withYear ? `${short} ’${String(m.date.getUTCFullYear()).slice(2)}` : short }
      })

    // Where each datum sits on x, and how wide its hover band is.
    const xs = data.map((d) => (kind === 'columns' ? xAt(d.x + (nextMonth(d.x) - d.x) / 2) : xAt(d.x)))
    return { xAt, yAt, ticks, band, shown, xs }
  }, [data, series, unit, from, to, plotW, kind])

  const nearest = useCallback(
    (px: number) => {
      let best = 0
      for (let i = 1; i < layout.xs.length; i++) {
        if (Math.abs(layout.xs[i] - px) < Math.abs(layout.xs[best] - px)) best = i
      }
      return layout.xs.length ? best : null
    },
    [layout.xs],
  )

  const onPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setActive(nearest(e.clientX - rect.left))
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (!data.length) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const step = e.key === 'ArrowRight' ? 1 : -1
      setActive((i) => (i === null ? (step > 0 ? 0 : data.length - 1) : Math.min(data.length - 1, Math.max(0, i + step))))
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setActive(e.key === 'Home' ? 0 : data.length - 1)
    } else if (e.key === 'Escape') {
      setActive(null)
    }
  }

  const base = TOP + PLOT_H
  // Only explain the partial styling when a partial mark is actually drawn:
  // a zero column draws nothing, and a note about "the lighter bar" would then
  // describe a mark that isn't there.
  const hasPartial = data.some(
    (d) => d.partial && series.some((s) => {
      const v = d.values[s.key]
      return v != null && (kind === 'lines' || v > 0)
    }),
  )

  // Per-series line segments, broken wherever a value is missing (an anonymous
  // board has no contributor count — joining across it would invent one).
  const segments = (key: string) => {
    const out: { x: number; y: number }[][] = []
    let run: { x: number; y: number }[] = []
    data.forEach((d, i) => {
      const v = d.values[key]
      if (v == null) {
        if (run.length) out.push(run)
        run = []
      } else {
        run.push({ x: layout.xs[i], y: layout.yAt(v) })
      }
    })
    if (run.length) out.push(run)
    return out
  }

  // End labels for the multi-line chart — only when they don't collide.
  // Nudging colliding labels apart detaches them from their lines; the legend
  // and tooltip carry identity instead.
  const endLabels = (() => {
    if (kind !== 'lines' || !plotW) return []
    const ends = series.flatMap((s) => {
      for (let i = data.length - 1; i >= 0; i--) {
        const v = data[i].values[s.key]
        if (v != null) return [{ s, x: layout.xs[i], y: layout.yAt(v), v }]
      }
      return []
    })
    if (multi) {
      const ys = ends.map((e) => e.y).sort((a, b) => a - b)
      if (ys.some((y, i) => i > 0 && y - ys[i - 1] < 13)) return []
    }
    return ends
  })()

  const activeDatum = active === null ? null : data[active]
  const tipLeft = active === null ? 0 : layout.xs[active]
  const flip = tipLeft > width * 0.6

  return (
    <figure className="flex flex-col rounded-xl border bg-card px-4 pb-3 pt-4 shadow-[var(--shadow-card)]">
      <figcaption className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          <div id={descId} className="text-xs text-muted-foreground">{description}</div>
        </div>
        {enough && (
          <button
            type="button"
            onClick={() => { setAsTable((t) => !t); setActive(null) }}
            className="-mr-1 shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-pressed={asTable}
          >
            {asTable ? 'Chart' : 'Table'}
          </button>
        )}
      </figcaption>

      {multi && enough && !asTable && (
        <ul className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              {kind === 'lines'
                ? <span className="h-0.5 w-3 rounded-full" style={{ background: TONE[s.tone] }} />
                : <span className="h-2.5 w-2.5 rounded-sm" style={{ background: TONE[s.tone] }} />}
              {s.label}
            </li>
          ))}
        </ul>
      )}

      {!enough ? (
        <div className="flex items-center justify-center text-center text-xs text-muted-foreground" style={{ height: HEIGHT }}>
          {emptyMessage ?? 'Not enough sessions yet to show a trend.'}
        </div>
      ) : asTable ? (
        <div className="max-h-[220px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-medium">{kind === 'columns' ? 'Month' : 'Session'}</th>
                {series.map((s) => <th key={s.key} className="py-1 text-right font-medium">{s.label}</th>)}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {data.map((d) => (
                <tr key={d.x} className="border-t">
                  <td className="py-1 pr-3">
                    {d.heading}
                    {d.note && <span className="ml-1 text-muted-foreground">({d.note})</span>}
                  </td>
                  {series.map((s) => <td key={s.key} className="py-1 text-right">{format(unit, d.values[s.key])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          ref={boxRef}
          className="relative rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ height: HEIGHT }}
          tabIndex={0}
          role="group"
          aria-roledescription="chart"
          aria-label={`${title}. Use the arrow keys to step through values, or switch to the table.`}
          aria-describedby={descId}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
        >
          {width > 0 && (
            <svg
              width={width}
              height={HEIGHT}
              className="block touch-none select-none"
              aria-hidden="true"
              onPointerMove={onPointer}
              onPointerDown={onPointer}
              onPointerLeave={() => setActive(null)}
            >
              {/* Hairline grid, solid, one step off the surface. */}
              {layout.ticks.map((t) => (
                <g key={t}>
                  <line
                    x1={LEFT} x2={width - right} y1={layout.yAt(t)} y2={layout.yAt(t)}
                    stroke={t === 0 ? 'hsl(var(--muted-foreground) / 0.45)' : 'hsl(var(--border))'}
                    strokeWidth={1} shapeRendering="crispEdges"
                  />
                  <text
                    x={LEFT - 6} y={layout.yAt(t)} dy="0.32em" textAnchor="end"
                    className="fill-muted-foreground text-[11px] tabular-nums"
                  >
                    {format(unit, t)}
                  </text>
                </g>
              ))}

              {layout.shown.map((m) => (
                <text key={m.mid} x={m.mid} y={base + 15} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                  {m.label}
                </text>
              ))}

              {kind === 'columns' && data.map((d, i) => {
                const s = series[0]
                const v = d.values[s.key] ?? 0
                if (v <= 0) return null
                const w = Math.min(BAR_MAX, layout.band * 0.6)
                const cx = layout.xs[i]
                return (
                  <path
                    key={d.x}
                    d={columnPath(cx - w / 2, cx + w / 2, layout.yAt(v), base)}
                    fill={TONE[s.tone]}
                    opacity={d.partial ? 0.45 : active === null || active === i ? 1 : 0.7}
                  />
                )
              })}

              {kind === 'lines' && active !== null && (
                <line
                  x1={layout.xs[active]} x2={layout.xs[active]} y1={TOP} y2={base}
                  stroke="hsl(var(--muted-foreground) / 0.5)" strokeWidth={1} shapeRendering="crispEdges"
                />
              )}

              {kind === 'lines' && series.map((s) => (
                <g key={s.key}>
                  {segments(s.key).map((run, j) => run.length > 1 && (
                    <polyline
                      key={j}
                      points={run.map((p) => `${p.x},${p.y}`).join(' ')}
                      fill="none" stroke={TONE[s.tone]} strokeWidth={2}
                      strokeLinejoin="round" strokeLinecap="round"
                    />
                  ))}
                  {data.map((d, i) => {
                    const v = d.values[s.key]
                    if (v == null) return null
                    const on = active === i
                    return (
                      <circle
                        key={d.x}
                        cx={layout.xs[i]} cy={layout.yAt(v)} r={on ? 5 : 4}
                        // A partial period is hollow: the value is real but not final.
                        fill={d.partial ? 'hsl(var(--card))' : TONE[s.tone]}
                        stroke={d.partial ? TONE[s.tone] : 'hsl(var(--card))'}
                        strokeWidth={2}
                      />
                    )
                  })}
                </g>
              ))}

              {endLabels.map(({ s, x, y, v }) => (
                <text key={s.key} x={x + 9} y={y} dy="0.32em" className="fill-muted-foreground text-[11px] tabular-nums">
                  {multi ? s.label : format(unit, v)}
                </text>
              ))}
            </svg>
          )}

          {activeDatum && (
            <div
              aria-live="polite"
              className="pointer-events-none absolute top-0 z-10 min-w-[8rem] max-w-[16rem] rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
              style={flip ? { right: width - tipLeft + 10 } : { left: tipLeft + 10 }}
            >
              <div className="font-medium text-foreground">{activeDatum.heading}</div>
              {activeDatum.note && <div className="text-muted-foreground">{activeDatum.note}</div>}
              <ul className="mt-1 space-y-0.5">
                {series.map((s) => (
                  <li key={s.key} className="flex items-center gap-2">
                    <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: TONE[s.tone] }} />
                    <span className="font-semibold tabular-nums text-foreground">{format(unit, activeDatum.values[s.key])}</span>
                    <span className="text-muted-foreground">{s.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {enough && !asTable && hasPartial && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {kind === 'columns' ? 'Lighter bar' : 'Hollow point'}: this month so far.
        </p>
      )}
    </figure>
  )
}
