/**
 * SQLite data-access layer built on Node's built-in `node:sqlite` module.
 *
 * It requires NO native modules and NO network access at install or build time,
 * so it works in airgapped/offline environments.
 *
 * Requirements:
 *   - Node 22+ (node:sqlite is available; in Node 22 it is behind the
 *     `--experimental-sqlite` flag, set via NODE_OPTIONS in package.json/Docker).
 *
 * The schema is embedded below and applied with `CREATE TABLE IF NOT EXISTS`
 * on first connection, so there is no separate migration step.
 */
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { engagementFromRows, phaseDurationsFromRows } from "./aggregate";
import type {
  Team, TeamJiraConfig, TeamGroups, TeamCreateOptions, Retrospective, Column, Vote, Reaction, Item, ActionItem,
  ColumnWithItems, RetroFull, RetroFilter, ActionFilter,
  CreateColumnInput, CreateRetroInput, ActionItemWithRetro, TeamAnalyticsRaw,
} from "./types";
import path from "node:path";
import fs from "node:fs";

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

function resolveDbPath(): string {
  // Resolve the SQLite file from DATABASE_URL ("file:./data/dev.db") or an
  // explicit DATABASE_PATH override. Defaults to ./data/dev.db.
  const explicit = process.env.DATABASE_PATH;
  if (explicit) return path.resolve(process.cwd(), explicit);

  const url = process.env.DATABASE_URL ?? "file:./data/dev.db";
  const filePart = url.startsWith("file:") ? url.slice("file:".length) : url;
  return path.resolve(process.cwd(), filePart);
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS "Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "memberGroups" TEXT NOT NULL DEFAULT '[]',
    "adminGroups" TEXT NOT NULL DEFAULT '[]',
    "imageData" TEXT,
    "jiraBaseUrl" TEXT,
    "jiraProjectKey" TEXT,
    "jiraEmail" TEXT,
    "jiraApiToken" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "Team_name_key" ON "Team"("name");

CREATE TABLE IF NOT EXISTS "Retrospective" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INPUT',
    "tags" TEXT NOT NULL DEFAULT '',
    "creator" TEXT NOT NULL DEFAULT 'Anonymous',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT 0,
    "blindInput" BOOLEAN NOT NULL DEFAULT 0,
    "expiresAt" DATETIME,
    "inputDuration" INTEGER,
    "votingDuration" INTEGER,
    "reviewDuration" INTEGER,
    "phaseStartTime" DATETIME,
    "teamId" TEXT,
    CONSTRAINT "Retrospective_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Column" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "retrospectiveId" TEXT NOT NULL,
    CONSTRAINT "Column_retrospectiveId_fkey" FOREIGN KEY ("retrospectiveId") REFERENCES "Retrospective" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Item" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "userId" TEXT NOT NULL DEFAULT 'anonymous',
    "username" TEXT NOT NULL DEFAULT 'Anonymous',
    "columnId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Item_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "Column" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "PhaseEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "retrospectiveId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "enteredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PhaseEvent_retrospectiveId_fkey" FOREIGN KEY ("retrospectiveId") REFERENCES "Retrospective" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Vote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    CONSTRAINT "Vote_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Reaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "emoji" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Reaction_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ActionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT 0,
    "retrospectiveId" TEXT NOT NULL,
    "assignee" TEXT,
    "dueDate" DATETIME,
    "externalUrl" TEXT,
    "externalKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "ActionItem_retrospectiveId_fkey" FOREIGN KEY ("retrospectiveId") REFERENCES "Retrospective" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
`;

/**
 * Idempotent column additions for databases created before these columns
 * existed. `CREATE TABLE IF NOT EXISTS` never alters an existing table, so we
 * add new nullable columns here. Each ALTER is wrapped because node:sqlite has
 * no "ADD COLUMN IF NOT EXISTS"; a duplicate-column error is expected and safe.
 */
const MIGRATIONS: string[] = [
  `ALTER TABLE "Team" ADD COLUMN "createdBy" TEXT`,
  `ALTER TABLE "Team" ADD COLUMN "memberGroups" TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE "Team" ADD COLUMN "adminGroups" TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE "Team" ADD COLUMN "imageData" TEXT`,
  `ALTER TABLE "Team" ADD COLUMN "jiraBaseUrl" TEXT`,
  `ALTER TABLE "Team" ADD COLUMN "jiraProjectKey" TEXT`,
  `ALTER TABLE "Team" ADD COLUMN "jiraEmail" TEXT`,
  `ALTER TABLE "Team" ADD COLUMN "jiraApiToken" TEXT`,
  `ALTER TABLE "ActionItem" ADD COLUMN "assignee" TEXT`,
  `ALTER TABLE "ActionItem" ADD COLUMN "dueDate" DATETIME`,
  `ALTER TABLE "ActionItem" ADD COLUMN "externalUrl" TEXT`,
  `ALTER TABLE "ActionItem" ADD COLUMN "externalKey" TEXT`,
  `ALTER TABLE "Retrospective" ADD COLUMN "blindInput" BOOLEAN NOT NULL DEFAULT 0`,
  `ALTER TABLE "Column" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "Retrospective" ADD COLUMN "expiresAt" DATETIME`,
  `ALTER TABLE "ActionItem" ADD COLUMN "createdAt" DATETIME`,
  `ALTER TABLE "ActionItem" ADD COLUMN "completedAt" DATETIME`,
];

function applyMigrations(db: DatabaseSync): void {
  for (const sql of MIGRATIONS) {
    try {
      db.exec(sql);
    } catch (err: any) {
      // "duplicate column name" means the migration already ran — ignore it.
      if (!/duplicate column name/i.test(String(err?.message ?? err))) throw err;
    }
  }
  migrateRetroTeamIdNullable(db);
}

/**
 * Boards may now be created without a team ("open boards"), so
 * Retrospective.teamId must be nullable. Databases created before this change
 * have it as NOT NULL; SQLite cannot drop a NOT NULL constraint in place, so we
 * rebuild the table (the standard 12-step approach) only when needed.
 */
function migrateRetroTeamIdNullable(db: DatabaseSync): void {
  const cols = db.prepare(`PRAGMA table_info("Retrospective")`).all() as Array<{
    name: string;
    notnull: number;
  }>;
  const teamCol = cols.find((c) => c.name === "teamId");
  if (!teamCol || teamCol.notnull === 0) return; // already nullable (or fresh schema)

  db.exec("PRAGMA foreign_keys=OFF");
  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE "Retrospective_new" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "title" TEXT NOT NULL,
          "status" TEXT NOT NULL DEFAULT 'INPUT',
          "tags" TEXT NOT NULL DEFAULT '',
          "creator" TEXT NOT NULL DEFAULT 'Anonymous',
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "isAnonymous" BOOLEAN NOT NULL DEFAULT 0,
          "blindInput" BOOLEAN NOT NULL DEFAULT 0,
          "expiresAt" DATETIME,
          "inputDuration" INTEGER,
          "votingDuration" INTEGER,
          "reviewDuration" INTEGER,
          "phaseStartTime" DATETIME,
          "teamId" TEXT,
          CONSTRAINT "Retrospective_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
      );
      INSERT INTO "Retrospective_new"
        ("id","title","status","tags","creator","createdAt","isAnonymous","blindInput","expiresAt",
         "inputDuration","votingDuration","reviewDuration","phaseStartTime","teamId")
        SELECT "id","title","status","tags","creator","createdAt","isAnonymous","blindInput","expiresAt",
               "inputDuration","votingDuration","reviewDuration","phaseStartTime","teamId"
        FROM "Retrospective";
      DROP TABLE "Retrospective";
      ALTER TABLE "Retrospective_new" RENAME TO "Retrospective";
    `);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    db.exec("PRAGMA foreign_keys=ON");
  }
}

