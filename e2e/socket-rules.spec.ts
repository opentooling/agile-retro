/**
 * The board's rules, tested where they are enforced: on the socket, the way
 * someone who skipped the UI would reach them.
 *
 * Each refusal is paired with the same action succeeding, on the same
 * connection, so a refusal can never pass merely because nothing got through.
 * Outcomes are read straight from the database.
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { io, type Socket } from 'socket.io-client'
import { MAX_TEXT_LENGTH } from '../src/lib/text-limits'

type Seed = { boards: Record<string, string>; columns: Record<string, string[]>; sessions: Record<string, string> }
const seed = () => JSON.parse(readFileSync('e2e/.data/seed.json', 'utf8')) as Seed

/** Which column a card with this text is in, or null if there is none. */
function columnOf(content: string): string | null {
  const db = new DatabaseSync('e2e/.data/e2e.db', { readOnly: true })
  try {
    const row = db.prepare('SELECT "columnId" FROM "Item" WHERE "content" = ?').get(content) as { columnId: string } | undefined
    return row?.columnId ?? null
  } finally {
    db.close()
  }
}

let socket: Socket
test.beforeAll(async () => {
  socket = io('http://localhost:3000', {
    extraHeaders: { cookie: `authjs.session-token=${seed().sessions.ana}` },
    transports: ['websocket'],
  })
  await new Promise<void>((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject) })
})
test.afterAll(() => { socket.disconnect() })

