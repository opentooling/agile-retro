import { isDoneCategory, selectTransitionId, type JiraTransition } from './jira'

describe('isDoneCategory', () => {
  it('treats only the "done" category as done', () => {
    expect(isDoneCategory('done')).toBe(true)
    expect(isDoneCategory('new')).toBe(false)
    expect(isDoneCategory('indeterminate')).toBe(false)
    expect(isDoneCategory(undefined)).toBe(false)
    expect(isDoneCategory(null)).toBe(false)
  })
})

describe('selectTransitionId', () => {
  const transitions: JiraTransition[] = [
    { id: '11', to: { statusCategory: { key: 'new' } } },        // To Do
    { id: '21', to: { statusCategory: { key: 'indeterminate' } } }, // In Progress
    { id: '31', to: { statusCategory: { key: 'done' } } },       // Done
  ]

  it('picks a Done-category transition when completing', () => {
    expect(selectTransitionId(transitions, true)).toBe('31')
  })

  it('prefers a To Do (new) transition when reopening', () => {
    expect(selectTransitionId(transitions, false)).toBe('11')
  })

  it('falls back to In Progress when no To Do transition exists', () => {
    const noNew = transitions.filter((t) => t.to?.statusCategory?.key !== 'new')
    expect(selectTransitionId(noNew, false)).toBe('21')
  })

  it('returns undefined when no suitable transition is available', () => {
    const onlyDone = transitions.filter((t) => t.to?.statusCategory?.key === 'done')
    expect(selectTransitionId(onlyDone, false)).toBeUndefined()
    const onlyOpen = transitions.filter((t) => t.to?.statusCategory?.key !== 'done')
    expect(selectTransitionId(onlyOpen, true)).toBeUndefined()
  })
})
