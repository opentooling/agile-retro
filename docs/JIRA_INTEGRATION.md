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
- Once linked, the action's **done state stays in two-way sync** with the Jira
  issue (see [Two-way done sync](#two-way-done-sync)).

---

## Configuration (per team)

Open **Teams**, expand **Jira integration** on a team card, and fill in:

| Field | Example | Notes |
| --- | --- | --- |
| Base URL | `https://jira.yourco.com` | Your Jira Server/Data Center host, no trailing slash needed |
| Project key | `PROJ` | The key issues are created under |
| Account email | `you@yourco.com` | The account the token belongs to (used for Basic auth) |
| API token | `ATATT3x…` | An Atlassian API token (see below) |

The API token is **write-only from the UI**: it is stored server-side and never
sent back to the browser. To change other settings without re-entering it, leave
the token field blank when saving — the existing token is kept. A team shows
**Connected** once all four fields are present.

### Creating an API token (Personal Access Token)

On Jira **Server / Data Center**, create a **Personal Access Token**:

1. In Jira, open your **Profile → Personal Access Tokens**.
2. **Create token**, give it a label, copy the value.
3. Paste it into the team's **API token** field.

The token inherits your Jira permissions, so the account must be able to **create
issues** in the target project, **transition** them (for the done sync), and
**browse users** (to resolve assignees).

---

## How a Jira issue is created

When **Create in Jira** is clicked, the `createExternalTaskForAction` server
action runs the Jira plugin, which calls the Jira **REST API v2** (Jira Server /
Data Center):

```
POST {baseUrl}/rest/api/2/issue
Authorization: Basic base64(email:apiToken)
Content-Type: application/json

{
  "fields": {
    "project":   { "key": "PROJ" },
    "summary":   "<action text, single line, ≤254 chars>",
    "description": "<action text + due date + source retro> (plain text)",
    "issuetype": { "name": "Task" },
    "assignee":  { "name": "<resolved username>" },  // only if resolved (see below)
    "duedate":   "YYYY-MM-DD"                         // only if the action has a due date
  }
}
```

- **Auth** is HTTP Basic with `email:apiToken`.
- **Description** is a plain-text (wiki) string — v2 does not use ADF.
- **Assignee** is set as the real `assignee` field. The action's assignee
  (an email such as `firstname.lastname@domain`) is resolved to a Jira user via
  `GET /rest/api/2/user/search?username=<value>`, choosing an exact **email**
  match, then an exact name/display-name match, then a single unambiguous result.
  The resolved **username** is used (`{ "name": "…" }`, the Server/DC form). If it
  can't be resolved, the assignee is left in the **description** instead and the
  issue is still created — assignee lookup never blocks creation.
  - This requires the API-token account to hold the **Browse users and groups**
    global permission; otherwise the search returns nothing and it falls back to
    the description.
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

## Two-way done sync

Once an action item is linked to a Jira issue, its **completed** state and the
issue's **status** are kept in sync in both directions. "Done" is determined by
Jira's **status category** (`statusCategory.key === "done"`), so it works with
custom workflows without configuring specific status names.

**App → Jira (immediate).** Toggling an action fires `pushActionDoneState`,
which transitions the linked issue:

- Marking **done** → transitions to a status in the **Done** category.
- **Reopening** → transitions to a **To Do** (`new`) status, falling back to
  **In Progress** (`indeterminate`).

It first reads the issue's current category and skips if already there, so it's
idempotent. If no suitable transition is available from the issue's current
status, it's left unchanged.

**Jira → App (poll on open).** When a board (`/retro/[id]`) or the **Actions**
page is opened, the app reconciles: it reads each linked issue's status category
and updates the action's `completed` flag to match Jira. This is a
poll-on-open, not a background job — there is no webhook to configure.

Because the app→Jira push runs on every toggle, the two stay converged and don't
ping-pong.

> **Permissions:** the transitions use the same team Jira credentials as issue
> creation, so that Atlassian account must be allowed to **transition** issues in
> the project (not just create them). Reconcile only **reads** status.

---

## Where it lives in the code

```
src/lib/plugins/
  types.ts      RetroPlugin interface (+ optional getIssueDoneState / setIssueDone)
  registry.ts   list of available plugins + lookup helpers
  jira.ts       the Jira plugin: create issue, read status category, transition
                (isDoneCategory / selectTransitionId are pure + unit-tested)

src/lib/jira-sync.ts
  pushActionDoneState(id, done)        app -> Jira on toggle (transition/reopen)
  reconcileActionsForRetro(retroId)    Jira -> app on board open
  reconcileAllLinkedActions()          Jira -> app on the Actions page

src/app/actions.ts
  updateTeamJira(...)                 save a team's Jira config (token kept if blank)
  createExternalTaskForAction(id,plugin)  run a plugin for an action, persist link

server.ts / actions page             call pushActionDoneState when an action toggles
retro page / actions page            call the reconcile helpers on load

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

- Jira **Cloud** support (this integration targets Server/Data Center REST v2;
  Cloud uses `accountId` for assignee and ADF descriptions on `/rest/api/3`).
- Configurable issue type / extra fields per team.
- Real-time Jira → app updates via webhooks (today the pull side is poll-on-open;
  the push side is already immediate).
- OAuth instead of API tokens for tighter credential management.
