import { splitTags } from './facets'

describe('splitTags', () => {
  it('pulls the distinct tags out of comma-separated board tags', () => {
    expect(splitTags(['retro,team-a', 'team-a,quarterly'])).toEqual(['quarterly', 'retro', 'team-a'])
  })

  it('trims spacing around a tag, so "a, b" is two tags and not one odd one', () => {
    expect(splitTags(['a, b ,  c'])).toEqual(['a', 'b', 'c'])
  })

  it('ignores boards with no tags at all', () => {
    expect(splitTags(['', null, 'only'])).toEqual(['only'])
  })

  it('drops empty entries left by stray commas', () => {
    expect(splitTags([',,retro,,'])).toEqual(['retro'])
  })

  it('sorts them, so the suggestions do not reshuffle between loads', () => {
    expect(splitTags(['zebra', 'apple', 'Mango'])).toEqual(['apple', 'Mango', 'zebra'])
  })
})
