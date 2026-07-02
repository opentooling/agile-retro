# Agile Retro — User Guide

Agile Retro is a real-time retrospective tool. A **team** runs a **retrospective
board** ("retro") that moves through timed phases — everyone adds items, votes on
what matters, discusses the top items, and captures **action items** that can be
pushed to Jira. This guide covers how to use the app and what each page (path)
is for.

---

## Signing in

Open the app and you'll land on the **Sign-in** page (`/login`). Choose a
provider — **Google** and/or **Keycloak**, depending on how your instance is
configured — and authenticate. You must be signed in to use anything; the app
redirects you to `/login` otherwise.

Your access to team-restricted boards depends on your identity-provider groups.
Most people don't need to think about this; see [Access & roles](#access--roles)
if a board says you don't have access.

---

## The pages at a glance

The left **sidebar** links the four main areas. Full route reference:

| Path | What it's for |
| --- | --- |
| `/login` | Sign in (Google / Keycloak). |
| `/` | **Dashboard** — overview stats and the "Create New Session" button. |
| `/teams` | **Teams** — create/rename teams, configure access groups and Jira. |
| `/actions` | **Actions** — every action item across retros, with filters. |
| `/history` | **History** — browse past and active retrospectives. |
| `/retro/<id>` | A **retrospective board** — the live session itself. |
| `/api/retro/<id>/export` | Downloads a **PDF report** of a retro (opened via the Export button). |

---

## Quick start: run your first retro

