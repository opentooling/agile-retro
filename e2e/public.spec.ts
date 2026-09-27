import { test, expect } from '@playwright/test'

test.describe('before signing in', () => {
  test('help is readable', async ({ page }) => {
    const res = await page.goto('/help')
    expect(res?.status()).toBe(200)
    await expect(page).toHaveURL(/\/help$/)
    await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible()
  })

  // kubelet has no session: the probes must answer without one, and must say
  // nothing beyond whether the pod is up — they are reachable by anyone who
  // can reach the port.
  test('the health and readiness probes answer without a session', async ({ request }) => {
    for (const path of ['/api/health', '/api/ready']) {
      const res = await request.get(path, { maxRedirects: 0 })
      expect(res.status(), path).toBe(200)
      expect(await res.json(), path).toEqual({ status: 'ok' })
    }
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
