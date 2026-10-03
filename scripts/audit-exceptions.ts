/**
 * Exceptions to the dependency audit — kept deliberately hard to use.
 *
 * Sometimes an advisory has no fix anywhere: every published version of the
 * package is affected, and npm's only suggestion is to downgrade whatever
 * pulls it in. Blocking every commit until upstream acts teaches people to
 * reach for --no-verify, which switches the check off for everything. An
 * exception switches it off for one advisory, for a while, with a reason.
 *
 * An exception (in .audit-exceptions.json) covers an advisory only while:
 *   - it names that exact advisory — another one on the same package still fails;
 *   - the advisory stays out of the runtime dependencies — dev tooling only;
 *   - it has not expired — on the day after, the audit fails and names it.
 *
 * A package fails unless every advisory behind it is covered, so a package
 * that is vulnerable both through an excepted advisory and another one fails.
 */

export type Exception = { advisory: string; package: string; reason: string; expires: string }

export type Vulnerability = {
  severity: string
  via: (string | { title?: string; url?: string })[]
}

/** GHSA-xxxx-xxxx-xxxx from an advisory URL, or the URL itself if it has none. */
export function advisoryId(url: string | undefined): string {
  return url?.match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i)?.[0] ?? url ?? 'unknown'
}

/**
 * The advisories behind a package, following npm's chain: a package listed
 * only because it depends on a vulnerable one has that one's name in `via`.
 */
export function advisoriesBehind(name: string, vulns: Record<string, Vulnerability>, seen = new Set<string>()): Set<string> {
  const found = new Set<string>()
  if (seen.has(name) || !vulns[name]) return found
  seen.add(name)
  for (const via of vulns[name].via) {
    if (typeof via === 'string') {
      for (const id of advisoriesBehind(via, vulns, seen)) found.add(id)
    } else {
      found.add(advisoryId(via.url))
    }
  }
  return found
}

export type Verdict = {
  /** Packages still failing the audit. */
  failing: string[]
  /** Packages let through, and by which exceptions. */
  excepted: { name: string; exceptions: Exception[] }[]
  /** Exceptions that no longer apply, and why. These fail the audit. */
  problems: string[]
}

/**
 * Which of the packages over the threshold an exception lets through.
 *
 * @param over       packages at or above the threshold, from the full audit
 * @param vulns      the full audit's vulnerabilities, for following chains
 * @param runtime    advisory ids present in the runtime-only audit
 * @param today      YYYY-MM-DD
 */
export function applyExceptions(
  over: string[],
  vulns: Record<string, Vulnerability>,
  exceptions: Exception[],
  runtime: Set<string>,
  today: string,
): Verdict {
  const problems: string[] = []
  const usable = new Map<string, Exception>()
  for (const e of exceptions) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.expires)) {
      problems.push(`exception for ${e.advisory} has no valid expires date (YYYY-MM-DD)`)
    } else if (e.expires < today) {
      problems.push(`exception for ${e.advisory} (${e.package}) expired on ${e.expires}: check for a fix, or renew it deliberately`)
    } else if (runtime.has(e.advisory)) {
      problems.push(`exception for ${e.advisory} (${e.package}) no longer applies: the advisory now reaches runtime dependencies`)
    } else if (!e.reason?.trim()) {
      problems.push(`exception for ${e.advisory} gives no reason`)
    } else {
      usable.set(e.advisory, e)
    }
  }

  const failing: string[] = []
  const excepted: Verdict['excepted'] = []
  for (const name of over) {
    const behind = [...advisoriesBehind(name, vulns)]
    if (behind.length > 0 && behind.every((id) => usable.has(id))) {
      excepted.push({ name, exceptions: behind.map((id) => usable.get(id)!) })
    } else {
      failing.push(name)
    }
  }
  return { failing, excepted, problems }
}