// Cache the connection on globalThis so dev/HMR doesn't open many handles.
const globalForDb = globalThis as unknown as { __sqlite?: DatabaseSync };

function getDb(): DatabaseSync {
  if (!globalForDb.__sqlite) {
    const dbPath = resolveDbPath();
    // node:sqlite does not create the parent directory; ensure it exists.
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(SCHEMA_SQL);
    applyMigrations(db);
    globalForDb.__sqlite = db;
  }
  return globalForDb.__sqlite;
}

/** Run a function inside a transaction. node:sqlite is synchronous. */
export function transaction<T>(fn: () => T): T {
  const db = getDb();
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------







// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

type Row = Record<string, any>;
const toDate = (v: any): Date => new Date(v);
const toDateOrNull = (v: any): Date | null => (v == null ? null : new Date(v));
const toBool = (v: any): boolean => v === 1 || v === true || v === "1";
const dateToDb = (d: Date | string | null | undefined): string | null =>
  d == null ? null : d instanceof Date ? d.toISOString() : d;

function parseGroups(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((g): g is string => typeof g === "string") : [];
  } catch {
    return [];
  }
}

const mapTeam = (r: Row): Team => ({
  id: r.id,
  name: r.name,
  createdAt: toDate(r.createdAt),
  createdBy: r.createdBy ?? null,
  memberGroups: parseGroups(r.memberGroups),
  adminGroups: parseGroups(r.adminGroups),
  imageData: r.imageData ?? null,
  jiraBaseUrl: r.jiraBaseUrl ?? null,
  jiraProjectKey: r.jiraProjectKey ?? null,
  jiraEmail: r.jiraEmail ?? null,
  jiraApiToken: r.jiraApiToken ?? null,
});
const mapColumn = (r: Row): Column => ({ id: r.id, title: r.title, type: r.type, retrospectiveId: r.retrospectiveId, order: r.order ?? 0 });
const mapVote = (r: Row): Vote => ({ id: r.id, itemId: r.itemId, userId: r.userId, count: r.count });
const mapReaction = (r: Row): Reaction => ({
  id: r.id, emoji: r.emoji, userId: r.userId, itemId: r.itemId, createdAt: toDate(r.createdAt),
});
const mapActionItem = (r: Row): ActionItem => ({
  id: r.id,
  content: r.content,
  completed: toBool(r.completed),
  retrospectiveId: r.retrospectiveId,
  assignee: r.assignee ?? null,
  dueDate: toDateOrNull(r.dueDate),
  externalUrl: r.externalUrl ?? null,
  externalKey: r.externalKey ?? null,
  createdAt: toDateOrNull(r.createdAt),
  completedAt: toDateOrNull(r.completedAt),
});
const mapRetro = (r: Row): Retrospective => ({
  id: r.id,
  title: r.title,
  status: r.status,
  tags: r.tags,
  creator: r.creator,
  createdAt: toDate(r.createdAt),
  isAnonymous: toBool(r.isAnonymous),
  blindInput: toBool(r.blindInput),
  expiresAt: toDateOrNull(r.expiresAt),
  inputDuration: r.inputDuration ?? null,
  votingDuration: r.votingDuration ?? null,
  reviewDuration: r.reviewDuration ?? null,
  phaseStartTime: toDateOrNull(r.phaseStartTime),
  teamId: r.teamId,
});
const mapItem = (r: Row): Item => ({
  id: r.id,
  content: r.content,
  summary: r.summary ?? null,
  userId: r.userId,
  username: r.username,
  columnId: r.columnId,
  order: r.order,
  createdAt: toDate(r.createdAt),
  votes: [],
  reactions: [],
});

