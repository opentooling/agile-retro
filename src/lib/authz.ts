/**
 * Authorization model (framework-agnostic).
 *
 * Access to a team-aligned board is driven by identity-provider **groups**
 * (e.g. AD / Keycloak groups delivered in the token's `groups` claim), matched
 * against each team's own configuration:
 *
 *   - Team.memberGroups  -> groups whose members may view/participate.
 *   - Team.adminGroups   -> groups whose members may manage (team-admin).
 *   - Team.createdBy      -> the team's creator, always treated as a team-admin.
 *
 * In addition, the global `admin` realm role is a super-user who can do
 * anything. Team membership/roles are configured per team in Team settings; see
 * docs/KEYCLOAK_GROUPS.md.
 *
 * Access rules:
 *   - A board with no team ("open board") keeps the previous behavior: any
 *     authenticated user can view and participate.
 *   - A board aligned to a team is protected: only members / team-admins of
 *     that team (and global admins) may view or participate. If the team has no
 *     groups configured, it is restricted to global admins (fail closed).
 *   - Management actions (phase changes, extending the timer, moderating other
 *     people's items) require the facilitator (board creator), a team-admin of
 *     the board's team, or a global admin.
 *   - Editing an item or its summary/notes requires the item's author, the
 *     facilitator, a team-admin of the board's team, or a global admin.
 *
 * These helpers are pure and shared by the Next.js server components and the
 * Socket.IO server so both enforce exactly the same policy.
 */

export type TeamRef =
  | {
      id: string;
      name?: string | null;
      createdBy?: string | null;
      memberGroups?: string[];
      adminGroups?: string[];
    }
  | null
  | undefined;

export type AuthUser = {
  /** Stable identity used for authorship checks (email, falling back to name). */
  id: string;
  name?: string | null;
  email?: string | null;
  isAdmin: boolean;
  /** Identity-provider groups the user belongs to (normalized on match). */
  groups: string[];
};

export type RetroRef = {
  teamId: string | null;
  creator: string;
  team?: TeamRef;
};

export type ItemRef = { userId: string; username: string };

const norm = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();

/** Normalize a group identifier: trim, lowercase, drop a leading slash. */
function normGroup(s: string): string {
  return norm(s).replace(/^\/+/, "");
}

/**
 * Parse a raw groups claim into a clean list. Accepts either an array of strings
 * (a multivalued claim like `user_roles` / `groups`) or a single delimited
 * string (comma / newline / whitespace separated).
 */
export function parseGroupsClaim(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((g): g is string => typeof g === "string" && g.trim().length > 0);
  }
  if (typeof raw === "string") {
    // Delimited string fallback: split on comma/newline only (group names may
    // contain spaces, so don't split on arbitrary whitespace).
    return raw.split(/[\n,]+/).map((g) => g.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Does any of the user's groups satisfy the configured group list? A configured
 * value matches a user group when they are equal after normalization, or when
 * the configured value equals the user group's last path segment — so
 * configuring "Platform" matches a user group of "/Eng/Platform".
 */
function groupsMatch(userGroups: string[], configured: string[] | undefined): boolean {
  if (!configured || configured.length === 0) return false;
  const wanted = new Set(configured.map(normGroup).filter(Boolean));
  if (wanted.size === 0) return false;
  return userGroups.some((g) => {
    const n = normGroup(g);
    if (wanted.has(n)) return true;
    const last = n.split("/").pop();
    return last ? wanted.has(last) : false;
  });
}

/**
 * Build an AuthUser from a NextAuth session-like object. Returns null when the
 * session has no authenticated user.
 */
export function authUserFromSession(session: unknown): AuthUser | null {
  const s = session as
    | { user?: { name?: string | null; email?: string | null }; roles?: string[]; groups?: string[] }
    | null
    | undefined;
  if (!s || !s.user) return null;
  return buildUser(s.user.name ?? null, s.user.email ?? null, null, s.roles, s.groups);
}

/**
 * Build an AuthUser from a decoded NextAuth JWT (as returned by `getToken` from
 * "next-auth/jwt"). Used by the Socket.IO server, which reads the session from
 * the handshake cookie rather than a session object.
 */
export function authUserFromToken(token: unknown): AuthUser | null {
  const t = token as
    | { name?: string | null; email?: string | null; sub?: string | null; roles?: string[]; groups?: string[] }
    | null
    | undefined;
  if (!t) return null;
  return buildUser(t.name ?? null, t.email ?? null, t.sub ?? null, t.roles, t.groups);
}

/**
 * Global-admin groups configured via the ADMIN_GROUPS env var (comma / newline /
 * whitespace separated identity-provider group identifiers). A user in any of
 * these groups is a global admin, in addition to anyone holding the `admin`
 * realm role. Read at call time so a deploy/env change takes effect without
 * requiring users to re-login.
 */
export function adminGroupsFromEnv(): string[] {
  const raw = process.env.ADMIN_GROUPS;
  if (!raw) return [];
  return raw
    .split(/[\n,]+/)
    .map((g) => g.trim())
    .filter(Boolean);
}

function buildUser(
  name: string | null,
  email: string | null,
  sub: string | null,
  roles: unknown,
  groups: unknown
): AuthUser | null {
  const id = norm(email) || norm(name) || norm(sub);
  if (!id) return null;
  const userGroups = parseGroupsClaim(groups);
  const hasAdminRole = Array.isArray(roles) && roles.includes("admin");
  return {
    id,
    name,
    email,
    // Global admin = the `admin` realm role OR membership of a configured
    // ADMIN_GROUPS group.
    isAdmin: hasAdminRole || groupsMatch(userGroups, adminGroupsFromEnv()),
    groups: userGroups,
  };
}

export function isTeamMember(user: AuthUser, retro: RetroRef): boolean {
  const team = retro.team;
  if (!team) return false;
  return groupsMatch(user.groups, team.memberGroups) || isTeamAdmin(user, retro);
}

export function isTeamAdmin(user: AuthUser, retro: RetroRef): boolean {
  const team = retro.team;
  if (!team) return false;
  if (team.createdBy && norm(team.createdBy) === user.id) return true;
  return groupsMatch(user.groups, team.adminGroups);
}

/** True when the user created (facilitates) the board. */
export function isFacilitator(user: AuthUser, retro: RetroRef): boolean {
  const c = norm(retro.creator);
  if (!c) return false;
  return norm(user.name) === c || norm(user.email) === c || user.id === c;
}

/** Can the user view / participate in this board? */
export function canViewBoard(user: AuthUser | null, retro: RetroRef): boolean {
  if (!user) return false;
  if (!retro.teamId) return true; // open board — any authenticated user
  if (user.isAdmin) return true;
  return isTeamMember(user, retro) || isTeamAdmin(user, retro);
}

/** Can the user manage the board (phase changes, timer, moderation)? */
export function canManageBoard(user: AuthUser | null, retro: RetroRef): boolean {
  if (!user) return false;
  if (user.isAdmin) return true;
  if (isFacilitator(user, retro)) return true;
  if (retro.teamId && isTeamAdmin(user, retro)) return true;
  return false;
}

/** Can the user edit this specific item (its content or summary/notes)? */
export function canEditItem(user: AuthUser | null, retro: RetroRef, item: ItemRef): boolean {
  if (!user) return false;
  if (canManageBoard(user, retro)) return true; // facilitator / team-admin / admin
  // Author of the item.
  if (item.userId && norm(item.userId) === user.id) return true;
  if (user.name && norm(item.username) === norm(user.name)) return true;
  return false;
}
