import { expiryFromRetention, RETENTION_OPTIONS, DEFAULT_RETENTION } from './retention'

const DAY = 24 * 60 * 60 * 1000
const from = new Date('2026-01-01T00:00:00.000Z')

describe('expiryFromRetention', () => {
  it('keeps boards indefinitely by default', () => {
    expect(DEFAULT_RETENTION).toBe('never')
    expect(expiryFromRetention(DEFAULT_RETENTION, from)).toBeNull()
  })

  it('turns a retention choice into an absolute expiry', () => {
    expect(expiryFromRetention('30', from)!.getTime()).toBe(from.getTime() + 30 * DAY)
    expect(expiryFromRetention('365', from)!.getTime()).toBe(from.getTime() + 365 * DAY)
  })

  it('never shortens a board’s life on unrecognised input', () => {
    // A stale form, a hand-crafted request or a typo must fail safe: keep the
    // board, never delete it sooner than asked.
    for (const bad of ['', '  ', 'forever', '7', '-30', '99999', null, undefined]) {
      expect(expiryFromRetention(bad, from)).toBeNull()
    }
  })

  it('offers only options the parser understands', () => {
    for (const option of RETENTION_OPTIONS) {
      const result = expiryFromRetention(option.value, from)
      if (option.days === null) expect(result).toBeNull()
      else expect(result!.getTime()).toBe(from.getTime() + option.days * DAY)
    }
  })
})
