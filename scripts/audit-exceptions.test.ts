import { advisoriesBehind, advisoryId, applyExceptions, type Exception, type Vulnerability } from './audit-exceptions'

const BRACES = 'GHSA-vfj7-8cjw-p6xm'
const OTHER = 'GHSA-aaaa-bbbb-cccc'
const url = (id: string) => `https://github.com/advisories/${id}`

/** The real chain: lint tooling → fast-glob → micromatch → braces. */
function vulns(): Record<string, Vulnerability> {
  return {
    braces: { severity: 'high', via: [{ title: 'stack exhaustion', url: url(BRACES) }] },
    micromatch: { severity: 'high', via: ['braces'] },
    'fast-glob': { severity: 'high', via: ['micromatch'] },
    'eslint-config-next': { severity: 'high', via: ['fast-glob'] },
  }
}
const chain = ['braces', 'micromatch', 'fast-glob', 'eslint-config-next']
const exception = (over: Partial<Exception> = {}): Exception => ({
  advisory: BRACES,
  package: 'braces',
  reason: 'no fixed version exists; reached only through lint tooling',
  expires: '2026-11-03',
  ...over,
})

describe('advisoriesBehind', () => {
  it('follows a dependency chain down to the advisory that started it', () => {
    expect([...advisoriesBehind('eslint-config-next', vulns())]).toEqual([BRACES])
  })

  it('survives a cycle in the chain', () => {
    const v = { a: { severity: 'high', via: ['b'] }, b: { severity: 'high', via: ['a', { url: url(OTHER) }] } }
    expect([...advisoriesBehind('a', v)]).toEqual([OTHER])
  })

  it('reads the GHSA id out of an advisory URL', () => {
    expect(advisoryId(url(BRACES))).toBe(BRACES)
  })
})

describe('applyExceptions', () => {
  it('lets a whole chain through when its only advisory is excepted', () => {
    const v = applyExceptions(chain, vulns(), [exception()], new Set(), '2026-10-03')
    expect(v.failing).toEqual([])
    expect(v.excepted.map((e) => e.name)).toEqual(chain)
    expect(v.problems).toEqual([])
  })

  it('fails a package that is also vulnerable through an advisory with no exception', () => {
    const v = vulns()
    v.micromatch.via.push({ url: url(OTHER) })
    const verdict = applyExceptions(chain, v, [exception()], new Set(), '2026-10-03')
    expect(verdict.failing).toEqual(['micromatch', 'fast-glob', 'eslint-config-next'])
  })

  it('stops applying the day after it expires, and says so', () => {
    const v = applyExceptions(chain, vulns(), [exception({ expires: '2026-10-02' })], new Set(), '2026-10-03')
    expect(v.failing).toEqual(chain)
    expect(v.problems[0]).toMatch(/expired on 2026-10-02/)
  })

  it('still applies on its expiry date itself', () => {
    expect(applyExceptions(chain, vulns(), [exception()], new Set(), '2026-11-03').failing).toEqual([])
  })

  it('stops applying once the advisory reaches runtime dependencies', () => {
    const v = applyExceptions(chain, vulns(), [exception()], new Set([BRACES]), '2026-10-03')
    expect(v.failing).toEqual(chain)
    expect(v.problems[0]).toMatch(/now reaches runtime dependencies/)
  })

  it('refuses an exception with no reason or no proper expiry date', () => {
    expect(applyExceptions(chain, vulns(), [exception({ reason: ' ' })], new Set(), '2026-10-03').problems[0]).toMatch(/gives no reason/)
    expect(applyExceptions(chain, vulns(), [exception({ expires: 'soon' })], new Set(), '2026-10-03').problems[0]).toMatch(/no valid expires date/)
  })

  it('does not let through an advisory it does not name', () => {
    const v = applyExceptions(chain, vulns(), [exception({ advisory: OTHER })], new Set(), '2026-10-03')
    expect(v.failing).toEqual(chain)
  })
})