// ---------------------------------------------------------------------------
// Where-clause builders
// ---------------------------------------------------------------------------

function buildRetroWhere(f: RetroFilter, ra: string, ta: string) {
  const clauses: string[] = [];
  const params: any[] = [];
  let needsTeamJoin = false;

  if (f.creatorEquals != null) {
    clauses.push(`${ra}.creator = ?`);
    params.push(f.creatorEquals);
  } else if (f.creatorContains) {
    clauses.push(`${ra}.creator LIKE ?`);
    params.push(`%${f.creatorContains}%`);
  }
  if (f.tagsContains) {
    clauses.push(`${ra}.tags LIKE ?`);
    params.push(`%${f.tagsContains}%`);
  }
  if (f.statusNot) {
    clauses.push(`${ra}.status != ?`);
    params.push(f.statusNot);
  }
  if (f.teamNameContains) {
    needsTeamJoin = true;
    clauses.push(`${ta}.name LIKE ?`);
    params.push(`%${f.teamNameContains}%`);
  }
  return { clauses, params, needsTeamJoin };
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export function listTeams(): Team[] {
  return getDb().prepare(`SELECT * FROM "Team" ORDER BY "name" ASC`).all().map(mapTeam);
}

export function createTeam(name: string, opts?: TeamCreateOptions): Team {
  const db = getDb();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO "Team" ("id","name","createdAt","createdBy","memberGroups","adminGroups") VALUES (?,?,?,?,?,?)`
  ).run(
    id,
    name,
    createdAt,
    opts?.createdBy ?? null,
    JSON.stringify(opts?.memberGroups ?? []),
    JSON.stringify(opts?.adminGroups ?? [])
  );
  return mapTeam(db.prepare(`SELECT * FROM "Team" WHERE "id" = ?`).get(id) as Row);
}

export function updateTeamGroups(id: string, groups: TeamGroups): Team {
  const db = getDb();
  db.prepare(`UPDATE "Team" SET "memberGroups" = ?, "adminGroups" = ? WHERE "id" = ?`).run(
    JSON.stringify(groups.memberGroups ?? []),
    JSON.stringify(groups.adminGroups ?? []),
    id
  );
  return mapTeam(db.prepare(`SELECT * FROM "Team" WHERE "id" = ?`).get(id) as Row);
}

export function updateTeamImage(id: string, imageData: string | null): Team {
  const db = getDb();
  db.prepare(`UPDATE "Team" SET "imageData" = ? WHERE "id" = ?`).run(imageData ?? null, id);
  return mapTeam(db.prepare(`SELECT * FROM "Team" WHERE "id" = ?`).get(id) as Row);
}

export function updateTeam(id: string, name: string): Team {
  const db = getDb();
  db.prepare(`UPDATE "Team" SET "name" = ? WHERE "id" = ?`).run(name, id);
  return mapTeam(db.prepare(`SELECT * FROM "Team" WHERE "id" = ?`).get(id) as Row);
}

export function updateTeamJira(id: string, config: TeamJiraConfig): Team {
  const db = getDb();
  db.prepare(
    `UPDATE "Team" SET "jiraBaseUrl" = ?, "jiraProjectKey" = ?, "jiraEmail" = ?, "jiraApiToken" = ? WHERE "id" = ?`
  ).run(
    config.jiraBaseUrl ?? null,
    config.jiraProjectKey ?? null,
    config.jiraEmail ?? null,
    config.jiraApiToken ?? null,
    id
  );
  return mapTeam(db.prepare(`SELECT * FROM "Team" WHERE "id" = ?`).get(id) as Row);
}

export function getTeam(id: string): Team | null {
  const r = getDb().prepare(`SELECT * FROM "Team" WHERE "id" = ?`).get(id) as Row | undefined;
  return r ? mapTeam(r) : null;
}

// ---------------------------------------------------------------------------
// Retrospectives
// ---------------------------------------------------------------------------

export function getRetro(id: string): Retrospective | null {
  const r = getDb().prepare(`SELECT * FROM "Retrospective" WHERE "id" = ?`).get(id) as Row | undefined;
  return r ? mapRetro(r) : null;
}

export function getRetroStatus(id: string): { status: string } | null {
  const r = getDb().prepare(`SELECT "status" FROM "Retrospective" WHERE "id" = ?`).get(id) as Row | undefined;
  return r ? { status: r.status } : null;
}

/** Full nested retro: columns -> items (ordered) -> votes + reactions, plus actions and team. */
export function getRetroFull(id: string): RetroFull | null {
  const db = getDb();
  const retroRow = db.prepare(`SELECT * FROM "Retrospective" WHERE "id" = ?`).get(id) as Row | undefined;
  if (!retroRow) return null;
  const retro = mapRetro(retroRow);

  const columns = db
    .prepare(
      // Explicit ordering, mirroring the Postgres backend. Boards predating
      // formats have "order" 0 throughout, so the classic-type CASE orders them.
      `SELECT * FROM "Column" WHERE "retrospectiveId" = ?
       ORDER BY "order", CASE "type"
         WHEN 'WHAT_WENT_WELL' THEN 0
         WHEN 'WHAT_DIDNT_GO_WELL' THEN 1
         WHEN 'WHAT_SHOULD_BE_IMPROVED' THEN 2
         ELSE 3 END, "title"`
    )
    .all(id)
    .map(mapColumn);

  const itemStmt = db.prepare(`SELECT * FROM "Item" WHERE "columnId" = ? ORDER BY "order" ASC`);
  const voteStmt = db.prepare(`SELECT * FROM "Vote" WHERE "itemId" = ?`);
  const reactionStmt = db.prepare(`SELECT * FROM "Reaction" WHERE "itemId" = ?`);

  const columnsWithItems: ColumnWithItems[] = columns.map((col) => {
    const items = itemStmt.all(col.id).map(mapItem);
    for (const item of items) {
      item.votes = voteStmt.all(item.id).map(mapVote);
      item.reactions = reactionStmt.all(item.id).map(mapReaction);
    }
    return { ...col, items };
  });

  const actions = db
    .prepare(`SELECT * FROM "ActionItem" WHERE "retrospectiveId" = ?`)
    .all(id)
    .map(mapActionItem);

  return { ...retro, columns: columnsWithItems, actions, team: retro.teamId ? getTeam(retro.teamId) : null };
}


export function createRetrospectiveWithColumns(
  data: CreateRetroInput,
  columns: CreateColumnInput[]
): Retrospective {
  const db = getDb();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  return transaction(() => {
    db.prepare(
      `INSERT INTO "Retrospective"
        ("id","title","status","tags","creator","createdAt","isAnonymous","blindInput","expiresAt",
         "inputDuration","votingDuration","reviewDuration","phaseStartTime","teamId")
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id,
      data.title,
      "INPUT",
      data.tags,
      data.creator,
      createdAt,
      data.isAnonymous ? 1 : 0,
      data.blindInput ? 1 : 0,
      data.expiresAt ? dateToDb(data.expiresAt) : null,
      data.inputDuration,
      data.votingDuration,
      data.reviewDuration,
      dateToDb(data.phaseStartTime),
      data.teamId
    );
    const colStmt = db.prepare(
      `INSERT INTO "Column" ("id","title","type","order","retrospectiveId") VALUES (?,?,?,?,?)`
    );
    for (const [index, c] of columns.entries()) {
      colStmt.run(randomUUID(), c.title, c.type, index, id);
    }
    // A board opens in INPUT without a status change, so log that entry here
    // or INPUT never appears in the phase durations.
    db.prepare(`INSERT INTO "PhaseEvent" ("id","retrospectiveId","phase","enteredAt") VALUES (?,?,'INPUT',?)`)
      .run(randomUUID(), id, dateToDb(data.phaseStartTime));
    return mapRetro(db.prepare(`SELECT * FROM "Retrospective" WHERE "id" = ?`).get(id) as Row);
  });
}

