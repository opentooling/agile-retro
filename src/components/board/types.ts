/** The board as the client receives it (dates arrive as strings over JSON). */
export type BoardItem = {
  id: string
  content: string
  summary: string | null
  userId?: string
  username: string
  votes: { userId: string; count: number }[]
  /** The facilitator's place for this card in the review queue, if they set one. */
  reviewOrder?: number | null
  reactions?: { userId: string; emoji: string }[]
}

export type BoardColumn = {
  id: string
  title: string
  type: string
  // Set by the server under blind input: how many of this column's items are
  // withheld from this viewer.
  hiddenItemCount?: number
  items: BoardItem[]
}
