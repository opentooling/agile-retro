import { buildTrends, MAX_MONTHS, MIN_MONTHS } from './trends'
import { perRetroFromRows, actionTimelineFromRows } from './db/aggregate'
import type { TeamAnalyticsRaw } from './db/types'

// Mid-September 2026, UTC.
const NOW = new Date('2026-09-12T10:00:00Z')
const at = (iso: string) => new Date(iso)
const month = (iso: string) => new Date(iso).getTime()

type Input = Pick<TeamAnalyticsRaw, 'retroDates' | 'perRetro' | 'actionTimeline'>
const input = (over: Partial<Input> = {}): Input => ({
  retroDates: [],
  perRetro: [],
  actionTimeline: [],
  ...over,
})

describe('buildTrends — the window', () => {
  it('has no timeline for a team that has never run a retro', () => {
    expect(buildTrends(input(), NOW)).toBeNull()
  })

  it('starts at the first retro and runs to the end of this month', () => {
    const t = buildTrends(input({ retroDates: [at('2026-04-20T00:00:00Z')] }), NOW)!
    expect(t.months.map((m) => new Date(m.start).toISOString().slice(0, 7))).toEqual([
      '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
    ])
    expect(t.from).toBe(month('2026-04-01T00:00:00Z'))
    expect(t.to).toBe(month('2026-10-01T00:00:00Z'))
  })

  it('never reaches back more than a year', () => {
    const t = buildTrends(input({ retroDates: [at('2024-01-10T00:00:00Z'), at('2026-09-01T00:00:00Z')] }), NOW)!
    expect(t.months).toHaveLength(MAX_MONTHS)
    expect(new Date(t.from).toISOString().slice(0, 7)).toBe('2025-10')
    // The 2024 retro is outside the window, so it is in no bucket.
    expect(t.months.reduce((n, m) => n + m.retros, 0)).toBe(1)
  })

  it('shows at least a quarter for a team that started this month', () => {
    // Otherwise a new team gets a one-bar bar chart.
    const t = buildTrends(input({ retroDates: [at('2026-09-03T00:00:00Z')] }), NOW)!
    expect(t.months).toHaveLength(MIN_MONTHS)
    expect(t.months.map((m) => m.retros)).toEqual([0, 0, 1])
  })

  it('marks only the current month as partial', () => {
    const t = buildTrends(input({ retroDates: [at('2026-06-01T00:00:00Z')] }), NOW)!
    expect(t.months.map((m) => m.partial)).toEqual([false, false, false, true])
  })
})

describe('buildTrends — bucketing', () => {
  it('splits on UTC month boundaries exactly', () => {
    const t = buildTrends(input({
      retroDates: [at('2026-07-31T23:59:59.999Z'), at('2026-08-01T00:00:00Z')],
    }), NOW)!
    const byMonth = Object.fromEntries(t.months.map((m) => [new Date(m.start).toISOString().slice(0, 7), m.retros]))
    expect(byMonth['2026-07']).toBe(1)
    expect(byMonth['2026-08']).toBe(1)
  })

  it('dates "agreed" by the board and "closed" by when it was ticked off', () => {
    const t = buildTrends(input({
      retroDates: [at('2026-07-10T00:00:00Z')],
      actionTimeline: [
        { agreedAt: at('2026-07-10T00:00:00Z'), completed: true, completedAt: at('2026-08-20T00:00:00Z') },
        { agreedAt: at('2026-07-10T00:00:00Z'), completed: false, completedAt: null },
      ],
    }), NOW)!
    const m = Object.fromEntries(t.months.map((b) => [new Date(b.start).toISOString().slice(0, 7), b]))
    expect(m['2026-07']).toMatchObject({ agreed: 2, closed: 0 })
    expect(m['2026-08']).toMatchObject({ agreed: 0, closed: 1 })
  })

  it('counts a closure inside the window even when the action was agreed before it', () => {
    // Paying down old debt is exactly what the "closed" line should show.
    const t = buildTrends(input({
      retroDates: [at('2024-05-01T00:00:00Z'), at('2026-09-01T00:00:00Z')],
      actionTimeline: [{ agreedAt: at('2024-05-01T00:00:00Z'), completed: true, completedAt: at('2026-09-05T00:00:00Z') }],
    }), NOW)!
    expect(t.months.reduce((n, b) => n + b.agreed, 0)).toBe(0)
    expect(t.months.at(-1)!.closed).toBe(1)
  })

  it('states closures it cannot date instead of dropping or misplacing them', () => {
    const t = buildTrends(input({
      retroDates: [at('2026-08-01T00:00:00Z')],
      actionTimeline: [
        { agreedAt: at('2026-08-01T00:00:00Z'), completed: true, completedAt: null },
        { agreedAt: at('2026-08-01T00:00:00Z'), completed: true, completedAt: null },
      ],
    }), NOW)!
    expect(t.untimedClosures).toBe(2)
    expect(t.months.reduce((n, b) => n + b.closed, 0)).toBe(0)
  })
})

