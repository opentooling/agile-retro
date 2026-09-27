/**
 * Where a moved card ends up in its (new) column.
 *
 * Positions are expressed as "before this card", not as an index. With blind
 * input a participant sees only their own cards, so an index they computed
 * refers to a column they cannot see — "put it before the card I dropped it on"
 * means the same thing to them and to the server.
 *
 * `columnIds` is the column's full current order (hidden cards included).
 * A missing or unknown `beforeId` means "at the end".
 */
export function placeBefore(columnIds: string[], movedId: string, beforeId: string | null | undefined): string[] {
  const rest = columnIds.filter((id) => id !== movedId)
  const at = beforeId ? rest.indexOf(beforeId) : -1
  if (at === -1) return [...rest, movedId]
  return [...rest.slice(0, at), movedId, ...rest.slice(at)]
}

/**
 * The `beforeId` that moves a card one step up or down among the cards the
 * viewer can see, or `undefined` when it is already at that end.
 */
export function neighbourFor(visibleIds: string[], id: string, direction: 'up' | 'down'): string | null | undefined {
  const i = visibleIds.indexOf(id)
  if (i === -1) return undefined
  if (direction === 'up') return i === 0 ? undefined : visibleIds[i - 1]
  if (i === visibleIds.length - 1) return undefined
  // Down one: land before the card that is two below, or at the end.
  return visibleIds[i + 2] ?? null
}
