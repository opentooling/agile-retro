import { test, expect } from '@playwright/test'
import { as, openBoard, lane, cardsIn } from './helpers'

test.describe('cards during Input — as their author', () => {
  test.use(as('ana'))

  test('move a card to another section from its menu', async ({ page }) => {
    await openBoard(page, 'move')
    await page.getByRole('button', { name: 'Card options: Ana first' }).click()
    await page.getByRole('menuitem', { name: 'What should be improved' }).click()
    await expect(lane(page, 'What should be improved').getByText('Ana first')).toBeVisible()
    await page.reload()
    await expect.poll(() => cardsIn(page, 'What should be improved')).toEqual(['Ana first'])
    await expect.poll(() => cardsIn(page, 'What went well')).not.toContain('Ana first')
  })

  test('reorder within a section', async ({ page }) => {
    await openBoard(page, 'reorder')
    await page.getByRole('button', { name: 'Card options: Ana second' }).click()
    await page.getByRole('menuitem', { name: 'Move up' }).click()
    await expect.poll(() => cardsIn(page, 'What went well')).toEqual(['Ana second', 'Ana first', 'Amy card'])
    await page.reload()
    await expect.poll(() => cardsIn(page, 'What went well')).toEqual(['Ana second', 'Ana first', 'Amy card'])
  })

  test('drag a card by its handle into an empty section', async ({ page }) => {
    await openBoard(page, 'drag')
    const handle = page.getByRole('button', { name: 'Drag to move: Ana first' })
    const target = lane(page, "What didn't go well")
    const from = (await handle.boundingBox())!
    const to = (await target.boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    // dnd-kit starts a drag after 8px of movement; move in steps like a hand would.
    await page.mouse.move(from.x + 30, from.y + 30, { steps: 5 })
    await page.mouse.move(to.x + to.width / 2, to.y + 120, { steps: 20 })
    await page.mouse.up()
    await expect(target.getByText('Ana first')).toBeVisible()
    await page.reload()
    await expect.poll(() => cardsIn(page, "What didn't go well")).toEqual(['Ana first'])
  })

  test('delete asks first, then the card is gone for good', async ({ page }) => {
    await openBoard(page, 'remove')
    await page.getByRole('button', { name: 'Card options: Ana first' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete this card?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Keep it' }).click()
    await expect(page.getByText('Ana first')).toBeVisible()

    await page.getByRole('button', { name: 'Card options: Ana first' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Delete card' }).click()
    await expect(page.getByText('Ana first')).toHaveCount(0)
    await page.reload()
    await expect.poll(() => cardsIn(page, 'What went well')).toEqual(['Ana second', 'Amy card'])
  })

  test("only your own cards offer moving and deleting", async ({ page }) => {
    await openBoard(page, 'permissions')
    await expect(page.getByRole('button', { name: 'Card options: Ana first' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Card options: Amy card' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Drag to move: Amy card' })).toHaveCount(0)
  })

  test('nothing moves once voting has started', async ({ page }) => {
    await openBoard(page, 'voting')
    await expect(page.getByText('Ana first')).toBeVisible()
    await expect(page.getByRole('button', { name: /Card options/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Drag to move/ })).toHaveCount(0)
  })
})

test('a new card appears for everyone on the board, live', async ({ browser }) => {
  const ana = await browser.newContext(as('ana'))
  const amy = await browser.newContext(as('amy'))
  const [anaPage, amyPage] = [await ana.newPage(), await amy.newPage()]
  await openBoard(anaPage, 'realtime')
  await openBoard(amyPage, 'realtime')

  const text = `Seen by everyone ${Date.now()}`
  const composer = lane(anaPage, 'What went well').getByRole('textbox')
  await composer.fill(text)
  await composer.press('Enter')
  // First prove the card was added at all, so a failure below means the
  // broadcast, not the composer.
  await expect(lane(anaPage, 'What went well').getByText(text)).toBeVisible()

  await expect(lane(amyPage, 'What went well').getByText(text)).toBeVisible()
  await ana.close()
  await amy.close()
})
