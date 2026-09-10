/**
 * PostgreSQL data-access layer built on `pg` (node-postgres).
 *
 * `pg` is pure JavaScript (no native build step — we don't use pg-native), so it
 * stays airgapped/offline-build friendly. The connection string comes from
 * DATABASE_URL (postgres://user:pass@host:port/db).
 *
 * The schema is embedded below and applied with `CREATE TABLE IF NOT EXISTS` the
 * first time a connection is used, so no separate migration step is required.
 * This is safe to run concurrently across replicas (it takes an advisory lock).
 *
 * Deployments that would rather gate DDL behind a controlled step — a Helm
 * migration Job, or an app database user without DDL rights — can run
 * `scripts/migrate-postgres.ts` and set `DB_SKIP_SCHEMA_BOOTSTRAP=true` on the
 * app so it never issues DDL itself. Both paths execute the same `SCHEMA_SQL`
 * below, which is the single definition of the schema.
 */
import { Pool, type PoolClient } from "pg";
import { engagementFromRows, phaseDurationsFromRows } from "./aggregate";
import { randomUUID } from "node:crypto";
import type {
  Team, TeamJiraConfig, TeamGroups, TeamCreateOptions, Retrospective, Column, Vote, Reaction, Item, ActionItem,
  ColumnWithItems, RetroFull, RetroFilter, ActionFilter,
  CreateColumnInput, CreateRetroInput, ActionItemWithRetro, TeamAnalyticsRaw,
} from "./types";

// ---------------------------------------------------------------------------
// Connection + schema bootstrap
// ---------------------------------------------------------------------------

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS "Team" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "createdBy" TEXT,
    "memberGroups" JSONB NOT NULL DEFAULT '[]',
    "adminGroups" JSONB NOT NULL DEFAULT '[]',
    "imageData" TEXT,
    "jiraBaseUrl" TEXT,
    "jiraProjectKey" TEXT,
    "jiraEmail" TEXT,
    "jiraApiToken" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "Team_name_key" ON "Team" ("name");

CREATE TABLE IF NOT EXISTS "Retrospective" (
    "id" TEXT PRIMARY KEY,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INPUT',
    "tags" TEXT NOT NULL DEFAULT '',
    "creator" TEXT NOT NULL DEFAULT 'Anonymous',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "blindInput" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMPTZ,
    "inputDuration" INTEGER,
    "votingDuration" INTEGER,
    "reviewDuration" INTEGER,
    "phaseStartTime" TIMESTAMPTZ,
    "teamId" TEXT REFERENCES "Team" ("id")
);

CREATE TABLE IF NOT EXISTS "Column" (
    "id" TEXT PRIMARY KEY,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "retrospectiveId" TEXT NOT NULL REFERENCES "Retrospective" ("id")
);

