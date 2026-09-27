import type { BoardScope } from "../authz";
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

export type Team = {
  id: string;
  name: string;
  createdAt: Date;
  // Identity (email/name) of the user who created the team. Treated as a
  // team-admin so the creator can always manage the team's boards.
  createdBy: string | null;
  // Access control: identity-provider group identifiers (e.g. AD/Keycloak group
  // paths or names) that grant membership / team-admin on this team's boards.
  // Configured in Team settings. Empty means the team is access-restricted to
  // global admins only (fail closed).
  memberGroups: string[];
  adminGroups: string[];
  // Optional team logo, stored inline as a data URI (small images only).
  imageData: string | null;
  // Jira integration, configured per team in Team settings. `jiraApiToken` is a
  // secret and must be stripped before a Team is sent to the client.
  jiraBaseUrl: string | null;
  jiraProjectKey: string | null;
  jiraEmail: string | null;
  jiraApiToken: string | null;
};

export type TeamJiraConfig = {
  jiraBaseUrl: string | null;
  jiraProjectKey: string | null;
  jiraEmail: string | null;
  jiraApiToken: string | null;
};

export type TeamGroups = {
  memberGroups: string[];
  adminGroups: string[];
};

export type TeamCreateOptions = {
  createdBy?: string | null;
  memberGroups?: string[];
  adminGroups?: string[];
};

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
  teamId: string | null;
  // "Blind input": during the INPUT phase each participant sees only their own
  // items. Prevents the first few cards anchoring everyone else's thinking.
  // Enforced server-side — the hidden items never reach the other clients.
  blindInput: boolean;
  // Optional retention: the board and everything in it is deleted once this
  // passes. Null means keep indefinitely (the default).
  expiresAt: Date | null;
};

export type Column = {
  id: string;
  title: string;
  type: string;
  retrospectiveId: string;
  // Position within the board, from the template's column order. Needed because
  // formats other than the classic three have no inherent ordering to infer.
  order: number;
};
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
  /**
   * The facilitator's position for this card in the review queue, when they
   * have arranged it. Null everywhere means the queue is ranked by votes.
   */
  reviewOrder: number | null;
  createdAt: Date;
  votes: Vote[];
  reactions: Reaction[];
};
export type ActionItem = {
  id: string;
  content: string;
  completed: boolean;
  // When the action was agreed, and when it was ticked off. Without these the
  // only answerable question is "how many are open right now" — never whether
  // a team's follow-through is improving, or how long actions take to close.
  createdAt: Date | null;
  completedAt: Date | null;
  retrospectiveId: string;
  assignee: string | null;
  dueDate: Date | null;
  // Link to an external task created by a plugin (e.g. a Jira issue).
  externalUrl: string | null;
  externalKey: string | null;
};

/**
 * A board entering a phase. `Retrospective.phaseStartTime` only holds the
 * *current* phase's start — each transition overwrites it — so without this
 * the time a board actually spent in each phase is unrecoverable.
 */
export type PhaseEvent = {
  id: string;
  retrospectiveId: string;
  phase: string;
  enteredAt: Date;
};

export type ColumnWithItems = Column & {
  items: Item[];
  // Set only on a client payload under blind input: how many of this column's
  // items were withheld from this viewer. Never persisted.
  hiddenItemCount?: number;
};
export type RetroFull = Retrospective & {
  columns: ColumnWithItems[];
  actions: ActionItem[];
  team: Team | null;
};

export type FilterFacets = {
  creators: string[];
  teamNames: string[];
  tags: string[];
};

export type RetroFilter = {
  /** Restrict to boards the viewer may see (see boardScopeFor in authz). */
  scope?: BoardScope;
  creatorContains?: string;
  creatorEquals?: string;
  tagsContains?: string;
  teamNameContains?: string;
  statusNot?: string;
};

export type ActionFilter = {
  /**
   * Which boards' actions may be returned. Required, not optional: an action
   * listing that forgets it returns every team's actions to whoever asked —
   * which is exactly what the Actions page used to do. System callers that
   * are already gated some other way pass `{ kind: "all" }` and say why.
   */
  scope: BoardScope;
  completed?: boolean;
  teamNameContains?: string;
  creatorContains?: string;
  assigneeContains?: string;
  /**
   * Exact assignee match, case-insensitive, against any of these names. For
   * "assigned to me": the substring filter would count "Diana"'s actions as
   * "ana"'s.
   */
  assigneeIn?: string[];
  retrospectiveId?: string;
  /** Exact team match — used to carry a team's open actions into its next retro. */
  teamId?: string;
  /** Exclude one retro, so a board doesn't list its own actions as carried over. */
  excludeRetrospectiveId?: string;
  /** Page window. Callers that render a list must set these — the tables grow without bound. */
  take?: number;
  skip?: number;
};

export type CreateColumnInput = { title: string; type: string };
export type CreateRetroInput = {
  title: string;
  tags: string;
  creator: string;
  teamId: string | null;
  inputDuration: number | null;
  votingDuration: number | null;
  reviewDuration: number | null;
  isAnonymous: boolean;
  blindInput: boolean;
  expiresAt: Date | null;
  phaseStartTime: Date;
};

export type ActionItemWithRetro = ActionItem & {
  retrospective: Retrospective & { team: Team | null };
};

/**
 * Raw aggregates for a team, straight from the database. Shaping into
 * percentages and medians happens in lib/analytics.ts so it is testable
 * without a database and identical across both backends.
 */
