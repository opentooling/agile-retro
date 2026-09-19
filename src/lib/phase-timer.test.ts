import { snoozePhase } from './phase-timer'

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