/** Update status (and reset phaseStartTime). Returns full nested retro. */
export function updateRetroStatus(id: string, status: string, phaseStartTime: Date): RetroFull | null {
  const db = getDb();
  db.prepare(`UPDATE "Retrospective" SET "status" = ?, "phaseStartTime" = ? WHERE "id" = ?`)
    .run(status, dateToDb(phaseStartTime), id);
  // Log the transition: phaseStartTime is overwritten each time, so this is the
  // only record of how long a board actually spent in each phase.
  db.prepare(`INSERT INTO "PhaseEvent" ("id","retrospectiveId","phase","enteredAt") VALUES (?,?,?,?)`)
    .run(randomUUID(), id, status, dateToDb(phaseStartTime));
  return getRetroFull(id);
}

/** Update timer durations. Returns full nested retro. */
export function updateRetroDurations(
  id: string,
  durations: { inputDuration?: number; votingDuration?: number; reviewDuration?: number }
): RetroFull | null {
  const sets: string[] = [];
  const params: any[] = [];
  if (durations.inputDuration !== undefined) {
    sets.push(`"inputDuration" = ?`);
    params.push(durations.inputDuration);
  }
  if (durations.votingDuration !== undefined) {
    sets.push(`"votingDuration" = ?`);
    params.push(durations.votingDuration);
  }
  if (durations.reviewDuration !== undefined) {
    sets.push(`"reviewDuration" = ?`);
    params.push(durations.reviewDuration);
  }
  if (sets.length > 0) {
    params.push(id);
    getDb().prepare(`UPDATE "Retrospective" SET ${sets.join(", ")} WHERE "id" = ?`).run(...params);
  }
  return getRetroFull(id);
}