CREATE TABLE IF NOT EXISTS "Item" (
    "id" TEXT PRIMARY KEY,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "userId" TEXT NOT NULL DEFAULT 'anonymous',
    "username" TEXT NOT NULL DEFAULT 'Anonymous',
    "columnId" TEXT NOT NULL REFERENCES "Column" ("id"),
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "Vote" (
    "id" TEXT PRIMARY KEY,
    "itemId" TEXT NOT NULL REFERENCES "Item" ("id"),
    "userId" TEXT NOT NULL,
    "count" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "Reaction" (
    "id" TEXT PRIMARY KEY,
    "emoji" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL REFERENCES "Item" ("id"),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "ActionItem" (
    "id" TEXT PRIMARY KEY,
    "content" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "retrospectiveId" TEXT NOT NULL REFERENCES "Retrospective" ("id"),
    "assignee" TEXT,
    "dueDate" TIMESTAMPTZ,
    "externalUrl" TEXT,
    "externalKey" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "completedAt" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "PhaseEvent" (
    "id" TEXT PRIMARY KEY,
    "retrospectiveId" TEXT NOT NULL REFERENCES "Retrospective" ("id"),
    "phase" TEXT NOT NULL,
    "enteredAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "PhaseEvent_retro_idx" ON "PhaseEvent" ("retrospectiveId", "enteredAt");

-- Idempotent column additions for databases created before these columns
-- existed (CREATE TABLE IF NOT EXISTS never alters an existing table).
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "jiraBaseUrl" TEXT;
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "jiraProjectKey" TEXT;
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "jiraEmail" TEXT;
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "jiraApiToken" TEXT;
ALTER TABLE "ActionItem" ADD COLUMN IF NOT EXISTS "assignee" TEXT;
ALTER TABLE "ActionItem" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMPTZ;
ALTER TABLE "ActionItem" ADD COLUMN IF NOT EXISTS "externalUrl" TEXT;
ALTER TABLE "ActionItem" ADD COLUMN IF NOT EXISTS "externalKey" TEXT;
-- Boards may now be created without a team ("open boards"), so teamId is nullable.
ALTER TABLE "Retrospective" ALTER COLUMN "teamId" DROP NOT NULL;
-- Per-team access control via identity-provider groups.
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "memberGroups" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "adminGroups" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "imageData" TEXT;
ALTER TABLE "Retrospective" ADD COLUMN IF NOT EXISTS "blindInput" BOOLEAN NOT NULL DEFAULT false;
-- Board formats other than the classic three columns need an explicit order.
ALTER TABLE "Column" ADD COLUMN IF NOT EXISTS "order" INTEGER NOT NULL DEFAULT 0;
-- Optional retention: boards are deleted once "expiresAt" passes.
ALTER TABLE "Retrospective" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMPTZ;
-- Action follow-through over time needs both ends of an action's life.
-- Existing rows get a creation date but no completion date: their close times
-- are simply unknown, rather than being invented.
ALTER TABLE "ActionItem" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE "ActionItem" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMPTZ;
`;

// Cache the pool and the one-time schema init on globalThis so dev/HMR and
// multiple imports share a single pool.
const globalForDb = globalThis as unknown as {
  __pgPool?: Pool;
  __pgInit?: Promise<unknown>;
};

/**
 * Advisory-lock key that serialises schema application. Replicas starting
 * together (or a migration Job racing a rolling update) would otherwise run the
 * DDL concurrently, and not every statement here is safe under that —
 * `ALTER TABLE ... DROP NOT NULL` has no `IF EXISTS` guard.
 */
const SCHEMA_LOCK_ID = 8274531;

function getPool(): Pool {
  if (!globalForDb.__pgPool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set (expected a postgres:// connection string)");
    }
    globalForDb.__pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PGPOOL_MAX ?? 10),
    });
  }
  return globalForDb.__pgPool;
}

/**
 * Create/upgrade the schema. Exported so the standalone migration script runs
 * exactly the SQL the app would have run — the DDL has one definition, not a
 * copy that can drift out of step with the code that depends on it.
 */
export async function applySchema(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK_ID]);
    await client.query(SCHEMA_SQL);
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK_ID]);
    } catch {
      // A broken connection releases the lock on its own; don't mask the
      // original failure with the unlock's.
    }
    client.release();
  }
}

/** Close the pool so a short-lived script can exit. */
export async function closePool(): Promise<void> {
  if (globalForDb.__pgPool) {
    await globalForDb.__pgPool.end();
    globalForDb.__pgPool = undefined;
    globalForDb.__pgInit = undefined;
  }
}

/** Returns the pool, ensuring the schema has been created exactly once. */
async function pool(): Promise<Pool> {
  const p = getPool();
  if (!globalForDb.__pgInit) {
    // When a migration Job owns DDL, the app must not attempt it — its database
    // user may not even be permitted to.
    const init =
      process.env.DB_SKIP_SCHEMA_BOOTSTRAP === "true" ? Promise.resolve() : applySchema();
    // Never cache a *failed* init. The app and its database routinely start
    // together, so the first query can land before Postgres is accepting
    // connections; caching that rejection left the process permanently broken
    // — every later query awaited the same rejected promise — until it was
    // restarted. Clearing it lets the next caller try again.
    globalForDb.__pgInit = init.catch((err) => {
      globalForDb.__pgInit = undefined;
      throw err;
    });
  }
  await globalForDb.__pgInit;
  return p;
}

async function query<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const p = await pool();
  const res = await p.query(text, params);
  return res.rows as T[];
}

async function queryOne<T = Row>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const p = await pool();
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------







// ---------------------------------------------------------------------------
// Row mappers
//
// pg returns native types: TIMESTAMPTZ -> Date, BOOLEAN -> boolean,
// INTEGER -> number, NULL -> null. Quoted identifiers preserve the PascalCase
// column names, so rows already match our shapes; mappers mainly add the
// nested arrays and keep the types explicit.
// ---------------------------------------------------------------------------

type Row = Record<string, any>;

function toGroups(raw: unknown): string[] {
  // JSONB comes back parsed from node-pg; be defensive about strings too.
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value.filter((g): g is string => typeof g === "string") : [];
}

const mapTeam = (r: Row): Team => ({
  id: r.id,
  name: r.name,
  createdAt: r.createdAt,
  createdBy: r.createdBy ?? null,
  memberGroups: toGroups(r.memberGroups),
  adminGroups: toGroups(r.adminGroups),
  imageData: r.imageData ?? null,
  jiraBaseUrl: r.jiraBaseUrl ?? null,
  jiraProjectKey: r.jiraProjectKey ?? null,
  jiraEmail: r.jiraEmail ?? null,
  jiraApiToken: r.jiraApiToken ?? null,
});
const mapColumn = (r: Row): Column => ({
  id: r.id, title: r.title, type: r.type, retrospectiveId: r.retrospectiveId,
  order: r.order ?? 0,
});
const mapVote = (r: Row): Vote => ({ id: r.id, itemId: r.itemId, userId: r.userId, count: r.count });
const mapReaction = (r: Row): Reaction => ({
  id: r.id, emoji: r.emoji, userId: r.userId, itemId: r.itemId, createdAt: r.createdAt,
});
const mapActionItem = (r: Row): ActionItem => ({
  id: r.id,
  content: r.content,
  completed: r.completed,
  retrospectiveId: r.retrospectiveId,
  assignee: r.assignee ?? null,
  dueDate: r.dueDate ?? null,
  externalUrl: r.externalUrl ?? null,
  externalKey: r.externalKey ?? null,
  createdAt: r.createdAt ?? null,
  completedAt: r.completedAt ?? null,
});
const mapRetro = (r: Row): Retrospective => ({
  id: r.id,
  title: r.title,
  status: r.status,
  tags: r.tags,
  creator: r.creator,
  createdAt: r.createdAt,
  isAnonymous: r.isAnonymous,
  blindInput: r.blindInput ?? false,
  expiresAt: r.expiresAt ?? null,
  inputDuration: r.inputDuration,
  votingDuration: r.votingDuration,
  reviewDuration: r.reviewDuration,
  phaseStartTime: r.phaseStartTime,
  teamId: r.teamId,
});
const mapItem = (r: Row): Item => ({
  id: r.id,
  content: r.content,
  summary: r.summary,
  userId: r.userId,
  username: r.username,
  columnId: r.columnId,
  order: r.order,
  createdAt: r.createdAt,
  votes: [],
  reactions: [],
});

// Stable column ordering (Postgres has no implicit row order). Boards created
// since formats were introduced carry an explicit "order"; boards predating it
// have 0 across the board, so the classic-type CASE still sorts them correctly.
const COLUMN_ORDER_SQL = `ORDER BY "order", CASE "type"
    WHEN 'WHAT_WENT_WELL' THEN 0
    WHEN 'WHAT_DIDNT_GO_WELL' THEN 1
    WHEN 'WHAT_SHOULD_BE_IMPROVED' THEN 2
    ELSE 3 END, "title"`;

// ---------------------------------------------------------------------------
// Where-clause builder
// ---------------------------------------------------------------------------

type WhereBuild = { clauses: string[]; params: unknown[]; needsTeamJoin: boolean };

function buildRetroWhere(f: RetroFilter, ra: string, ta: string, params: unknown[]): WhereBuild {
  const clauses: string[] = [];
  let needsTeamJoin = false;

  if (f.creatorEquals != null) {
    clauses.push(`${ra}."creator" = $${params.push(f.creatorEquals)}`);
  } else if (f.creatorContains) {
    clauses.push(`${ra}."creator" ILIKE $${params.push(`%${f.creatorContains}%`)}`);
  }
  if (f.tagsContains) {
    clauses.push(`${ra}."tags" ILIKE $${params.push(`%${f.tagsContains}%`)}`);
  }
  if (f.statusNot) {
    clauses.push(`${ra}."status" <> $${params.push(f.statusNot)}`);
  }
  if (f.teamNameContains) {
    needsTeamJoin = true;
    clauses.push(`${ta}."name" ILIKE $${params.push(`%${f.teamNameContains}%`)}`);
  }
  return { clauses, params, needsTeamJoin };
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export async function listTeams(): Promise<Team[]> {
  return (await query(`SELECT * FROM "Team" ORDER BY "name" ASC`)).map(mapTeam);
}

export async function createTeam(name: string, opts?: TeamCreateOptions): Promise<Team> {
  const row = await queryOne(
    `INSERT INTO "Team" ("id", "name", "createdBy", "memberGroups", "adminGroups")
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb) RETURNING *`,
    [
      randomUUID(),
      name,
      opts?.createdBy ?? null,
      JSON.stringify(opts?.memberGroups ?? []),
      JSON.stringify(opts?.adminGroups ?? []),
    ]
  );
  return mapTeam(row as Row);
}

export async function updateTeamGroups(id: string, groups: TeamGroups): Promise<Team> {
  const row = await queryOne(
    `UPDATE "Team" SET "memberGroups" = $2::jsonb, "adminGroups" = $3::jsonb
     WHERE "id" = $1 RETURNING *`,
    [id, JSON.stringify(groups.memberGroups ?? []), JSON.stringify(groups.adminGroups ?? [])]
  );
  return mapTeam(row as Row);
}

export async function updateTeamImage(id: string, imageData: string | null): Promise<Team> {
  const row = await queryOne(`UPDATE "Team" SET "imageData" = $2 WHERE "id" = $1 RETURNING *`, [
    id,
    imageData ?? null,
  ]);
  return mapTeam(row as Row);
}

export async function updateTeam(id: string, name: string): Promise<Team> {
  const row = await queryOne(
    `UPDATE "Team" SET "name" = $2 WHERE "id" = $1 RETURNING *`,
    [id, name]
  );
  return mapTeam(row as Row);
}

export async function updateTeamJira(id: string, config: TeamJiraConfig): Promise<Team> {
  const row = await queryOne(
    `UPDATE "Team"
       SET "jiraBaseUrl" = $2, "jiraProjectKey" = $3, "jiraEmail" = $4, "jiraApiToken" = $5
     WHERE "id" = $1 RETURNING *`,
    [
      id,
      config.jiraBaseUrl ?? null,
      config.jiraProjectKey ?? null,
      config.jiraEmail ?? null,
      config.jiraApiToken ?? null,
    ]
  );
  return mapTeam(row as Row);
}

export async function getTeam(id: string): Promise<Team | null> {
  const row = await queryOne(`SELECT * FROM "Team" WHERE "id" = $1`, [id]);
  return row ? mapTeam(row as Row) : null;
}

async function getTeamsByIds(ids: string[]): Promise<Map<string, Team>> {
  const map = new Map<string, Team>();
  if (ids.length === 0) return map;
  const rows = await query(`SELECT * FROM "Team" WHERE "id" = ANY($1)`, [ids]);
  for (const r of rows) map.set(r.id, mapTeam(r));
  return map;
}

// ---------------------------------------------------------------------------
// Retrospectives
// ---------------------------------------------------------------------------

export async function getRetro(id: string): Promise<Retrospective | null> {
  const row = await queryOne(`SELECT * FROM "Retrospective" WHERE "id" = $1`, [id]);
  return row ? mapRetro(row as Row) : null;
}

export async function getRetroStatus(id: string): Promise<{ status: string } | null> {
  const row = await queryOne(`SELECT "status" FROM "Retrospective" WHERE "id" = $1`, [id]);
  return row ? { status: (row as Row).status } : null;
}

/** Full nested retro: columns -> items (ordered) -> votes + reactions, plus actions and team. */
export async function getRetroFull(id: string): Promise<RetroFull | null> {
  const retroRow = await queryOne(`SELECT * FROM "Retrospective" WHERE "id" = $1`, [id]);
  if (!retroRow) return null;
  const retro = mapRetro(retroRow as Row);

  const columns = (
    await query(`SELECT * FROM "Column" WHERE "retrospectiveId" = $1 ${COLUMN_ORDER_SQL}`, [id])
  ).map(mapColumn);
  const columnIds = columns.map((c) => c.id);

  const items = (
    await query(
      `SELECT * FROM "Item" WHERE "columnId" = ANY($1) ORDER BY "order" ASC`,
      [columnIds]
    )
  ).map(mapItem);
  const itemIds = items.map((i) => i.id);

  const [votes, reactions, actions] = await Promise.all([
    query(`SELECT * FROM "Vote" WHERE "itemId" = ANY($1)`, [itemIds]),
    query(`SELECT * FROM "Reaction" WHERE "itemId" = ANY($1)`, [itemIds]),
    query(`SELECT * FROM "ActionItem" WHERE "retrospectiveId" = $1`, [id]),
  ]);

  const itemById = new Map(items.map((i) => [i.id, i]));
  for (const v of votes) itemById.get(v.itemId)?.votes.push(mapVote(v));
  for (const re of reactions) itemById.get(re.itemId)?.reactions.push(mapReaction(re));

  const itemsByColumn = new Map<string, Item[]>();
  for (const item of items) {
    const list = itemsByColumn.get(item.columnId) ?? [];
    list.push(item);
    itemsByColumn.set(item.columnId, list);
  }
  const columnsWithItems: ColumnWithItems[] = columns.map((col) => ({
    ...col,
    items: itemsByColumn.get(col.id) ?? [],
  }));

  return {
    ...retro,
    columns: columnsWithItems,
    actions: actions.map(mapActionItem),
    team: retro.teamId ? await getTeam(retro.teamId) : null,
  };
}


export async function createRetrospectiveWithColumns(
  data: CreateRetroInput,
  columns: CreateColumnInput[]
): Promise<Retrospective> {
  const id = randomUUID();
  return withTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO "Retrospective"
        ("id","title","status","tags","creator","isAnonymous","blindInput","expiresAt",
         "inputDuration","votingDuration","reviewDuration","phaseStartTime","teamId")
       VALUES ($1,$2,'INPUT',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        id,
        data.title,
        data.tags,
        data.creator,
        data.isAnonymous,
        data.blindInput,
        data.expiresAt,
        data.inputDuration,
        data.votingDuration,
        data.reviewDuration,
        data.phaseStartTime,
        data.teamId,
      ]
    );
    for (const [index, c] of columns.entries()) {
      await client.query(
        `INSERT INTO "Column" ("id","title","type","order","retrospectiveId") VALUES ($1,$2,$3,$4,$5)`,
        [randomUUID(), c.title, c.type, index, id]
      );
    }
    // A board opens in INPUT without a status change, so log that entry here
    // or INPUT never appears in the phase durations.
    await client.query(
      `INSERT INTO "PhaseEvent" ("id","retrospectiveId","phase","enteredAt") VALUES ($1,$2,'INPUT',$3)`,
      [randomUUID(), id, data.phaseStartTime]
    );
    return mapRetro(res.rows[0]);
  });
}

/** Update status (and reset phaseStartTime). Returns full nested retro. */
export async function updateRetroStatus(
  id: string,
  status: string,
  phaseStartTime: Date
): Promise<RetroFull | null> {
  await query(
    `UPDATE "Retrospective" SET "status" = $2, "phaseStartTime" = $3 WHERE "id" = $1`,
    [id, status, phaseStartTime]
  );
  // Log the transition: phaseStartTime is overwritten each time, so this is the
  // only record of how long a board actually spent in each phase.
  await query(
    `INSERT INTO "PhaseEvent" ("id","retrospectiveId","phase","enteredAt") VALUES ($1,$2,$3,$4)`,
    [randomUUID(), id, status, phaseStartTime]
  );
  return getRetroFull(id);
}

/** Update timer durations. Returns full nested retro. */
export async function updateRetroDurations(
  id: string,
  durations: { inputDuration?: number; votingDuration?: number; reviewDuration?: number }
): Promise<RetroFull | null> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  if (durations.inputDuration !== undefined) {
    sets.push(`"inputDuration" = $${params.push(durations.inputDuration)}`);
  }
  if (durations.votingDuration !== undefined) {
    sets.push(`"votingDuration" = $${params.push(durations.votingDuration)}`);
  }
  if (durations.reviewDuration !== undefined) {
    sets.push(`"reviewDuration" = $${params.push(durations.reviewDuration)}`);
  }
  if (sets.length > 0) {
    await query(`UPDATE "Retrospective" SET ${sets.join(", ")} WHERE "id" = $1`, params);
  }
  return getRetroFull(id);
}

export async function listRetrospectives(
  filter: RetroFilter,
  take?: number,
  skip?: number
): Promise<(Retrospective & { team: Team | null })[]> {
  const params: unknown[] = [];
  const { clauses, needsTeamJoin } = buildRetroWhere(filter, "r", "t", params);
  const join = needsTeamJoin ? `JOIN "Team" t ON t."id" = r."teamId"` : "";
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = take != null ? ` LIMIT ${Number(take)}` : "";
  // `id` is the tiebreaker in the ORDER BY above: two boards created in the
  // same millisecond would otherwise order arbitrarily and could appear on two
  // pages, or on neither.
  const offset = skip ? ` OFFSET ${Number(skip)}` : "";
  const rows = await query(
    `SELECT r.* FROM "Retrospective" r ${join} ${where} ORDER BY r."createdAt" DESC, r."id" ${limit}${offset}`,
    params
  );
  const teams = await getTeamsByIds([
    ...new Set(rows.map((r) => r.teamId as string | null).filter((t): t is string => !!t)),
  ]);
  return rows.map((row) => ({ ...mapRetro(row), team: row.teamId ? teams.get(row.teamId) ?? null : null }));
}

export async function countRetrospectives(filter: RetroFilter): Promise<number> {
  const params: unknown[] = [];
  const { clauses, needsTeamJoin } = buildRetroWhere(filter, "r", "t", params);
  const join = needsTeamJoin ? `JOIN "Team" t ON t."id" = r."teamId"` : "";
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const row = await queryOne(`SELECT COUNT(*)::int AS c FROM "Retrospective" r ${join} ${where}`, params);
  return (row as Row).c;
}

/** Raw `tags` strings of every retrospective (used to derive unique/popular tags). */
export async function getAllTagStrings(): Promise<string[]> {
  return (await query(`SELECT "tags" FROM "Retrospective"`)).map((r) => r.tags as string);
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export async function itemMaxOrder(columnId: string): Promise<number | null> {
  const row = await queryOne(
    `SELECT MAX("order") AS "maxOrder" FROM "Item" WHERE "columnId" = $1`,
    [columnId]
  );
  return (row as Row)?.maxOrder ?? null;
}

export async function createItem(data: {
  content: string;
  columnId: string;
  userId: string;
  username: string;
  order: number;
}): Promise<Item> {
  const row = await queryOne(
    `INSERT INTO "Item" ("id","content","userId","username","columnId","order")
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [randomUUID(), data.content, data.userId, data.username, data.columnId, data.order]
  );
  return mapItem(row as Row);
}

export async function getItem(id: string): Promise<Item | null> {
  const row = await queryOne(`SELECT * FROM "Item" WHERE "id" = $1`, [id]);
  return row ? mapItem(row as Row) : null;
}

export async function listItemsInColumn(columnId: string): Promise<Item[]> {
  return (
    await query(`SELECT * FROM "Item" WHERE "columnId" = $1 ORDER BY "order" ASC`, [columnId])
  ).map(mapItem);
}

export async function updateItemContent(id: string, content: string): Promise<void> {
  await query(`UPDATE "Item" SET "content" = $2 WHERE "id" = $1`, [id, content]);
}

export async function updateItemSummary(id: string, summary: string): Promise<void> {
  await query(`UPDATE "Item" SET "summary" = $2 WHERE "id" = $1`, [id, summary]);
}

export async function updateItemColumn(id: string, columnId: string): Promise<void> {
  await query(`UPDATE "Item" SET "columnId" = $2 WHERE "id" = $1`, [id, columnId]);
}

/** Set the order of items to match the given id sequence, atomically. */
export async function reorderItems(orderedIds: string[]): Promise<void> {
  if (orderedIds.length === 0) return;
  await withTransaction(async (client) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(`UPDATE "Item" SET "order" = $2 WHERE "id" = $1`, [orderedIds[i], i]);
    }
  });
}