1. **Create a team** (once) on `/teams` — see [Teams](#teams-teams).
2. On the **Dashboard** (`/`), click **Create New Session**, give it a title,
   pick the team (or leave it as an open board), optionally set tags, phase
   timers and anonymous mode, then **Create**. You're taken to the board.
3. **Share the board URL** (`/retro/<id>`) with participants. Anyone with access
   opens it and joins.
4. Work through the phases: **Input → Voting → Review → Actions → Close**.
5. Capture **action items**, optionally push them to **Jira**, and **Export** a
   PDF when done.

---

## Dashboard (`/`)

Your landing page after sign-in. It shows summary widgets (total
retrospectives, active sessions, action items) that link into History and
Actions, and the main **Create New Session** button.

**Creating a session** opens a dialog with:

- **Title** (required) — e.g. "Sprint 42 Retro".
- **Team** — pick a team, or choose **"No team (open board)"**. A team-aligned
  board is access-controlled; an open board is visible to any signed-in user.
- **Tags** — optional labels for filtering later (reused across retros).
- **Phase timers** — minutes for Input / Voting / Review (each phase can also be
  extended live).
- **Anonymous** — hide author names on cards.

Submitting creates the board and opens it.

---

## The retrospective board (`/retro/<id>`)

This is the live, real-time session. Everyone on the board sees changes
instantly. The header shows the title, team, current **status** (phase), a
**countdown timer**, and controls; the right side lists **participants**.

### Joining

If you're signed in your name is used automatically. Otherwise you'll be asked
for a display name on a **Join Session** screen. Once joined you appear in the
participants list.

### Readiness & advancing phases

- Each participant can toggle **Ready** to signal they're done with the current
  phase.
- The **facilitator** (the board's creator — plus team-admins/global admins)
  advances the phase with the button in the header:
  **Start Voting → Start Review → Start Actions → Close Retro**.
- Phases also **auto-advance** when their timer runs out. The facilitator can
  **extend** the timer during a phase.

### The phases

**Input** — Add cards to the columns (default: *What went well*, *What didn't go
well*, *What should be improved*). Type in a column's box and submit. Use **@** to
mention people. You can **drag** cards to reorder or move them between columns.
Edit a card you're allowed to edit by hovering it and clicking the **pencil**
(see [Editing items](#editing-items-and-notes)).

**Voting** — Each person gets a pool of **up to 10 votes**. Click the stars on a
card to spend votes on what matters most; your remaining votes are shown. Adjust
freely until the phase ends.

**Review** — Cards are sorted by votes so the group discusses the top items. Each
item has a **Summary / Notes** field for capturing the discussion (editable by
the item's author, the facilitator, and admins).

**Actions** — Turn conclusions into **action items**: content, an optional
**assignee** (supports @-mentions) and a **due date**. Action items are what you
track after the retro. If the team has Jira configured, each action shows a
**Create in Jira** button.

**Closed** — The session is archived (read-only). It still appears in History
and its actions remain in Actions.

### Editing items and notes

Hover a card and click the **pencil** to edit its text inline (Save / Cancel).
The **Summary / Notes** field in Review works the same way. Who can edit:

- The **author** of the item, and
- the **facilitator** (board creator), **team-admins** of the board's team, and
  **global admins**.

If you can't edit an item, the pencil won't appear and the notes show read-only.

### Exporting

The **Export** button downloads a **PDF report** (`/api/retro/<id>/export`) with
the items (by votes), notes and action items. Anonymous boards omit names.

---

## Teams (`/teams`)

Teams group retrospectives and control who can access team-aligned boards.

- **Create a team** — enter a name. Optionally set **Member groups** and **Admin
  groups** (your identity-provider groups) now; you can also do it later. The
  person who creates a team is automatically a **team-admin** of it.
- **Rename** — click the pencil on a team card.
- **Access groups** — expand **Access groups** on a team card to set:
  - *Member groups* — who can view and participate in the team's boards.
  - *Admin groups* — who can manage the team's boards (advance phases, moderate).
  If your instance is connected to Keycloak's group directory, these fields
  autocomplete; otherwise type the group paths/names. Editing a team's groups is
  limited to that team's team-admins and global admins. See
  [docs/KEYCLOAK_GROUPS.md](KEYCLOAK_GROUPS.md).
- **Jira integration** — expand **Jira integration** to connect the team to a
  Jira project (base URL, project key, account email, API token). See
  [docs/JIRA_INTEGRATION.md](JIRA_INTEGRATION.md).
- **New Session** — start a retro pre-set to that team.

---

## Actions (`/actions`)

A single place to track every action item created across all retrospectives.

- Filter by status with the **Open / Closed / All** buttons.
- Each row shows the action, its retro, team, owner, assignee and due date — the
  team/owner/assignee/retro are clickable to **filter** the list.
- The board owner can **Mark Done** / **Reopen**.
- If the action is linked to Jira, its **done state stays in two-way sync** with
  the Jira issue: toggling here transitions the issue (and vice-versa; changes
  made in Jira are picked up when you open this page or the board). See
  [docs/JIRA_INTEGRATION.md](JIRA_INTEGRATION.md).

Useful URL filters: `?status=open|closed|all`, `?retroId=<id>`,
`?assignee=<name>`, `?creator=<name>`, `?teamId=<team name>`.

---

## History (`/history`)

Browse retrospectives. Toggle **All Boards** vs **My Boards** (the ones you
created). Click any retro to open its board (live if still active, read-only if
closed).

Useful URL filters: `?myBoards=true`, `?status=active` (hide closed),
`?tag=<tag>`, `?creator=<name>`, `?teamId=<team name>`.

---

## Action items & Jira

Once a team is connected to Jira (on `/teams`), any action item in that team's
retros gets a **Create in Jira** button (on the board's Review/Actions views and
on the Actions page). Clicking it creates a Jira **Task** and links it. From then
on the action's **done/reopened** state and the Jira issue's status stay in sync
both ways. Full details and setup: [docs/JIRA_INTEGRATION.md](JIRA_INTEGRATION.md).

---

## Access & roles

- **Open boards** (created without a team): any signed-in user can view and
  participate.
- **Team-aligned boards**: restricted to the team's member/admin groups, the
  team's creator, and global admins. If you see **"You don't have access to this
  board,"** ask a team-admin to add your group to the team (on `/teams`), or ask
  an admin.
- **Facilitator** (board creator), **team-admins**, and **global admins** can
  advance phases, extend timers and moderate/edit any item. Everyone else can add
  their own items, vote, react, and edit their own items.
- **Global admins** can do everything on every board. Admin is granted via
  identity-provider groups/roles configured by your operators.

The specifics of how groups map to access are in
[AUTHENTICATION.md](../AUTHENTICATION.md) and
[docs/KEYCLOAK_GROUPS.md](KEYCLOAK_GROUPS.md).

---

## Tips

- **Real-time:** everyone sees updates live — no need to refresh.
- **@ mentions** work in item text and action assignees.
- **Anonymous mode** hides names on cards (set at creation).
- **Tags** make it easy to find related retros later via History/Dashboard.
- Share the board link (`/retro/<id>`) directly to invite people.
- Stuck on the wrong phase? The facilitator can advance it or extend the timer.
