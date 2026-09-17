/**
 * The Insights trend lines: the same team figures as the tiles, over time.
 *
 * Pure, like analytics.ts — the bucketing and windowing are where time series
 * go quietly wrong (off-by-one months, a partial month read as a slump), so
 * they are testable without a database or a clock.
 *
 * Months are UTC throughout. A retro at 00:30 local time on the 1st can land
 * in the previous month for someone east of Greenwich; for a monthly cadence
 * chart that is noise, and one consistent rule beats per-viewer buckets.
 */
import type { TeamAnalyticsRaw } from "./db/types";

/** At most a year back: older than that describes a different team. */
export const MAX_MONTHS = 12;
/** At least a quarter, so the axis reads as time even for a brand-new team. */
export const MIN_MONTHS = 3;

export type MonthBucket = {
  /** First instant of the month, UTC, as epoch ms (crosses to the client). */
  start: number;
  retros: number;
  /** Actions agreed in that month's sessions. */
  agreed: number;
  /** Actions ticked off that month, whenever they were agreed. */
  closed: number;
  /** The current month: still filling up, so a low bar is not yet a slump. */
  partial: boolean;
};

export type SessionPoint = {
  at: number;
  title: string;
  cards: number;
  /** Share of the board's cards that got notes in Review, 0-1. */
  discussed: number;
  /** Null on anonymous boards, which are never counted. */
  contributors: number | null;
};

export type TeamTrends = {
  months: MonthBucket[];
  /** The shared x-domain for every chart: first month start to the next month's start. */
  from: number;
  to: number;
  sessions: SessionPoint[];
  /**
   * Completed actions with no completion date — they predate the timestamp, so
   * they cannot be placed on the "closed" line. Counted so the gap is stated.
   */
  untimedClosures: number;
};

const monthStart = (t: number): number => {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};
const addMonths = (t: number, n: number): number => {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1);
};

/** Null when the team has never run a retro — there is no timeline to draw. */
export function buildTrends(
  raw: Pick<TeamAnalyticsRaw, "retroDates" | "perRetro" | "actionTimeline">,
  now: Date = new Date(),
): TeamTrends | null {
  if (raw.retroDates.length === 0) return null;

  const first = Math.min(...raw.retroDates.map((d) => new Date(d).getTime()));
  const current = monthStart(now.getTime());
  const earliestAllowed = addMonths(current, -(MAX_MONTHS - 1));
  let from = Math.max(monthStart(first), earliestAllowed);
  if (from > addMonths(current, -(MIN_MONTHS - 1))) from = addMonths(current, -(MIN_MONTHS - 1));
  const to = addMonths(current, 1);

  const months: MonthBucket[] = [];
  const index = new Map<number, MonthBucket>();
  for (let m = from; m < to; m = addMonths(m, 1)) {
    const bucket = { start: m, retros: 0, agreed: 0, closed: 0, partial: m === current };
    months.push(bucket);
    index.set(m, bucket);
  }
  const bucketFor = (t: number) => (t >= from && t < to ? index.get(monthStart(t)) : undefined);

  for (const d of raw.retroDates) {
    const b = bucketFor(new Date(d).getTime());
    if (b) b.retros += 1;
  }

  let untimedClosures = 0;
  for (const a of raw.actionTimeline) {
    const agreed = bucketFor(a.agreedAt.getTime());
    if (agreed) agreed.agreed += 1;
    if (!a.completed) continue;
    if (!a.completedAt) {
      untimedClosures += 1;
      continue;
    }
    const closed = bucketFor(a.completedAt.getTime());
    if (closed) closed.closed += 1;
  }

  const sessions: SessionPoint[] = raw.perRetro
    .filter((r) => r.at.getTime() >= from && r.at.getTime() < to)
    .map((r) => ({
      at: r.at.getTime(),
      title: r.title,
      cards: r.cards,
      discussed: r.cards === 0 ? 0 : r.discussed / r.cards,
      contributors: r.contributors,
    }));

  return { months, from, to, sessions, untimedClosures };
}
