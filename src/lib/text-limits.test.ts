import { acceptText, MAX_TEXT_LENGTH } from './text-limits'

describe('acceptText', () => {
  it('trims and accepts ordinary text', () => expect(acceptText('  a card  ')).toBe('a card'))
  it('refuses empty or whitespace-only text', () => {
    expect(acceptText('')).toBeNull()
    expect(acceptText('   ')).toBeNull()
  })
  it('refuses anything that is not a string', () => {
    expect(acceptText(undefined)).toBeNull()
    expect(acceptText({ toString: () => 'x' })).toBeNull()
  })
  it('accepts exactly the limit and refuses one more', () => {
    expect(acceptText('x'.repeat(MAX_TEXT_LENGTH))).toHaveLength(MAX_TEXT_LENGTH)
    expect(acceptText('x'.repeat(MAX_TEXT_LENGTH + 1))).toBeNull()
  })
})
