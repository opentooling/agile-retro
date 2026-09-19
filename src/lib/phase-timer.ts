/**
 * Snoozing a phase: "five more minutes".
 *
 * From the later of the deadline and now. Before the deadline that is the
 * deadline plus five; in overtime it is five minutes from now. Adding five to
 * the deadline in overtime — what this used to do — turned 57 minutes over into
 * 52 minutes over, which is not what anyone pressing "snooze" means.
 *
 * Durations are stored in whole minutes, so the phase's duration is rounded up
 * to cover the new deadline and its start is moved back by the remainder (always
 * under a minute) to land the deadline exactly. The start only anchors the clock
 * — how long phases really took comes from the phase log — so nothing else moves.
 */
export function snoozePhase(
  phaseStart: Date | null,
  durationMinutes: number | null,
  now: Date,
  extraMinutes = 5,
): { durationMinutes: number; phaseStart: Date } {
  const MIN = 60_000
  const start = phaseStart ?? now
  const deadline = start.getTime() + (durationMinutes ?? 0) * MIN
  const target = Math.max(deadline, now.getTime()) + extraMinutes * MIN
  const minutes = Math.ceil((target - start.getTime()) / MIN)
  return { durationMinutes: minutes, phaseStart: new Date(target - minutes * MIN) }
}