describe('buildTrends — per-session points', () => {
  it('turns discussion into a share and keeps anonymous boards uncounted', () => {
    const t = buildTrends(input({
      retroDates: [at('2026-08-01T00:00:00Z'), at('2026-08-15T00:00:00Z')],
      perRetro: [
        { at: at('2026-08-01T00:00:00Z'), title: 'Sprint 1', cards: 8, discussed: 2, contributors: 4 },
        { at: at('2026-08-15T00:00:00Z'), title: 'Sprint 2', cards: 5, discussed: 5, contributors: null },
      ],
    }), NOW)!
    expect(t.sessions).toEqual([
      { at: month('2026-08-01T00:00:00Z'), title: 'Sprint 1', cards: 8, discussed: 0.25, contributors: 4 },
      { at: month('2026-08-15T00:00:00Z'), title: 'Sprint 2', cards: 5, discussed: 1, contributors: null },
    ])
  })

  it('leaves out sessions older than the window', () => {
    const t = buildTrends(input({
      retroDates: [at('2024-01-01T00:00:00Z'), at('2026-09-01T00:00:00Z')],
      perRetro: [
        { at: at('2024-01-01T00:00:00Z'), title: 'Old', cards: 3, discussed: 0, contributors: 2 },
        { at: at('2026-09-01T00:00:00Z'), title: 'New', cards: 3, discussed: 0, contributors: 2 },
      ],
    }), NOW)!
    expect(t.sessions.map((s) => s.title)).toEqual(['New'])
  })
})

describe('row shaping for the trends', () => {
  const retros = [
    { id: 'b', title: 'Second', createdAt: '2026-08-15T00:00:00.000Z', isAnonymous: 1 },
    { id: 'a', title: 'First', createdAt: '2026-08-01T00:00:00.000Z', isAnonymous: 0 },
    { id: 'empty', title: 'Test board', createdAt: '2026-08-20T00:00:00.000Z', isAnonymous: 0 },
  ]

  it('plots one point per board that had cards, oldest first', () => {
    const points = perRetroFromRows(retros, [
      { retro: 'a', userId: 'u1', summarised: 1 },
      { retro: 'a', userId: 'u2', summarised: 0 },
      { retro: 'a', userId: 'u1', summarised: 0 },
      { retro: 'b', userId: 'u3', summarised: true },
    ])
    expect(points.map((p) => p.title)).toEqual(['First', 'Second'])
    expect(points[0]).toMatchObject({ cards: 3, discussed: 1, contributors: 2 })
  })

  it('never counts contributors on an anonymous board (sqlite 0/1 flags included)', () => {
    const points = perRetroFromRows(retros, [{ retro: 'b', userId: 'u3', summarised: 0 }])
    expect(points[0]).toMatchObject({ title: 'Second', contributors: null })
  })

  it('leaves empty boards off the line rather than plotting a zero', () => {
    const points = perRetroFromRows(retros, [{ retro: 'a', userId: 'u1', summarised: 0 }])
    expect(points.map((p) => p.title)).not.toContain('Test board')
  })

  it('dates actions by their board and ignores a stale completedAt on a reopened action', () => {
    const timeline = actionTimelineFromRows(retros, [
      { retro: 'a', completed: 1, completedAt: '2026-08-10T00:00:00.000Z' },
      // Reopened: completed is false, but the old completion time is still stored.
      { retro: 'a', completed: 0, completedAt: '2026-08-11T00:00:00.000Z' },
      { retro: 'gone', completed: 0, completedAt: null },
    ])
    expect(timeline).toEqual([
      { agreedAt: new Date('2026-08-01T00:00:00.000Z'), completed: true, completedAt: new Date('2026-08-10T00:00:00.000Z') },
      { agreedAt: new Date('2026-08-01T00:00:00.000Z'), completed: false, completedAt: null },
    ])
  })
})
