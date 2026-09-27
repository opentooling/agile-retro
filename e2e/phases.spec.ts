import { test, expect, type WebSocketRoute } from '@playwright/test'
import { as, openBoard } from './helpers'

/** Where the console says the board is. */
const step = (n: number) => new RegExp(`step ${n} of 4`)

test.describe('moving the board on', () => {
  test.use(as('fay'))

  test('the facilitator can start voting from overtime', async ({ page }) => {
    await openBoard(page, 'overtimeAdvance')
    await expect(page.getByText('Overtime', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Start voting' }).click()
    await expect(page.getByText(step(2))).toBeVisible()
    await page.reload()
    await expect(page.getByText(step(2))).toBeVisible()
  })

  test('…and still can after the live connection drops and comes back', async ({ page }) => {
    // A board left open long enough to run into overtime is exactly the page
    // that has lived through a dropped connection — a laptop lid, a proxy, a
    // redeploy. Cut the socket the way the network would and let it reconnect.
    const sockets: WebSocketRoute[] = []
    await page.routeWebSocket(/\/socket\.io\//, (ws) => {
      ws.connectToServer()
      sockets.push(ws)
    })
    // A new Engine.IO session starts with a polling handshake that carries no
    // session id — the reliable sign of a reconnect, whichever transport the
    // client settles on afterwards.
    let handshakes = 0
    page.on('request', (r) => {
      const url = r.url()
      if (url.includes('/socket.io/') && url.includes('transport=polling') && !url.includes('sid=')) handshakes++
    })

    await openBoard(page, 'overtimeReconnect')
    await expect(page.getByText('Overtime', { exact: true })).toBeVisible()
    await expect.poll(() => sockets.length).toBeGreaterThan(0)
    // Let the transport finish upgrading to WebSocket first. Cutting it during
    // the upgrade probe only makes the client stay on long-polling — no
    // disconnect, nothing to reconnect — which is not the failure being tested.
    await page.waitForTimeout(2000)
    const before = handshakes

    await sockets.at(-1)!.close()
    await expect.poll(() => handshakes, { timeout: 15_000 }).toBeGreaterThan(before) // reconnected
    // Let the new session settle before acting.
    await page.waitForTimeout(1500)

    await page.getByRole('button', { name: 'Start voting' }).click()
    await expect(page.getByText(step(2))).toBeVisible()
  })

  test('the clock follows the server, not a device whose own clock is wrong', async ({ page }) => {
    // Phase starts are stamped by the server, so a clock that disagrees lands
    // straight on the timer: this used to open a brand-new board hours into
    // overtime. Put this browser three hours ahead and the 10-minute phase
    // should still read as roughly ten minutes left.
    await page.addInitScript((skewMs) => {
      const Real = Date
      // `new Date()` and `Date.now()` run fast; everything else is the real
      // thing, so parsing the board's timestamps still works.
      function Skewed(...args: unknown[]) {
        // @ts-expect-error forwarding the real constructor's own overloads
        return args.length ? new Real(...args) : new Real(Real.now() + skewMs)
      }
      Skewed.now = () => Real.now() + skewMs
      Skewed.parse = Real.parse
      Skewed.UTC = Real.UTC
      Skewed.prototype = Real.prototype
      window.Date = Skewed as unknown as DateConstructor
    }, 3 * 60 * 60 * 1000)

    await openBoard(page, 'freshTimer')
    const clock = page.getByRole('timer')
    await expect(clock).toBeVisible()
    await expect(page.getByText('Overtime', { exact: true })).toHaveCount(0)
    await expect(clock).toHaveText(/^0[89]:[0-5][0-9]$/)
  })
})
