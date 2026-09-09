import { applyBlindInput, redactTeam } from './sanitize'
import { RETRO_TEMPLATES, templateById, DEFAULT_TEMPLATE_ID } from './retro-templates'
import type { ClientRetroFull } from './sanitize'

const item = (id: string, userId: string) =>
  ({ id, content: id, summary: null, userId, username: userId, columnId: 'c1', order: 0, createdAt: new Date(), votes: [], reactions: [] }) as any

const board = (over: Partial<ClientRetroFull> = {}): ClientRetroFull =>
  ({
    id: 'r1',
    title: 'Retro',
    status: 'INPUT',
    tags: '',
    creator: 'ana',
    createdAt: new Date(),
    isAnonymous: false,
    blindInput: true,
    inputDuration: 10,
    votingDuration: 5,
    reviewDuration: 10,
    phaseStartTime: new Date(),
    teamId: 't1',
    team: null,
    actions: [],
    columns: [
      { id: 'c1', title: 'Went well', type: 'WHAT_WENT_WELL', retrospectiveId: 'r1', items: [item('mine', 'ana'), item('theirs', 'bo'), item('other', 'cy')] },
    ],
    ...over,
  }) as ClientRetroFull

describe('applyBlindInput', () => {
  it('hides other people’s items during the input phase', () => {
    const seen = applyBlindInput(board(), 'ana')
    expect(seen!.columns[0].items.map((i) => i.id)).toEqual(['mine'])
  })

  it('reports how many were withheld, so the board still looks alive', () => {
    const seen = applyBlindInput(board(), 'ana')
    expect(seen!.columns[0].hiddenItemCount).toBe(2)
  })

  it('reveals everything once the phase moves past input', () => {
    for (const status of ['VOTING', 'REVIEW', 'ACTIONS', 'CLOSED']) {
      const seen = applyBlindInput(board({ status }), 'ana')
      expect(seen!.columns[0].items).toHaveLength(3)
    }
  })

  it('is a no-op when the board did not opt in', () => {
    const seen = applyBlindInput(board({ blindInput: false }), 'ana')
    expect(seen!.columns[0].items).toHaveLength(3)
    expect(seen!.columns[0].hiddenItemCount).toBeUndefined()
  })

  it('hides everything from a viewer with no identity rather than failing open', () => {
    const seen = applyBlindInput(board(), null)
    expect(seen!.columns[0].items).toHaveLength(0)
    expect(seen!.columns[0].hiddenItemCount).toBe(3)
  })

  it('passes null through', () => {
    expect(applyBlindInput(null, 'ana')).toBeNull()
  })
})

describe('redactTeam', () => {
  it('strips the Jira token and the access-control internals', () => {
    const redacted = redactTeam({
      id: 't1', name: 'Platform', createdAt: new Date(), createdBy: 'ana@example.com',
      memberGroups: ['/Eng/Platform'], adminGroups: ['/Eng/Admins'], imageData: null,
      jiraBaseUrl: 'https://jira', jiraProjectKey: 'PLT', jiraEmail: 'a@b.c', jiraApiToken: 'secret',
    })
    expect(redacted).not.toHaveProperty('jiraApiToken')
    expect(redacted).not.toHaveProperty('memberGroups')
    expect(redacted).not.toHaveProperty('adminGroups')
    expect(redacted).not.toHaveProperty('createdBy')
    expect(redacted!.jiraConfigured).toBe(true)
  })
})

describe('retro templates', () => {
  it('offers formats with unique ids and at least three columns each', () => {
    const ids = RETRO_TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const t of RETRO_TEMPLATES) expect(t.columns.length).toBeGreaterThanOrEqual(3)
  })

  it('gives every column a distinct type within its format', () => {
    for (const t of RETRO_TEMPLATES) {
      const types = t.columns.map((c) => c.type)
      expect(new Set(types).size).toBe(types.length)
    }
  })

  it('defaults to the columns every board had before formats existed', () => {
    // Pinned deliberately rather than compared against DEFAULT_TEMPLATE_ID,
    // which would make this test pass for any value. Changing the default
    // changes what every new board looks like, so it should fail loudly here.
    expect(DEFAULT_TEMPLATE_ID).toBe('classic')
    expect(templateById(DEFAULT_TEMPLATE_ID).columns).toEqual([
      { title: 'What went well', type: 'WHAT_WENT_WELL' },
      { title: "What didn't go well", type: 'WHAT_DIDNT_GO_WELL' },
      { title: 'What should be improved', type: 'WHAT_SHOULD_BE_IMPROVED' },
    ])
  })

  it('lists the default first, since the picker renders in array order', () => {
    expect(RETRO_TEMPLATES[0].id).toBe(DEFAULT_TEMPLATE_ID)
  })

  it('falls back to the default format for an unknown or missing id', () => {
    expect(templateById('nope').id).toBe(DEFAULT_TEMPLATE_ID)
    expect(templateById(null).id).toBe(DEFAULT_TEMPLATE_ID)
    expect(templateById(undefined).id).toBe(DEFAULT_TEMPLATE_ID)
  })

  it('offers Start / Stop / Continue as an explicit choice', () => {
    expect(templateById('start-stop-continue').columns).toEqual([
      { title: 'Start', type: 'START' },
      { title: 'Stop', type: 'STOP' },
      { title: 'Continue', type: 'CONTINUE' },
    ])
  })
})
