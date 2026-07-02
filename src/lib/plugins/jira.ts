/**
 * Jira plugin — creates a Jira issue from a retro action item via the Jira
 * REST API v2 (Jira Server / Data Center).
 *
 * Auth is HTTP Basic with `email:apiToken`, configured per team in Team
 * settings, along with the base URL and a project key (e.g. "PROJ").
 *
 * The action's assignee (an email like `firstname.lastname@domain`) is resolved
 * to a Jira user and set as the real `assignee` field (`{ name: <username> }`
 * for Server/DC). If it can't be resolved, it's left in the description instead,
 * so issue creation never fails on assignee lookup. Due date and the source
 * retro are also recorded in the description.
 */
import type { Team } from "../db/types";
import type { ActionPluginContext, ExternalTaskResult, RetroPlugin } from "./types";

function trimBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Base URL + Basic auth header for a team's Jira credentials. */
function jiraAuth(team: Team): { baseUrl: string; authHeader: string } {
  return {
    baseUrl: trimBaseUrl(team.jiraBaseUrl!),
    authHeader: `Basic ${Buffer.from(`${team.jiraEmail}:${team.jiraApiToken}`).toString("base64")}`,
  };
}

export type JiraTransition = { id: string; to?: { statusCategory?: { key?: string } } };

/** True when a Jira status category key represents a completed/done state. */
export function isDoneCategory(categoryKey: string | undefined | null): boolean {
  return categoryKey === "done";
}

/**
 * Choose a transition that lands the issue in the desired state. To reach done,
 * pick a transition into the "done" category. To reopen, prefer "new" (To Do),
 * falling back to "indeterminate" (In Progress). Returns undefined when no
 * suitable transition is available from the current status.
 */
export function selectTransitionId(
  transitions: JiraTransition[],
  done: boolean
): string | undefined {
  const pick = (cat: string) =>
    transitions.find((t) => t.to?.statusCategory?.key === cat)?.id;
  return done ? pick("done") : pick("new") ?? pick("indeterminate");
}

function buildDescription(ctx: ActionPluginContext, includeAssignee = true): string {
  const lines = [ctx.action.content, ""];
  // Only record the assignee in the description when it wasn't set as the real
  // assignee field (i.e. couldn't be resolved to a Jira user).
  if (includeAssignee && ctx.action.assignee) lines.push(`Assignee: ${ctx.action.assignee}`);
  if (ctx.action.dueDate) {
    lines.push(`Due: ${new Date(ctx.action.dueDate).toISOString().slice(0, 10)}`);
  }
  lines.push(`Created from retrospective: ${ctx.retro.title}`);
  return lines.join("\n");
}

export type JiraUser = { name?: string; key?: string; emailAddress?: string; displayName?: string };

/**
 * Pick the best-matching Jira username from user-search results for a query.
 * Prefers an exact email match, then an exact name/display-name match, then a
 * single unambiguous result. Returns null when nothing suitable is found.
 */
export function selectAssigneeUsername(users: JiraUser[], query: string): string | null {
  if (!Array.isArray(users) || users.length === 0) return null;
  const wanted = query.trim().toLowerCase();
  if (!wanted) return null;

  const byEmail = users.find((u) => (u.emailAddress ?? "").toLowerCase() === wanted);
  if (byEmail?.name) return byEmail.name;
  const byName = users.find(
    (u) => (u.displayName ?? "").toLowerCase() === wanted || (u.name ?? "").toLowerCase() === wanted
  );
  if (byName?.name) return byName.name;
  if (users.length === 1 && users[0].name) return users[0].name;
  return null;
}

/**
 * Resolve an action assignee (typically an email like firstname.lastname@domain)
 * to a Jira Server/DC username via user search. The `username` search param
 * matches against username, display name and email. Returns null when nothing
 * suitable is found (caller then leaves the assignee in the description).
 */
async function resolveAssigneeName(
  baseUrl: string,
  authHeader: string,
  assignee: string
): Promise<string | null> {
  const query = assignee.trim();
  if (!query) return null;
  try {
    const res = await fetch(
      `${baseUrl}/rest/api/2/user/search?username=${encodeURIComponent(query)}&maxResults=50`,
      { headers: { Authorization: authHeader, Accept: "application/json" } }
    );
    if (!res.ok) return null;
    const users = (await res.json()) as JiraUser[];
    return selectAssigneeUsername(users, query);
  } catch {
    return null;
  }
}

