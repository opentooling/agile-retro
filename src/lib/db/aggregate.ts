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

/** node:sqlite returns 0/1 and ISO strings; pg returns booleans and Dates. */
const asBool = (v: unknown): boolean => v === true || v === 1 || v === "1";
const asDateOrNull = (v: unknown): Date | null =>
  v == null || v === "" ? null : new Date(v as string | Date);

/**
 * One point per board, for the per-session trend lines.
 *
 * Boards with no cards are left out, matching the "cards per retro" average:
 * an empty board is almost always a test or an abandoned one, and plotting it
 * as a zero would drag the line down for a session that never happened.
 */
export function perRetroFromRows(retros: Row[], itemRows: Row[]): TeamAnalyticsRaw["perRetro"] {
  const cards = new Map<string, number>();
  const discussed = new Map<string, number>();
  const people = new Map<string, Set<string>>();
  for (const row of itemRows) {
    const retro = row.retro as string;
    cards.set(retro, (cards.get(retro) ?? 0) + 1);
    if (asBool(row.summarised)) discussed.set(retro, (discussed.get(retro) ?? 0) + 1);
    const set = people.get(retro) ?? new Set<string>();
    set.add(String(row.userId ?? ""));
    people.set(retro, set);
  }

  return retros
    .filter((r) => cards.has(r.id as string))
    .map((r) => {
      const id = r.id as string;
      return {
        at: new Date(r.createdAt as string | Date),
        title: String(r.title ?? ""),
        cards: cards.get(id)!,
        discussed: discussed.get(id) ?? 0,
        // Same promise as engagementFromRows: an anonymous board's authors are
        // stored, but they never become a number.
        contributors: asBool(r.isAnonymous) ? null : people.get(id)!.size,
      };
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * Every action placed on the timeline.
 *
 * "Agreed" is dated by the board it came out of rather than the action's own
 * createdAt. The two are the same for anything raised in the session, and the
 * board's date is always present — action timestamps were only added later,
 * so older rows carry a backfilled value that would pile them all into one
 * month.
 */
export function actionTimelineFromRows(retros: Row[], actionRows: Row[]): TeamAnalyticsRaw["actionTimeline"] {
  const heldAt = new Map(retros.map((r) => [r.id as string, new Date(r.createdAt as string | Date)]));
  const out: TeamAnalyticsRaw["actionTimeline"] = [];
  for (const a of actionRows) {
    const agreedAt = heldAt.get(a.retro as string);
    if (!agreedAt) continue;
    const completed = asBool(a.completed);
    out.push({ agreedAt, completed, completedAt: completed ? asDateOrNull(a.completedAt) : null });
  }
  return out;
}
