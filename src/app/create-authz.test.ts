/**
 * The authorization decisions behind board creation, exercised directly.
 *
 * The server action itself needs a Next.js request context, so these test the
 * policy it now applies — the same `canViewBoard` call, against the same shapes.
 */
import { canViewBoard, type AuthUser, type TeamRef } from '@/lib/authz'

const team: TeamRef = {
  id: 'team-1',
  name: 'Platform',
  createdBy: 'ana@example.com',
  memberGroups: ['/Eng/Platform'],
  adminGroups: ['/Eng/Platform/Admins'],
}

const user = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: 'zed@example.com', name: 'Zed', email: 'zed@example.com', isAdmin: false, groups: [], ...over,
})

const mayCreateAgainst = (u: AuthUser | null, t: TeamRef) =>
  canViewBoard(u, { teamId: t!.id, creator: '', team: t })

describe('creating a board against a team', () => {
  it('refuses someone outside the team', () => {
    // Previously unchecked: anyone could drop a board into any team's space,
    // polluting its history and insights — and then not even open it.
    expect(mayCreateAgainst(user({ groups: ['/Some/Other'] }), team)).toBe(false)
  })

  it('allows a member and a team admin', () => {
    expect(mayCreateAgainst(user({ groups: ['/Eng/Platform'] }), team)).toBe(true)
    expect(mayCreateAgainst(user({ groups: ['/Eng/Platform/Admins'] }), team)).toBe(true)
  })

  it('allows a global admin', () => {
    expect(mayCreateAgainst(user({ isAdmin: true }), team)).toBe(true)
  })

  it('refuses an unauthenticated caller', () => {
    expect(mayCreateAgainst(null, team)).toBe(false)
  })

  it('fails closed for a team with no groups configured', () => {
    const unconfigured: TeamRef = { id: 't2', name: 'New', createdBy: null, memberGroups: [], adminGroups: [] }
    expect(mayCreateAgainst(user(), unconfigured)).toBe(false)
    expect(mayCreateAgainst(user({ isAdmin: true }), unconfigured)).toBe(true)
  })

  it('lists only teams the viewer can use, so the picker cannot offer others', () => {
    const other: TeamRef = { id: 't3', name: 'Trading', createdBy: null, memberGroups: ['/Eng/Trading'], adminGroups: [] }
    const me = user({ groups: ['/Eng/Platform'] })
    const visible = [team, other].filter((t) => mayCreateAgainst(me, t)).map((t) => t!.name)
    expect(visible).toEqual(['Platform'])
  })
})
