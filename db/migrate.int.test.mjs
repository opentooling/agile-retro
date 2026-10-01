// The migration runner against a real PostgreSQL — the same cases ShoutOut's
// db/migrate.int.test.ts covers, plus taking over a database the application
// built before its migrations were versioned.
//
// Needs PG_TEST_URL, a superuser connection such as
//   postgres://postgres:postgres@127.0.0.1:5432/postgres
// Each test creates a database of its own. Skipped without PG_TEST_URL.
// Run: PG_TEST_URL=... npm run test:migrations
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { main, migrate, MIGRATIONS_DIR } from "./migrate.mjs";

const adminUrl = process.env.PG_TEST_URL;
const created = [];
const quiet = () => {};

/** Each test gets its own empty database. */
async function freshDatabase(name) {
  const db = `${name}_${Date.now().toString(36)}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${db}`);
  await admin.end();
  created.push(db);
  const url = new URL(adminUrl);
  url.pathname = `/${db}`;
  return url.toString();
}

async function query(connectionString, text) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return (await client.query(text)).rows;
  } finally {
    await client.end();
  }
}

describe("migrate (postgres)", { skip: !adminUrl && "PG_TEST_URL is not set" }, () => {
  let dir;

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "migrations-"));
    await writeFile(path.join(dir, "001_first.sql"), "CREATE TABLE t (id int);");
    await writeFile(path.join(dir, "002_second.sql"), "ALTER TABLE t ADD COLUMN name text;");
    await writeFile(path.join(dir, "README.md"), "not a migration");
  });

  after(async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    for (const db of created) await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.end();
  });

  it("applies pending migrations once, in order, and ignores anything that is not .sql", async () => {
    const url = await freshDatabase("migrate_order");
    const logged = [];
    const log = (line) => logged.push(line);
    assert.deepEqual(await migrate({ connectionString: url, dir, log }), ["001_first", "002_second"]);
    assert.ok(logged.includes("applied 002_second"));
    assert.deepEqual(await migrate({ connectionString: url, dir, log }), []);
    assert.equal(logged.at(-1), "database is up to date");
    const versions = await query(url, "SELECT version FROM schema_migrations ORDER BY version");
    assert.deepEqual(versions.map((r) => r.version), ["001_first", "002_second"]);
  });

  it("rolls back a failing migration, records nothing for it, and reports it", async () => {
    const url = await freshDatabase("migrate_fail");
    const badDir = await mkdtemp(path.join(tmpdir(), "bad-"));
    await writeFile(path.join(badDir, "001_ok.sql"), "CREATE TABLE ok (id int);");
    await writeFile(path.join(badDir, "002_bad.sql"), "CREATE TABLE half (id int); SELECT nope;");
    await assert.rejects(migrate({ connectionString: url, dir: badDir, log: quiet }), /Migration 002_bad failed: column "nope" does not exist/);
    assert.deepEqual(await query(url, "SELECT to_regclass('half')::text AS half, to_regclass('ok')::text AS ok"), [{ half: null, ok: "ok" }]);
    assert.deepEqual((await query(url, "SELECT version FROM schema_migrations")).map((r) => r.version), ["001_ok"]);
  });

  it("is safe when several pods migrate at once", async () => {
    const url = await freshDatabase("migrate_concurrent");
    const runs = await Promise.all([1, 2, 3].map(() => migrate({ connectionString: url, dir, log: quiet })));
    // Exactly one run applied each migration; the others found it done.
    assert.deepEqual(runs.flat().sort(), ["001_first", "002_second"]);
  });

  it("builds the real schema from scratch with the default directory", async () => {
    const url = await freshDatabase("migrate_real");
    const applied = await migrate({ connectionString: url, log: quiet });
    assert.ok(applied.length >= 1);
    assert.match(MIGRATIONS_DIR, /db[/\\]migrations$/);
    for (const table of ["Team", "Retrospective", "Column", "Item", "Vote", "Reaction", "ActionItem", "PhaseEvent"]) {
      const [{ t }] = await query(url, `SELECT to_regclass('"${table}"')::text AS t`);
      assert.equal(t, `"${table}"`, `table ${table}`);
    }
    // The newest column of the baseline, so a truncated baseline cannot pass.
    const [{ c }] = await query(url, `SELECT count(*)::int AS c FROM information_schema.columns WHERE table_name = 'Item' AND column_name = 'reviewOrder'`);
    assert.equal(c, 1);
  });

  it("takes over a database the application built before migrations were versioned, keeping its data", async () => {
    const url = await freshDatabase("migrate_adopt");
    // What the application's start-up bootstrap used to leave behind: the
    // schema, data in it, and no migration history at all.
    const baseline = (await readFile(path.join(MIGRATIONS_DIR, "20261001090000_baseline.sql"), "utf8"));
    await query(url, baseline);
    await query(url, `INSERT INTO "Team" ("id", "name") VALUES ('t1', 'Platform')`);

    const applied = await migrate({ connectionString: url, log: quiet });
    assert.ok(applied.includes("20261001090000_baseline"));
    assert.deepEqual(await query(url, `SELECT "name" FROM "Team"`), [{ name: "Platform" }]);
    assert.deepEqual(await migrate({ connectionString: url, log: quiet }), []);
  });
});

describe("main", () => {
  it("needs DATABASE_URL, and a postgres:// one", async () => {
    const logged = [];
    assert.equal(await main({ env: {}, log: (l) => logged.push(l) }), 1);
    assert.ok(logged.includes("DATABASE_URL is not set"));
    assert.equal(await main({ env: { DATABASE_URL: "file:./dev.db" }, log: (l) => logged.push(l) }), 1);
    assert.match(logged.at(-1), /SQLite backend migrates itself/);
  });

  it("retries while the database starts, then succeeds or gives up", async () => {
    const logged = [];
    const log = (l) => logged.push(l);
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls === 1) throw new Error("ECONNREFUSED");
      return [];
    };
    assert.equal(await main({ env: { DATABASE_URL: "postgres://x" }, run: flaky, attempts: 3, delayMs: 1, log }), 0);
    assert.ok(logged.includes("migration attempt 1/3 failed: ECONNREFUSED"));

    let brokenCalls = 0;
    const broken = async () => {
      brokenCalls++;
      throw new Error("down");
    };
    assert.equal(await main({ env: { DATABASE_URL: "postgres://x" }, run: broken, attempts: 2, delayMs: 1, log }), 1);
    assert.equal(brokenCalls, 2);
  });
});
