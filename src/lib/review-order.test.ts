import { isCustomOrder, moveInReview, orderedForReview } from './review-order'

const entry = (id: string, total: number, reviewOrder?: number | null) => ({ id, total, reviewOrder })

describe('orderedForReview', () => {
  it('ranks by votes while nobody has arranged the queue', () => {
    const queue = orderedForReview([entry('a', 1), entry('b', 5), entry('c', 3)])
    expect(queue.map((e) => e.id)).toEqual(['b', 'c', 'a'])
  })

  it('keeps cards with equal votes in the order they came', () => {
    const queue = orderedForReview([entry('a', 0), entry('b', 0), entry('c', 0)])
    expect(queue.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('follows the facilitator once they have arranged it, votes and all', () => {
    const queue = orderedForReview([entry('a', 1, 0), entry('b', 5, 1), entry('c', 3, 2)])
    expect(queue.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('knows which of the two it is showing', () => {
    expect(isCustomOrder([entry('a', 1), entry('b', 2)])).toBe(false)
    expect(isCustomOrder([entry('a', 1, 0), entry('b', 2)])).toBe(true)
  })
})

describe('moveInReview', () => {
  const board = [entry('top', 5), entry('mid', 3), entry('low', 1), entry('none', 0), entry('none2', 0)]

  it('lifts a card one place up the queue', () => {
    expect(moveInReview(board, 'low', -1)).toEqual(['top', 'low', 'mid', 'none', 'none2'])
  })

  it('drops a card one place down', () => {
    expect(moveInReview(board, 'top', 1)).toEqual(['mid', 'top', 'low', 'none', 'none2'])
  })

  it('will not move the top card up or the last one down', () => {
    expect(moveInReview(board, 'top', -1)).toBeNull()
    expect(moveInReview(board, 'none2', 1)).toBeNull()
  })

  it('keeps a card inside its own group, so it cannot vanish across the divide', () => {
    // 'low' has votes, 'none' has not: they are drawn under different headings.
    expect(moveInReview(board, 'low', 1)).toBeNull()
    expect(moveInReview(board, 'none', -1)).toBeNull()
  })

  it('reorders cards nobody voted for, among themselves', () => {
    expect(moveInReview(board, 'none2', -1)).toEqual(['top', 'mid', 'low', 'none2', 'none'])
  })

  it('moves within an order the facilitator already set', () => {
    const arranged = [entry('a', 5, 0), entry('b', 1, 1), entry('c', 3, 2)]
    expect(moveInReview(arranged, 'c', -1)).toEqual(['a', 'c', 'b'])
  })

  it('ignores a card that is not on the board', () => {
    expect(moveInReview(board, 'ghost', -1)).toBeNull()
  })
})
