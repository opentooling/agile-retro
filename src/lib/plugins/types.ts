/**
 * Plugin architecture for the retro app.
 *
 * A plugin extends what the app can do with an action item — for example,
 * pushing it to an external tracker. Plugins are server-side only (they may use
 * secrets such as API tokens and make outbound network calls), and are
 * registered in ./registry.ts.
 *
 * The first plugin is Jira (./jira.ts): "create this action as a Jira task".
 * New integrations (GitHub Issues, Linear, Trello, …) only need to implement
 * this interface and register themselves — no changes to call sites.
 */
import type { ActionItem, Retrospective, Team } from "../db/types";

/** The context a plugin receives when asked to externalise an action. */
export type ActionPluginContext = {
  action: ActionItem;
  retro: Retrospective;
  team: Team;
};

/** What a plugin returns after creating an external task. */
export type ExternalTaskResult = {
  /** A stable, human-meaningful key (e.g. a Jira issue key like "PROJ-123"). */
  key: string;
  /** A browser URL pointing at the created task. */
  url: string;
};

export interface RetroPlugin {
  /** Stable identifier, e.g. "jira". */
  id: string;
  /** Human-readable name shown in the UI, e.g. "Jira". */
  name: string;
  /**
   * Whether this plugin is configured for the given team (e.g. the team has
   * Jira credentials + a project key). Used to decide whether to surface the
   * plugin's action in the UI.
   */
  isConfiguredForTeam(team: Team): boolean;
  /**
   * Create an external task for the given action. Throws an Error with a
   * user-presentable message on failure.
   */
  createTaskForAction(ctx: ActionPluginContext): Promise<ExternalTaskResult>;

  /**
   * Read the "done" state of external tasks by key. Returns a map of key ->
   * boolean (true when the external task is in a completed/done state). Keys the
   * plugin cannot resolve are omitted from the map. Optional: plugins that don't
   * support status sync can leave this unimplemented.
   */
  getIssueDoneState?(team: Team, keys: string[]): Promise<Map<string, boolean>>;

  /**
   * Move an external task into (done=true) or out of (done=false) its done
   * state. Best-effort and idempotent: a no-op when the task is already in the
   * requested state. Optional.
   */
  setIssueDone?(team: Team, key: string, done: boolean): Promise<void>;
}
