/**
 * Boundary helpers that strip server-only secrets (the Jira API token) from
 * objects before they are serialized to the browser — via a React Server
 * Component prop or a Socket.IO emit.
 */
import type { RetroFull, Team } from "./db/types";

// The board's client payload deliberately omits the Jira token (secret) and the
// access-control internals (group bindings, creator) — the client only needs
// display info. Management/edit rights are computed server-side and passed
// separately as the RetroBoard `viewer` prop.
export type ClientTeam = Omit<
  Team,
  "jiraApiToken" | "memberGroups" | "adminGroups" | "createdBy"
> & { jiraConfigured: boolean };
export type ClientRetroFull = Omit<RetroFull, "team"> & { team: ClientTeam | null };

export function redactTeam(team: Team | null): ClientTeam | null {
  if (!team) return null;
  const { jiraApiToken, memberGroups, adminGroups, createdBy, ...rest } = team;
  return {
    ...rest,
    jiraConfigured: Boolean(
      team.jiraBaseUrl && team.jiraProjectKey && team.jiraEmail && jiraApiToken
    ),
  };
}

/** Redact the nested team token from a full retro before sending to a client. */
export function redactRetroFull<T extends { team: Team | null } | null>(
  retro: T
): T extends null ? null : ClientRetroFull {
  if (!retro) return null as any;
  return { ...retro, team: redactTeam(retro.team) } as any;
}

/**
 * Apply "blind input" for one viewer: during the INPUT phase of a board with
 * `blindInput` on, drop everyone else's items so nobody's thinking is anchored
 * by what has already been written.
 *
 * This runs on the server for every payload — the initial page render and each
 * socket broadcast — so hidden items are never sent to the browser at all. The
 * per-column count of what's withheld is kept, so the UI can show that other
 * people are contributing without revealing what.
 *
 * A no-op outside the input phase, so items become visible to all as soon as
 * the phase advances.
 */
export function applyBlindInput<T extends ClientRetroFull | null>(
  retro: T,
  viewerId: string | null | undefined
): T {
  if (!retro || !retro.blindInput || retro.status !== "INPUT") return retro;
  return {
    ...retro,
    columns: retro.columns.map((column) => {
      const mine = column.items.filter((item) => !!viewerId && item.userId === viewerId);
      return { ...column, items: mine, hiddenItemCount: column.items.length - mine.length };
    }),
  } as T;
}
