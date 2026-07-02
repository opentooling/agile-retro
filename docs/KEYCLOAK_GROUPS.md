# Keycloak / AD Groups Integration

This document explains how Agile Retro controls access to team-aligned boards
using **identity-provider groups** (e.g. Active Directory groups federated into
Keycloak), how teams bind to those groups, and the Keycloak configuration
required to make it work.

For the authorization *rules* themselves (who can view / manage / edit), see
[`../AUTHENTICATION.md`](../AUTHENTICATION.md).

---

## TL;DR

- Each **team** is bound to identity-provider groups in **Team settings**:
  - **Member groups** → can view and participate in the team's boards.
  - **Admin groups** → can manage the team's boards (team-admin).
- The app reads the signed-in user's groups from the token's **`user_roles`
  claim** (configurable via `GROUPS_CLAIM`; falls back to `groups`) and matches
  them against each team's bound groups **at request time**.
- The team **creator** is always a team-admin of that team.
- The global **`admin`** realm role is a super-user (everything, everywhere).
- Groups are configured **at team creation and editable later**; editing a
  team's groups is restricted to that team's team-admins and global admins.
- **Critical Keycloak step:** add a **Group Membership** mapper that puts the
  `user_roles` claim **in the ID token**, or the app won't see any groups.
- Boards created **without a team** ("open boards") remain visible to any
  authenticated user — group rules only apply to team-aligned boards.

---

## How access is decided

```
AD groups  ──(federation/sync)──►  Keycloak groups
     └─(Group Membership mapper, ID token)─► token claim  user_roles: ["/Eng/Platform", ...]
          └─ src/auth.ts reads profile.user_roles (GROUPS_CLAIM) ──► session.groups
               └─ src/lib/authz.ts matches session.groups against the board's team:
                    • Team.memberGroups  → member (view/participate)
                    • Team.adminGroups   → team-admin (manage)
                    • Team.createdBy      → creator, always team-admin
                    • realm role `admin`  → global super-user
```

Matching is **case-insensitive** and a configured value matches either the
full group path or its **last path segment** — so a team configured with
`Platform` matches a user whose group is `/Eng/Platform`, and configuring the
full `/Eng/Platform` also works.

If a team has **no** member/admin groups configured, it is restricted to global
admins (and its creator) — access **fails closed**, it does not fall open.

---

## Configuring a team's groups (in the app)

On the **Teams** page:

- **At creation** — the "Create New Team" form has *Member groups* and
  *Admin groups* fields. Leave them empty to restrict the team to admins for now.
- **Later** — each team card has an **Access groups** panel to edit the member
  and admin groups. This is limited to the team's team-admins (its creator or a
  member of its admin groups) and global admins.

If the Keycloak Admin service account is configured (see below), these fields
offer an autocomplete **picker** of your real groups; otherwise they accept
free-text group paths/names typed exactly as they appear in your IdP.

---

## Required Keycloak configuration

### 1. Get AD groups into Keycloak

If your users come from Active Directory, federate AD into Keycloak (LDAP User
Federation) and enable **group sync** (a Group LDAP mapper) so AD groups appear
as Keycloak groups.

### 2. Emit the groups claim in the ID token (the easy-to-miss step)

NextAuth reads the **ID token / userinfo** (as `profile`), so the groups must be
there. The app reads them from the **`user_roles`** claim by default (override
with the `GROUPS_CLAIM` env var; it also falls back to a `groups` claim):

1. Clients → your app's client → **Client scopes** → open the
   `<client>-dedicated` scope.
2. **Add mapper → By configuration → Group Membership**.
3. Set:
   - **Name**: `user_roles`
   - **Token Claim Name**: `user_roles` (must match `GROUPS_CLAIM`; default `user_roles`)
   - **Full group path**: ON → claim values look like `/Eng/Platform`
     (recommended; the matcher also accepts last-segment names)
   - **Add to ID token**: **ON** ← required
   - **Add to userinfo**: ON (helpful fallback)

The claim may be a JSON array or a comma/newline-delimited string — both are
accepted. Without this mapper, the groups list is empty and every team-aligned
board denies access to everyone except global admins.