export function listRetrospectives(filter: RetroFilter, take?: number, skip?: number): (Retrospective & { team: Team | null })[] {
  const { clauses, params, needsTeamJoin } = buildRetroWhere(filter, "r", "t");
  const join = needsTeamJoin ? `JOIN "Team" t ON t."id" = r."teamId"` : "";
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = take != null ? ` LIMIT ${Number(take)}` : "";
  // `id` breaks ties in the ORDER BY: boards created in the same millisecond
  // would otherwise order arbitrarily and could land on two pages, or neither.
  const offset = skip ? ` OFFSET ${Number(skip)}` : "";
  const sql = `SELECT r.* FROM "Retrospective" r ${join} ${where} ORDER BY r."createdAt" DESC, r."id"${limit}${offset}`;
  const rows = getDb().prepare(sql).all(...params);
  const teamCache = new Map<string, Team | null>();
  return rows.map((row) => {
    const retro = mapRetro(row);
    if (!retro.teamId) return { ...retro, team: null };
    if (!teamCache.has(retro.teamId)) teamCache.set(retro.teamId, getTeam(retro.teamId));
    return { ...retro, team: teamCache.get(retro.teamId) ?? null };
  });
}

export function countRetrospectives(filter: RetroFilter): number {
  const { clauses, params, needsTeamJoin } = buildRetroWhere(filter, "r", "t");
  const join = needsTeamJoin ? `JOIN "Team" t ON t."id" = r."teamId"` : "";
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM "Retrospective" r ${join} ${where}`)
    .get(...params) as Row;
  return row.c;
}

/** Raw `tags` strings of every retrospective (used to derive unique/popular tags). */
export function getAllTagStrings(): string[] {
  return getDb()
    .prepare(`SELECT "tags" FROM "Retrospective"`)
    .all()
    .map((r: Row) => r.tags as string);
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export function itemMaxOrder(columnId: string): number | null {
  const row = getDb()
    .prepare(`SELECT MAX("order") AS maxOrder FROM "Item" WHERE "columnId" = ?`)
    .get(columnId) as Row;
  return row.maxOrder ?? null;
}

export function createItem(data: {
  content: string;
  columnId: string;
  userId: string;
  username: string;
  order: number;
}): Item {
  const db = getDb();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO "Item" ("id","content","summary","userId","username","columnId","order","createdAt")
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(id, data.content, null, data.userId, data.username, data.columnId, data.order, createdAt);
  return mapItem(db.prepare(`SELECT * FROM "Item" WHERE "id" = ?`).get(id) as Row);
}

export function getItem(id: string): Item | null {
  const r = getDb().prepare(`SELECT * FROM "Item" WHERE "id" = ?`).get(id) as Row | undefined;
  return r ? mapItem(r) : null;
}

export function listItemsInColumn(columnId: string): Item[] {
  return getDb()
    .prepare(`SELECT * FROM "Item" WHERE "columnId" = ? ORDER BY "order" ASC`)
    .all(columnId)
    .map(mapItem);
}

export function updateItemContent(id: string, content: string): void {
  getDb().prepare(`UPDATE "Item" SET "content" = ? WHERE "id" = ?`).run(content, id);
}

export function updateItemSummary(id: string, summary: string): void {
  getDb().prepare(`UPDATE "Item" SET "summary" = ? WHERE "id" = ?`).run(summary, id);
}

export function updateItemColumn(id: string, columnId: string): void {
  getDb().prepare(`UPDATE "Item" SET "columnId" = ? WHERE "id" = ?`).run(columnId, id);
}

export function updateItemOrder(id: string, order: number): void {
  getDb().prepare(`UPDATE "Item" SET "order" = ? WHERE "id" = ?`).run(order, id);
}

/** Set the order of items to match the given id sequence, atomically. */
export function reorderItems(orderedIds: string[]): void {
  if (orderedIds.length === 0) return;
  transaction(() => {
    orderedIds.forEach((id, index) => updateItemOrder(id, index));
  });
}

export function countItems(): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS c FROM "Item"`).get() as Row;
  return row.c;
}

