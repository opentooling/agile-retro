/**
 * Dependency vulnerability check.
 *
 * Wraps `npm audit` so the result is readable and the failure threshold is a
 * deliberate choice rather than npm's default. Run by CI on every push, on
 * pull requests, and on a schedule — a dependency that was clean when it was
 * merged becomes vulnerable without anyone touching the repository, so a
 * push-triggered check alone would miss most CVEs until the next commit.
 *
 *   npm run audit              fail on high or critical
 *   npm run audit -- --level moderate
 *   npm run audit -- --production   runtime dependencies only
 *
 * Exit codes: 0 clean (at the chosen level) · 1 vulnerabilities found ·
 * 2 the audit could not run (usually no route to the registry).
 *
 * 1 and 2 are kept apart for the pre-commit hook: it blocks a commit on 1 but
 * only warns on 2, so working offline doesn't turn every commit into a
 * `--no-verify`. CI treats any non-zero exit as a failure, so it is unaffected.
 *
 * An advisory with no fix anywhere can be excepted, narrowly and for a while,
 * in .audit-exceptions.json — see scripts/audit-exceptions.ts for the rules.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { advisoryId, applyExceptions, type Exception } from './audit-exceptions'

type Severity = 'info' | 'low' | 'moderate' | 'high' | 'critical'
const ORDER: Severity[] = ['info', 'low', 'moderate', 'high', 'critical']

function arg(name: string, fallback: string): string {
    const i = process.argv.indexOf(`--${name}`)
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const level = arg('level', 'high') as Severity
const productionOnly = process.argv.includes('--production')

if (!ORDER.includes(level)) {
    console.error(`[audit] unknown level "${level}" — expected one of ${ORDER.join(', ')}`)
    process.exit(1)
}

function runAudit(runtimeOnly = productionOnly): Record<string, unknown> {
    const args = ['audit', '--json', ...(runtimeOnly ? ['--omit=dev'] : [])]
    try {
        // npm exits non-zero when it finds anything, so the output is read from
        // the error too — an exception here does not mean the audit failed.
        return JSON.parse(execFileSync('npm', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
    } catch (err) {
        const out = (err as { stdout?: string }).stdout
        if (out) {
            try { return JSON.parse(out) } catch { /* fall through */ }
        }
        throw new Error(`could not run npm audit: ${err instanceof Error ? err.message : String(err)}`)
    }
}

/**
 * npm prints JSON even when the audit itself fails — an unreachable registry
 * comes back as `{"message": "...", "error": {...}}` with a non-zero exit. Read
 * naively that has no `vulnerabilities` key and passes as clean, so an outage
 * would report "found: nothing". A real report always carries the counts.
 */
function assertRealReport(report: Record<string, unknown>): void {
    const counts = (report.metadata as { vulnerabilities?: unknown } | undefined)?.vulnerabilities
    if (report.vulnerabilities && counts && typeof counts === 'object') return
    const why = typeof report.message === 'string' ? report.message : 'npm returned no audit report'
    throw new Error(`could not run npm audit: ${why}`)
}

function main(): number {
    const report = runAudit()
    assertRealReport(report)
    const vulns = (report.vulnerabilities ?? {}) as Record<string, {
        severity: Severity
        via: (string | { title?: string; url?: string })[]
        range?: string
        fixAvailable?: boolean | { name: string; version: string }
    }>

    const threshold = ORDER.indexOf(level)
    const over = Object.entries(vulns)
        .filter(([, v]) => ORDER.indexOf(v.severity) >= threshold)
        .sort((a, b) => ORDER.indexOf(b[1].severity) - ORDER.indexOf(a[1].severity))

    // Exceptions only ever narrow the result, and only for advisories that
    // stay out of what the app runs — so the runtime audit is consulted too.
    const exceptions: Exception[] = existsSync('.audit-exceptions.json')
        ? JSON.parse(readFileSync('.audit-exceptions.json', 'utf8'))
        : []
    let runtime = new Set<string>()
    if (exceptions.length > 0) {
        const runtimeReport = productionOnly ? report : runAudit(true)
        assertRealReport(runtimeReport)
        const runtimeVulns = (runtimeReport.vulnerabilities ?? {}) as typeof vulns
        runtime = new Set(Object.values(runtimeVulns).flatMap((v) =>
            v.via.filter((x): x is { url?: string } => typeof x === 'object').map((x) => advisoryId(x.url))))
    }
    const verdict = applyExceptions(over.map(([name]) => name), vulns, exceptions, runtime, new Date().toISOString().slice(0, 10))
    const failing = over.filter(([name]) => verdict.failing.includes(name))

    const counts = (report.metadata as { vulnerabilities?: Record<string, number> })?.vulnerabilities ?? {}
    const summary = ORDER.filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`).join(', ')

    console.log(`[audit] scope: ${productionOnly ? 'runtime dependencies' : 'all dependencies'}`)
    console.log(`[audit] threshold: ${level} and above`)
    console.log(`[audit] found: ${summary || 'nothing'}`)

    // One line per exception, naming every package it lets through.
    const byAdvisory = new Map<string, { exception: Exception; packages: string[] }>()
    for (const { name, exceptions: used } of verdict.excepted) {
        for (const e of used) {
            const entry = byAdvisory.get(e.advisory) ?? { exception: e, packages: [] }
            entry.packages.push(name)
            byAdvisory.set(e.advisory, entry)
        }
    }
    for (const { exception: e, packages } of byAdvisory.values()) {
        console.log(`[audit] excepted until ${e.expires}: ${e.advisory} in ${packages.join(', ')}`)
        console.log(`        ${e.reason}`)
    }
    for (const problem of verdict.problems) console.error(`[audit] ${problem}`)

    if (failing.length === 0 && verdict.problems.length === 0) {
        console.log(verdict.excepted.length
            ? '[audit] nothing at or above the threshold beyond the exceptions above'
            : '[audit] no vulnerabilities at or above the threshold')
        return 0
    }
    if (failing.length === 0) return 1

    console.error(`\n[audit] ${failing.length} package(s) at or above ${level}:\n`)
    for (const [name, v] of failing) {
        const advisories = v.via
            .filter((x): x is { title?: string; url?: string } => typeof x === 'object')
            .map((x) => `      ${x.title ?? 'advisory'}${x.url ? ` — ${x.url}` : ''}`)
        const fix = v.fixAvailable === false
            ? 'NO FIX AVAILABLE'
            : typeof v.fixAvailable === 'object'
                ? `fix: ${v.fixAvailable.name}@${v.fixAvailable.version}`
                : 'fix available'
        console.error(`  ${v.severity.toUpperCase()}  ${name}  (${v.range ?? 'range unknown'}) — ${fix}`)
        for (const line of advisories) console.error(line)
    }
    console.error('\n[audit] run `npm audit fix` for the non-breaking ones, or upgrade the direct dependency.')
    return 1
}

try {
    process.exit(main())
} catch (err) {
    console.error(`[audit] ERROR: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(2)
}
