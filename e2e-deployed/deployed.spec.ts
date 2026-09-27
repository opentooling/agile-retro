/**
 * The deployed stack, tested the way people use it: the production image,
 * behind its Ingress, on PostgreSQL, signing in through a real Keycloak.
 *
 * Every test here covers something the main suite cannot, because the main
 * suite runs the dev server with sessions minted directly: the OIDC round
 * trip, the groups claim reaching the app's access checks, WebSockets through
 * the Ingress, and the database the chart wires up.
 */
import { test, expect } from '@playwright/test'
import { addCard, card, lane, openNewSession, signIn, step, unique } from './helpers'

test('the stack is up behind its Ingress', async ({ request }) => {
  for (const path of ['/api/health', '/api/ready']) {
    const res = await request.get(path)
    expect(res.status(), path).toBe(200)
  }
})

test('signing in goes to Keycloak and back, and signing out ends the session', async ({ browser }) => {
  const alice = await signIn(browser, 'alice')
  await expect(alice.page.getByRole('heading', { level: 1, name: /^Hello, / })).toBeVisible()

  // Sign-out is JavaScript (it ends the Keycloak session as well as ours), so
  // a click before the page hydrates is lost; wait until it is interactive.
  await alice.page.waitForLoadState('networkidle')
  await alice.page.getByRole('button', { name: 'Sign out' }).click()
  // Through Keycloak's logout endpoint and back to the app's sign-in page.
  await expect(alice.page).toHaveURL(/\/login/)
  const cookies = (await alice.page.context().cookies()).map((c) => c.name)
  expect(cookies, 'app session').not.toContain('authjs.session-token')
  expect(cookies, 'Keycloak SSO session').not.toContain('KEYCLOAK_IDENTITY')
  // The session is really gone, not just the page left.
  await alice.page.goto('/history')
  await expect(alice.page).toHaveURL(/\/login/)
  await alice.close()
})

/**
 * The check a work deployment most needs. Team access is decided from the
 * groups in the user's token; if the identity provider's mapper is missing or
 * named differently from GROUPS_CLAIM, every team board is refused to everyone
 * and nothing else looks wrong. Here the groups come from a real Keycloak,
 * through a real sign-in.
 */
test('groups from Keycloak decide who may open a team board', async ({ browser }) => {
  const teamName = unique('Platform')
  const title = unique('Platform retro')

  // alice is a global admin: she sets the team up and creates its board.
  const alice = await signIn(browser, 'alice')
  await test.step('an admin creates a team for the Platform group', async () => {
    await alice.page.goto('/teams')
    await expect(async () => {
      await alice.page.getByRole('button', { name: 'New team' }).click()
      await expect(alice.page.getByLabel('Name')).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 20_000 })
    await alice.page.getByLabel('Name').fill(teamName)
    const memberGroups = alice.page.getByRole('dialog').getByRole('textbox').nth(1)
    await memberGroups.fill('/Eng/Platform')
    await memberGroups.press('Enter')
    await alice.page.getByRole('button', { name: 'Create team' }).click()
    await expect(alice.page.getByText(teamName).first()).toBeVisible()
  })

  let boardUrl = ''
  await test.step('…and a board on that team', async () => {
    await openNewSession(alice.page)
    await alice.page.getByLabel('Title').fill(title)
    await alice.page.getByRole('dialog').getByRole('combobox').first().click()
    await alice.page.getByRole('option', { name: teamName }).click()
    await alice.page.getByRole('button', { name: 'Create and open' }).click()
    await expect(alice.page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    boardUrl = alice.page.url()
  })

  await test.step('bob, in /Eng/Platform, can open it', async () => {
    const bob = await signIn(browser, 'bob')
    await bob.page.goto(boardUrl)
    await expect(bob.page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    await bob.close()
  })

  await test.step('carol, in /Eng/Payments, is refused', async () => {
    const carol = await signIn(browser, 'carol')
    await carol.page.goto(boardUrl)
    await expect(carol.page.getByRole('heading', { name: "You don't have access to this board" })).toBeVisible()
    await carol.close()
  })

  await test.step('dave, in no group at all, is refused too', async () => {
    const dave = await signIn(browser, 'dave')
    await dave.page.goto(boardUrl)
    await expect(dave.page.getByRole('heading', { name: "You don't have access to this board" })).toBeVisible()
    await dave.close()
  })

  await alice.close()
})

/**
 * A whole retrospective with two people, over the deployed WebSocket and
 * database. Each step checks the *other* person's screen, so it is the live
 * connection through the Ingress being tested, not only the clicker's page.
 */
test('a retrospective runs start to finish on the deployed stack', async ({ browser }) => {
  const title = unique('Deployed journey')
  // Unique too: bob's profile lists every action ever assigned to him, and
  // the deployed database keeps them from one run to the next.
  const action = unique('Build a deploy dashboard')
  const alice = await signIn(browser, 'alice')
  const bob = await signIn(browser, 'bob')

  await test.step('alice creates an open board and bob joins from the link', async () => {
    await openNewSession(alice.page)
    await alice.page.getByLabel('Title').fill(title)
    await alice.page.getByRole('button', { name: 'Create and open' }).click()
    await expect(alice.page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    await bob.page.goto(alice.page.url())
    await expect(bob.page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  })

  await test.step('cards arrive live on the other screen', async () => {
    await addCard(bob.page, 'What went well', 'Pairing helped')
    await addCard(alice.page, "What didn't go well", 'Deploys were slow')
    await expect(lane(alice.page, 'What went well').getByText('Pairing helped')).toBeVisible()
    await expect(lane(bob.page, "What didn't go well").getByText('Deploys were slow')).toBeVisible()
  })

  await test.step('voting', async () => {
    await alice.page.getByRole('button', { name: 'Start voting' }).click()
    await expect(bob.page.getByText(step(2))).toBeVisible()
    await card(bob.page, 'Deploys were slow').getByRole('button', { name: 'Give 3 votes' }).click()
    await expect(card(bob.page, 'Deploys were slow').getByRole('button', { name: 'Reduce to 2 votes' })).toBeVisible()
  })

  await test.step('review: notes reach everyone', async () => {
    await alice.page.getByRole('button', { name: 'Start review' }).click()
    await expect(bob.page.getByText(step(3))).toBeVisible()
    await expect(alice.page.getByRole('region', { name: 'Now discussing' }).getByText('Deploys were slow')).toBeVisible()
    await alice.page.getByLabel('Discussion notes').fill('Add a deploy dashboard')
    await expect(bob.page.getByRole('region', { name: 'Now discussing' }).getByText('Add a deploy dashboard')).toBeVisible()
  })

  await test.step('an action for bob, then the retro closes', async () => {
    await alice.page.getByRole('button', { name: 'Start actions' }).click()
    await expect(bob.page.getByText(step(4))).toBeVisible()
    await alice.page.getByRole('textbox', { name: 'New action item' }).fill(action)
    await alice.page.getByRole('textbox', { name: 'Assignee' }).fill('bob')
    await alice.page.getByRole('button', { name: 'Add action' }).click()
    await expect(bob.page.getByText(action)).toBeVisible()

    await alice.page.getByRole('button', { name: 'Close retro' }).click()
    await expect(bob.page.getByRole('heading', { name: 'This retrospective is closed' })).toBeVisible()
  })

  await test.step('the action waits for bob where he looks for it', async () => {
    await bob.page.goto('/profile')
    await expect(bob.page.getByRole('region', { name: 'Assigned to you' }).getByText(action)).toBeVisible()
  })

  await alice.close()
  await bob.close()
})