// ---------------------------------------------------------------------------
// Votes
// ---------------------------------------------------------------------------

export function findVote(itemId: string, userId: string): Vote | null {
  const r = getDb()
    .prepare(`SELECT * FROM "Vote" WHERE "itemId" = ? AND "userId" = ? LIMIT 1`)
    .get(itemId, userId) as Row | undefined;
  return r ? mapVote(r) : null;
}

export function createVote(data: { itemId: string; userId: string; count: number }): Vote {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`INSERT INTO "Vote" ("id","itemId","userId","count") VALUES (?,?,?,?)`).run(
    id, data.itemId, data.userId, data.count
  );
  return mapVote(db.prepare(`SELECT * FROM "Vote" WHERE "id" = ?`).get(id) as Row);
}

export function updateVoteCount(id: string, count: number): void {
  getDb().prepare(`UPDATE "Vote" SET "count" = ? WHERE "id" = ?`).run(count, id);
}

export function deleteVote(id: string): void {
  getDb().prepare(`DELETE FROM "Vote" WHERE "id" = ?`).run(id);
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

export function findReaction(itemId: string, userId: string, emoji: string): Reaction | null {
  const r = getDb()
    .prepare(`SELECT * FROM "Reaction" WHERE "itemId" = ? AND "userId" = ? AND "emoji" = ? LIMIT 1`)
    .get(itemId, userId, emoji) as Row | undefined;
  return r ? mapReaction(r) : null;
}

export function createReaction(data: { itemId: string; userId: string; emoji: string }): Reaction {
  const db = getDb();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(`INSERT INTO "Reaction" ("id","emoji","userId","itemId","createdAt") VALUES (?,?,?,?,?)`).run(
    id, data.emoji, data.userId, data.itemId, createdAt
  );
  return mapReaction(db.prepare(`SELECT * FROM "Reaction" WHERE "id" = ?`).get(id) as Row);
}

export function deleteReaction(id: string): void {
  getDb().prepare(`DELETE FROM "Reaction" WHERE "id" = ?`).run(id);
}

// ---------------------------------------------------------------------------
// Action items
// ---------------------------------------------------------------------------

export function createActionItem(data: {
  content: string;
  retrospectiveId: string;
  assignee?: string | null;
  dueDate?: Date | null;
}): ActionItem {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO "ActionItem" ("id","content","completed","retrospectiveId","assignee","dueDate","createdAt") VALUES (?,?,?,?,?,?,?)`
  ).run(
    id,
    data.content,
    0,
    data.retrospectiveId,
    data.assignee ?? null,
    dateToDb(data.dueDate ?? null),
    dateToDb(new Date())
  );
  return mapActionItem(db.prepare(`SELECT * FROM "ActionItem" WHERE "id" = ?`).get(id) as Row);
}

export function setActionExternalLink(
  id: string,
  link: { externalUrl: string; externalKey: string }
): void {
  getDb()
    .prepare(`UPDATE "ActionItem" SET "externalUrl" = ?, "externalKey" = ? WHERE "id" = ?`)
    .run(link.externalUrl, link.externalKey, id);
}

export function getActionItem(id: string): ActionItem | null {
  const r = getDb().prepare(`SELECT * FROM "ActionItem" WHERE "id" = ?`).get(id) as Row | undefined;
  return r ? mapActionItem(r) : null;
}

export function updateActionCompleted(id: string, completed: boolean): void {
  // Record when it closed, and clear it again if the action is reopened.
  getDb()
    .prepare(`UPDATE "ActionItem" SET "completed" = ?, "completedAt" = ? WHERE "id" = ?`)
    .run(completed ? 1 : 0, completed ? dateToDb(new Date()) : null, id);
}


/**
 * Where-clause for action queries. Shared by the list and the count so a page's
 * "N results" can never describe a different set than the rows shown.
 */
function buildActionWhere(filter: ActionFilter): { clauses: string[]; params: any[]; needsTeamJoin: boolean } {
  const clauses: string[] = [];
  const params: any[] = [];
  let needsTeamJoin = false;

  if (filter.completed !== undefined) {
    clauses.push(`a."completed" = ?`);
    params.push(filter.completed ? 1 : 0);
  }
  if (filter.retrospectiveId) {
    clauses.push(`a."retrospectiveId" = ?`);
    params.push(filter.retrospectiveId);
  }
  if (filter.creatorContains) {
    clauses.push(`r."creator" LIKE ?`);
    params.push(`%${filter.creatorContains}%`);
  }
  if (filter.assigneeContains) {
    clauses.push(`a."assignee" LIKE ?`);
    params.push(`%${filter.assigneeContains}%`);
  }
  if (filter.teamNameContains) {
    needsTeamJoin = true;
    clauses.push(`t."name" LIKE ?`);
    params.push(`%${filter.teamNameContains}%`);
  }
  if (filter.teamId) {
    clauses.push(`r."teamId" = ?`);
    params.push(filter.teamId);
  }
  if (filter.excludeRetrospectiveId) {
    clauses.push(`a."retrospectiveId" <> ?`);
    params.push(filter.excludeRetrospectiveId);
  }
  return { clauses, params, needsTeamJoin };
}

export function countActionItems(filter: ActionFilter): number {
  const { clauses, params, needsTeamJoin } = buildActionWhere(filter);
  const teamJoin = needsTeamJoin ? `JOIN "Team" t ON t."id" = r."teamId"` : "";
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM "ActionItem" a
              JOIN "Retrospective" r ON r."id" = a."retrospectiveId" ${teamJoin} ${where}`)
    .get(...params) as Row;
  return Number(row?.n ?? 0);
}

