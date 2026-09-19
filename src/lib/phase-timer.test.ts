import { clockOffset, snoozePhase } from './phase-timer'

const MIN = 60_000
const start = new Date('2026-09-19T10:00:00Z')
const deadlineOf = (r: { durationMinutes: number; phaseStart: Date }) => r.phaseStart.getTime() + r.durationMinutes * MIN

describe('snoozePhase', () => {
  it('in overtime, gives five minutes from now — not five off the overtime', () => {
    // A 10-minute phase, now 57 min 20 s past its deadline.
    const now = new Date(start.getTime() + (10 + 57) * MIN + 20_000)
    const r = snoozePhase(start, 10, now)
    expect(deadlineOf(r) - now.getTime()).toBe(5 * MIN)
  })

  it('before the deadline, adds five to it, exactly as before', () => {
    const now = new Date(start.getTime() + 7 * MIN) // 3 minutes left
    const r = snoozePhase(start, 10, now)
    expect(r).toEqual({ durationMinutes: 15, phaseStart: start })
  })

  it('keeps durations whole minutes and moves the start by less than one', () => {
    const now = new Date(start.getTime() + 67 * MIN + 20_000)
    const r = snoozePhase(start, 10, now)
    expect(Number.isInteger(r.durationMinutes)).toBe(true)
    expect(start.getTime() - r.phaseStart.getTime()).toBeGreaterThanOrEqual(0)
    expect(start.getTime() - r.phaseStart.getTime()).toBeLessThan(MIN)
  })

  it('snoozing twice in overtime gives ten minutes from the first press', () => {
    const now = new Date(start.getTime() + 67 * MIN)
    const once = snoozePhase(start, 10, now)
    const twice = snoozePhase(once.phaseStart, once.durationMinutes, now)
    expect(deadlineOf(twice) - now.getTime()).toBe(10 * MIN)
  })

  it('copes with a phase that had no timer', () => {
    const now = new Date(start.getTime() + 3 * MIN)
    expect(deadlineOf(snoozePhase(start, null, now)) - now.getTime()).toBe(5 * MIN)
    expect(deadlineOf(snoozePhase(null, null, now)) - now.getTime()).toBe(5 * MIN)
  })
})

describe('clockOffset', () => {
  it('is zero when the clocks agree', () => {
    expect(clockOffset(1_000, 1_020, 1_040)).toBe(0)
  })

  it('measures a server that is behind, discounting the flight time', () => {
    // Server six hours behind; 40ms round trip, so it answered at the midpoint.
    const behind = -6 * 60 * 60_000
    expect(clockOffset(1_000, 1_020 + behind, 1_040)).toBe(behind)
  })

  it('measures a server that is ahead', () => {
    expect(clockOffset(1_000, 1_020 + 90_000, 1_040)).toBe(90_000)
  })

  it('corrects a phase deadline back to the truth', () => {
    // The board opened "now" by the server's clock, which is 6h16m behind this
    // browser's. Without the offset the 10-minute phase looks 367 minutes over.
    const skew = -(6 * 60 + 16) * MIN
    const browserNow = Date.now()
    const phaseStart = browserNow + skew
    const deadline = phaseStart + 10 * MIN
    expect(Math.round((deadline - browserNow) / MIN)).toBe(-366)

    const offset = clockOffset(browserNow, browserNow + skew, browserNow)
    expect(Math.round((deadline - (browserNow + offset)) / MIN)).toBe(10)
  })
})
