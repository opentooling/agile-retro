/**
 * Plugin registry — the single place that knows which plugins exist.
 *
 * Register new integrations here; the rest of the app discovers them through
 * these helpers rather than importing concrete plugins directly.
 */
import type { RetroPlugin } from "./types";
import type { Team } from "@/lib/db/types";
import { jiraPlugin } from "./jira";

const PLUGINS: RetroPlugin[] = [jiraPlugin];

export function getPlugins(): RetroPlugin[] {
  return PLUGINS;
}

export function getPlugin(id: string): RetroPlugin | undefined {
  return PLUGINS.find((p) => p.id === id);
}

/** Plugins that are configured (and therefore usable) for a given team. */
export function getConfiguredPlugins(team: Team): RetroPlugin[] {
  return PLUGINS.filter((p) => p.isConfiguredForTeam(team));
}

export type { RetroPlugin } from "./types";