export const jiraPlugin: RetroPlugin = {
  id: "jira",
  name: "Jira",

  isConfiguredForTeam(team: Team): boolean {
    return Boolean(
      team.jiraBaseUrl && team.jiraProjectKey && team.jiraEmail && team.jiraApiToken
    );
  },

  async createTaskForAction(ctx: ActionPluginContext): Promise<ExternalTaskResult> {
    const { team } = ctx;
    if (!this.isConfiguredForTeam(team)) {
      throw new Error("Jira is not configured for this team.");
    }

    const { baseUrl, authHeader } = jiraAuth(team);

    // Keep the summary to a single line and within Jira's 255-char limit.
    const summary = ctx.action.content.replace(/\s+/g, " ").trim().slice(0, 254) || "Retro action";

    // Resolve the assignee to a Jira username (best-effort). If unresolved, it
    // stays in the description via buildDescription below.
    let assigneeName: string | null = null;
    if (ctx.action.assignee) {
      assigneeName = await resolveAssigneeName(baseUrl, authHeader, ctx.action.assignee);
    }

    const body = {
      fields: {
        project: { key: team.jiraProjectKey },
        summary,
        // REST v2 takes a plain-text (wiki) string, not ADF.
        description: buildDescription(ctx, assigneeName === null),
        issuetype: { name: "Task" },
        ...(assigneeName ? { assignee: { name: assigneeName } } : {}),
        ...(ctx.action.dueDate
          ? { duedate: new Date(ctx.action.dueDate).toISOString().slice(0, 10) }
          : {}),
      },
    };

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/rest/api/2/issue`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(
        `Could not reach Jira at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      let message = `Jira returned ${res.status}`;
      try {
        const parsed = JSON.parse(detail);
        const errs = [
          ...(parsed.errorMessages ?? []),
          ...Object.values(parsed.errors ?? {}),
        ];
        if (errs.length) message += `: ${errs.join("; ")}`;
      } catch {
        if (detail) message += `: ${detail.slice(0, 200)}`;
      }
      throw new Error(message);
    }

    const data = (await res.json()) as { key?: string };
    if (!data.key) throw new Error("Jira did not return an issue key.");

    return { key: data.key, url: `${baseUrl}/browse/${data.key}` };
  },

  async getIssueDoneState(team: Team, keys: string[]): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    if (!this.isConfiguredForTeam(team) || keys.length === 0) return result;

    const { baseUrl, authHeader } = jiraAuth(team);

    // Fetch each issue's status category individually. This avoids depending on
    // Jira's search/JQL endpoints (which have shifted between deprecated and new
    // paths); a page-open reconcile only touches a handful of issues.
    await Promise.all(
      keys.map(async (key) => {
        try {
          const res = await fetch(
            `${baseUrl}/rest/api/2/issue/${encodeURIComponent(key)}?fields=status`,
            { headers: { Authorization: authHeader, Accept: "application/json" } }
          );
          if (!res.ok) return; // 404 (deleted issue) etc. — skip.
          const data = (await res.json()) as {
            fields?: { status?: { statusCategory?: { key?: string } } };
          };
          const categoryKey = data.fields?.status?.statusCategory?.key;
          if (categoryKey) result.set(key, isDoneCategory(categoryKey));
        } catch {
          // Network error for this key — leave it out of the map so the caller
          // treats its state as unknown and doesn't change anything.
        }
      })
    );

    return result;
  },

  async setIssueDone(team: Team, key: string, done: boolean): Promise<void> {
    if (!this.isConfiguredForTeam(team)) return;

    const { baseUrl, authHeader } = jiraAuth(team);
    const headers = {
      Authorization: authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    // 1. Read current status category; skip if already where we want it.
    const issueRes = await fetch(
      `${baseUrl}/rest/api/2/issue/${encodeURIComponent(key)}?fields=status`,
      { headers: { Authorization: authHeader, Accept: "application/json" } }
    );
    if (!issueRes.ok) return;
    const issueData = (await issueRes.json()) as {
      fields?: { status?: { statusCategory?: { key?: string } } };
    };
    const currentCategory = issueData.fields?.status?.statusCategory?.key;
    if (done && isDoneCategory(currentCategory)) return;
    if (!done && currentCategory && !isDoneCategory(currentCategory)) return;

    // 2. List available transitions and pick one that lands in the target
    //    category. For "done" -> a Done-category status. For reopen -> prefer a
    //    "new" (To Do) status, otherwise "indeterminate" (In Progress).
    const transRes = await fetch(
      `${baseUrl}/rest/api/2/issue/${encodeURIComponent(key)}/transitions`,
      { headers: { Authorization: authHeader, Accept: "application/json" } }
    );
    if (!transRes.ok) return;
    const transData = (await transRes.json()) as { transitions?: JiraTransition[] };
    const transitions = transData.transitions ?? [];

    const transitionId = selectTransitionId(transitions, done);
    if (!transitionId) return; // No suitable transition available from here.

    await fetch(`${baseUrl}/rest/api/2/issue/${encodeURIComponent(key)}/transitions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ transition: { id: transitionId } }),
    });
  },
};
