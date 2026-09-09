/**
 * Standalone PostgreSQL schema migration.
 *
 * Runs the *same* `SCHEMA_SQL` the application applies on first connect (see
 * src/lib/db/postgres.ts) — there is deliberately no second copy of the DDL to
 * drift out of step. Every statement is idempotent (`CREATE TABLE IF NOT
 * EXISTS`, `ADD COLUMN IF NOT EXISTS`), and application is serialised with a
 * Postgres advisory lock, so this is safe to run repeatedly and concurrently
 * with starting application pods.
 *
 * Why run it separately when the app can do it itself?
 *   - a failed migration fails the Helm release, loudly, instead of surfacing
 *     as errors on the first request;
 *   - the app can then run with `DB_SKIP_SCHEMA_BOOTSTRAP=true` and a database
 *     user that has no DDL rights at all.
 *
 * Usage:
 *   npm run db:migrate              apply the schema, then verify it
 *   npm run db:migrate -- --check   report drift and exit 1; change nothing
 *
 * Environment:
 *   DATABASE_URL          postgres://…  (required; refuses non-postgres URLs)
 *   MIGRATE_WAIT_SECONDS  how long to wait for the database (default 60)
 *
 * Exit codes: 0 applied//up to date · 1 failed or (with --check) drift found.
 */
import { SCHEMA_SQL, applySchema, closePool } from '../src/lib/db/postgres'
import { Pool } from 'pg'

const check = process.argv.includes('--check')
const waitSeconds = Number(process.env.MIGRATE_WAIT_SECONDS ?? 60)

const log = (msg: string) => console.log(`[migrate] ${msg}`)
const fail = (msg: string) => console.error(`[migrate] ERROR: ${msg}`)

/**
 * What the schema expects to exist, derived from SCHEMA_SQL itself so this
 * check can never fall behind the DDL it is verifying.
 */
function expectations(): { tables: string[]; columns: { table: string; column: string }[] } {
    const tables = [...SCHEMA_SQL.matchAll(/CREATE TABLE IF NOT EXISTS "([^"]+)"/g)].map((m) => m[1])
    const columns = [
        ...SCHEMA_SQL.matchAll(/ALTER TABLE "([^"]+)" ADD COLUMN IF NOT EXISTS "([^"]+)"/g),
    ].map((m) => ({ table: m[1], column: m[2] }))
    return { tables, columns }
}

/** Wait for the database to accept connections — the Job may start first. */
async function waitForDatabase(pool: Pool): Promise<void> {
    const deadline = Date.now() + waitSeconds * 1000
    let lastError: unknown
    for (let attempt = 1; ; attempt++) {
        try {
            await pool.query('SELECT 1')
            return
        } catch (err) {
            lastError = err
            if (Date.now() >= deadline) break
            const delay = Math.min(5000, 500 * attempt)
            log(`database not ready (attempt ${attempt}), retrying in ${delay}ms…`)
            await new Promise((r) => setTimeout(r, delay))
        }
    }
    throw new Error(
        `database did not become available within ${waitSeconds}s: ${
            lastError instanceof Error ? lastError.message : String(lastError)
        }`
    )
}

/** Which expected tables/columns are missing right now. */
async function findDrift(pool: Pool): Promise<string[]> {
    const { tables, columns } = expectations()
    const missing: string[] = []

    const present = new Set(
        (
            await pool.query<{ table_name: string }>(
                `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`
            )
        ).rows.map((r) => r.table_name)
    )
    for (const t of tables) if (!present.has(t)) missing.push(`table "${t}"`)

    const presentColumns = new Set(
        (
            await pool.query<{ table_name: string; column_name: string }>(
                `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()`
            )
        ).rows.map((r) => `${r.table_name}.${r.column_name}`)
    )
    for (const { table, column } of columns) {
        // Only meaningful once the table exists; a missing table is already reported.
        if (present.has(table) && !presentColumns.has(`${table}.${column}`)) {
            missing.push(`column "${table}"."${column}"`)
        }
    }
    return missing
}

async function main() {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    if (!/^postgres(ql)?:\/\//.test(url)) {
        throw new Error(
            `DATABASE_URL is not a postgres:// connection string (got "${url.split(':')[0]}:"). ` +
            'The SQLite backend migrates itself on open and needs no job.'
        )
    }
    // Log where we are pointed without leaking the password.
    log(`target: ${url.replace(/\/\/[^@]*@/, '//***@')}`)

    const pool = new Pool({ connectionString: url, max: 1 })
    try {
        await waitForDatabase(pool)
        log('database reachable')

        const before = await findDrift(pool)

        if (check) {
            if (before.length === 0) {
                log('schema is up to date')
                return 0
            }
            fail(`schema is behind — ${before.length} object(s) missing:`)
            for (const m of before) console.error(`  - ${m}`)
            return 1
        }

        if (before.length === 0) {
            log('schema already up to date; applying anyway (idempotent)')
        } else {
            log(`applying ${before.length} missing object(s):`)
            for (const m of before) log(`  - ${m}`)
        }

        await applySchema()
        log('schema applied')

        const after = await findDrift(pool)
        if (after.length > 0) {
            fail('schema is still incomplete after applying:')
            for (const m of after) console.error(`  - ${m}`)
            return 1
        }
        log('verified: all expected tables and columns present')
        return 0
    } finally {
        await pool.end()
        await closePool()
    }
}

main()
    .then((code) => process.exit(code))
    .catch((err) => {
        fail(err instanceof Error ? err.message : String(err))
        process.exit(1)
    })
