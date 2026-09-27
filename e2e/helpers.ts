import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'

type Seed = { boards: Record<string, string> }
/** Read lazily: the file is written by global setup, after modules load. */
export const board = (key: string) => (JSON.parse(readFileSync('e2e/.data/seed.json', 'utf8')) as Seed).boards[key]

/** Sign in as one of the seeded users. */
export const as = (who: 'fay' | 'ana' | 'amy') => ({ storageState: `e2e/.data/${who}.json` })

export async function openBoard(page: Page, key: string) {
  await page.goto(`/retro/${board(key)}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

/** One of the board's columns. */
export const lane = (page: Page, title: string) => page.getByRole('region', { name: title })

/** Card texts in a lane, top to bottom. */
export async function cardsIn(page: Page, title: string) {
  return (await lane(page, title).locator('article').allInnerTexts()).map((t) => t.split('\n')[0].trim())
}
