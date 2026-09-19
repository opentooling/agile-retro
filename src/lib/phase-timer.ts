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

/**
 * How far this browser's clock sits from the server's, in milliseconds, so the
 * phase clock can count against the server's time rather than the device's.
 *
 * Phase starts are stamped by the server, so any disagreement between the two
 * clocks lands straight on the timer: a server running six hours behind (a
 * sleeping VM whose clock drifted, say) puts a brand-new board hours into
 * overtime, and a participant whose own laptop is ten minutes fast watches
 * every phase end early.
 *
 * Measured the way NTP does it, from a round trip: the reply was written at
 * some point between the request leaving and the answer arriving, and taking
 * the midpoint of those two cancels the flight time as long as it is roughly
 * symmetric. Add the result to a local timestamp to get the server's.
 */
export function clockOffset(sentAt: number, serverTime: number, receivedAt: number): number {
  return serverTime - (sentAt + receivedAt) / 2
}
