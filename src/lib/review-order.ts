/**
 * The order of the discussion queue in Review.
 *
 * By default the queue is ranked by votes: the card the room cared about most
 * is discussed first. A facilitator often knows better — two cards are really
 * one conversation, someone has to leave at half past, the cheap win should go
 * first — so they can lift a topic up or down the queue, and reset back to the
 * vote ranking afterwards.
 *
 * A manual order is stored as a number per card (`reviewOrder`). It is all or
 * nothing: the first move writes a position for every card on the board, so the
 * queue never half-remembers an arrangement. While no card carries one, the
 * queue is the vote ranking and the reset is a no-op.
 */

export type Orderable = {
  id: string
  /** Total votes, for the default ranking. */
  total: number
  /** The facilitator's position, if they have arranged the queue. */
  reviewOrder?: number | null
}

/**
 * Is the queue in an order someone chose, rather than the vote ranking? Asks
 * only for the positions, so it can be handed the cards themselves.
 */
export function isCustomOrder(entries: readonly { reviewOrder?: number | null }[]): boolean {
  return entries.some((e) => typeof e.reviewOrder === 'number')
}

/**
 * The queue as it should be shown: the facilitator's order when there is one,
 * the vote ranking otherwise.
 *
 * Ties keep the order they arrived in — `sort` is stable — so a queue of cards
 * nobody voted for does not reshuffle itself on every render.
 */
export function orderedForReview<T extends Orderable>(entries: readonly T[]): T[] {
  const custom = isCustomOrder(entries)
  return [...entries].sort((a, b) =>
    custom
      ? (a.reviewOrder ?? Number.MAX_SAFE_INTEGER) - (b.reviewOrder ?? Number.MAX_SAFE_INTEGER)
      : b.total - a.total,
  )
}

/**
 * The queue after moving one card one place up (-1) or down (+1).
 *
 * The move stays inside the card's own group: the queue is drawn as the voted
 * cards and then those nobody voted for ("Also raised"), and a card that jumped
 * between the two would appear to vanish. Returns the ids in their new order,
 * which is what gets written to the board; an impossible move (the top card
 * moving up) returns null, so callers can leave the board alone.
 */
export function moveInReview(
  entries: readonly Orderable[],
  itemId: string,
  delta: -1 | 1,
): string[] | null {
  const queue = orderedForReview(entries)
  const from = queue.findIndex((e) => e.id === itemId)
  if (from === -1) return null

  const group = (e: Orderable) => e.total > 0
  const to = from + delta
  if (to < 0 || to >= queue.length) return null
  if (group(queue[to]) !== group(queue[from])) return null

  const moved = [...queue]
  const [card] = moved.splice(from, 1)
  moved.splice(to, 0, card)
  return moved.map((e) => e.id)
}

/**
 * The queue after dropping one card in front of another (`null` for the end).
 *
 * The same rule as the arrows, expressed for a drag: the voted cards and those
 * nobody voted for are drawn under separate headings, so an order that mixed
 * them would put a card under a heading that does not describe it. Any drop
 * that would do so is refused rather than quietly corrected — the card springs
 * back, which is honest about what the queue allows.
 */
export function placeInReview(
  entries: readonly Orderable[],
  itemId: string,
  beforeItemId: string | null,
): string[] | null {
  const queue = orderedForReview(entries)
  const from = queue.findIndex((e) => e.id === itemId)
  if (from === -1) return null
  if (beforeItemId === itemId) return null

  const rest = queue.filter((e) => e.id !== itemId)
  const at = beforeItemId === null ? rest.length : rest.findIndex((e) => e.id === beforeItemId)
  if (at === -1) return null // dropped on a card that is not in this queue

  const moved = [...rest.slice(0, at), queue[from], ...rest.slice(at)]

  // Every voted card must still come before every card with no votes.
  let seenUnvoted = false
  for (const entry of moved) {
    if (entry.total === 0) seenUnvoted = true
    else if (seenUnvoted) return null
  }
  return moved.map((e) => e.id)
}