export type TeamAnalyticsRaw = {
  retroDates: Date[];
  itemsByColumnType: { type: string; items: number }[];
  actions: {
    open: number;
    done: number;
    overdue: number;
    /** Days between creation and completion, for actions that have both. */
    daysToClose: number[];
  };
  engagement: {
    totalItems: number;
    itemsWithSummary: number;
    retrosWithItems: number;
    /** Total votes per board, and the votes on that board's top three items. */
    voteSpread: { total: number; topThree: number }[];
    /** Distinct contributors per board, non-anonymous boards only. */
    contributorsPerRetro: number[];
  };
  /** Seconds spent in each phase, per board, from the phase log. */
  phaseDurations: { phase: string; seconds: number }[];
  /** One entry per board that had cards, oldest first — the trend lines. */
  perRetro: {
    at: Date;
    title: string;
    cards: number;
    /** Cards that got notes in Review. */
    discussed: number;
    /** Distinct contributors; null on anonymous boards, which are never counted. */
    contributors: number | null;
  }[];
  /** Each action, dated by the board that agreed it and by when it was closed. */
  actionTimeline: {
    agreedAt: Date;
    completed: boolean;
    /** Null while open, and for completions that predate the timestamp. */
    completedAt: Date | null;
  }[];
};

/** One person's own footprint across the boards, for their profile page. */
export type UserActivityRaw = {
  facilitated: { id: string; title: string; status: string; createdAt: Date; teamId: string | null }[];
  cards: {
    id: string;
    content: string;
    createdAt: Date;
    columnTitle: string;
    columnType: string;
    retroId: string;
    retroTitle: string;
    teamId: string | null;
    isAnonymous: boolean;
  }[];
  /** Stars given, summed per board. */
  votes: { retroId: string; teamId: string | null; count: number }[];
  /** Reactions given, counted per board. */
  reactions: { retroId: string; teamId: string | null; count: number }[];
};

export type RetroDurations = {
  inputDuration?: number;
  votingDuration?: number;
  reviewDuration?: number;
  /** Moved together with a duration when a snooze lands the deadline exactly. */
  phaseStartTime?: Date;
};

/**
 * The contract both backends implement. Methods return MaybePromise so the
 * synchronous SQLite backend and the asynchronous Postgres backend both satisfy
 * it; the dispatcher always awaits.
 */
export interface DbApi {
  // Teams
  listTeams(): MaybePromise<Team[]>;
  createTeam(name: string, opts?: TeamCreateOptions): MaybePromise<Team>;
  updateTeam(id: string, name: string): MaybePromise<Team>;
  updateTeamJira(id: string, config: TeamJiraConfig): MaybePromise<Team>;
  updateTeamGroups(id: string, groups: TeamGroups): MaybePromise<Team>;
  updateTeamImage(id: string, imageData: string | null): MaybePromise<Team>;
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
  /** Delete a board and everything belonging to it (items, votes, actions…). */
  deleteRetro(id: string): MaybePromise<void>;
  /** Ids of boards whose retention has elapsed as of `now`. */
  listExpiredRetroIds(now: Date): MaybePromise<string[]>;

  // Analytics
  /** Aggregates for one team's boards. Read-only; see lib/analytics.ts. */
  teamAnalytics(teamId: string): MaybePromise<TeamAnalyticsRaw>;
  listRetrospectives(
    filter: RetroFilter,
    take?: number,
    skip?: number
  ): MaybePromise<(Retrospective & { team: Team | null })[]>;
  countRetrospectives(filter: RetroFilter): MaybePromise<number>;
  getAllTagStrings(): MaybePromise<string[]>;
  /**
   * The values that actually occur in the boards a viewer may see, for the
   * filter's suggestions: facilitator names, team names and tags. Scoped like
   * every other listing, so a suggestion never names a team whose boards the
   * viewer cannot open — and never suggests a filter that returns nothing.
   */
  listFilterFacets(scope: BoardScope): MaybePromise<FilterFacets>;

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
  updateItemContent(id: string, content: string): MaybePromise<void>;
  updateItemSummary(id: string, summary: string): MaybePromise<void>;
  updateItemColumn(id: string, columnId: string): MaybePromise<void>;
  reorderItems(orderedIds: string[]): MaybePromise<void>;
  /** Arrange the review queue: positions follow the given id sequence. */
  setReviewOrder(orderedIds: string[]): MaybePromise<void>;
  /** Forget a board's arranged queue, returning it to the vote ranking. */
  clearReviewOrder(retroId: string): MaybePromise<void>;
  /** Delete a card with its votes and reactions, in one transaction. */
  deleteItem(id: string): MaybePromise<void>;
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
  createActionItem(data: {
    content: string;
    retrospectiveId: string;
    assignee?: string | null;
    dueDate?: Date | null;
  }): MaybePromise<ActionItem>;
  getActionItem(id: string): MaybePromise<ActionItem | null>;
  /** Rewrite an action's text, assignee and due date. */
  updateActionItem(id: string, data: { content: string; assignee: string | null; dueDate: Date | null }): MaybePromise<void>;
  deleteActionItem(id: string): MaybePromise<void>;
  updateActionCompleted(id: string, completed: boolean): MaybePromise<void>;
  setActionExternalLink(id: string, link: { externalUrl: string; externalKey: string }): MaybePromise<void>;
  listActionItems(filter: ActionFilter): MaybePromise<ActionItemWithRetro[]>;
  countActionItems(filter: ActionFilter): MaybePromise<number>;
  countOpenActions(retroFilter: RetroFilter): MaybePromise<number>;
  /**
   * Everything one person has done: boards they ran (matched on any of
   * `creatorNames`, since a board records its creator by name or id), and the
   * cards, stars and reactions attributed to `userId`.
   */
  userActivity(userId: string, creatorNames: string[]): MaybePromise<UserActivityRaw>;

  // Maintenance
  clearDatabase(): MaybePromise<void>;
}
