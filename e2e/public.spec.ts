import { test, expect } from '@playwright/test'

test.describe('before signing in', () => {
  test('help is readable', async ({ page }) => {
    const res = await page.goto('/help')
    expect(res?.status()).toBe(200)
    await expect(page).toHaveURL(/\/help$/)
    await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible()
  })

  test('everything else still asks you to sign in', async ({ page }) => {
    for (const path of ['/', '/profile', '/actions', '/history']) {
      await page.goto(path)
      await expect(page, `${path} should redirect`).toHaveURL(/\/login/)
    }
  })

  test('the sign-in page links to help', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('link', { name: /How it works/ }).click()
    await expect(page).toHaveURL(/\/help$/)
  })
})
