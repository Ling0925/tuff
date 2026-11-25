import { test, expect } from '@playwright/test'
import { add, login, make, NEEDS_MAIL, openProject, openSettings, withoutMail } from './helpers.js'

test('a webhook is turned off and on, sent only the events picked, tested, and deleted after asking', async ({ page }) => {
  await login(page)
  await openSettings(page)
  const url = `https://example.com/hook-${Date.now()}`
  await page.getByTestId('create-new-webhook').click()
  await page.getByTestId('draft-new-webhook').fill(url)
  await page.getByTestId('draft-new-webhook').press('Enter')
  await expect(page.getByTestId('webhook-secret')).toBeVisible({ timeout: 15_000 })
  const row = page.locator('[data-webhook]').filter({ hasText: url })
  await expect(row).toContainText('All events')

  // Only the events picked.
  await row.getByTestId('webhook-events').click()
  const picked = page.waitForResponse((r) => r.url().includes('/api/webhooks/') && r.request().method() === 'PATCH')
  await page.locator('[data-webhook-event="task.create"]').check()
  expect((await picked).status()).toBe(200)
  await page.keyboard.press('Escape')
  await expect(row).toContainText('1 event')

  // Off is off, and kept; on again.
  await row.getByTestId('disable-webhook').click()
  await expect(row.locator('[data-webhook-said]')).toContainText('Off')
  await page.reload()
  await expect(row.locator('[data-webhook-said]')).toContainText('Off', { timeout: 15_000 })
  await expect(row).toContainText('1 event')
  /* On is said at once and kept a moment later: the test is sent after the
     server has it on, or it answers that it is off. */
  const on = page.waitForResponse((r) => r.url().includes('/api/webhooks/') && r.request().method() === 'PATCH')
  await row.getByTestId('enable-webhook').click()
  expect((await on).status()).toBe(200)
  await expect(row.getByTestId('disable-webhook')).toBeVisible()

  // A test, through the queue.
  const tested = page.waitForResponse((r) => r.url().endsWith('/test') && r.request().method() === 'POST')
  await row.getByTestId('test-webhook').click()
  expect((await tested).status()).toBe(202)
  await expect(row.locator('[data-webhook-said]')).toContainText('Test sent')

  // Deleted, after asking.
  await row.getByTestId('delete-webhook').click()
  const asked = page.getByTestId('webhook-delete-dialog')
  await expect(asked).toContainText('To pause it instead, turn it off.')
  await asked.getByTestId('webhook-delete-go').click()
  await expect(row).toHaveCount(0)
  await page.reload()
  await expect(page.locator('[data-webhook]').first().or(page.getByText('Sends every change')).first()).toBeVisible({ timeout: 15_000 })
  await expect(row).toHaveCount(0)
})

/**
 * The small actions an audit found missing: each one a screen
 * already showed the thing and offered no way to change it.
 */

