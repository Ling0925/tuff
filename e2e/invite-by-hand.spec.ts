import { test, expect, type Page } from '@playwright/test'
import { drawnWhole, login, PASSWORD, withoutMail } from './helpers.js'

/*
 * An invitation handed over by hand.
 *
 * Only against a server of one's own with no mail set up: that is the one
 * place the invitation answers with its link, and the service never does.
 * So it asks the server what the screens ask (`withoutMail`) and skips
 * itself anywhere else, saying so — the service's check among them. The
 * community edition's own check starts its server with no mail, and there
 * it runs with the rest.
 */
test.beforeEach(async () => {
  test.skip(!(await withoutMail()), 'needs a server of one’s own with no mail set up')
})

const me = (page: Page) =>
  page.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('session') ?? 'null') as { access_token?: string } | null
    const r = await fetch('/api/me', { headers: { authorization: `Bearer ${s?.access_token}`, 'x-api-version': '1' } })
    return ((await r.json()) as { workspace: { id: string } }).workspace.id
  })

test('without mail, an invitation’s link is copied, followed, and lands the person in the workspace, confirmed', async ({
  page,
  browser,
  context,
}) => {
  test.setTimeout(90_000)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await login(page)
  await expect(page.getByTestId('nav-members')).toBeVisible({ timeout: 20_000 })
  const workspace = await me(page)

  await page.getByTestId('nav-members').click()
  await page.getByTestId('members-add').click()
  const window = page.getByTestId('invite')
  await expect(window).toBeVisible()
  const to = `handed-${Date.now()}@example.com`
  await window.getByTestId('invite-emails').fill(to)

  /* The links arrive whole, with the answer that made them. */
  const heights = await drawnWhole(page, '[data-testid="invite-by-hand"]', () => page.getByTestId('invite-send').click())
  expect(heights.length).toBe(1)
  const handed = window.getByTestId('invite-by-hand')
  await expect(handed).toContainText('This server can’t send email')
  await expect(handed).toContainText('only with that email address')
  await expect(window.locator('[data-invite-sent]')).toHaveCount(0)

  const row = handed.locator(`[data-invite-by-hand="${to}"]`)
  await row.getByRole('button', { name: `Copy the link for ${to}` }).click()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(link).toMatch(/\/invite\/inv_/)
  await expect(row).toContainText(link)

  /* Somebody with no account, following it. */
  const stranger = await browser.newContext()
  const them = await stranger.newPage()
  await them.goto(new URL(link).pathname)
  await expect(them.getByText(/^Join /)).toBeVisible({ timeout: 15_000 })
  await expect(them.getByTestId('join-email')).toHaveValue(to)
  await them.getByTestId('join-name').fill('Hana Handed')
  await them.getByTestId('join-password').fill(PASSWORD)
  await them.getByTestId('join').click()
  await expect(them.getByTestId('nav-members').or(them.locator('aside')).first()).toBeVisible({ timeout: 20_000 })
  expect(await me(them)).toBe(workspace)
  await stranger.close()

  /* Confirmed: signing in again, from anywhere, works — no mail was ever sent. */
  const later = await browser.newContext()
  const again = await later.newPage()
  await again.goto('/signin')
  await again.getByPlaceholder('email').fill(to)
  await again.getByPlaceholder('password').fill(PASSWORD)
  await again.getByRole('button', { name: 'Sign in' }).click()
  await expect(again).not.toHaveURL(/\/signin/, { timeout: 20_000 })
  expect(await me(again)).toBe(workspace)
  await later.close()
})