export async function countItems(): Promise<number> {
  const row = await queryOne(`SELECT COUNT(*)::int AS c FROM "Item"`);
  return (row as Row).c;
}

// ---------------------------------------------------------------------------
// Votes
// ---------------------------------------------------------------------------

export async function findVote(itemId: string, userId: string): Promise<Vote | null> {
  const row = await queryOne(
    `SELECT * FROM "Vote" WHERE "itemId" = $1 AND "userId" = $2 LIMIT 1`,
    [itemId, userId]
  );
  return row ? mapVote(row as Row) : null;
}

export async function createVote(data: { itemId: string; userId: string; count: number }): Promise<Vote> {
  const row = await queryOne(
    `INSERT INTO "Vote" ("id","itemId","userId","count") VALUES ($1,$2,$3,$4) RETURNING *`,
    [randomUUID(), data.itemId, data.userId, data.count]
  );
  return mapVote(row as Row);
}

export async function updateVoteCount(id: string, count: number): Promise<void> {
  await query(`UPDATE "Vote" SET "count" = $2 WHERE "id" = $1`, [id, count]);
}

export async function deleteVote(id: string): Promise<void> {
  await query(`DELETE FROM "Vote" WHERE "id" = $1`, [id]);
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

export async function findReaction(itemId: string, userId: string, emoji: string): Promise<Reaction | null> {
  const row = await queryOne(
    `SELECT * FROM "Reaction" WHERE "itemId" = $1 AND "userId" = $2 AND "emoji" = $3 LIMIT 1`,
    [itemId, userId, emoji]
  );
  return row ? mapReaction(row as Row) : null;
}

export async function createReaction(data: {
  itemId: string;
  userId: string;
  emoji: string;
}): Promise<Reaction> {
  const row = await queryOne(
    `INSERT INTO "Reaction" ("id","emoji","userId","itemId") VALUES ($1,$2,$3,$4) RETURNING *`,
    [randomUUID(), data.emoji, data.userId, data.itemId]
  );
  return mapReaction(row as Row);
}

export async function deleteReaction(id: string): Promise<void> {
  await query(`DELETE FROM "Reaction" WHERE "id" = $1`, [id]);
}

// ---------------------------------------------------------------------------
// Action items
// ---------------------------------------------------------------------------

export async function createActionItem(data: {
  content: string;
  retrospectiveId: string;
  assignee?: string | null;
  dueDate?: Date | null;
}): Promise<ActionItem> {
  const row = await queryOne(
    `INSERT INTO "ActionItem" ("id","content","retrospectiveId","assignee","dueDate")
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [randomUUID(), data.content, data.retrospectiveId, data.assignee ?? null, data.dueDate ?? null]
  );
  return mapActionItem(row as Row);
}

export async function setActionExternalLink(
  id: string,
  link: { externalUrl: string; externalKey: string }
): Promise<void> {
  await query(
    `UPDATE "ActionItem" SET "externalUrl" = $2, "externalKey" = $3 WHERE "id" = $1`,
    [id, link.externalUrl, link.externalKey]
  );
}

export async function getActionItem(id: string): Promise<ActionItem | null> {
  const row = await queryOne(`SELECT * FROM "ActionItem" WHERE "id" = $1`, [id]);
  return row ? mapActionItem(row as Row) : null;
}

export async function updateActionCompleted(id: string, completed: boolean): Promise<void> {
  // Record when it closed, and clear it again if the action is reopened, so
  // "time to close" always reflects the completion it belongs to.
  await query(
    `UPDATE "ActionItem" SET "completed" = $2, "completedAt" = $3 WHERE "id" = $1`,
    [id, completed, completed ? new Date() : null]
  );
}


export async function countActionItems(filter: ActionFilter): Promise<number> {
  const params: unknown[] = [];
  const { clauses, needsTeamJoin } = buildActionWhere(filter, params);
  const teamJoin = needsTeamJoin ? `JOIN "Team" t ON t."id" = r."teamId"` : "";
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await query(
    `SELECT COUNT(*)::int AS n FROM "ActionItem" a
     JOIN "Retrospective" r ON r."id" = a."retrospectiveId" ${teamJoin} ${where}`,
    params
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Where-clause for action queries. Shared by the list and the count so a page's
 * "N results" can never describe a different set than the rows shown.
 */
function buildActionWhere(
  filter: ActionFilter,
  params: unknown[]
): { clauses: string[]; needsTeamJoin: boolean } {
  const clauses: string[] = [];
  let needsTeamJoin = false;

  if (filter.completed !== undefined) {
    clauses.push(`a."completed" = $${params.push(filter.completed)}`);
  }
  if (filter.retrospectiveId) {
    clauses.push(`a."retrospectiveId" = $${params.push(filter.retrospectiveId)}`);
  }
  if (filter.creatorContains) {
    clauses.push(`r."creator" ILIKE $${params.push(`%${filter.creatorContains}%`)}`);
  }
  if (filter.assigneeContains) {
    clauses.push(`a."assignee" ILIKE $${params.push(`%${filter.assigneeContains}%`)}`);
  }
  if (filter.teamNameContains) {
    needsTeamJoin = true;
    clauses.push(`t."name" ILIKE $${params.push(`%${filter.teamNameContains}%`)}`);
  }
  if (filter.teamId) {
    clauses.push(`r."teamId" = $${params.push(filter.teamId)}`);
  }
  if (filter.excludeRetrospectiveId) {
    clauses.push(`a."retrospectiveId" <> $${params.push(filter.excludeRetrospectiveId)}`);
  }
  return { clauses, needsTeamJoin };
}

export async function listActionItems(filter: ActionFilter): Promise<ActionItemWithRetro[]> {
  const params: unknown[] = [];
  const { clauses, needsTeamJoin } = buildActionWhere(filter, params);

  const teamJoin = needsTeamJoin ? `JOIN "Team" t ON t."id" = r."teamId"` : "";
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = filter.take != null ? ` LIMIT ${Number(filter.take)}` : "";
  const offset = filter.skip ? ` OFFSET ${Number(filter.skip)}` : "";
  const rows = await query(
    `SELECT a.* FROM "ActionItem" a
     JOIN "Retrospective" r ON r."id" = a."retrospectiveId"
     ${teamJoin}
     ${where}
     ORDER BY r."createdAt" DESC, a."id"${limit}${offset}`,
    params
  );

  // Attach each action's retrospective (+team), fetched in bulk.
  const retroIds = [...new Set(rows.map((r) => r.retrospectiveId as string))];
  const retroById = new Map<string, Retrospective & { team: Team | null }>();
  if (retroIds.length > 0) {
    const retros = (await query(`SELECT * FROM "Retrospective" WHERE "id" = ANY($1)`, [retroIds])).map(mapRetro);
    const teams = await getTeamsByIds([
      ...new Set(retros.map((r) => r.teamId).filter((t): t is string => !!t)),
    ]);
    for (const r of retros) retroById.set(r.id, { ...r, team: r.teamId ? teams.get(r.teamId) ?? null : null });
  }

  return rows.map((row) => ({
    ...mapActionItem(row),
    retrospective: retroById.get(row.retrospectiveId)!,
  }));
}

export async function countOpenActions(retroFilter: RetroFilter): Promise<number> {
  const params: unknown[] = [];
  const { clauses, needsTeamJoin } = buildRetroWhere(retroFilter, "r", "t", params);
  const teamJoin = needsTeamJoin ? `JOIN "Team" t ON t."id" = r."teamId"` : "";
  const allClauses = [`a."completed" = false`, ...clauses];
  const row = await queryOne(
    `SELECT COUNT(*)::int AS c FROM "ActionItem" a
     JOIN "Retrospective" r ON r."id" = a."retrospectiveId"
     ${teamJoin}
     WHERE ${allClauses.join(" AND ")}`,
    params
  );
  return (row as Row).c;
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

/** Delete all data. Used by the clean-db script. */
/**
 * Delete a board and everything belonging to it. The foreign keys are
 * ON DELETE RESTRICT, so children go first, deepest first.
 */
export async function deleteRetro(id: string): Promise<void> {
  await withTransaction(async (client) => {
    const cols = `SELECT "id" FROM "Column" WHERE "retrospectiveId" = $1`;
    const items = `SELECT "id" FROM "Item" WHERE "columnId" IN (${cols})`;
    await client.query(`DELETE FROM "Reaction" WHERE "itemId" IN (${items})`, [id]);
    await client.query(`DELETE FROM "Vote" WHERE "itemId" IN (${items})`, [id]);
    await client.query(`DELETE FROM "Item" WHERE "columnId" IN (${cols})`, [id]);
    await client.query(`DELETE FROM "Column" WHERE "retrospectiveId" = $1`, [id]);
    await client.query(`DELETE FROM "ActionItem" WHERE "retrospectiveId" = $1`, [id]);
    await client.query(`DELETE FROM "PhaseEvent" WHERE "retrospectiveId" = $1`, [id]);
    await client.query(`DELETE FROM "Retrospective" WHERE "id" = $1`, [id]);
  });
}

export async function listExpiredRetroIds(now: Date): Promise<string[]> {
  const rows = await query(
    `SELECT "id" FROM "Retrospective" WHERE "expiresAt" IS NOT NULL AND "expiresAt" <= $1`,
    [now]
  );
  return rows.map((r) => r.id as string);
}

/**
 * Read-only aggregates for one team. Returns raw counts and samples; the
 * shaping into rates and medians lives in lib/analytics.ts so it is testable
 * without a database and identical on both backends.
 */
export async function teamAnalytics(teamId: string): Promise<TeamAnalyticsRaw> {
  const retros = await query(
    `SELECT "id", "createdAt", "isAnonymous" FROM "Retrospective" WHERE "teamId" = $1 ORDER BY "createdAt"`,
    [teamId]
  );
  const retroIds = retros.map((r) => r.id as string);
  const empty: TeamAnalyticsRaw = {
    retroDates: retros.map((r) => r.createdAt as Date),
    itemsByColumnType: [],
    actions: { open: 0, done: 0, overdue: 0, daysToClose: [] },
    engagement: { totalItems: 0, itemsWithSummary: 0, retrosWithItems: 0, voteSpread: [], contributorsPerRetro: [] },
    phaseDurations: [],
  };
  if (retroIds.length === 0) return empty;

  const itemsByColumnType = (
    await query(
      `SELECT c."type" AS type, COUNT(i."id")::int AS items
         FROM "Column" c JOIN "Item" i ON i."columnId" = c."id"
        WHERE c."retrospectiveId" = ANY($1)
        GROUP BY c."type"`,
      [retroIds]
    )
  ).map((r) => ({ type: r.type as string, items: Number(r.items) }));

  const actionRows = await query(
    `SELECT "completed", "dueDate", "createdAt", "completedAt"
       FROM "ActionItem" WHERE "retrospectiveId" = ANY($1)`,
    [retroIds]
  );
  const now = Date.now();
  const actions = { open: 0, done: 0, overdue: 0, daysToClose: [] as number[] };
  for (const a of actionRows) {
    if (a.completed) {
      actions.done += 1;
      if (a.createdAt && a.completedAt) {
        actions.daysToClose.push(
          (new Date(a.completedAt as Date).getTime() - new Date(a.createdAt as Date).getTime()) / 86_400_000
        );
      }
    } else {
      actions.open += 1;
      if (a.dueDate && new Date(a.dueDate as Date).getTime() < now) actions.overdue += 1;
    }
  }

  const itemRows = await query(
    `SELECT c."retrospectiveId" AS retro, i."id" AS item, i."userId" AS "userId",
            (i."summary" IS NOT NULL AND i."summary" <> '') AS summarised
       FROM "Column" c JOIN "Item" i ON i."columnId" = c."id"
      WHERE c."retrospectiveId" = ANY($1)`,
    [retroIds]
  );
  const voteRows = await query(
    `SELECT c."retrospectiveId" AS retro, v."itemId" AS item, SUM(v."count")::int AS votes
       FROM "Column" c JOIN "Item" i ON i."columnId" = c."id" JOIN "Vote" v ON v."itemId" = i."id"
      WHERE c."retrospectiveId" = ANY($1)
      GROUP BY c."retrospectiveId", v."itemId"`,
    [retroIds]
  );
  const phaseRows = await query(
    `SELECT "retrospectiveId" AS retro, "phase", "enteredAt"
       FROM "PhaseEvent" WHERE "retrospectiveId" = ANY($1) ORDER BY "retrospectiveId", "enteredAt"`,
    [retroIds]
  );

  return {
    ...empty,
    itemsByColumnType,
    actions,
    engagement: engagementFromRows(retros, itemRows, voteRows),
    phaseDurations: phaseDurationsFromRows(phaseRows),
  };
}

export async function clearDatabase(): Promise<void> {
  await query(
    `TRUNCATE "Reaction","Vote","Item","Column","ActionItem","PhaseEvent","Retrospective","Team" RESTART IDENTITY CASCADE`
  );
}