test('an agent is renamed on its page and given a new token there, shown once', async ({ page }) => {
  await login(page)
  await page.getByTestId('nav-members').click()
  await page.getByTestId('members-add').click()
  await page.getByTestId('add-tab-agents').click()
  const asked = page.getByTestId('agent-connect')
  const name = `Typo bot ${Date.now()}`
  await asked.getByTestId('agent-name').fill(name)
  await asked.locator('[data-agent-project]').filter({ hasText: 'Website' }).click()
  await asked.getByTestId('agent-connect-go').click()
  const first = (await page.getByTestId('agent-made').getByTestId('agent-token').innerText()).trim()
  await page.getByTestId('agent-made').getByRole('button', { name: 'Done' }).click()
  const open = page.locator('[data-agent-open]')
  await expect(open.getByTestId('agent-name')).toHaveValue(name, { timeout: 15_000 })

  // Renamed in place: Enter keeps it, and the list beside it says so.
  const renamed = `Release bot ${Date.now()}`
  const saved = page.waitForResponse((r) => /\/api\/agents\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH')
  await open.getByTestId('agent-name').fill(renamed)
  await open.getByTestId('agent-name').press('Enter')
  expect((await saved).status()).toBe(200)
  await expect(page.locator('[data-members-column] [data-agent]').filter({ hasText: renamed })).toHaveCount(1, { timeout: 15_000 })
  // Escape puts a half-typed one back.
  await open.getByTestId('agent-name').fill('Never mind')
  await open.getByTestId('agent-name').press('Escape')
  await expect(open.getByTestId('agent-name')).toHaveValue(renamed)

  // A new token: asked first, then shown once with its setup.
  await open.getByTestId('agent-new-token').click()
  const dialog = page.getByTestId('agent-new-token-dialog')
  await expect(dialog).toContainText('The old token stops working now')
  await dialog.getByTestId('agent-new-token-go').click()
  const next = (await dialog.getByTestId('agent-token').innerText()).trim()
  expect(next).toMatch(/^tok_/)
  expect(next).not.toBe(first)
  await expect(dialog.getByTestId('agent-mcp-setup')).toContainText(next)
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toHaveCount(0)

  // The old one is refused, the new one is let in.
  const answers = await page.evaluate(
    async ([a, b]) =>
      Promise.all(
        [a, b].map(
          async (t) =>
            (await fetch('/api/my/tasks?tab=assigned', { headers: { authorization: `Bearer ${t}`, 'x-api-version': '1' } })).status,
        ),
      ),
    [first, next] as const,
  )
  expect(answers).toEqual([401, 200])
})

/* By mail: a server with
   none hands the link over instead, and the next test is the half that
   holds there too. */
test('a pending invitation is sent again from its row', async ({ page }) => {
  test.skip(await withoutMail(), NEEDS_MAIL)
  await login(page)
  await page.getByTestId('nav-members').click()
  const stamp = Date.now()
  const to = `again-${stamp}@example.com`
  await page.getByTestId('members-add').click()
  const window = page.getByTestId('invite')
  await window.getByTestId('invite-emails').fill(to)
  await window.getByTestId('invite-emails').press('Enter')
  await page.getByTestId('invite-send').click()
  await expect(window.locator('[data-invite-sent]')).toBeVisible({ timeout: 15_000 })
  await window.getByRole('button', { name: 'Done' }).click()

  // To an address: sent again, and the row says the old link stopped.
  const out = page.locator('[data-invite]').filter({ hasText: to })
  await expect(out).toHaveCount(1, { timeout: 15_000 })
  await out.hover()
  await expect(out.getByTestId('resend-invite')).toHaveText('Resend')
  const resent = page.waitForResponse((r) => r.url().includes('/resend'))
  await out.getByTestId('resend-invite').click()
  expect((await resent).status()).toBe(200)
  await expect(out.locator('[data-invite-said]')).toHaveText('Sent again. The old link no longer works.')
  await expect(out).toHaveCount(1)
})

test('an invitation by link is copied new from its row, and the old one stops', async ({ page }) => {
  await login(page)
  await page.getByTestId('nav-members').click()
  // With no address: a new link, copied, the old one stopped.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByTestId('members-add').click()
  await page.getByTestId('invite-link').click()
  await expect(page.getByText('Works once and expires.')).toBeVisible({ timeout: 15_000 })
  await page.keyboard.press('Escape')
  const link = page.locator('[data-invite]').filter({ hasText: 'Anyone with the link' }).first()
  await link.hover()
  await expect(link.getByTestId('resend-invite')).toHaveText('Copy new link')
  const copied = page.waitForResponse((r) => r.url().includes('/resend'))
  await link.getByTestId('resend-invite').click()
  const made = (await (await copied).json()) as { token: string }
  expect(made.token).toMatch(/^inv_/)
  await expect(page.locator('[data-invite-said]').filter({ hasText: 'New link copied. The old one no longer works.' })).toHaveCount(1)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`/invite/${made.token}`)
})

