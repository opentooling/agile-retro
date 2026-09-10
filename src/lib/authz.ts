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
  /** Board phase. Only "CLOSED" affects policy: a closed board is frozen. */
  status?: string;
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

/** The token claim the user's groups are read from (GROUPS_CLAIM, default `user_roles`). */
export function groupsClaimName(): string {
  return process.env.GROUPS_CLAIM || "user_roles";
}

/**
 * Base64url-decode a JWT segment. Built on `atob` + `decodeURIComponent` only:
 * `Buffer` doesn't exist in the Edge runtime (where the middleware runs the
 * auth callbacks) and `TextDecoder` isn't a global in the jsdom test
 * environment, but these two are available everywhere this code runs.
 */
function base64UrlDecode(segment: string): string | null {
  try {
    const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    // atob yields one latin1 char per byte; percent-encode those bytes and let
    // decodeURIComponent read them back as UTF-8, so non-ASCII group names
    // survive the round trip.
    const bytes = atob(padded);
    return decodeURIComponent(
      Array.from(bytes, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join("")
    );
  } catch {
    return null;
  }
}

/**
 * Read the claims out of a stored OIDC ID token without verifying it. Safe
 * here because the token only ever reaches us inside our own AUTH_SECRET-
 * encrypted session cookie — we are recovering claims we already trusted at
 * sign-in, not accepting a token from a caller.
 */
export function claimsFromIdToken(idToken: unknown): Record<string, unknown> | null {
  if (typeof idToken !== "string") return null;
  const parts = idToken.split(".");
  if (parts.length < 2) return null;
  const json = base64UrlDecode(parts[1]);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Extract the identity we care about from a set of OIDC claims — either a
 * NextAuth `profile` or a decoded ID-token payload: the global `admin` realm
 * role, and the user's groups (from GROUPS_CLAIM, falling back to `groups`).
 */
export function identityFromClaims(claims: Record<string, any> | null | undefined): {
  isAdminRole: boolean;
  groups: string[];
} {
  if (!claims) return { isAdminRole: false, groups: [] };
  const realmRoles = claims.realm_access?.roles;
  return {
    isAdminRole: Array.isArray(realmRoles) && realmRoles.includes("admin"),
    groups: parseGroupsClaim(claims[groupsClaimName()] ?? claims.groups),
  };
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
    | {
        user?: { name?: string | null; email?: string | null };
        roles?: string[];
        groups?: string[];
        id_token?: string;
      }
    | null
    | undefined;
  if (!s || !s.user) return null;
  return buildUser(s.user.name ?? null, s.user.email ?? null, null, s.roles, s.groups, s.id_token);
}

/**
 * Build an AuthUser from a decoded NextAuth JWT (as returned by `getToken` from
 * "next-auth/jwt"). Used by the Socket.IO server, which reads the session from
 * the handshake cookie rather than a session object.
 */
export function authUserFromToken(token: unknown): AuthUser | null {
  const t = token as
    | {
        name?: string | null;
        email?: string | null;
        sub?: string | null;
        roles?: string[];
        groups?: string[];
        id_token?: string;
      }
    | null
    | undefined;
  if (!t) return null;
  return buildUser(t.name ?? null, t.email ?? null, t.sub ?? null, t.roles, t.groups, t.id_token);
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
  groups: unknown,
  idToken?: unknown
): AuthUser | null {
  const id = norm(email) || norm(name) || norm(sub);
  if (!id) return null;
  let userGroups = parseGroupsClaim(groups);
  let hasAdminRole = Array.isArray(roles) && roles.includes("admin");

  // Recover identity from the stored ID token when the session carries no
  // groups. Sessions minted before group support existed (and any sign-in
  // whose `account` never reached the jwt callback) have no `groups` key at
  // all, and the jwt callback only populates it on the sign-in call — so
  // without this such a session would be permanently group-less until the
  // user re-authenticated. The ID token has been stored on every session
  // since the app's first release, so its claims are available here.
  if (userGroups.length === 0 && idToken) {
    const recovered = identityFromClaims(claimsFromIdToken(idToken));
    userGroups = recovered.groups;
    hasAdminRole = hasAdminRole || recovered.isAdminRole;
  }
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

/**
 * A closed board is an archive: it can still be read by everyone who could read
 * it before, but its contents are frozen.
 *
 * Closing used to be presentational only — the board said "read-only" while
 * every socket handler happily accepted edits, votes and reactions. This is the
 * single check the server enforces it with.
 *
 * Action items are the deliberate exception and are not governed by this:
 * they outlive the session that produced them, get carried into the team's next
 * retro, and are ticked off from the Actions page long after the board closes.
 */
export function isBoardFrozen(retro: RetroRef): boolean {
  return retro.status === "CLOSED";
}

/** Can the user change anything on this board? False once it is closed. */
export function canContributeToBoard(user: AuthUser | null, retro: RetroRef): boolean {
  if (isBoardFrozen(retro)) return false;
  return canViewBoard(user, retro);
}

/**
 * Who administers this board: its facilitator, a team-admin of its team, or a
 * global admin. Independent of phase — deleting a finished retro is a normal
 * thing to want, and retention deletes closed boards on a timer anyway.
 */
export function canAdministerBoard(user: AuthUser | null, retro: RetroRef): boolean {
  if (!user) return false;
  if (user.isAdmin) return true;
  if (isFacilitator(user, retro)) return true;
  if (retro.teamId && isTeamAdmin(user, retro)) return true;
  return false;
}

/**
 * Can the user run the board — phase changes, the timer, moderating other
 * people's cards?
 *
 * False once the board is closed: there is no phase left to drive, and
 * reopening would otherwise be a quiet way around the freeze. Deletion is
 * deliberately *not* governed by this; see canAdministerBoard.
 */
export function canManageBoard(user: AuthUser | null, retro: RetroRef): boolean {
  if (isBoardFrozen(retro)) return false;
  return canAdministerBoard(user, retro);
}

/** Can the user edit this specific item (its content or summary/notes)? */
export function canEditItem(user: AuthUser | null, retro: RetroRef, item: ItemRef): boolean {
  if (!user) return false;
  if (isBoardFrozen(retro)) return false;
  if (canManageBoard(user, retro)) return true; // facilitator / team-admin / admin
  // Author of the item.
  if (item.userId && norm(item.userId) === user.id) return true;
  if (user.name && norm(item.username) === norm(user.name)) return true;
  return false;
}
