/**
 * PostgreSQL data-access layer built on `pg` (node-postgres).
 *
 * `pg` is pure JavaScript (no native build step — we don't use pg-native), so it
 * stays airgapped/offline-build friendly. The connection string comes from
 * DATABASE_URL (postgres://user:pass@host:port/db).
 *
 * The schema is embedded below and applied with `CREATE TABLE IF NOT EXISTS` the
 * first time a connection is used, so there is no separate migration step. This
 * is safe to run concurrently across replicas.
 */
import { Pool, type PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import type {
  Team, Retrospective, Column, Vote, Reaction, Item, ActionItem,
  ColumnWithItems, RetroFull, RetroFilter, ActionFilter,
  CreateColumnInput, CreateRetroInput, ActionItemWithRetro,
} from "./types";

// ---------------------------------------------------------------------------
// Connection + schema bootstrap
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS "Team" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
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
    "inputDuration" INTEGER,
    "votingDuration" INTEGER,
    "reviewDuration" INTEGER,
    "phaseStartTime" TIMESTAMPTZ,
    "teamId" TEXT NOT NULL REFERENCES "Team" ("id")
);

CREATE TABLE IF NOT EXISTS "Column" (
    "id" TEXT PRIMARY KEY,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
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
    "retrospectiveId" TEXT NOT NULL REFERENCES "Retrospective" ("id")
);
`;

// Cache the pool and the one-time schema init on globalThis so dev/HMR and
// multiple imports share a single pool.
const globalForDb = globalThis as unknown as {
  __pgPool?: Pool;
  __pgInit?: Promise<unknown>;
};

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

/** Returns the pool, ensuring the schema has been created exactly once. */
async function pool(): Promise<Pool> {
  const p = getPool();
  if (!globalForDb.__pgInit) {
    globalForDb.__pgInit = p.query(SCHEMA_SQL);
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

const mapTeam = (r: Row): Team => ({ id: r.id, name: r.name, createdAt: r.createdAt });
const mapColumn = (r: Row): Column => ({
  id: r.id, title: r.title, type: r.type, retrospectiveId: r.retrospectiveId,
});
const mapVote = (r: Row): Vote => ({ id: r.id, itemId: r.itemId, userId: r.userId, count: r.count });
const mapReaction = (r: Row): Reaction => ({
  id: r.id, emoji: r.emoji, userId: r.userId, itemId: r.itemId, createdAt: r.createdAt,
});
const mapActionItem = (r: Row): ActionItem => ({
  id: r.id, content: r.content, completed: r.completed, retrospectiveId: r.retrospectiveId,
});
const mapRetro = (r: Row): Retrospective => ({
  id: r.id,
  title: r.title,
  status: r.status,
  tags: r.tags,
  creator: r.creator,
  createdAt: r.createdAt,
  isAnonymous: r.isAnonymous,
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

// Stable column ordering (Postgres has no implicit row order). Mirrors the
// order columns are created in actions.ts.
const COLUMN_ORDER_SQL = `ORDER BY CASE "type"
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

export async function createTeam(name: string): Promise<Team> {
  const row = await queryOne(
    `INSERT INTO "Team" ("id", "name") VALUES ($1, $2) RETURNING *`,
    [randomUUID(), name]
  );
  return mapTeam(row as Row);
}

export async function updateTeam(id: string, name: string): Promise<Team> {
  const row = await queryOne(
    `UPDATE "Team" SET "name" = $2 WHERE "id" = $1 RETURNING *`,
    [id, name]
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
    team: await getTeam(retro.teamId),
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
        ("id","title","status","tags","creator","isAnonymous",
         "inputDuration","votingDuration","reviewDuration","phaseStartTime","teamId")
       VALUES ($1,$2,'INPUT',$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        id,
        data.title,
        data.tags,
        data.creator,
        data.isAnonymous,
        data.inputDuration,
        data.votingDuration,
        data.reviewDuration,
        data.phaseStartTime,
        data.teamId,
      ]
    );
    for (const c of columns) {
      await client.query(
        `INSERT INTO "Column" ("id","title","type","retrospectiveId") VALUES ($1,$2,$3,$4)`,
        [randomUUID(), c.title, c.type, id]
      );
    }
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
  take?: number
): Promise<(Retrospective & { team: Team | null })[]> {
  const params: unknown[] = [];
  const { clauses, needsTeamJoin } = buildRetroWhere(filter, "r", "t", params);
  const join = needsTeamJoin ? `JOIN "Team" t ON t."id" = r."teamId"` : "";
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = take != null ? `LIMIT ${Number(take)}` : "";
  const rows = await query(
    `SELECT r.* FROM "Retrospective" r ${join} ${where} ORDER BY r."createdAt" DESC ${limit}`,
    params
  );
  const teams = await getTeamsByIds([...new Set(rows.map((r) => r.teamId as string))]);
  return rows.map((row) => ({ ...mapRetro(row), team: teams.get(row.teamId) ?? null }));
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
}): Promise<ActionItem> {
  const row = await queryOne(
    `INSERT INTO "ActionItem" ("id","content","retrospectiveId") VALUES ($1,$2,$3) RETURNING *`,
    [randomUUID(), data.content, data.retrospectiveId]
  );
  return mapActionItem(row as Row);
}

export async function getActionItem(id: string): Promise<ActionItem | null> {
  const row = await queryOne(`SELECT * FROM "ActionItem" WHERE "id" = $1`, [id]);
  return row ? mapActionItem(row as Row) : null;
}

export async function updateActionCompleted(id: string, completed: boolean): Promise<void> {
  await query(`UPDATE "ActionItem" SET "completed" = $2 WHERE "id" = $1`, [id, completed]);
}


export async function listActionItems(filter: ActionFilter): Promise<ActionItemWithRetro[]> {
  const params: unknown[] = [];
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
  if (filter.teamNameContains) {
    needsTeamJoin = true;
    clauses.push(`t."name" ILIKE $${params.push(`%${filter.teamNameContains}%`)}`);
  }

  const teamJoin = needsTeamJoin ? `JOIN "Team" t ON t."id" = r."teamId"` : "";
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await query(
    `SELECT a.* FROM "ActionItem" a
     JOIN "Retrospective" r ON r."id" = a."retrospectiveId"
     ${teamJoin}
     ${where}
     ORDER BY r."createdAt" DESC`,
    params
  );

  // Attach each action's retrospective (+team), fetched in bulk.
  const retroIds = [...new Set(rows.map((r) => r.retrospectiveId as string))];
  const retroById = new Map<string, Retrospective & { team: Team | null }>();
  if (retroIds.length > 0) {
    const retros = (await query(`SELECT * FROM "Retrospective" WHERE "id" = ANY($1)`, [retroIds])).map(mapRetro);
    const teams = await getTeamsByIds([...new Set(retros.map((r) => r.teamId))]);
    for (const r of retros) retroById.set(r.id, { ...r, team: teams.get(r.teamId) ?? null });
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
export async function clearDatabase(): Promise<void> {
  await query(
    `TRUNCATE "Reaction","Vote","Item","Column","ActionItem","Retrospective","Team" RESTART IDENTITY CASCADE`
  );
}
