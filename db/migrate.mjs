// Applies db/migrations/*.sql in filename order, each in its own transaction,
// recording applied versions in schema_migrations — the same runner ShoutOut
// uses. Safe to run from several pods at once (advisory lock).
// Usage: DATABASE_URL=postgres://... node db/migrate.mjs
//
// It holds the advisory lock the application's own schema bootstrap held
// before migrations were versioned, so during a rolling upgrade it also waits
// for an old pod still running that bootstrap. The SQLite backend migrates
// itself when the file is opened and needs none of this.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const LOCK_ID = 8_274_531;

export async function migrate({ connectionString, dir = MIGRATIONS_DIR, log = console.log }) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query("SELECT version FROM schema_migrations");
    const applied = new Set(rows.map((row) => row.version));
    const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
    const ran = [];
    for (const file of files) {
      const version = file.slice(0, -".sql".length);
      if (applied.has(version)) continue;
      const statements = await readFile(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(statements);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${version} failed: ${error.message}`, { cause: error });
      }
      log(`applied ${version}`);
      ran.push(version);
    }
    if (ran.length === 0) log("database is up to date");
    return ran;
  } finally {
    await client.end();
  }
}

/** CLI entry: retries while the database is still starting. */
export async function main({
  env = process.env,
  attempts = 30,
  delayMs = 5000,
  run = migrate,
  log = console.log,
} = {}) {
  if (!env.DATABASE_URL) {
    log("DATABASE_URL is not set");
    return 1;
  }
  if (!/^postgres(ql)?:\/\//.test(env.DATABASE_URL)) {
    log("DATABASE_URL is not a postgres:// URL; the SQLite backend migrates itself and needs no migration");
    return 1;
  }
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await run({ connectionString: env.DATABASE_URL, log });
      return 0;
    } catch (error) {
      log(`migration attempt ${attempt}/${attempts} failed: ${error.message}`);
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
