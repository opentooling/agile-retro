/**
 * How much text one card or action may hold, and the check the socket handlers
 * share.
 *
 * Every change to a board re-sends the whole board to everyone on it, so one
 * multi-megabyte card is re-sent to every participant on every keystroke-sized
 * change that follows. 5,000 characters is roughly a page — far past any real
 * retro card — and small enough that no single card can dominate a broadcast.
 */
export const MAX_TEXT_LENGTH = 5000

/** The trimmed text, or null when it is empty or too long to accept. */
export function acceptText(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || text.length > MAX_TEXT_LENGTH) return null
  return text
}
