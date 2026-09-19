import { test, expect } from '@playwright/test'
import { as, openBoard } from './helpers'

test.describe('the phase clock', () => {
  test('snoozing in overtime gives five minutes from now', async ({ browser }) => {
    const ctx = await browser.newContext(as('fay'))
    const page = await ctx.newPage()
    await openBoard(page, 'overtime')
    // Seeded 67 minutes into a 10-minute phase: well into overtime.
    await expect(page.getByText('Overtime', { exact: true })).toBeVisible()
    await expect(page.getByRole('timer')).toHaveText(/^-5\d:\d\d$/)

    await page.getByRole('button', { name: /Snooze 5 minutes/ }).click()
    await expect(page.getByRole('timer')).toHaveText(/^0[45]:\d\d$/)
    // Held by the server, not just the page.
    await page.reload()
    await expect(page.getByRole('timer')).toHaveText(/^0[45]:\d\d$/)
    await ctx.close()
  })

  test('only the facilitator is offered the snooze', async ({ browser }) => {
    const ctx = await browser.newContext(as('ana'))
    const page = await ctx.newPage()
    await openBoard(page, 'overtime')
    await expect(page.getByRole('timer')).toBeVisible()
    await expect(page.getByRole('button', { name: /Snooze/ })).toHaveCount(0)
    await ctx.close()
  })
})