/* `docs/specs/docs.md`, "A link's address". */
test('a link’s address is changed on its own screen, and stays', async ({ page }) => {
  await login(page)
  await openProject(page, 'Website')
  await page.getByTestId('tool-files').click()
  await expect(page.getByTestId('docs-add')).toBeVisible({ timeout: 15_000 })
  const n = Date.now() % 1_000_000
  const named = `Moved link ${n}`
  await page.getByTestId('docs-add').click()
  await page.getByTestId('create-add-link').click()
  await page.getByTestId('draft-add-link').fill(`https://example.com/old/${n}`)
  await page.getByTestId('draft-link-name').fill(named)
  await page.getByTestId('make-link').click()
  const row = page.locator('[data-file]').filter({ hasText: named })
  await expect(row.getByTestId('file-row-menu')).toBeVisible({ timeout: 15_000 })
  // Its own screen, from the row's menu: pressing the row opens the place it goes.
  await row.hover()
  await row.getByTestId('file-row-menu').click()
  await page.getByTestId('edit-link-row').click()
  await expect(page.getByTestId('link-address')).toHaveText(`https://example.com/old/${n}`, { timeout: 15_000 })

  // Not an address that is not one.
  await page.getByTestId('change-link').click()
  await page.getByTestId('link-address-field').fill('ftp://example.com/x')
  await page.getByTestId('link-address-field').press('Enter')
  await expect(page.getByRole('alert')).toHaveText('Use an address that starts with http:// or https://.')
  // Escape puts it back.
  await page.getByTestId('link-address-field').press('Escape')
  await expect(page.getByTestId('link-address')).toHaveText(`https://example.com/old/${n}`)

  const saved = page.waitForResponse((r) => /\/api\/files\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH')
  await page.getByTestId('change-link').click()
  await page.getByTestId('link-address-field').fill(`https://example.com/new/${n}`)
  await page.getByTestId('link-address-field').press('Enter')
  await expect(page.getByTestId('link-address')).toHaveText(`https://example.com/new/${n}`)
  expect((await saved).status()).toBe(200)
  await expect(page.getByTestId('link-address')).toHaveAttribute('href', `https://example.com/new/${n}`)

  await page.reload()
  await expect(page.getByTestId('link-address')).toHaveText(`https://example.com/new/${n}`, { timeout: 15_000 })
})

test('an hour logged on a task is changed where it is read: how long, the note, and it stays', async ({ page }) => {
  await login(page)
  const stamp = Date.now()
  await add(page, 'new-project', `Changed hours ${stamp}`)
  await openProject(page, `Changed hours ${stamp}`)
  await page.getByTestId('tool-tasks').click()
  await make(page, page.getByTestId('create-new-task'), `Timed again ${stamp}`)
  await page.locator('[data-task]').first().click()
  await expect(page.getByTestId('task-title')).toHaveValue(`Timed again ${stamp}`, { timeout: 15_000 })
  await page.getByTestId('open-time').click()
  const time = page.getByTestId('task-time')

  const logged = page.waitForResponse((r) => r.url().endsWith('/api/time') && r.request().method() === 'POST')
  await page.getByTestId('log-time').click()
  await page.locator('[data-how-long]').filter({ hasText: '15m' }).first().click()
  await logged
  await expect(page.getByTestId('time-total')).toHaveText('15m', { timeout: 15_000 })
  await time.getByTestId('time-person').first().click()

  // Another length, from the same menu.
  const changed = page.waitForResponse((r) => r.url().includes('/api/time/') && r.request().method() === 'PATCH')
  await time.getByTestId('change-time').click()
  await page.locator('[data-how-long]').filter({ hasText: '1h 30m' }).first().click()
  await expect(page.getByTestId('time-total')).toHaveText('1h 30m')
  expect((await changed).status()).toBe(200)

  // A note, typed where it is read.
  const noted = page.waitForResponse((r) => r.url().includes('/api/time/') && r.request().method() === 'PATCH')
  await time.getByTestId('time-note').fill('the review')
  await time.getByTestId('time-note').press('Enter')
  expect((await noted).status()).toBe(200)

  await page.reload()
  await expect(page.getByTestId('time-total')).toHaveText('1h 30m', { timeout: 15_000 })
  await page.getByTestId('task-time').getByTestId('time-person').first().click()
  await expect(page.getByTestId('task-time').getByTestId('time-note')).toHaveValue('the review')
})
