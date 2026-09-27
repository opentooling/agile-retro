/**
 * A person's own footprint, shaped for their profile page.
 *
 * Pure: the database hands over raw rows, this decides what is shown. Two rules
 * live here rather than in the page:
 *
 *   - Only boards the viewer can open *now* count. Someone moved off a team
 *     keeps their history in the database, but the profile does not become a
 *     way to read the titles of boards they have lost access to.
 *   - Cards on anonymous boards are included — it is the author looking at
 *     their own words — but they are flagged, so the page can say that others
 *     see them without a name.
 */
import type { BoardScope } from './authz'
import type { UserActivityRaw } from './db/types'
import { columnSentiment, type Sentiment } from './column-sentiment'

export type Profile = {
  stats: {
    boardsRun: number
    boardsJoined: number
    cards: number
    stars: number
    reactions: number
  }
  /** What they tend to raise, by sentiment, largest first. */
  raises: { sentiment: Sentiment; count: number; share: number }[]
  recentCards: (UserActivityRaw['cards'][number])[]
  recentBoardsRun: UserActivityRaw['facilitated']
  /** When they were last active, from their newest card or board. */
  lastActive: Date | null
}

export function inScope(scope: BoardScope, teamId: string | null): boolean {
  if (scope.kind === 'all') return true
  return teamId === null ? scope.openBoards : scope.teamIds.includes(teamId)
}

export function buildProfile(raw: UserActivityRaw, scope: BoardScope, recent = 8): Profile {
  const facilitated = raw.facilitated.filter((r) => inScope(scope, r.teamId))
  const cards = raw.cards.filter((c) => inScope(scope, c.teamId))
  const votes = raw.votes.filter((v) => inScope(scope, v.teamId))
  const reactions = raw.reactions.filter((r) => inScope(scope, r.teamId))

  // "Joined" is any board they took part in — wrote on, starred or reacted —
  // whether or not they ran it.
  const joined = new Set<string>([
    ...cards.map((c) => c.retroId),
    ...votes.filter((v) => v.count > 0).map((v) => v.retroId),
    ...reactions.filter((r) => r.count > 0).map((r) => r.retroId),
  ])

  const bySentiment = new Map<Sentiment, number>()
  for (const card of cards) {
    const s = columnSentiment(card.columnType)
    bySentiment.set(s, (bySentiment.get(s) ?? 0) + 1)
  }
  const raises = [...bySentiment.entries()]
    .map(([sentiment, count]) => ({ sentiment, count, share: count / cards.length }))
    .sort((a, b) => b.count - a.count)

  const newest = [cards[0]?.createdAt, facilitated[0]?.createdAt]
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0]

  return {
    stats: {
      boardsRun: facilitated.length,
      boardsJoined: joined.size,
      cards: cards.length,
      stars: votes.reduce((n, v) => n + v.count, 0),
      reactions: reactions.reduce((n, r) => n + r.count, 0),
    },
    raises,
    recentCards: cards.slice(0, recent),
    recentBoardsRun: facilitated.slice(0, recent),
    lastActive: newest ?? null,
  }
}

/**
 * The names an action might be assigned to this person under. Assignees are
 * free text (often an @mention), so match the display name, the email and its
 * local part, each with and without a leading "@".
 */
export function assigneeNamesFor(name: string | null | undefined, email: string | null | undefined): string[] {
  const base = [name, email, email?.split('@')[0]].filter((v): v is string => Boolean(v && v.trim()))
  return [...new Set(base.flatMap((v) => [v.trim(), `@${v.trim()}`]))]
}
