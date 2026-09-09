import { buildInsights, median } from './analytics'
import type { TeamAnalyticsRaw } from './db/types'

const DAY = 86_400_000
const NOW = new Date('2026-03-01T00:00:00Z')

const raw = (over: Partial<TeamAnalyticsRaw> = {}): TeamAnalyticsRaw => ({
  retroDates: [],
  itemsByColumnType: [],
  actions: { open: 0, done: 0, overdue: 0, daysToClose: [] },
  engagement: { totalItems: 0, itemsWithSummary: 0, retrosWithItems: 0, voteSpread: [], contributorsPerRetro: [] },
  phaseDurations: [],
  ...over,
})

describe('median', () => {
  it('handles odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})

describe('buildInsights', () => {
  it('reports nothing rather than zeroes for a team with no retros', () => {
    // A brand-new team must not look like a team with a 0% completion rate.
    const i = buildInsights(raw(), NOW)
    expect(i.retroCount).toBe(0)
    expect(i.lastRetroAt).toBeNull()
    expect(i.medianGapDays).toBeNull()
    expect(i.actions.completionRate).toBeNull()
    expect(i.engagement.discussionCoverage).toBeNull()
  })

  it('measures cadence from the gaps between retros', () => {
    const i = buildInsights(raw({
      retroDates: [
        new Date(NOW.getTime() - 42 * DAY),
        new Date(NOW.getTime() - 28 * DAY),
        new Date(NOW.getTime() - 7 * DAY),
      ],
    }), NOW)
    expect(i.retroCount).toBe(3)
    expect(i.medianGapDays).toBe(17.5) // gaps of 14 and 21
    expect(i.daysSinceLastRetro).toBe(7)
  })

  it('needs two retros before it claims a cadence', () => {
    expect(buildInsights(raw({ retroDates: [NOW] }), NOW).medianGapDays).toBeNull()
  })

  it('folds column types into sentiment so formats are comparable', () => {
    // Start/Stop/Continue and 4Ls describe the same feelings differently.
    const i = buildInsights(raw({
      itemsByColumnType: [
        { type: 'START', items: 3 },
        { type: 'LIKED_POSITIVE', items: 1 },
        { type: 'STOP', items: 6 },
      ],
    }), NOW)
    const positive = i.sentiment.find((s) => s.sentiment === 'positive')!
    const negative = i.sentiment.find((s) => s.sentiment === 'negative')!
    expect(positive.items).toBe(4)
    expect(negative.items).toBe(6)
    expect(negative.share).toBeCloseTo(0.6)
  })

  it('computes action follow-through', () => {
    const i = buildInsights(raw({
      actions: { open: 2, done: 6, overdue: 1, daysToClose: [4, 10, 6, 8, 20, 2] },
    }), NOW)
    expect(i.actions.completionRate).toBe(0.75)
    expect(i.actions.medianDaysToClose).toBe(7)
    expect(i.actions.untimedCompletions).toBe(0)
  })

  it('says how many completions it could not time, rather than skewing the median', () => {
    // Actions closed before the timestamps existed have no duration. Silently
    // taking the median of the rest would overstate how fast the team is.
    const i = buildInsights(raw({
      actions: { open: 0, done: 10, overdue: 0, daysToClose: [3, 5] },
    }), NOW)
    expect(i.actions.medianDaysToClose).toBe(4)
    expect(i.actions.untimedCompletions).toBe(8)
  })

  it('measures discussion coverage and vote concentration', () => {
    const i = buildInsights(raw({
      engagement: {
        totalItems: 20, itemsWithSummary: 5, retrosWithItems: 2,
        voteSpread: [{ total: 10, topThree: 8 }, { total: 10, topThree: 4 }],
        contributorsPerRetro: [4, 6],
      },
    }), NOW)
    expect(i.engagement.avgItemsPerRetro).toBe(10)
    expect(i.engagement.discussionCoverage).toBe(0.25)
    expect(i.engagement.voteConcentration).toBe(0.6)
    expect(i.engagement.avgContributors).toBe(5)
  })

  it('reports phase durations in minutes, with the sample count', () => {
    const i = buildInsights(raw({
      phaseDurations: [
        { phase: 'INPUT', seconds: 600 },
        { phase: 'INPUT', seconds: 900 },
        { phase: 'REVIEW', seconds: 1800 },
      ],
    }), NOW)
    expect(i.phases[0]).toEqual({ phase: 'REVIEW', medianMinutes: 30, samples: 1 })
    expect(i.phases[1]).toEqual({ phase: 'INPUT', medianMinutes: 12.5, samples: 2 })
  })

  it('never divides by zero', () => {
    const i = buildInsights(raw({
      itemsByColumnType: [{ type: 'START', items: 0 }],
      engagement: { totalItems: 0, itemsWithSummary: 0, retrosWithItems: 0, voteSpread: [{ total: 0, topThree: 0 }], contributorsPerRetro: [] },
    }), NOW)
    expect(i.sentiment[0].share).toBe(0)
    expect(i.engagement.voteConcentration).toBeNull()
    expect(i.engagement.avgContributors).toBeNull()
  })
})
