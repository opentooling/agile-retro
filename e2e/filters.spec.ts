import { test, expect, type Page } from '@playwright/test'
import { as } from './helpers'

/** The filter's fields are named by their labels: Team, Facilitator, Tag. */
const field = (page: Page, name: string) => page.getByRole('combobox', { name })

const suggestions = (page: Page, label: string) =>
  page.getByRole('listbox', { name: `${label} suggestions` })

test.describe('the history filter', () => {
  test.use(as('fay'))

  test('suggests the facilitators that are actually there', async ({ page }) => {
    await page.goto('/history')
    await field(page, 'Facilitator').click()
    await expect(suggestions(page, 'Facilitator')).toBeVisible()
    await expect(suggestions(page, 'Facilitator').getByRole('option', { name: 'fay' })).toBeVisible()

    // 'nobody' runs a board on a team fay cannot see, so it is not offered:
    // the suggestions would otherwise leak who runs a private team's boards.
    await expect(suggestions(page, 'Facilitator').getByRole('option', { name: 'nobody' })).toHaveCount(0)
  })

  test('narrows as you type, and choosing one filters the list', async ({ page }) => {
    await page.goto('/history')
    const tag = field(page, 'Tag')
    await tag.fill('e2')
    const option = suggestions(page, 'Tag').getByRole('option', { name: 'e2e' })
    await expect(option).toBeVisible()
    await option.click()

    await expect.poll(() => new URL(page.url()).searchParams.get('tag')).toBe('e2e')
    await expect(tag).toHaveValue('e2e')
    // The list it filters is still there, and the chosen tag is on the rows.
    await expect(page.getByRole('main').getByText('#e2e').first()).toBeVisible()
  })

  test('is reachable from the keyboard alone', async ({ page }) => {
    await page.goto('/history')
    const creator = field(page, 'Facilitator')
    await creator.click()
    // The suggestions load after the page does; arrow keys before then have
    // nothing to walk.
    await expect(suggestions(page, 'Facilitator').getByRole('option', { name: 'fay' })).toBeVisible()
    await creator.press('ArrowDown')
    await creator.press('Enter')
    await expect(creator).toHaveValue('fay')
    await expect.poll(() => new URL(page.url()).searchParams.get('creator')).toBe('fay')
  })

  test('suggests the teams fay can see, and only those', async ({ page }) => {
    await page.goto('/history')
    await field(page, 'Team').click()
    const list = suggestions(page, 'Team')
    await expect(list.getByRole('option', { name: 'E2E visible team' })).toBeVisible()
    // Paired with a team whose boards fay cannot open, so the absence below
    // cannot be the suggestions simply not working.
    await expect(list.getByRole('option', { name: 'E2E private team' })).toHaveCount(0)
  })

  test('still takes free text that matches nothing in the list', async ({ page }) => {
    await page.goto('/history')
    const creator = field(page, 'Facilitator')
    await creator.fill('zzz-nobody-by-this-name')
    await expect.poll(() => new URL(page.url()).searchParams.get('creator')).toBe('zzz-nobody-by-this-name')
    await expect(page.getByText('No retrospectives found matching your filters.')).toBeVisible()
  })
})
