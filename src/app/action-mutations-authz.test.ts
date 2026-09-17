/**
 * The server actions that change action items, called directly — the way an
 * attacker would, not through the page that hides the buttons.
 *
 * Both used to accept any action id from any signed-in user: the Actions page
 * only decided whether to *render* "Mark Done", and creating a Jira issue had
 * no check at all.
 */
jest.mock('@/auth', () => ({ auth: jest.fn() }))
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('@/lib/jira-sync', () => ({ pushActionDoneState: jest.fn() }))
jest.mock('@/lib/plugins/registry', () => ({
  getPlugin: () => ({ createTaskForAction: jest.fn(async () => ({ url: 'https://jira.invalid/X-1', key: 'X-1' })) }),
}))
jest.mock('@/lib/purge', () => ({ purgeExpiredRetros: jest.fn() }))
jest.mock('@/lib/db', () => ({
  getActionItem: jest.fn(),
  getRetro: jest.fn(),
  getTeam: jest.fn(),
  updateActionCompleted: jest.fn(),
  setActionExternalLink: jest.fn(),
}))

import { auth } from '@/auth'
import * as db from '@/lib/db'
import { setActionCompleted, createExternalTaskForAction } from './actions'

const platform = { id: 'team-p', name: 'Platform', createdBy: null, memberGroups: ['/Eng/Platform'], adminGroups: [] }
const action = { id: 'act-1', retrospectiveId: 'retro-p', completed: false, externalUrl: null, externalKey: null }
const retro = { id: 'retro-p', teamId: 'team-p', creator: 'ana', status: 'CLOSED' }

const signInAs = (groups: string[]) =>
  (auth as unknown as jest.Mock).mockResolvedValue({ user: { name: 'Zed', email: 'zed@example.com' }, groups })

beforeEach(() => {
  jest.clearAllMocks()
  ;(db.getActionItem as jest.Mock).mockResolvedValue(action)
  ;(db.getRetro as jest.Mock).mockResolvedValue(retro)
  ;(db.getTeam as jest.Mock).mockResolvedValue(platform)
})

describe('setActionCompleted', () => {
  it("refuses someone outside the action's team, and changes nothing", async () => {
    signInAs(['/Eng/Trading'])
    await expect(setActionCompleted('act-1', true)).rejects.toThrow('Unauthorized')
    expect(db.updateActionCompleted).not.toHaveBeenCalled()
  })

  it('refuses an unauthenticated caller', async () => {
    ;(auth as unknown as jest.Mock).mockResolvedValue(null)
    await expect(setActionCompleted('act-1', true)).rejects.toThrow('Unauthorized')
    expect(db.updateActionCompleted).not.toHaveBeenCalled()
  })

  it('lets a team member tick it off — even on a closed board', async () => {
    signInAs(['/Eng/Platform'])
    await setActionCompleted('act-1', true)
    expect(db.updateActionCompleted).toHaveBeenCalledWith('act-1', true)
  })
})

describe('createExternalTaskForAction', () => {
  it("refuses to create an issue in another team's Jira", async () => {
    signInAs(['/Eng/Trading'])
    await expect(createExternalTaskForAction('act-1', 'jira')).rejects.toThrow('Unauthorized')
    expect(db.setActionExternalLink).not.toHaveBeenCalled()
  })

  it('creates it for a team member', async () => {
    signInAs(['/Eng/Platform'])
    await expect(createExternalTaskForAction('act-1', 'jira')).resolves.toEqual({ url: 'https://jira.invalid/X-1', key: 'X-1' })
  })
})
