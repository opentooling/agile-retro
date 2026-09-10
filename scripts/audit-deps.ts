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
 * Exit codes: 0 clean (at the chosen level) · 1 vulnerabilities found or the
 * audit could not run.
 */
import { execFileSync } from 'node:child_process'

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

function runAudit(): Record<string, unknown> {
    const args = ['audit', '--json', ...(productionOnly ? ['--omit=dev'] : [])]
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

function main(): number {
    const report = runAudit()
    const vulns = (report.vulnerabilities ?? {}) as Record<string, {
        severity: Severity
        via: (string | { title?: string; url?: string })[]
        range?: string
        fixAvailable?: boolean | { name: string; version: string }
    }>

    const threshold = ORDER.indexOf(level)
    const failing = Object.entries(vulns)
        .filter(([, v]) => ORDER.indexOf(v.severity) >= threshold)
        .sort((a, b) => ORDER.indexOf(b[1].severity) - ORDER.indexOf(a[1].severity))

    const counts = (report.metadata as { vulnerabilities?: Record<string, number> })?.vulnerabilities ?? {}
    const summary = ORDER.filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`).join(', ')

    console.log(`[audit] scope: ${productionOnly ? 'runtime dependencies' : 'all dependencies'}`)
    console.log(`[audit] threshold: ${level} and above`)
    console.log(`[audit] found: ${summary || 'nothing'}`)

    if (failing.length === 0) {
        console.log('[audit] no vulnerabilities at or above the threshold')
        return 0
    }

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
    process.exit(1)
}
