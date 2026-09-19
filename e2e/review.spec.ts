import { test, expect, type Page } from '@playwright/test'
import { as, openBoard } from './helpers'

/** The discussion queue, top to bottom: each row reads rank, then the card. */
async function queue(page: Page) {
  const rows = page.getByRole('navigation', { name: 'Discussion queue' }).locator('li:not([role="presentation"])')
  return (await rows.allInnerTexts()).map((t) => t.split('\n')[1]?.trim())
}

const VOTE_ORDER = ['Queue top', 'Queue middle', 'Queue bottom', 'Queue unvoted', 'Queue unvoted two']

test.describe('the review queue', () => {
  test.describe('as the facilitator', () => {
    test.use(as('fay'))

    test('starts ranked by votes and can be rearranged, then reset', async ({ page }) => {
      await openBoard(page, 'review')
      await expect(page.getByText('Queue · by votes')).toBeVisible()
      expect(await queue(page)).toEqual(VOTE_ORDER)

      // Lift the third topic above the second.
      await page.getByRole('button', { name: 'Move topic 3 up' }).click()
      await expect.poll(() => queue(page)).toEqual(
        ['Queue top', 'Queue bottom', 'Queue middle', 'Queue unvoted', 'Queue unvoted two'],
      )
      await expect(page.getByText('Queue · your order')).toBeVisible()

      // The cards nobody voted for rearrange among themselves too.
      await page.getByRole('button', { name: 'Move topic 5 up' }).click()
      await expect.poll(() => queue(page)).toEqual(
        ['Queue top', 'Queue bottom', 'Queue middle', 'Queue unvoted two', 'Queue unvoted'],
      )

      // The order is the board's, not this tab's.
      await page.reload()
      await expect.poll(() => queue(page)).toEqual(
        ['Queue top', 'Queue bottom', 'Queue middle', 'Queue unvoted two', 'Queue unvoted'],
      )

      await page.getByRole('button', { name: 'Reset order' }).click()
      await expect.poll(() => queue(page)).toEqual(VOTE_ORDER)
      await expect(page.getByText('Queue · by votes')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Reset order' })).toHaveCount(0)
    })

    test('cannot push a topic out of its half of the queue', async ({ page }) => {
      await openBoard(page, 'review')
      // The top of the ranking, and the last card nobody voted for.
      await expect(page.getByRole('button', { name: 'Move topic 1 up' })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Move topic 5 down' })).toBeDisabled()
      // The boundary between the two halves is closed from both sides.
      await expect(page.getByRole('button', { name: 'Move topic 3 down' })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Move topic 4 up' })).toBeDisabled()
    })

    test('a topic can be dragged to a new place in the queue', async ({ page }) => {
      await openBoard(page, 'drag-queue')
      expect(await queue(page)).toEqual(VOTE_ORDER)

      // Drag the third topic above the first.
      const handle = page.getByRole('button', { name: 'Drag to reorder topic 3' })
      const target = page.getByRole('button', { name: 'Drag to reorder topic 1' })
      const from = (await handle.boundingBox())!
      const to = (await target.boundingBox())!
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
      await page.mouse.down()
      // dnd-kit starts a drag after 8px; move in steps like a hand would.
      await page.mouse.move(from.x, from.y - 20, { steps: 5 })
      await page.mouse.move(to.x + to.width / 2, to.y - 4, { steps: 20 })
      await page.mouse.up()

      await expect.poll(() => queue(page)).toEqual(
        ['Queue bottom', 'Queue top', 'Queue middle', 'Queue unvoted', 'Queue unvoted two'],
      )
      await page.reload()
      await expect.poll(() => queue(page)).toEqual(
        ['Queue bottom', 'Queue top', 'Queue middle', 'Queue unvoted', 'Queue unvoted two'],
      )
    })

    test('a drag across the "Also raised" line is refused, and the card springs back', async ({ page }) => {
      await openBoard(page, 'drag-line')
      const handle = page.getByRole('button', { name: 'Drag to reorder topic 1' })
      const target = page.getByRole('button', { name: 'Drag to reorder topic 5' })
      const from = (await handle.boundingBox())!
      const to = (await target.boundingBox())!
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
      await page.mouse.down()
      await page.mouse.move(from.x, from.y + 20, { steps: 5 })
      await page.mouse.move(to.x + to.width / 2, to.y + 20, { steps: 20 })
      await page.mouse.up()

      await page.waitForTimeout(1000)
      expect(await queue(page)).toEqual(VOTE_ORDER)
      await expect(page.getByText('Queue · by votes')).toBeVisible()

      // …while a drag that stays inside the ranked half lands, on the same
      // page, so the refusal above cannot be the drag simply not working.
      const second = page.getByRole('button', { name: 'Drag to reorder topic 2' })
      const first = (await handle.boundingBox())!
      const legal = (await second.boundingBox())!
      await page.mouse.move(legal.x + legal.width / 2, legal.y + legal.height / 2)
      await page.mouse.down()
      await page.mouse.move(legal.x, legal.y - 20, { steps: 5 })
      await page.mouse.move(first.x + first.width / 2, first.y - 4, { steps: 20 })
      await page.mouse.up()
      await expect.poll(() => queue(page)).toEqual(
        ['Queue middle', 'Queue top', 'Queue bottom', 'Queue unvoted', 'Queue unvoted two'],
      )
    })
  })

  test('the order is the room\'s: everyone\'s queue moves together', async ({ browser }) => {
    const facilitator = await (await browser.newContext(as('fay'))).newPage()
    const participant = await (await browser.newContext(as('ana'))).newPage()
    await openBoard(facilitator, 'live')
    await openBoard(participant, 'live')
    expect(await queue(participant)).toEqual(VOTE_ORDER)

    await facilitator.getByRole('button', { name: 'Move topic 3 up' }).click()
    // No reload: the board tells everyone.
    await expect.poll(() => queue(participant), { timeout: 15_000 }).toEqual(
      ['Queue top', 'Queue bottom', 'Queue middle', 'Queue unvoted', 'Queue unvoted two'],
    )

    await facilitator.getByRole('button', { name: 'Reset order' }).click()
    await expect.poll(() => queue(participant), { timeout: 15_000 }).toEqual(VOTE_ORDER)
  })

  test.describe('as a participant', () => {
    test.use(as('ana'))

    test('sees the queue but cannot rearrange it', async ({ page }) => {
      await openBoard(page, 'review')
      expect(await queue(page)).toEqual(VOTE_ORDER)
      await expect(page.getByRole('button', { name: /^Move topic/ })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Reset order' })).toHaveCount(0)
    })
  })
})
