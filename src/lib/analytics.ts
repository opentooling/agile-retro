/**
 * Turning raw team aggregates into the figures a team lead reads.
 *
 * Pure: takes the rows the database returned and produces rates, medians and
 * trends. No I/O, so the arithmetic — which is where analytics usually goes
 * quietly wrong — is testable without a database.
 *
 * Deliberately team-level throughout. Nothing here reports on an individual:
 * retros stop being honest the moment people believe they are being measured,
 * and contributor counts are already excluded for anonymous boards upstream.
 */
import type { TeamAnalyticsRaw } from "./db/types";
import { columnSentiment, type Sentiment } from "./column-sentiment";

export type TeamInsights = {
  /** Null when a team has no boards yet — every figure below is then empty. */
  lastRetroAt: Date | null;
  retroCount: number;
  /** Days between consecutive retros; null with fewer than two. */
  medianGapDays: number | null;
  /** Days since the most recent retro. */
  daysSinceLastRetro: number | null;
  sentiment: { sentiment: Sentiment; items: number; share: number }[];
  actions: {
    open: number;
    done: number;
    overdue: number;
    /** Share of all actions that have been completed, 0-1; null with none. */
    completionRate: number | null;
    /** Median days from agreeing an action to closing it; null when unknown. */
    medianDaysToClose: number | null;
    /** How many completed actions we cannot time, because they predate the timestamps. */
    untimedCompletions: number;
  };
  engagement: {
    avgItemsPerRetro: number | null;
    /** Share of items that got discussion notes in Review, 0-1. */
    discussionCoverage: number | null;
    /** Share of votes landing on each board's top three items, 0-1. */
    voteConcentration: number | null;
    avgContributors: number | null;
  };
  phases: { phase: string; medianMinutes: number; samples: number }[];
};

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

const DAY = 86_400_000;

export function buildInsights(raw: TeamAnalyticsRaw, now: Date = new Date()): TeamInsights {
  const dates = [...raw.retroDates].map((d) => new Date(d).getTime()).sort((a, b) => a - b);
  const last = dates.length > 0 ? dates[dates.length - 1] : null;

  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) gaps.push((dates[i] - dates[i - 1]) / DAY);

  // Fold column types into sentiments, so a team using 4Ls and one using
  // Start/Stop/Continue are comparable.
  const bySentiment = new Map<Sentiment, number>();
  let sentimentTotal = 0;
  for (const { type, items } of raw.itemsByColumnType) {
    const s = columnSentiment(type);
    bySentiment.set(s, (bySentiment.get(s) ?? 0) + items);
    sentimentTotal += items;
  }

  const totalActions = raw.actions.open + raw.actions.done;
  const { totalItems, itemsWithSummary, retrosWithItems, voteSpread, contributorsPerRetro } = raw.engagement;
  const votesTotal = voteSpread.reduce((acc, v) => acc + v.total, 0);
  const votesTopThree = voteSpread.reduce((acc, v) => acc + v.topThree, 0);

  const phaseGroups = new Map<string, number[]>();
  for (const { phase, seconds } of raw.phaseDurations) {
    phaseGroups.set(phase, [...(phaseGroups.get(phase) ?? []), seconds]);
  }

  return {
    lastRetroAt: last === null ? null : new Date(last),
    retroCount: dates.length,
    medianGapDays: median(gaps),
    daysSinceLastRetro: last === null ? null : (now.getTime() - last) / DAY,
    sentiment: [...bySentiment.entries()]
      .map(([sentiment, items]) => ({ sentiment, items, share: sentimentTotal === 0 ? 0 : items / sentimentTotal }))
      .sort((a, b) => b.items - a.items),
    actions: {
      open: raw.actions.open,
      done: raw.actions.done,
      overdue: raw.actions.overdue,
      completionRate: totalActions === 0 ? null : raw.actions.done / totalActions,
      medianDaysToClose: median(raw.actions.daysToClose),
      // Actions closed before the timestamps existed can be counted but not
      // timed. Reporting the gap beats a median quietly drawn from a subset.
      untimedCompletions: Math.max(0, raw.actions.done - raw.actions.daysToClose.length),
    },
    engagement: {
      avgItemsPerRetro: retrosWithItems === 0 ? null : totalItems / retrosWithItems,
      discussionCoverage: totalItems === 0 ? null : itemsWithSummary / totalItems,
      voteConcentration: votesTotal === 0 ? null : votesTopThree / votesTotal,
      avgContributors: mean(contributorsPerRetro),
    },
    phases: [...phaseGroups.entries()]
      .map(([phase, samples]) => ({
        phase,
        medianMinutes: (median(samples) ?? 0) / 60,
        samples: samples.length,
      }))
      .sort((a, b) => b.medianMinutes - a.medianMinutes),
  };
}
