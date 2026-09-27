/**
 * The chart's non-visual contract. Hover is a convenience; these are the paths
 * that must work for everyone: the table view carries every value, the chart
 * says so when there is too little to draw, and the partial-month explanation
 * only appears when there is a partial mark to explain.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { TrendChart, type TrendChartProps } from './TrendChart'

beforeAll(() => {
  // jsdom has no layout; the chart measures itself before drawing.
  global.ResizeObserver = class {
    constructor(private cb: ResizeObserverCallback) {}
    observe() { this.cb([{ contentRect: { width: 480 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

const JUL = Date.UTC(2026, 6, 1)
const AUG = Date.UTC(2026, 7, 1)
const SEP = Date.UTC(2026, 8, 1)
const OCT = Date.UTC(2026, 9, 1)

const base: TrendChartProps = {
  title: 'Cards discussed',
  description: 'Share of cards with notes.',
  kind: 'lines',
  unit: 'percent',
  from: JUL,
  to: OCT,
  series: [{ key: 'v', label: 'Discussed', tone: 1 }],
  data: [
    { x: JUL + 86_400_000, heading: '2 Jul 2026 · Sprint 1', values: { v: 0.25 } },
    { x: AUG + 86_400_000, heading: '2 Aug 2026 · Sprint 2', note: 'Anonymous board', values: { v: null } },
    { x: SEP + 86_400_000, heading: '2 Sep 2026 · Sprint 3', values: { v: 1 } },
  ],
}

describe('TrendChart', () => {
  it('offers every value as a table, including the ones it cannot plot', () => {
    render(<TrendChart {...base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))

    const rows = screen.getAllByRole('row').slice(1).map((r) => r.textContent)
    expect(rows).toEqual([
      '2 Jul 2026 · Sprint 125%',
      '2 Aug 2026 · Sprint 2(Anonymous board)—',
      '2 Sep 2026 · Sprint 3100%',
    ])
    expect(screen.getByRole('button', { name: 'Chart' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('names the chart for assistive tech and tells keyboard users how to use it', () => {
    render(<TrendChart {...base} />)
    const chart = screen.getByRole('group', { name: /Cards discussed/ })
    expect(chart).toHaveAttribute('tabindex', '0')
    expect(chart.getAttribute('aria-label')).toMatch(/arrow keys/)
  })

  it('says there is not enough to draw rather than drawing a single dot', () => {
    render(<TrendChart {...base} data={[base.data[0], base.data[1]]} />)
    expect(screen.getByText(/Not enough sessions yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull()
  })

  it('explains a partial month only when a partial mark is drawn', () => {
    const months = (septSessions: number): TrendChartProps => ({
      ...base,
      kind: 'columns',
      unit: 'count',
      series: [{ key: 'n', label: 'Sessions', tone: 1 }],
      data: [
        { x: JUL, heading: 'July 2026', values: { n: 2 } },
        { x: AUG, heading: 'August 2026', values: { n: 3 } },
        { x: SEP, heading: 'September 2026', partial: true, values: { n: septSessions } },
      ],
    })
    const { rerender } = render(<TrendChart {...months(1)} />)
    expect(screen.getByText(/this month so far/)).toBeInTheDocument()

    // A zero column draws nothing, so "the lighter bar" would point at nothing.
    rerender(<TrendChart {...months(0)} />)
    expect(screen.queryByText(/this month so far/)).toBeNull()
  })
})
