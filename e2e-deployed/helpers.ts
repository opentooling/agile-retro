import { expect, type Browser, type Page } from '@playwright/test'
import { demoUser, type DemoUser } from './users'

/**
 * Sign in the way a person does: the app's login page, over to Keycloak, the
 * username and password, and back again. Each user gets a browser context of
 * their own, so their cookies never mix.
 */
export async function signIn(browser: Browser, username: Parameters<typeof demoUser>[0]) {
  const user = demoUser(username)
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/login')
  await page.getByRole('button', { name: /Continue with Keycloak/ }).click()

  // Keycloak's own login form, on the issuer's host.
  await expect(page).toHaveURL(/\/realms\/retro\/protocol\/openid-connect\/auth/)
  await page.locator('#username').fill(user.username)
  await page.locator('#password').fill(user.password)
  await page.locator('#kc-login').click()

  // Back on the app, signed in.
  await expect(page).not.toHaveURL(/\/realms\//)
  await expect(page).not.toHaveURL(/\/login/)
  return { user, page, close: () => context.close() }
}

export type SignedIn = { user: DemoUser; page: Page; close: () => Promise<void> }

/** Open the New session dialog, waiting out hydration (a click before it is lost). */
export async function openNewSession(page: Page) {
  await page.goto('/')
  await expect(async () => {
    await page.getByRole('button', { name: 'New session' }).first().click()
    await expect(page.getByLabel('Title')).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 20_000 })
}

export const step = (n: number) => new RegExp(`step ${n} of 4`)
export const lane = (page: Page, title: string) => page.getByRole('region', { name: title })
export const card = (page: Page, text: string) => page.locator('article').filter({ hasText: text })

export async function addCard(page: Page, column: string, text: string) {
  const composer = lane(page, column).getByRole('textbox')
  await composer.fill(text)
  await composer.press('Enter')
}

/** Unique per run: the deployed database outlives every run of the suite. */
export const unique = (label: string) => `${label} ${Date.now().toString(36)}`
