/**
 * Who may see an action item: exactly the people who may view the board it
 * came from. `boardScopeFor` turns that rule into a filter the database can
 * apply, so it must agree with canViewBoard for every board — checked here by
 * comparing the two directly rather than restating the policy.
 */
import { boardScopeFor, canViewBoard, type AuthUser, type TeamRef } from '@/lib/authz'

const platform = { id: 'team-p', name: 'Platform', createdBy: 'ana@example.com', memberGroups: ['/Eng/Platform'], adminGroups: ['/Eng/Platform/Admins'] }
const trading = { id: 'team-t', name: 'Trading', createdBy: null, memberGroups: ['/Eng/Trading'], adminGroups: [] }
const orphan = { id: 'team-o', name: 'Unconfigured', createdBy: null, memberGroups: [], adminGroups: [] }
const teams = [platform, trading, orphan]

const user = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: 'zed@example.com', name: 'Zed', email: 'zed@example.com', isAdmin: false, groups: [], ...over,
})

/** Would a board with this team (null = open board) pass the scope as SQL would apply it? */
const inScope = (scope: ReturnType<typeof boardScopeFor>, teamId: string | null) =>
  scope.kind === 'all' || (teamId === null ? scope.openBoards : scope.teamIds.includes(teamId))

const viewers: [string, AuthUser | null][] = [
  ['an outsider', user()],
  ['a Platform member', user({ groups: ['/Eng/Platform'] })],
  ['a Platform team admin', user({ groups: ['/Eng/Platform/Admins'] })],
  ["Platform's creator", user({ id: 'ana@example.com' })],
  ['a member of two teams', user({ groups: ['/Eng/Platform', '/Eng/Trading'] })],
  ['a global admin', user({ isAdmin: true })],
  ['nobody (unauthenticated)', null],
]

describe('boardScopeFor agrees with canViewBoard', () => {
  it.each(viewers)('for %s, on every kind of board', (_label, viewer) => {
    const scope = boardScopeFor(viewer, teams)
    const boards: (TeamRef & object | null)[] = [null, ...teams]
    for (const team of boards) {
      const expected = canViewBoard(viewer, { teamId: team?.id ?? null, creator: '', team })
      expect({ board: team?.name ?? 'open board', visible: inScope(scope, team?.id ?? null) })
        .toEqual({ board: team?.name ?? 'open board', visible: expected })
    }
  })
})

describe('what that means for the Actions page', () => {
  it("hides another team's actions from an outsider, but not open-board ones", () => {
    const scope = boardScopeFor(user(), teams)
    expect(scope).toEqual({ kind: 'some', openBoards: true, teamIds: [] })
  })

  it('gives a member their own team only', () => {
    const scope = boardScopeFor(user({ groups: ['/Eng/Trading'] }), teams)
    expect(scope).toEqual({ kind: 'some', openBoards: true, teamIds: ['team-t'] })
  })

  it('gives an unauthenticated caller nothing at all', () => {
    expect(boardScopeFor(null, teams)).toEqual({ kind: 'some', openBoards: false, teamIds: [] })
  })

  it('never lets an unconfigured team leak to non-admins (fail closed)', () => {
    const scope = boardScopeFor(user({ groups: ['/Eng/Platform', '/Eng/Trading'] }), teams)
    expect(scope.kind === 'some' && scope.teamIds).not.toContain('team-o')
  })
})
