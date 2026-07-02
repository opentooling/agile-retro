import {
  parseGroupsClaim,
  authUserFromSession,
  authUserFromToken,
  canViewBoard,
  canManageBoard,
  canEditItem,
  isFacilitator,
  type AuthUser,
  type RetroRef,
} from './authz'

const TEAM_ID = 'team-uuid-123'

const teamBoard: RetroRef = {
  teamId: TEAM_ID,
  creator: 'Alice',
  team: {
    id: TEAM_ID,
    name: 'Platform',
    createdBy: 'alice@example.com',
    memberGroups: ['/Eng/Platform'],
    adminGroups: ['/Eng/Platform/Admins'],
  },
}

const openBoard: RetroRef = { teamId: null, creator: 'Alice', team: null }

function makeUser(over: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'bob@example.com',
    name: 'Bob',
    email: 'bob@example.com',
    isAdmin: false,
    groups: [],
    ...over,
  }
}

describe('parseGroupsClaim', () => {
  it('keeps only non-empty strings from an array', () => {
    expect(parseGroupsClaim(['/a', ' ', 'b', 5, null])).toEqual(['/a', 'b'])
    expect(parseGroupsClaim(undefined)).toEqual([])
    expect(parseGroupsClaim(42)).toEqual([])
  })

  it('splits a delimited string (comma/newline), not on spaces within names', () => {
    expect(parseGroupsClaim('/Eng/Platform, Platform-Admins')).toEqual(['/Eng/Platform', 'Platform-Admins'])
    expect(parseGroupsClaim('/a\n/b')).toEqual(['/a', '/b'])
    expect(parseGroupsClaim('Retro Admins')).toEqual(['Retro Admins'])
  })
})

describe('authUserFromSession / authUserFromToken', () => {
  it('builds a user with groups from a session', () => {
    const u = authUserFromSession({
      user: { name: 'Bob', email: 'BOB@example.com' },
      roles: ['user', 'admin'],
      groups: ['/Eng/Platform'],
    })
    expect(u?.id).toBe('bob@example.com')
    expect(u?.isAdmin).toBe(true)
    expect(u?.groups).toEqual(['/Eng/Platform'])
  })

  it('returns null without an authenticated user', () => {
    expect(authUserFromSession(null)).toBeNull()
    expect(authUserFromSession({})).toBeNull()
    expect(authUserFromToken(null)).toBeNull()
  })

  it('falls back to sub when there is no email or name', () => {
    expect(authUserFromToken({ sub: 'abc-123', roles: ['user'] })?.id).toBe('abc-123')
  })
})

describe('global admin via ADMIN_GROUPS env', () => {
  const prev = process.env.ADMIN_GROUPS
  afterEach(() => {
    if (prev === undefined) delete process.env.ADMIN_GROUPS
    else process.env.ADMIN_GROUPS = prev
  })

  it('makes a user in an ADMIN_GROUPS group a global admin', () => {
    process.env.ADMIN_GROUPS = '/Eng/Retro-Admins, Platform-Admins'
    const u = authUserFromSession({ user: { name: 'Bob', email: 'bob@x.com' }, groups: ['/Eng/Retro-Admins'] })
    expect(u?.isAdmin).toBe(true)
    // And that admin can view/manage any team board.
    expect(canViewBoard(u, teamBoard)).toBe(true)
    expect(canManageBoard(u, teamBoard)).toBe(true)
  })

  it('does not grant admin to users outside the configured groups', () => {
    process.env.ADMIN_GROUPS = '/Eng/Retro-Admins'
    const u = authUserFromSession({ user: { name: 'Bob', email: 'bob@x.com' }, groups: ['/Eng/Other'] })
    expect(u?.isAdmin).toBe(false)
  })

  it('still honors the admin realm role when ADMIN_GROUPS is unset', () => {
    delete process.env.ADMIN_GROUPS
    const u = authUserFromSession({ user: { name: 'Bob', email: 'bob@x.com' }, roles: ['admin'] })
    expect(u?.isAdmin).toBe(true)
  })
})