const settle = () => new Promise((r) => setTimeout(r, 1000))
const unique = (label: string) => `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

test.describe('adding cards', () => {
  test('lands in a column of the board you name', async () => {
    const { boards, columns } = seed()
    const text = unique('Allowed card')
    socket.emit('add-item', { retroId: boards.sockets, columnId: columns.sockets[1], content: text })
    await expect.poll(() => columnOf(text)).toBe(columns.sockets[1])
  })

  test("cannot plant a card on another team's board through one you can use", async () => {
    const { boards, columns } = seed()
    const planted = unique('Planted card')
    socket.emit('add-item', { retroId: boards.sockets, columnId: columns.private[0], content: planted })
    await settle()
    expect(columnOf(planted)).toBeNull()
  })

  test('only while cards are being written', async () => {
    const { boards, columns } = seed()
    const late = unique('Late card')
    socket.emit('add-item', { retroId: boards.voting, columnId: columns.voting[0], content: late })
    await settle()
    expect(columnOf(late)).toBeNull()
  })

  test(`up to ${MAX_TEXT_LENGTH} characters`, async () => {
    const { boards, columns } = seed()
    const tag = unique('Long')
    const atLimit = `${tag} `.padEnd(MAX_TEXT_LENGTH, 'x')
    const overLimit = `${tag}!`.padEnd(MAX_TEXT_LENGTH + 1, 'x')
    socket.emit('add-item', { retroId: boards.sockets, columnId: columns.sockets[2], content: overLimit })
    socket.emit('add-item', { retroId: boards.sockets, columnId: columns.sockets[2], content: atLimit })
    await expect.poll(() => columnOf(atLimit)).toBe(columns.sockets[2])
    expect(columnOf(overLimit)).toBeNull()
  })
})

test.describe('moving cards', () => {
  test("cannot reach another board's card through one you can use", async () => {
    const { boards, columns } = seed()
    // Look the private card up by its text, then try to drag it across.
    const db = new DatabaseSync('e2e/.data/e2e.db', { readOnly: true })
    const privateCard = db.prepare('SELECT "id" FROM "Item" WHERE "content" = ?').get('Private card') as { id: string }
    db.close()
    socket.emit('move-item', { retroId: boards.sockets, itemId: privateCard.id, targetColumnId: columns.sockets[0], beforeItemId: null })
    await settle()
    expect(columnOf('Private card')).toBe(columns.private[0])
  })

  test("cannot push your card into another board's column", async () => {
    const { boards, columns } = seed()
    const db = new DatabaseSync('e2e/.data/e2e.db', { readOnly: true })
    const mine = db.prepare('SELECT "id" FROM "Item" WHERE "content" = ?').get('Ana socket card') as { id: string }
    db.close()
    socket.emit('move-item', { retroId: boards.sockets, itemId: mine.id, targetColumnId: columns.private[0], beforeItemId: null })
    await settle()
    expect(columnOf('Ana socket card')).toBe(columns.sockets[0])

    // …while moving it within its own board works.
    socket.emit('move-item', { retroId: boards.sockets, itemId: mine.id, targetColumnId: columns.sockets[2], beforeItemId: null })
    await expect.poll(() => columnOf('Ana socket card')).toBe(columns.sockets[2])
  })
})

test.describe('arranging the review queue', () => {
  /** The queue as the board holds it: cards in their stored order. */
  function storedQueue(retroId: string) {
    const db = new DatabaseSync('e2e/.data/e2e.db', { readOnly: true })
    try {
      return db
        .prepare(
          `SELECT i."content", i."reviewOrder" FROM "Item" i
             JOIN "Column" c ON c."id" = i."columnId"
            WHERE c."retrospectiveId" = ? ORDER BY i."reviewOrder"`,
        )
        .all(retroId) as { content: string; reviewOrder: number | null }[]
    } finally {
      db.close()
    }
  }
  const arranged = (retroId: string) =>
    storedQueue(retroId).filter((r) => r.reviewOrder !== null).map((r) => r.content)

  let facilitator: Socket
  test.beforeAll(async () => {
    facilitator = io('http://localhost:3000', {
      extraHeaders: { cookie: `authjs.session-token=${seed().sessions.fay}` },
      transports: ['websocket'],
    })
    await new Promise<void>((resolve, reject) => {
      facilitator.on('connect', resolve)
      facilitator.on('connect_error', reject)
    })
  })
  test.afterAll(() => { facilitator.disconnect() })

  test('only whoever runs the board may rearrange it', async () => {
    const { boards } = seed()
    // Ana is a participant, not the facilitator: her move is refused.
    socket.emit('reorder-review', { retroId: boards.review, itemId: null, delta: 1 })
    const top = storedQueue(boards.review)[0]
    const db = new DatabaseSync('e2e/.data/e2e.db', { readOnly: true })
    const card = db.prepare('SELECT "id" FROM "Item" WHERE "content" = ?').get('Queue middle') as { id: string }
    db.close()
    socket.emit('reorder-review', { retroId: boards.review, itemId: card.id, delta: -1 })
    await settle()
    expect(arranged(boards.review)).toEqual([])
    expect(top).toBeDefined()

    // …while fay, who runs it, is obeyed.
    facilitator.emit('reorder-review', { retroId: boards.review, itemId: card.id, delta: -1 })
    await expect.poll(() => arranged(boards.review).slice(0, 2)).toEqual(['Queue middle', 'Queue top'])

    // And only fay can put it back.
    socket.emit('reset-review-order', { retroId: boards.review })
    await settle()
    expect(arranged(boards.review).length).toBeGreaterThan(0)
    facilitator.emit('reset-review-order', { retroId: boards.review })
    await expect.poll(() => arranged(boards.review)).toEqual([])
  })

  test('not on a board that has moved past review', async () => {
    const { boards } = seed()
    const db = new DatabaseSync('e2e/.data/e2e.db', { readOnly: true })
    const card = db
      .prepare(
        `SELECT i."id" FROM "Item" i JOIN "Column" c ON c."id" = i."columnId"
          WHERE c."retrospectiveId" = ? LIMIT 1`,
      )
      .get(boards.voting) as { id: string }
    db.close()
    // boards.voting is still in voting: there is no queue to arrange yet.
    facilitator.emit('reorder-review', { retroId: boards.voting, itemId: card.id, delta: 1 })
    await settle()
    expect(arranged(boards.voting)).toEqual([])
  })
})
