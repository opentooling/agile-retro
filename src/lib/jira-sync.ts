/**
 * Two-way "done" synchronization between retro action items and their linked
 * external tasks (currently Jira).
 *
 * Directions:
 *   - App -> external ("push"): when an action's completed state is toggled,
 *     `pushActionDoneState` transitions the linked issue to Done (or reopens it).
 *     This runs immediately on toggle.
 *   - External -> app ("reconcile / pull"): when a board or the actions page is
 *     opened, `reconcileActionsForRetro` / `reconcileActions` read the linked
 *     issues' status and update the app's `completed` flag to match. This is a
 *     poll-on-open, not a background job.
 *
 * Polling is bounded in two ways, because this runs on a page render and makes
 * outbound network calls. Callers pass only the actions they are about to
 * display, and each team is polled at most once per RECONCILE_INTERVAL_MS
 * across renders — otherwise every refresh of a busy actions page fires a
 * fresh round of Jira requests.
 *
 * The sync covers reopen in both directions: an issue moved out of Done in Jira
 * un-completes the action, and un-completing an action reopens the issue.
 *
 * This module is server-only (it uses team secrets and makes outbound calls).
 */
// Relative imports (not the "@/" alias): this module is loaded both by the
// Next.js app and by the tsx-run Socket.IO server, and the latter does not go
// through Next's path-alias resolution.
import * as db from "./db";
import type { ActionItemWithRetro, Team } from "./db/types";
import { getPlugin } from "./plugins/registry";

const PLUGIN_ID = "jira";

/**
 * Minimum gap between polls of the same team. In-process and best-effort: a
 * restart or a second replica simply polls again, which is harmless.
 */
const RECONCILE_INTERVAL_MS = Number(process.env.JIRA_RECONCILE_INTERVAL_MS ?? 60_000);
const lastPolled = new Map<string, number>();

/**
 * Reconcile the app's completed flags with the linked external tasks' done
 * state. External state wins here (this is the pull direction). Best-effort:
 * failures for a given team/issue are logged and skipped, never thrown.
 */
async function reconcile(actions: ActionItemWithRetro[]): Promise<void> {
  const plugin = getPlugin(PLUGIN_ID);
  if (!plugin?.getIssueDoneState) return;

  // Group linked actions by team so we can read statuses per team's credentials.
  const byTeam = new Map<string, { team: Team; actions: ActionItemWithRetro[] }>();
  for (const action of actions) {
    if (!action.externalKey) continue;
    const team = action.retrospective.team;
    if (!team || !plugin.isConfiguredForTeam(team)) continue;
    const bucket = byTeam.get(team.id) ?? { team, actions: [] };
    bucket.actions.push(action);
    byTeam.set(team.id, bucket);
  }

  for (const { team, actions: teamActions } of byTeam.values()) {
    const since = Date.now() - (lastPolled.get(team.id) ?? 0);
    if (since < RECONCILE_INTERVAL_MS) continue;
    lastPolled.set(team.id, Date.now());

    const keys = teamActions.map((a) => a.externalKey!).filter(Boolean);
    let doneByKey: Map<string, boolean>;
    try {
      doneByKey = await plugin.getIssueDoneState(team, keys);
    } catch (err) {
      console.error(`Jira reconcile failed for team ${team.name}:`, err);
      continue;
    }

    for (const action of teamActions) {
      const done = doneByKey.get(action.externalKey!);
      if (done === undefined) continue; // Unknown — don't touch.
      if (done !== action.completed) {
        try {
          await db.updateActionCompleted(action.id, done);
        } catch (err) {
          console.error(`Failed to reconcile action ${action.id}:`, err);
        }
      }
    }
  }
}

/** Reconcile linked actions for a single retrospective (called on board open). */
export async function reconcileActionsForRetro(retrospectiveId: string): Promise<void> {
  try {
    const actions = await db.listActionItems({ retrospectiveId });
    await reconcile(actions);
  } catch (err) {
    console.error("reconcileActionsForRetro failed:", err);
  }
}

/** Reconcile all linked actions (called on the actions page). */
/**
 * Reconcile a specific set of actions — the ones a page is about to show.
 *
 * Replaces a previous `reconcileAllLinkedActions`, which read *every* action
 * ever created and then asked Jira about all of them on each render of the
 * actions page. That was unbounded outbound work proportional to the whole
 * history, and it ignored the page's own filters.
 */
export async function reconcileActions(actions: ActionItemWithRetro[]): Promise<void> {
  try {
    await reconcile(actions);
  } catch (err) {
    console.error("reconcileActions failed:", err);
  }
}

/**
 * Push an action's completed state to its linked external task (the app -> Jira
 * direction). Best-effort: never throws, so it can't break the toggle itself.
 */
export async function pushActionDoneState(actionId: string, completed: boolean): Promise<void> {
  try {
    const plugin = getPlugin(PLUGIN_ID);
    if (!plugin?.setIssueDone) return;

    const action = await db.getActionItem(actionId);
    if (!action?.externalKey) return;

    const retro = await db.getRetro(action.retrospectiveId);
    if (!retro?.teamId) return;

    const team = await db.getTeam(retro.teamId);
    if (!team || !plugin.isConfiguredForTeam(team)) return;

    await plugin.setIssueDone(team, action.externalKey, completed);
  } catch (err) {
    console.error(`Failed to push done state for action ${actionId}:`, err);
  }
}