> Using a different claim name? Set `GROUPS_CLAIM` (Helm: `auth.groupsClaim`) to
> match, e.g. `GROUPS_CLAIM=groups`.

### 3. (Optional) Service account for the group picker

To turn the free-text fields into a searchable **picker**, give the app a
Keycloak service account that can list groups:

1. Create/choose a confidential client with **Service accounts enabled**.
2. Grant it the realm-management roles **`query-groups`** and **`view-realm`**.
3. Provide its credentials to the app via env:

   ```bash
   KEYCLOAK_ADMIN_CLIENT_ID="retro-admin"
   KEYCLOAK_ADMIN_CLIENT_SECRET="…"
   AUTH_KEYCLOAK_ISSUER="https://kc.example.com/realms/myrealm"   # already set for login
   ```

   (If unset, the app falls back to `AUTH_KEYCLOAK_ID` / `AUTH_KEYCLOAK_SECRET`.)

The picker is served by `GET /api/keycloak/groups`, which returns
`{ configured: false, groups: [] }` when no service account is available — so the
UI simply degrades to free-text. **No service account is required** for access
control itself; it only powers autocomplete.

### 4. Global admins

Global super-users can be granted two ways (either is sufficient):

- The **`admin`** realm role — assign it directly or via a group's role mapping,
  and ensure the realm-roles mapper adds roles to the ID token (see
  `../AUTHENTICATION.md`).
- The **`ADMIN_GROUPS`** environment variable — a comma-separated list of group
  identifiers; any user in one of these `groups` is a global admin. This is the
  no-Keycloak-role option: set it in the Helm chart via `auth.adminGroups`, e.g.

  ```yaml
  auth:
    adminGroups:
      - /Eng/Retro-Admins
  ```

  Group matching is the same as team groups (case-insensitive; full path or last
  segment). It's read per request, so changing it takes effect on redeploy
  without users re-logging in (their group membership itself still comes from the
  token issued at login).

---

## Verifying

1. Sign in as a user who is in an AD/Keycloak group.
2. In Team settings, bind a team's **Member groups** to that group.
3. Open one of the team's boards → it should load. Sign in as someone not in the
   group → they should see "You don't have access to this board".
4. Bind the group as an **Admin group** (or use the team creator) → confirm that
   user can advance phases and edit others' items.

### Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Everyone is denied team boards | groups claim (`user_roles`) missing from the **ID token** (step 2), or `GROUPS_CLAIM` doesn't match the mapper's claim name, so `session.groups` is empty. |
| Groups appear in the access token but not the app | The app reads the ID token/userinfo, not the access token — configure the mapper for the ID token. |
| A member is still denied | Configured value doesn't match the user's group path or last segment (check spelling; matching is case-insensitive). |
| Picker shows nothing / free-text only | Service account not configured or lacks `query-groups`/`view-realm`; `/api/keycloak/groups` returns `configured: false`. |
| Works for Keycloak users but not Google | Expected — group-based access needs Keycloak. Google logins get only the `user` role and can use open boards. |
| Team is unexpectedly locked to admins | The team has no groups configured (fail-closed). Add member/admin groups in Team settings. |

---

## Files involved

- `src/auth.ts` — reads the groups claim (`user_roles` by default, via
  `GROUPS_CLAIM`) into `session.groups`; keeps the global
  `admin` realm role.
- `src/lib/authz.ts` — `parseGroupsClaim()` and the permission helpers
  (`canViewBoard`, `canManageBoard`, `canEditItem`) that match groups against a
  team's `memberGroups` / `adminGroups` / `createdBy`.
- `src/app/actions.ts` — `createTeam` (records the creator, sets initial groups)
  and `updateTeamGroups` (team-admin/admin gated).
- `src/app/teams/page.tsx` + `src/components/GroupsField.tsx` — the create form
  and per-team **Access groups** editor (with picker/free-text).
- `src/app/api/keycloak/groups/route.ts` — lists Keycloak groups for the picker.
- `src/lib/db/*` — `Team.memberGroups`, `Team.adminGroups`, `Team.createdBy`.
- `AUTHENTICATION.md` — provider setup and the authorization rules.
