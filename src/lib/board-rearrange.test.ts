import { placeBefore, neighbourFor } from './board-order'
import { canRearrangeItem, canChangeActionItems, type AuthUser, type RetroRef } from './authz'

describe('placeBefore', () => {
  it('reorders within a column', () => {
    expect(placeBefore(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
    expect(placeBefore(['a', 'b', 'c', 'd'], 'a', 'd')).toEqual(['b', 'c', 'a', 'd'])
  })

  it('puts a card at the end when there is nothing to go before', () => {
    expect(placeBefore(['a', 'b'], 'a', null)).toEqual(['b', 'a'])
    expect(placeBefore([], 'x', null)).toEqual(['x'])
  })

  it('inserts a card arriving from another column', () => {
    expect(placeBefore(['a', 'b'], 'x', 'b')).toEqual(['a', 'x', 'b'])
  })

  it('keeps cards the mover cannot see in place (blind input)', () => {
    // The mover sees only m1 and m2; h1 and h2 are hidden from them. Dropping
    // m2 before m1 must not disturb the hidden cards' positions relative to m1.
    expect(placeBefore(['h1', 'm1', 'h2', 'm2'], 'm2', 'm1')).toEqual(['h1', 'm2', 'm1', 'h2'])
  })

  it('treats an unknown target as "at the end" rather than failing', () => {
    expect(placeBefore(['a', 'b'], 'a', 'gone')).toEqual(['b', 'a'])
  })
})

describe('neighbourFor', () => {
  const ids = ['a', 'b', 'c']
  it('moves up before the previous card', () => expect(neighbourFor(ids, 'b', 'up')).toBe('a'))
  it('moves down before the card two below, or to the end', () => {
    expect(neighbourFor(ids, 'a', 'down')).toBe('c')
    expect(neighbourFor(ids, 'b', 'down')).toBeNull()
  })
  it('says when a card is already at that end', () => {
    expect(neighbourFor(ids, 'a', 'up')).toBeUndefined()
    expect(neighbourFor(ids, 'c', 'down')).toBeUndefined()
  })
  it('round-trips: down then up restores the order', () => {
    const down = placeBefore(ids, 'a', neighbourFor(ids, 'a', 'down'))
    expect(down).toEqual(['b', 'a', 'c'])
    expect(placeBefore(down, 'a', neighbourFor(down, 'a', 'up'))).toEqual(ids)
  })
})

const author: AuthUser = { id: 'zed@example.com', name: 'Zed', email: 'zed@example.com', isAdmin: false, groups: [] }
const other: AuthUser = { ...author, id: 'amy@example.com', name: 'Amy', email: 'amy@example.com' }
const board = (status: string): RetroRef => ({ teamId: null, creator: 'Fay', status })
const card = { userId: 'zed@example.com', username: 'Zed' }

describe('canRearrangeItem', () => {
  it('lets the author delete or move their card while cards are being written', () => {
    expect(canRearrangeItem(author, board('INPUT'), card)).toBe(true)
  })
  it("refuses someone else's card", () => {
    expect(canRearrangeItem(other, board('INPUT'), card)).toBe(false)
  })
  it('lets the facilitator rearrange anyone\'s card', () => {
    expect(canRearrangeItem({ ...other, name: 'Fay', id: 'fay@example.com' }, board('INPUT'), card)).toBe(true)
  })
  it('refuses once voting has started — that would reshuffle cast votes', () => {
    for (const phase of ['VOTING', 'REVIEW', 'ACTIONS', 'CLOSED']) {
      expect(canRearrangeItem(author, board(phase), card)).toBe(false)
    }
  })
})

describe('canChangeActionItems', () => {
  it('lets any participant edit or delete during the Actions phase', () => {
    expect(canChangeActionItems(other, board('ACTIONS'))).toBe(true)
  })
  it('refuses outside the Actions phase', () => {
    for (const phase of ['INPUT', 'VOTING', 'REVIEW', 'CLOSED']) {
      expect(canChangeActionItems(other, board(phase))).toBe(false)
    }
  })
  it("refuses someone who can't see the board", () => {
    const locked: RetroRef = { teamId: 't', creator: 'Fay', status: 'ACTIONS', team: { id: 't', memberGroups: ['/X'], adminGroups: [] } }
    expect(canChangeActionItems(other, locked)).toBe(false)
  })
})
