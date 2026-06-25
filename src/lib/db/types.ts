/**
 * Shared types for the data-access layer.
 *
 * Two interchangeable backends implement `DbApi`:
 *   - ./sqlite.ts  (node:sqlite, synchronous) — file-based, zero dependencies
 *   - ./postgres.ts (pg, asynchronous)        — external Postgres
 *
 * The dispatcher in ../db.ts selects one at runtime from DATABASE_URL. Because
 * the SQLite backend is synchronous and the Postgres one is async, every DbApi
 * method returns `MaybePromise<T>`; callers always `await`, which handles both.
 */

export type MaybePromise<T> = T | Promise<T>;

export type Team = { id: string; name: string; createdAt: Date };

export type Retrospective = {
  id: string;
  title: string;
  status: string;
  tags: string;
  creator: string;
  createdAt: Date;
  isAnonymous: boolean;
  inputDuration: number | null;
  votingDuration: number | null;
  reviewDuration: number | null;
  phaseStartTime: Date | null;
  teamId: string;
};

export type Column = { id: string; title: string; type: string; retrospectiveId: string };
export type Vote = { id: string; itemId: string; userId: string; count: number };
export type Reaction = { id: string; emoji: string; userId: string; itemId: string; createdAt: Date };
export type Item = {
  id: string;
  content: string;
  summary: string | null;
  userId: string;
  username: string;
  columnId: string;
  order: number;
  createdAt: Date;
  votes: Vote[];
  reactions: Reaction[];
};
export type ActionItem = { id: string; content: string; completed: boolean; retrospectiveId: string };

export type ColumnWithItems = Column & { items: Item[] };
export type RetroFull = Retrospective & {
  columns: ColumnWithItems[];
  actions: ActionItem[];
  team: Team | null;
};

export type RetroFilter = {
  creatorContains?: string;
  creatorEquals?: string;
  tagsContains?: string;
  teamNameContains?: string;
  statusNot?: string;
};

export type ActionFilter = {
  completed?: boolean;
  teamNameContains?: string;
  creatorContains?: string;
  retrospectiveId?: string;
};

export type CreateColumnInput = { title: string; type: string };
export type CreateRetroInput = {
  title: string;
  tags: string;
  creator: string;
  teamId: string;
  inputDuration: number | null;
  votingDuration: number | null;
  reviewDuration: number | null;
  isAnonymous: boolean;
  phaseStartTime: Date;
};

export type ActionItemWithRetro = ActionItem & {
  retrospective: Retrospective & { team: Team | null };
};

export type RetroDurations = {
  inputDuration?: number;
  votingDuration?: number;
  reviewDuration?: number;
};

/**
 * The contract both backends implement. Methods return MaybePromise so the
 * synchronous SQLite backend and the asynchronous Postgres backend both satisfy
 * it; the dispatcher always awaits.
 */
export interface DbApi {
  // Teams
  listTeams(): MaybePromise<Team[]>;
  createTeam(name: string): MaybePromise<Team>;
  updateTeam(id: string, name: string): MaybePromise<Team>;
  getTeam(id: string): MaybePromise<Team | null>;

  // Retrospectives
  getRetro(id: string): MaybePromise<Retrospective | null>;
  getRetroStatus(id: string): MaybePromise<{ status: string } | null>;
  getRetroFull(id: string): MaybePromise<RetroFull | null>;
  createRetrospectiveWithColumns(
    data: CreateRetroInput,
    columns: CreateColumnInput[]
  ): MaybePromise<Retrospective>;
  updateRetroStatus(id: string, status: string, phaseStartTime: Date): MaybePromise<RetroFull | null>;
  updateRetroDurations(id: string, durations: RetroDurations): MaybePromise<RetroFull | null>;
  listRetrospectives(
    filter: RetroFilter,
    take?: number
  ): MaybePromise<(Retrospective & { team: Team | null })[]>;
  countRetrospectives(filter: RetroFilter): MaybePromise<number>;
  getAllTagStrings(): MaybePromise<string[]>;

  // Items
  itemMaxOrder(columnId: string): MaybePromise<number | null>;
  createItem(data: {
    content: string;
    columnId: string;
    userId: string;
    username: string;
    order: number;
  }): MaybePromise<Item>;
  getItem(id: string): MaybePromise<Item | null>;
  listItemsInColumn(columnId: string): MaybePromise<Item[]>;
  updateItemSummary(id: string, summary: string): MaybePromise<void>;
  updateItemColumn(id: string, columnId: string): MaybePromise<void>;
  reorderItems(orderedIds: string[]): MaybePromise<void>;
  countItems(): MaybePromise<number>;

  // Votes
  findVote(itemId: string, userId: string): MaybePromise<Vote | null>;
  createVote(data: { itemId: string; userId: string; count: number }): MaybePromise<Vote>;
  updateVoteCount(id: string, count: number): MaybePromise<void>;
  deleteVote(id: string): MaybePromise<void>;

  // Reactions
  findReaction(itemId: string, userId: string, emoji: string): MaybePromise<Reaction | null>;
  createReaction(data: { itemId: string; userId: string; emoji: string }): MaybePromise<Reaction>;
  deleteReaction(id: string): MaybePromise<void>;

  // Action items
  createActionItem(data: { content: string; retrospectiveId: string }): MaybePromise<ActionItem>;
  getActionItem(id: string): MaybePromise<ActionItem | null>;
  updateActionCompleted(id: string, completed: boolean): MaybePromise<void>;
  listActionItems(filter: ActionFilter): MaybePromise<ActionItemWithRetro[]>;
  countOpenActions(retroFilter: RetroFilter): MaybePromise<number>;

  // Maintenance
  clearDatabase(): MaybePromise<void>;
}
