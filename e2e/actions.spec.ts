import { test, expect } from '@playwright/test'
import { as, openBoard } from './helpers'

test.describe('actions — any participant', () => {
  test.use(as('amy'))

  test('edit an action during the Actions phase', async ({ page }) => {
    await openBoard(page, 'actions')
    await page.getByRole('button', { name: 'Edit action: Fix the flaky test' }).click()
    await page.getByRole('textbox', { name: 'Action', exact: true }).fill('Quarantine the flaky test')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Quarantine the flaky test')).toBeVisible()
    await page.reload()
    await expect(page.getByText('Quarantine the flaky test')).toBeVisible()
    await expect(page.getByText('Fix the flaky test')).toHaveCount(0)
  })

  test('delete an action, after confirming', async ({ page }) => {
    await openBoard(page, 'actions')
    await page.getByRole('button', { name: 'Delete action: Book the next retro' }).click()
    await page.getByRole('group', { name: 'Confirm deletion' }).getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText('Book the next retro')).toHaveCount(0)
    await page.reload()
    await expect(page.getByText('Book the next retro')).toHaveCount(0)
  })

  test('the list is fixed once the retro is closed', async ({ page }) => {
    await openBoard(page, 'closed')
    await page.getByRole('tab', { name: 'Actions' }).click()
    await expect(page.getByText('Archived action')).toBeVisible()
    await expect(page.getByRole('button', { name: /Edit action/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Delete action/ })).toHaveCount(0)
  })
})
