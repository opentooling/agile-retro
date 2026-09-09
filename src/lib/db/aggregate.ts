/**
 * Row-shaping shared by both database backends.
 *
 * The two backends return the same rows for analytics; folding those rows into
 * per-board figures is identical work, so it lives here rather than being
 * written twice in SQL dialects that would inevitably drift.
 */
import type { TeamAnalyticsRaw } from "./types";

type Row = Record<string, unknown>;

/**
 * Per-board engagement: how many items, how many were actually discussed
 * (a non-empty summary), how votes were spread, and how many distinct people
 * contributed.
 *
 * Contributors are counted only for boards that are not anonymous. On an
 * anonymous board the author is still stored, but counting it here would
 * quietly turn a display-level promise into an analytics signal.
 */
export function engagementFromRows(
  retros: Row[],
  itemRows: Row[],
  voteRows: Row[]
): TeamAnalyticsRaw["engagement"] {
  const anonymous = new Set(
    retros.filter((r) => r.isAnonymous).map((r) => r.id as string)
  );

  const contributors = new Map<string, Set<string>>();
  const itemsPerRetro = new Map<string, number>();
  let totalItems = 0;
  let itemsWithSummary = 0;

  for (const row of itemRows) {
    const retro = row.retro as string;
    totalItems += 1;
    if (row.summarised) itemsWithSummary += 1;
    itemsPerRetro.set(retro, (itemsPerRetro.get(retro) ?? 0) + 1);
    if (!anonymous.has(retro)) {
      const set = contributors.get(retro) ?? new Set<string>();
      set.add(String(row.userId ?? ""));
      contributors.set(retro, set);
    }
  }

  const votesPerRetro = new Map<string, number[]>();
  for (const row of voteRows) {
    const retro = row.retro as string;
    const list = votesPerRetro.get(retro) ?? [];
    list.push(Number(row.votes ?? 0));
    votesPerRetro.set(retro, list);
  }

  const voteSpread = [...votesPerRetro.entries()].map(([, votes]) => {
    const sorted = [...votes].sort((a, b) => b - a);
    return {
      total: sorted.reduce((acc, v) => acc + v, 0),
      topThree: sorted.slice(0, 3).reduce((acc, v) => acc + v, 0),
    };
  });

  return {
    totalItems,
    itemsWithSummary,
    retrosWithItems: itemsPerRetro.size,
    voteSpread,
    contributorsPerRetro: [...contributors.values()].map((s) => s.size),
  };
}

/**
 * Seconds spent in each phase, from consecutive entries in the phase log.
 *
 * The last phase a board entered has no successor, so its duration is unknown
 * and is left out rather than being measured against "now" — that would make a
 * board still sitting in Review look like a phase that took three weeks.
 */
export function phaseDurationsFromRows(phaseRows: Row[]): TeamAnalyticsRaw["phaseDurations"] {
  const byRetro = new Map<string, { phase: string; at: number }[]>();
  for (const row of phaseRows) {
    const retro = row.retro as string;
    const list = byRetro.get(retro) ?? [];
    list.push({ phase: row.phase as string, at: new Date(row.enteredAt as string | Date).getTime() });
    byRetro.set(retro, list);
  }

  const out: TeamAnalyticsRaw["phaseDurations"] = [];
  for (const events of byRetro.values()) {
    events.sort((a, b) => a.at - b.at);
    for (let i = 0; i < events.length - 1; i++) {
      const seconds = (events[i + 1].at - events[i].at) / 1000;
      if (seconds >= 0) out.push({ phase: events[i].phase, seconds });
    }
  }
  return out;
}
