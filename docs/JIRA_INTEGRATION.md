# Jira Integration

The app can push retrospective **action items** into Jira as issues. This is
built on a small, general **plugin architecture**, so Jira is just the first of
potentially several trackers (GitHub Issues, Linear, Trello, …).

This document explains how the integration works, how to configure it, and how
to add another tracker later.

---

## What it does

- Each **team** can be linked to a single Jira project (base URL + project key +
  credentials), configured from the **Teams** page.
- Once a team is linked, every action item created in that team's retrospectives
  shows a **"Create in Jira"** button (on the retro board's review/closed view
  and on the **Actions** page).
- Clicking it creates a Jira issue of type **Task** using the action's text,
  assignee and due date, then stores the resulting issue key + URL on the action
  so the button becomes a link to the issue. Creating twice is prevented.

---

## Configuration (per team)

Open **Teams**, expand **Jira integration** on a team card, and fill in:

| Field | Example | Notes |
| --- | --- | --- |
| Base URL | `https://yourco.atlassian.net` | Your Jira Cloud site, no trailing slash needed |
| Project key | `PROJ` | The key issues are created under |
| Account email | `you@yourco.com` | The Atlassian account the token belongs to |
| API token | `ATATT3x…` | An Atlassian API token (see below) |

The API token is **write-only from the UI**: it is stored server-side and never
sent back to the browser. To change other settings without re-entering it, leave
the token field blank when saving — the existing token is kept. A team shows
**Connected** once all four fields are present.

### Creating an Atlassian API token

1. Go to <https://id.atlassian.com/manage-profile/security/api-tokens>.
2. **Create API token**, give it a label, copy the value.
3. Paste it into the team's **API token** field.

The token inherits your Jira permissions, so the account must be able to create
issues in the target project.

---

## How a Jira issue is created

When **Create in Jira** is clicked, the `createExternalTaskForAction` server
action runs the Jira plugin, which calls the Jira Cloud REST API:

```
POST {baseUrl}/rest/api/3/issue
Authorization: Basic base64(email:apiToken)
Content-Type: application/json

{
  "fields": {
    "project":   { "key": "PROJ" },
    "summary":   "<action text, single line, ≤254 chars>",
    "description": "<action text + assignee + due date + source retro> (ADF)",
    "issuetype": { "name": "Task" },
    "duedate":   "YYYY-MM-DD"        // only if the action has a due date
  }
}
```

- **Auth** is HTTP Basic with `email:apiToken` (Atlassian's standard for API
  tokens).
- **Assignee** is written into the description rather than the structured
  `assignee` field, because Jira Cloud requires an `accountId` (not a display
  name) to assign, and the app only has free-text names. (See *Extending* below
  for how to upgrade this.)
- On success the issue **key** (e.g. `PROJ-123`) and a **browse URL**
  (`{baseUrl}/browse/PROJ-123`) are saved on the action item.
- On failure the API's error messages are surfaced inline in the UI (e.g.
  unknown project key, missing required field, auth failure).

### Network requirements

The **server** makes the outbound call to Jira, so the host running the app
needs network access to your Jira site. In locked-down/airgapped deployments,
allowlist `*.atlassian.net` (or your Jira Server/Data Center host) from the app
server.

---

## Where it lives in the code

```
src/lib/plugins/
  types.ts      RetroPlugin interface + context/result types
  registry.ts   list of available plugins + lookup helpers
  jira.ts       the Jira plugin (REST call, error handling)

src/app/actions.ts
  updateTeamJira(...)                 save a team's Jira config (token kept if blank)
  createExternalTaskForAction(id,plugin)  run a plugin for an action, persist link

Data layer (src/lib/db/*):
  Team:        jiraBaseUrl, jiraProjectKey, jiraEmail, jiraApiToken
  ActionItem:  externalUrl, externalKey   (the created issue link)
```

The Jira **API token never reaches the browser**: `getTeams()` strips it, and the
retro payload sent to clients (page prop + Socket.IO emits) is run through
`redactRetroFull` in `src/lib/sanitize.ts`.

---

## Extending: add another tracker

1. Implement `RetroPlugin` (in `src/lib/plugins/yourtracker.ts`):

   ```ts
   export const yourPlugin: RetroPlugin = {
     id: 'yourtracker',
     name: 'Your Tracker',
     isConfiguredForTeam(team) { /* check the team has what it needs */ },
     async createTaskForAction({ action, retro, team }) {
       // call the tracker's API…
       return { key: 'ABC-1', url: 'https://…' }
     },
   }
   ```

2. Register it in `src/lib/plugins/registry.ts`:

   ```ts
   const PLUGINS: RetroPlugin[] = [jiraPlugin, yourPlugin]
   ```

3. Add any new config columns the tracker needs to `Team` (both `sqlite.ts` and
   `postgres.ts`, plus `types.ts`), and surface them in the Teams settings UI.

4. Trigger it from the UI by calling
   `createExternalTaskForAction(actionId, 'yourtracker')`.

Because call sites talk to the **registry**, not to concrete plugins, the rest of
the app needs no changes.

---

## Possible improvements

- Resolve assignee names to Jira `accountId`s (via
  `/rest/api/3/user/search`) and set the real `assignee` field.
- Configurable issue type / extra fields per team.
- Two-way sync (reflect Jira status back onto the action) via webhooks or polling.
- OAuth instead of API tokens for tighter credential management.