export function listActionItems(filter: ActionFilter): ActionItemWithRetro[] {
  const { clauses, params, needsTeamJoin } = buildActionWhere(filter);
  const teamJoin = needsTeamJoin ? `JOIN "Team" t ON t."id" = r."teamId"` : "";
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = filter.take != null ? ` LIMIT ${Number(filter.take)}` : "";
  const offset = filter.skip ? ` OFFSET ${Number(filter.skip)}` : "";
  const sql = `
    SELECT a.* FROM "ActionItem" a
    JOIN "Retrospective" r ON r."id" = a."retrospectiveId"
    ${teamJoin}
    ${where}
    ORDER BY r."createdAt" DESC, a."id"${limit}${offset}`;
  const rows = getDb().prepare(sql).all(...params);

  const retroCache = new Map<string, (Retrospective & { team: Team | null }) | null>();
  return rows.map((row) => {
    const action = mapActionItem(row);
    if (!retroCache.has(action.retrospectiveId)) {
      const retro = getRetro(action.retrospectiveId);
      retroCache.set(
        action.retrospectiveId,
        retro ? { ...retro, team: retro.teamId ? getTeam(retro.teamId) : null } : null
      );
    }
    return { ...action, retrospective: retroCache.get(action.retrospectiveId)! };
  });
}

