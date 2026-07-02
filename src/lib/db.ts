/**
 * Data-access dispatcher.
 *
 * Selects a backend at runtime from DATABASE_URL and exposes a single async API
 * (every call site already `await`s these functions):
 *
 *   - postgres:// or postgresql://  -> ./db/postgres  (pg, external Postgres)
 *   - anything else (e.g. file:...) -> ./db/sqlite    (node:sqlite, file-based)
 *
 * The chosen backend is imported dynamically and only on first use, so the
 * Postgres path never loads node:sqlite and the SQLite path never loads `pg`.
 */
import type { DbApi } from "./db/types";

// Re-export the shared types so callers can keep using `db.RetroFilter`, etc.
export * from "./db/types";

function isPostgresUrl(url: string): boolean {
  return /^postgres(ql)?:\/\//i.test(url);
}

/** Which backend the current DATABASE_URL selects. */
export function activeBackend(): "postgres" | "sqlite" {
  return isPostgresUrl(process.env.DATABASE_URL ?? "") ? "postgres" : "sqlite";
}

let backendPromise: Promise<DbApi> | undefined;
function load(): Promise<DbApi> {
  if (!backendPromise) {
    backendPromise =
      activeBackend() === "postgres" ? import("./db/postgres") : import("./db/sqlite");
  }
  return backendPromise;
}

type Asyncify<F> = F extends (...args: infer A) => infer R
  ? (...args: A) => Promise<Awaited<R>>
  : never;

function bind<K extends keyof DbApi>(name: K): Asyncify<DbApi[K]> {
  return ((...args: unknown[]) =>
    load().then((backend) =>
      (backend[name] as (...a: unknown[]) => unknown)(...args)
    )) as Asyncify<DbApi[K]>;
}

// Teams
export const listTeams = bind("listTeams");
export const createTeam = bind("createTeam");
export const updateTeam = bind("updateTeam");
export const updateTeamJira = bind("updateTeamJira");
export const updateTeamGroups = bind("updateTeamGroups");
export const getTeam = bind("getTeam");

// Retrospectives
export const getRetro = bind("getRetro");
export const getRetroStatus = bind("getRetroStatus");
export const getRetroFull = bind("getRetroFull");
export const createRetrospectiveWithColumns = bind("createRetrospectiveWithColumns");
export const updateRetroStatus = bind("updateRetroStatus");
export const updateRetroDurations = bind("updateRetroDurations");
export const listRetrospectives = bind("listRetrospectives");
export const countRetrospectives = bind("countRetrospectives");
export const getAllTagStrings = bind("getAllTagStrings");

// Items
export const itemMaxOrder = bind("itemMaxOrder");
export const createItem = bind("createItem");
export const getItem = bind("getItem");
export const listItemsInColumn = bind("listItemsInColumn");
export const updateItemContent = bind("updateItemContent");
export const updateItemSummary = bind("updateItemSummary");
export const updateItemColumn = bind("updateItemColumn");
export const reorderItems = bind("reorderItems");
export const countItems = bind("countItems");

// Votes
export const findVote = bind("findVote");
export const createVote = bind("createVote");
export const updateVoteCount = bind("updateVoteCount");
export const deleteVote = bind("deleteVote");

// Reactions
export const findReaction = bind("findReaction");
export const createReaction = bind("createReaction");
export const deleteReaction = bind("deleteReaction");

// Action items
export const createActionItem = bind("createActionItem");
export const getActionItem = bind("getActionItem");
export const updateActionCompleted = bind("updateActionCompleted");
export const setActionExternalLink = bind("setActionExternalLink");
export const listActionItems = bind("listActionItems");
export const countOpenActions = bind("countOpenActions");

// Maintenance
export const clearDatabase = bind("clearDatabase");
