/**
 * A whole retrospective, start to finish, as two people would run it: a
 * facilitator and a participant in separate browsers.
 *
 * This is the "basic functionality" test. If it passes, the app does its job:
 * a board can be created, filled in together live, voted on, discussed, turned
 * into actions, closed — and those actions show up afterwards where people look
 * for them. Each step checks the *other* person's screen too, so it is the live
 * connection being tested, not just the clicker's own page.
 */
import { test, expect, type Page } from '@playwright/test'
import { as } from './helpers'

const step = (n: number) => new RegExp(`step ${n} of 4`)
const lane = (page: Page, title: string) => page.getByRole('region', { name: title })
const card = (page: Page, text: string) => page.locator('article').filter({ hasText: text })

async function addCard(page: Page, column: string, text: string) {
  const composer = lane(page, column).getByRole('textbox')
  await composer.fill(text)
  await composer.press('Enter')
}

test('a retrospective from start to finish', async ({ browser }) => {
  test.setTimeout(180_000)
  const title = `Journey ${Date.now()}`
  const fayCtx = await browser.newContext(as('fay'))
  const anaCtx = await browser.newContext(as('ana'))
  const fay = await fayCtx.newPage()
  const ana = await anaCtx.newPage()

  await test.step('the facilitator creates a board', async () => {
    await fay.goto('/')
    // The button renders before React hydrates; a click before then does
    // nothing, so keep clicking until the dialog is really open.
    await expect(async () => {
      await fay.getByRole('button', { name: 'New session' }).first().click()
      await expect(fay.getByLabel('Title')).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 15_000 })
    await fay.getByLabel('Title').fill(title)
    await fay.getByRole('button', { name: 'Create and open' }).click()
    await expect(fay).toHaveURL(/\/retro\//)
    await expect(fay.getByRole('heading', { level: 1, name: title })).toBeVisible()
    await expect(fay.getByText(step(1))).toBeVisible()
  })

  await test.step('a participant joins from the link', async () => {
    await ana.goto(fay.url())
    await expect(ana.getByRole('heading', { level: 1, name: title })).toBeVisible()
  })

  await test.step('both add cards, and each sees the other\'s live', async () => {
    await addCard(ana, 'What went well', 'Pairing helped')
    await addCard(fay, "What didn't go well", 'Deploys were slow')
    await expect(lane(fay, 'What went well').getByText('Pairing helped')).toBeVisible()
    await expect(lane(ana, "What didn't go well").getByText('Deploys were slow')).toBeVisible()
  })

  await test.step('voting', async () => {
    await fay.getByRole('button', { name: 'Start voting' }).click()
    await expect(fay.getByText(step(2))).toBeVisible()
    await expect(ana.getByText(step(2))).toBeVisible()

    await card(ana, 'Deploys were slow').getByRole('button', { name: 'Give 3 votes' }).click()
    // The star you're on now offers to step back down — the vote landed.
    await expect(card(ana, 'Deploys were slow').getByRole('button', { name: 'Reduce to 2 votes' })).toBeVisible()
  })

  await test.step('review: the top card is discussed, and notes reach everyone', async () => {
    await fay.getByRole('button', { name: 'Start review' }).click()
    await expect(ana.getByText(step(3))).toBeVisible()
    const spotlight = fay.getByRole('region', { name: 'Now discussing' })
    await expect(spotlight.getByText('Deploys were slow')).toBeVisible()

    await fay.getByLabel('Discussion notes').fill('Add a deploy dashboard')
    // Ana can't edit someone else's card, so the notes reach her as text.
    await expect(ana.getByRole('region', { name: 'Now discussing' }).getByText('Add a deploy dashboard'))
      .toBeVisible({ timeout: 15_000 })
  })

  await test.step('actions', async () => {
    await fay.getByRole('button', { name: 'Start actions' }).click()
    await expect(ana.getByText(step(4))).toBeVisible()
    await fay.getByRole('textbox', { name: 'New action item' }).fill('Build a deploy dashboard')
    await fay.getByRole('textbox', { name: 'Assignee' }).fill('ana')
    await fay.getByRole('button', { name: 'Add action' }).click()
    await expect(ana.getByText('Build a deploy dashboard')).toBeVisible()
  })

  await test.step('closing leaves a readable record', async () => {
    await fay.getByRole('button', { name: 'Close retro' }).click()
    await expect(ana.getByRole('heading', { name: 'This retrospective is closed' })).toBeVisible()
    await ana.getByRole('tab', { name: 'Actions' }).click()
    await expect(ana.getByText('Build a deploy dashboard')).toBeVisible()
  })

  await test.step('afterwards, the action is where people look for it', async () => {
    await ana.goto('/actions')
    await expect(ana.getByText('Build a deploy dashboard')).toBeVisible()
    await ana.goto('/profile')
    await expect(ana.getByRole('region', { name: 'Assigned to you' }).getByText('Build a deploy dashboard')).toBeVisible()
    await fay.goto('/')
    await expect(fay.getByText(title).first()).toBeVisible()
  })

  await fayCtx.close()
  await anaCtx.close()
})
