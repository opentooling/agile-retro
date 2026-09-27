/**
 * The Teams screen lists every team so people can see what exists and ask for
 * access. That is only safe if two things hold, so both are pinned here:
 *
 *   1. a team you have no access to is reduced to its name and logo, and
 *   2. changing a team's settings still needs team-admin.
 *
 * The shaping below mirrors `getTeamDirectory`; the server action itself needs
 * a Next.js request context, so the policy it applies is exercised directly.
 */
import { teamAccessLevel, canAdministerTeam, type AuthUser } from '@/lib/authz'

type StoredTeam = {
  id: string
  name: string
  createdAt: Date
  createdBy: string | null
  memberGroups: string[]
  adminGroups: string[]
  imageData: string | null
  jiraBaseUrl: string | null
  jiraEmail: string | null
}

const platform: StoredTeam = {
  id: 'team-1',
  name: 'Platform',
  createdAt: new Date('2026-01-01'),
  createdBy: 'ana@example.com',
  memberGroups: ['/Eng/Platform'],
  adminGroups: ['/Eng/Platform/Admins'],
  imageData: 'data:image/png;base64,AAA',
  jiraBaseUrl: 'https://jira.internal',
  jiraEmail: 'svc-retro@example.com',
}

const trading: StoredTeam = {
  ...platform,
  id: 'team-2',
  name: 'Trading',
  createdBy: null,
  memberGroups: ['/Eng/Trading'],
  adminGroups: ['/Eng/Trading/Admins'],
}

const user = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: 'zed@example.com', name: 'Zed', email: 'zed@example.com', isAdmin: false, groups: [], ...over,
})

/** The shaping `getTeamDirectory` applies, kept in step with it. */
function directory(viewer: AuthUser | null, teams: StoredTeam[]) {
  return teams
    .map((team) => {
      const access = teamAccessLevel(viewer, team)
      if (access === 'none') {
        const { id, name, createdAt, imageData } = team
        return { id, name, createdAt, imageData, access }
      }
      return { ...team, access }
    })
    .sort((a, b) => {
      const mine = Number(b.access !== 'none') - Number(a.access !== 'none')
      return mine !== 0 ? mine : a.name.localeCompare(b.name)
    })
}

describe('the team directory', () => {
  it('lists teams the viewer has no access to', () => {
    // The point of the change: a team you are not in is still discoverable, so
    // you can see it exists and go ask to be added.
    const names = directory(user(), [platform, trading]).map((t) => t.name)
    expect(names).toEqual(['Platform', 'Trading'])
  })

  it('sends nothing but a name and a logo for a team you cannot reach', () => {
    // Access groups spell out the company's AD structure and the Jira fields
    // carry a server address and the account it syncs as. None of it travels.
    const [entry] = directory(user(), [platform])
    expect(entry.access).toBe('none')
    expect(entry).toEqual({
      id: 'team-1',
      name: 'Platform',
      createdAt: platform.createdAt,
      imageData: platform.imageData,
      access: 'none',
    })
  })

  it('keeps the detail for teams the viewer belongs to', () => {
    const [entry] = directory(user({ groups: ['/Eng/Platform'] }), [platform])
    expect(entry.access).toBe('member')
    expect(entry).toMatchObject({ memberGroups: ['/Eng/Platform'], jiraEmail: 'svc-retro@example.com' })
  })

  it('puts the viewer\'s own teams first', () => {
    // Alphabetically Platform leads; membership of Trading has to outrank that.
    const listed = directory(user({ groups: ['/Eng/Trading'] }), [platform, trading])
    expect(listed.map((t) => t.name)).toEqual(['Trading', 'Platform'])
  })

  it('gives an unauthenticated viewer nothing', () => {
    expect(directory(null, [platform]).every((t) => t.access === 'none')).toBe(true)
  })
})

describe('changing a team\'s settings', () => {
  it('refuses an outsider', () => {
    // updateTeam / updateTeamImage / updateTeamJira previously had no check at
    // all — any signed-in caller could rename any team by id.
    expect(canAdministerTeam(user({ groups: ['/Eng/Trading'] }), platform)).toBe(false)
  })

  it('refuses a plain member', () => {
    expect(canAdministerTeam(user({ groups: ['/Eng/Platform'] }), platform)).toBe(false)
  })

  it('allows a team admin, the creator and a global admin', () => {
    expect(canAdministerTeam(user({ groups: ['/Eng/Platform/Admins'] }), platform)).toBe(true)
    expect(canAdministerTeam(user({ id: 'ana@example.com' }), platform)).toBe(true)
    expect(canAdministerTeam(user({ isAdmin: true }), platform)).toBe(true)
  })

  it('refuses an unauthenticated caller', () => {
    expect(canAdministerTeam(null, platform)).toBe(false)
  })

  it('fails closed on a team with no groups and no creator', () => {
    const orphan = { ...platform, createdBy: null, memberGroups: [], adminGroups: [] }
    expect(canAdministerTeam(user(), orphan)).toBe(false)
    expect(canAdministerTeam(user({ isAdmin: true }), orphan)).toBe(true)
  })
})
