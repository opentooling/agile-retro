/**
 * Jira plugin — creates a Jira issue from a retro action item via the Jira
 * Cloud REST API (v3).
 *
 * Auth is HTTP Basic with `email:apiToken` (Atlassian API tokens), configured
 * per team in Team settings. The team also supplies the base URL
 * (e.g. https://yourco.atlassian.net) and a project key (e.g. "PROJ").
 *
 * Assignee and due date are included in the issue description rather than as
 * structured fields, because Jira Cloud requires an accountId (not a display
 * name) to set the assignee, and we only have free-text names here.
 */
import type { Team } from "@/lib/db/types";
import type { ActionPluginContext, ExternalTaskResult, RetroPlugin } from "./types";

function trimBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function buildDescription(ctx: ActionPluginContext): string {
  const lines = [ctx.action.content, ""];
  if (ctx.action.assignee) lines.push(`Assignee: ${ctx.action.assignee}`);
  if (ctx.action.dueDate) {
    lines.push(`Due: ${new Date(ctx.action.dueDate).toISOString().slice(0, 10)}`);
  }
  lines.push(`Created from retrospective: ${ctx.retro.title}`);
  return lines.join("\n");
}

/** Minimal Atlassian Document Format wrapper for a plain-text body. */
function adf(text: string) {
  return {
    type: "doc",
    version: 1,
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    })),
  };
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

    const baseUrl = trimBaseUrl(team.jiraBaseUrl!);
    const auth = Buffer.from(`${team.jiraEmail}:${team.jiraApiToken}`).toString("base64");

    // Keep the summary to a single line and within Jira's 255-char limit.
    const summary = ctx.action.content.replace(/\s+/g, " ").trim().slice(0, 254) || "Retro action";

    const body = {
      fields: {
        project: { key: team.jiraProjectKey },
        summary,
        description: adf(buildDescription(ctx)),
        issuetype: { name: "Task" },
        ...(ctx.action.dueDate
          ? { duedate: new Date(ctx.action.dueDate).toISOString().slice(0, 10) }
          : {}),
      },
    };

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/rest/api/3/issue`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
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
};
