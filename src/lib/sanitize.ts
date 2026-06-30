/**
 * Boundary helpers that strip server-only secrets (the Jira API token) from
 * objects before they are serialized to the browser — via a React Server
 * Component prop or a Socket.IO emit.
 */
import type { RetroFull, Team } from "./db/types";

export type ClientTeam = Omit<Team, "jiraApiToken"> & { jiraConfigured: boolean };
export type ClientRetroFull = Omit<RetroFull, "team"> & { team: ClientTeam | null };

export function redactTeam(team: Team | null): ClientTeam | null {
  if (!team) return null;
  const { jiraApiToken, ...rest } = team;
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
