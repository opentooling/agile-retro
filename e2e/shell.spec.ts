import { test, expect } from '@playwright/test'
import { as } from './helpers'

test.describe('navigation and profile', () => {
  test.use(as('ana'))

  test('sign out and the theme switch are in plain sight', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
    const toDark = page.getByRole('button', { name: 'Dark mode' })
    await expect(toDark).toBeVisible()
    await toDark.click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.getByRole('button', { name: 'Light mode' }).click()
    await expect(page.locator('html')).not.toHaveClass(/dark/)
  })

  test('your name opens your profile', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: /View your profile/ }).click()
    await expect(page).toHaveURL(/\/profile$/)
    await expect(page.getByText('Only you can see this page')).toBeVisible()
    for (const label of ['Retros you ran', 'Retros you joined', 'Cards written', 'Stars given', 'Reactions']) {
      await expect(page.locator('dl').getByText(label, { exact: true })).toBeVisible()
    }
    // ana wrote cards on the seeded boards.
    await expect(page.getByRole('heading', { name: 'Your recent cards' })).toBeVisible()
  })
})