export function countOpenActions(retroFilter: RetroFilter): number {
  const { clauses, params, needsTeamJoin } = buildRetroWhere(retroFilter, "r", "t");
  const teamJoin = needsTeamJoin ? `JOIN "Team" t ON t."id" = r."teamId"` : "";
  const allClauses = [`a."completed" = 0`, ...clauses];
  const sql = `
    SELECT COUNT(*) AS c FROM "ActionItem" a
    JOIN "Retrospective" r ON r."id" = a."retrospectiveId"
    ${teamJoin}
    WHERE ${allClauses.join(" AND ")}`;
  const row = getDb().prepare(sql).get(...params) as Row;
  return row.c;
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

/** Delete all data (respecting FK order). Used by the clean-db script. */
/**
 * Delete a board and everything belonging to it. The foreign keys are
 * ON DELETE RESTRICT, so children go first, deepest first.
 */
export function deleteRetro(id: string): void {
  const db = getDb();
  transaction(() => {
    const cols = `SELECT "id" FROM "Column" WHERE "retrospectiveId" = ?`;
    const items = `SELECT "id" FROM "Item" WHERE "columnId" IN (${cols})`;
    db.prepare(`DELETE FROM "Reaction" WHERE "itemId" IN (${items})`).run(id);
    db.prepare(`DELETE FROM "Vote" WHERE "itemId" IN (${items})`).run(id);
    db.prepare(`DELETE FROM "Item" WHERE "columnId" IN (${cols})`).run(id);
    db.prepare(`DELETE FROM "Column" WHERE "retrospectiveId" = ?`).run(id);
    db.prepare(`DELETE FROM "ActionItem" WHERE "retrospectiveId" = ?`).run(id);
    db.prepare(`DELETE FROM "PhaseEvent" WHERE "retrospectiveId" = ?`).run(id);
    db.prepare(`DELETE FROM "Retrospective" WHERE "id" = ?`).run(id);
  });
}

export function listExpiredRetroIds(now: Date): string[] {
  return (
    getDb()
      .prepare(`SELECT "id" FROM "Retrospective" WHERE "expiresAt" IS NOT NULL AND "expiresAt" <= ?`)
      .all(dateToDb(now)) as Row[]
  ).map((r) => r.id as string);
}

/**
 * Read-only aggregates for one team. Mirrors the Postgres implementation; the
 * row-shaping is shared so the two cannot drift.
 */
export function teamAnalytics(teamId: string): TeamAnalyticsRaw {
  const db = getDb();
  const retros = db
    .prepare(`SELECT "id", "createdAt", "isAnonymous" FROM "Retrospective" WHERE "teamId" = ? ORDER BY "createdAt"`)
    .all(teamId) as Row[];

  const empty: TeamAnalyticsRaw = {
    retroDates: retros.map((r) => toDate(r.createdAt)),
    itemsByColumnType: [],
    actions: { open: 0, done: 0, overdue: 0, daysToClose: [] },
    engagement: { totalItems: 0, itemsWithSummary: 0, retrosWithItems: 0, voteSpread: [], contributorsPerRetro: [] },
    phaseDurations: [],
  };
  if (retros.length === 0) return empty;

  // node:sqlite has no array binding, so the id list is expanded into
  // placeholders. The ids are UUIDs we just read back, never user input.
  const ids = retros.map((r) => r.id as string);
  const holes = ids.map(() => "?").join(",");

  const itemsByColumnType = (
    db
      .prepare(
        `SELECT c."type" AS type, COUNT(i."id") AS items
           FROM "Column" c JOIN "Item" i ON i."columnId" = c."id"
          WHERE c."retrospectiveId" IN (${holes})
          GROUP BY c."type"`
      )
      .all(...ids) as Row[]
  ).map((r) => ({ type: r.type as string, items: Number(r.items) }));

  const actionRows = db
    .prepare(`SELECT "completed", "dueDate", "createdAt", "completedAt" FROM "ActionItem" WHERE "retrospectiveId" IN (${holes})`)
    .all(...ids) as Row[];
  const now = Date.now();
  const actions = { open: 0, done: 0, overdue: 0, daysToClose: [] as number[] };
  for (const a of actionRows) {
    if (toBool(a.completed)) {
      actions.done += 1;
      const created = toDateOrNull(a.createdAt);
      const closed = toDateOrNull(a.completedAt);
      if (created && closed) actions.daysToClose.push((closed.getTime() - created.getTime()) / 86_400_000);
    } else {
      actions.open += 1;
      const due = toDateOrNull(a.dueDate);
      if (due && due.getTime() < now) actions.overdue += 1;
    }
  }

  const itemRows = db
    .prepare(
      `SELECT c."retrospectiveId" AS retro, i."userId" AS userId,
              (i."summary" IS NOT NULL AND i."summary" <> '') AS summarised
         FROM "Column" c JOIN "Item" i ON i."columnId" = c."id"
        WHERE c."retrospectiveId" IN (${holes})`
    )
    .all(...ids) as Row[];
  const voteRows = db
    .prepare(
      `SELECT c."retrospectiveId" AS retro, v."itemId" AS item, SUM(v."count") AS votes
         FROM "Column" c JOIN "Item" i ON i."columnId" = c."id" JOIN "Vote" v ON v."itemId" = i."id"
        WHERE c."retrospectiveId" IN (${holes})
        GROUP BY c."retrospectiveId", v."itemId"`
    )
    .all(...ids) as Row[];
  const phaseRows = db
    .prepare(
      `SELECT "retrospectiveId" AS retro, "phase", "enteredAt"
         FROM "PhaseEvent" WHERE "retrospectiveId" IN (${holes}) ORDER BY "retrospectiveId", "enteredAt"`
    )
    .all(...ids) as Row[];

  return {
    ...empty,
    itemsByColumnType,
    actions,
    engagement: engagementFromRows(
      retros.map((r) => ({ id: r.id, isAnonymous: toBool(r.isAnonymous) })),
      itemRows,
      voteRows
    ),
    phaseDurations: phaseDurationsFromRows(phaseRows),
  };
}

export function clearDatabase(): void {
  transaction(() => {
    const db = getDb();
    for (const table of ["Reaction", "Vote", "Item", "Column", "ActionItem", "Retrospective", "Team"]) {
      db.prepare(`DELETE FROM "${table}"`).run();
    }
  });
}
