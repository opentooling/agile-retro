import { buildProfile, assigneeNamesFor } from './profile'
import type { UserActivityRaw } from './db/types'

const d = (iso: string) => new Date(iso)
const card = (over: Partial<UserActivityRaw['cards'][number]>) => ({
  id: 'c', content: 'x', createdAt: d('2026-09-01'), columnTitle: 'Went well', columnType: 'WENT_WELL',
  retroId: 'r1', retroTitle: 'Sprint 1', teamId: 'mine', isAnonymous: false, ...over,
})

const raw: UserActivityRaw = {
  facilitated: [
    { id: 'r1', title: 'Sprint 1', status: 'CLOSED', createdAt: d('2026-09-01'), teamId: 'mine' },
    { id: 'rX', title: 'Secret board', status: 'CLOSED', createdAt: d('2026-09-05'), teamId: 'lost' },
  ],
  cards: [
    card({ id: 'c1', createdAt: d('2026-09-03'), columnType: 'TO_IMPROVE' }),
    card({ id: 'c2', createdAt: d('2026-09-02') }),
    card({ id: 'c3', createdAt: d('2026-09-01'), columnType: 'TO_IMPROVE', retroId: 'r2' }),
    card({ id: 'cX', createdAt: d('2026-09-06'), retroId: 'rX', retroTitle: 'Secret board', teamId: 'lost' }),
  ],
  votes: [{ retroId: 'r1', teamId: 'mine', count: 5 }, { retroId: 'rX', teamId: 'lost', count: 9 }],
  reactions: [{ retroId: 'r3', teamId: null, count: 2 }],
}
const scope = { kind: 'some' as const, openBoards: true, teamIds: ['mine'] }

describe('buildProfile', () => {
  it('counts only boards the viewer can open now', () => {
    const p = buildProfile(raw, scope)
    expect(p.stats).toEqual({ boardsRun: 1, boardsJoined: 3, cards: 3, stars: 5, reactions: 2 })
    // Neither the title nor the card from a board they lost access to appears.
    expect(p.recentBoardsRun.map((b) => b.title)).not.toContain('Secret board')
    expect(p.recentCards.map((c) => c.id)).not.toContain('cX')
  })

  it('counts a board as joined by writing, starring or reacting — once', () => {
    // r1: cards + stars; r2: a card; r3: a reaction on an open board.
    expect(buildProfile(raw, scope).stats.boardsJoined).toBe(3)
  })

  it('shows everything to a global admin', () => {
    expect(buildProfile(raw, { kind: 'all' }).stats.cards).toBe(4)
  })

  it('says what they tend to raise, largest share first', () => {
    const p = buildProfile(raw, scope)
    expect(p.raises[0]).toMatchObject({ sentiment: 'improve', count: 2 })
    expect(p.raises.reduce((n, r) => n + r.share, 0)).toBeCloseTo(1)
  })

  it('knows when they were last active, and says nothing for a newcomer', () => {
    expect(buildProfile(raw, scope).lastActive).toEqual(d('2026-09-03'))
    const empty = buildProfile({ facilitated: [], cards: [], votes: [], reactions: [] }, scope)
    expect(empty.lastActive).toBeNull()
    expect(empty.raises).toEqual([])
  })
})

describe('assigneeNamesFor', () => {
  it('covers name, email and handle, with and without @', () => {
    expect(assigneeNamesFor('Ana Silva', 'ana@example.com').sort()).toEqual(
      ['@Ana Silva', '@ana', '@ana@example.com', 'Ana Silva', 'ana', 'ana@example.com'].sort(),
    )
  })
  it('copes with a missing email', () => {
    expect(assigneeNamesFor('Zed', null)).toEqual(['Zed', '@Zed'])
  })
})