describe('canViewBoard', () => {
  it('lets any authenticated user view an open board', () => {
    expect(canViewBoard(makeUser(), openBoard)).toBe(true)
  })

  it('requires a session even for open boards', () => {
    expect(canViewBoard(null, openBoard)).toBe(false)
  })

  it('blocks users not in the team groups', () => {
    expect(canViewBoard(makeUser({ groups: ['/Eng/Other'] }), teamBoard)).toBe(false)
  })

  it('allows members, admins-group and global admins', () => {
    expect(canViewBoard(makeUser({ groups: ['/Eng/Platform'] }), teamBoard)).toBe(true)
    expect(canViewBoard(makeUser({ groups: ['/Eng/Platform/Admins'] }), teamBoard)).toBe(true)
    expect(canViewBoard(makeUser({ isAdmin: true }), teamBoard)).toBe(true)
  })

  it('matches a configured group by last path segment', () => {
    const board: RetroRef = {
      teamId: TEAM_ID,
      creator: 'Alice',
      team: { id: TEAM_ID, name: 'Platform', memberGroups: ['Platform'] },
    }
    expect(canViewBoard(makeUser({ groups: ['/Eng/Platform'] }), board)).toBe(true)
  })

  it('fails closed when the team has no groups configured', () => {
    const board: RetroRef = {
      teamId: TEAM_ID,
      creator: 'Alice',
      team: { id: TEAM_ID, name: 'Empty', memberGroups: [], adminGroups: [] },
    }
    expect(canViewBoard(makeUser({ groups: ['/anything'] }), board)).toBe(false)
    expect(canViewBoard(makeUser({ isAdmin: true }), board)).toBe(true)
  })
})

describe('isFacilitator / canManageBoard', () => {
  const facilitator = makeUser({ name: 'Alice', email: 'alice@x.com', id: 'alice@x.com' })

  it('recognizes the board creator by name', () => {
    expect(isFacilitator(facilitator, teamBoard)).toBe(true)
    expect(isFacilitator(makeUser(), teamBoard)).toBe(false)
  })

  it('grants management to facilitator, admin-group, team creator and global admin only', () => {
    expect(canManageBoard(facilitator, teamBoard)).toBe(true)
    expect(canManageBoard(makeUser({ groups: ['/Eng/Platform/Admins'] }), teamBoard)).toBe(true)
    // team.createdBy is a team-admin
    expect(canManageBoard(makeUser({ id: 'alice@example.com', email: 'alice@example.com' }), teamBoard)).toBe(true)
    expect(canManageBoard(makeUser({ isAdmin: true }), teamBoard)).toBe(true)
    // A plain member cannot manage.
    expect(canManageBoard(makeUser({ groups: ['/Eng/Platform'] }), teamBoard)).toBe(false)
  })

  it('on an open board only facilitator/admin manage', () => {
    expect(canManageBoard(makeUser({ groups: ['/Eng/Platform/Admins'] }), openBoard)).toBe(false)
    expect(canManageBoard(makeUser({ isAdmin: true }), openBoard)).toBe(true)
  })
})

describe('canEditItem', () => {
  const item = { userId: 'carol@example.com', username: 'Carol' }

  it('lets the author edit their own item', () => {
    expect(
      canEditItem(makeUser({ id: 'carol@example.com', name: 'Carol', email: 'carol@example.com' }), teamBoard, item)
    ).toBe(true)
  })

  it('lets facilitator / admin-group / global admin edit any item', () => {
    expect(canEditItem(makeUser({ name: 'Alice', email: 'alice@x.com', id: 'alice@x.com' }), teamBoard, item)).toBe(true)
    expect(canEditItem(makeUser({ groups: ['/Eng/Platform/Admins'] }), teamBoard, item)).toBe(true)
    expect(canEditItem(makeUser({ isAdmin: true }), teamBoard, item)).toBe(true)
  })

  it('blocks an unrelated member from editing someone else’s item', () => {
    expect(canEditItem(makeUser({ groups: ['/Eng/Platform'] }), teamBoard, item)).toBe(false)
  })

  it('falls back to matching author by username for legacy items', () => {
    expect(canEditItem(makeUser(), teamBoard, { userId: 'legacy-id', username: 'Bob' })).toBe(true)
  })
})
