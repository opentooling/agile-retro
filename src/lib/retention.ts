/**
 * Optional board retention ("TTL").
 *
 * A board can be given a lifetime at creation; once it elapses the board and
 * everything on it is deleted by the periodic sweep. Retros often capture
 * candid, sometimes sensitive comments, and teams frequently want them gone on
 * a schedule rather than kept forever — but keeping them is still the default,
 * because deletion is irreversible.
 */

export type RetentionOption = { value: string; label: string; days: number | null };

export const RETENTION_OPTIONS: RetentionOption[] = [
  { value: 'never', label: 'Keep indefinitely', days: null },
  { value: '30', label: 'Delete after 30 days', days: 30 },
  { value: '90', label: 'Delete after 90 days', days: 90 },
  { value: '180', label: 'Delete after 6 months', days: 180 },
  { value: '365', label: 'Delete after 1 year', days: 365 },
];

export const DEFAULT_RETENTION = 'never';

/**
 * Turn a retention choice into an absolute expiry. Anything unrecognised —
 * including "never", an empty field, or a value from a stale form — keeps the
 * board indefinitely, so a bad input can never shorten a board's life.
 */
export function expiryFromRetention(value: string | null | undefined, from: Date): Date | null {
  const option = RETENTION_OPTIONS.find((o) => o.value === value);
  if (!option?.days) return null;
  return new Date(from.getTime() + option.days * 24 * 60 * 60 * 1000);
}
