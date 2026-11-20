import { test, expect, type Page } from '@playwright/test'
import { add, login, make, openProject, settleThenReload } from './helpers.js'

/**
 * Every deletion has an Undo. A task from its own
 * screen, an announcement, a comment and a channel: gone at once, offered
 * back in the toast at the foot, and back on the server after Undo, not
 * only on the screen.
 */

const toast = (page: Page) => page.locator('[data-undo-toast]')

test('a task deleted from its own screen comes back from the toast', async ({ page }) => {
  await login(page)
  const stamp = Date.now()
  await add(page, 'new-project', `Undone ${stamp}`)
  await openProject(page, `Undone ${stamp}`)
  await page.getByTestId('tool-tasks').click()
  await make(page, page.getByTestId('create-new-task'), `Slip ${stamp}`)
  const row = page.locator('[data-open-task]').filter({ hasText: `Slip ${stamp}` })
  await row.first().click()
  await expect(page.getByTestId('task-title')).toHaveValue(`Slip ${stamp}`, { timeout: 15_000 })

  await page.getByTestId('task-menu').click()
  const deleted = page.waitForResponse((r) => /\/api\/tasks\/[^/]+$/.test(r.url()) && r.request().method() === 'DELETE')
  await page.getByTestId('delete-task').click()
  /* Back on the list, which does not have it, with the way back at the foot. */
  await expect(page.getByTestId('task-title')).toHaveCount(0, { timeout: 5_000 })
  await expect(row).toHaveCount(0)
  await expect(toast(page)).toContainText(`Slip ${stamp}`, { timeout: 5_000 })
  expect((await deleted).status()).toBe(200)

  const restored = page.waitForResponse((r) => r.url().includes('/restore') && r.request().method() === 'POST')
  await page.getByTestId('undo-delete').click()
  expect((await restored).status()).toBe(200)
  await expect(row).toHaveCount(1, { timeout: 15_000 })
  await expect(toast(page)).toHaveCount(0)

  await settleThenReload(page, '/api/tasks/')
  await expect(page.locator('[data-open-task]').filter({ hasText: `Slip ${stamp}` })).toHaveCount(1, { timeout: 15_000 })
})

test('an announcement deleted comes back on ⌘Z', async ({ page }) => {
  await login(page)
  await openProject(page, 'Onboarding')
  await page.getByTestId('tool-posts').click()

  /* One of the owner's own, made through the same API the screen uses. */
  const title = `Kick-off moved ${Date.now()}`
  const made = await page.evaluate(async (title) => {
    const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
    const h = { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1', 'content-type': 'application/json' }
    const projects = (await (await fetch('/api/projects', { headers: h })).json()) as { projects: { id: string; name: string }[] }
    const p = projects.projects.find((x) => x.name === 'Onboarding')!
    const said = await fetch(`/api/projects/${p.id}/posts`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({
        title,
        body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Thursday now.' }] }] },
      }),
    })
    return said.status
  }, title)
  expect(made).toBe(201)
  await page.reload()

  const row = page.locator('[data-open-post]').filter({ hasText: title })
  await row.first().click()
  await expect(page.getByTestId('post-title')).toHaveValue(title, { timeout: 15_000 })
  await page.getByTestId('post-menu').click()
  const deleted = page.waitForResponse((r) => /\/api\/posts\/[^/]+$/.test(r.url()) && r.request().method() === 'DELETE')
  /* One's own goes on one press: Undo is the way back, not a question. */
  await page.getByTestId('delete-post').click()
  await expect(page.getByTestId('post-title')).toHaveCount(0, { timeout: 5_000 })
  await expect(row).toHaveCount(0, { timeout: 5_000 })
  await expect(toast(page)).toContainText(title)
  expect((await deleted).status()).toBe(200)

  /* The key, with the pointer nowhere in particular. */
  const restored = page.waitForResponse((r) => r.url().includes('/restore') && r.request().method() === 'POST')
  await page.locator('body').press('ControlOrMeta+z')
  expect((await restored).status()).toBe(200)
  await expect(row).toHaveCount(1, { timeout: 15_000 })
  await expect(toast(page)).toHaveCount(0)

  await page.reload()
  await expect(page.locator('[data-open-post]').filter({ hasText: title })).toHaveCount(1, { timeout: 15_000 })
})

test('a comment deleted comes back where it was', async ({ page }) => {
  await login(page)
  const stamp = Date.now()
  await add(page, 'new-project', `Talked ${stamp}`)
  await openProject(page, `Talked ${stamp}`)
  await page.getByTestId('tool-tasks').click()
  await make(page, page.getByTestId('create-new-task'), `Thread ${stamp}`)
  await page.locator('[data-task]').first().click()
  await expect(page.getByTestId('task-title')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('new-comment').fill(`Said too soon ${stamp}`)
  await page.getByTestId('new-comment').press('Enter')
  const said = page.locator('[data-comment]').filter({ hasText: `Said too soon ${stamp}` })
  await expect(said).toHaveCount(1, { timeout: 15_000 })
  /* Its real id, not the one the screen drew it with before the answer. */
  await expect(said.getByTestId('comment-menu')).toBeVisible({ timeout: 15_000 })

  await said.hover()
  await said.getByTestId('comment-menu').click()
  const deleted = page.waitForResponse((r) => /\/api\/comments\/[^/]+$/.test(r.url()) && r.request().method() === 'DELETE')
  await page.getByTestId('delete-comment').click()
  await expect(said).toHaveCount(0, { timeout: 5_000 })
  await expect(toast(page)).toContainText('Comment deleted')
  expect((await deleted).status()).toBe(200)

  const restored = page.waitForResponse((r) => r.url().includes('/restore') && r.request().method() === 'POST')
  await page.getByTestId('undo-delete').click()
  expect((await restored).status()).toBe(200)
  await expect(said).toHaveCount(1, { timeout: 15_000 })

  await page.reload()
  await expect(page.getByTestId('task-title')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-comment]').filter({ hasText: `Said too soon ${stamp}` })).toHaveCount(1, {
    timeout: 15_000,
  })
})

test('a channel is asked about first, and comes back from the toast', async ({ page }) => {
  await login(page)
  await openProject(page, 'Acme rebrand')
  await page.getByTestId('tool-messages').click()
  await expect(page.getByLabel('Message')).toBeVisible({ timeout: 30_000 })

  await page.getByTestId('create-new-channel').click()
  const name = `second-thoughts-${Date.now()}`
  await page.getByTestId('draft-new-channel').fill(name)
  await page.getByTestId('make-channel').click()
  const tab = page.locator('[data-pick]').filter({ hasText: name })
  await expect(tab).toBeVisible({ timeout: 15_000 })
  await tab.click()

  await page.getByTestId('room-settings').click()
  await page.getByTestId('delete-channel').click()
  /* It says what goes, and nothing has gone yet. */
  await expect(page.getByTestId('delete-channel-ask')).toContainText(`${name} for everyone`)
  await expect(page.getByTestId('delete-channel-ask')).toContainText('messages go with it')
  await expect(tab).toHaveCount(1)
  const deleted = page.waitForResponse((r) => /\/api\/conversations\/[^/]+$/.test(r.url()) && r.request().method() === 'DELETE')
  await page.getByTestId('delete-channel-confirm').click()
  expect((await deleted).status()).toBe(200)
  await expect(toast(page)).toContainText(name, { timeout: 5_000 })
  await expect(page.locator('[data-pick]').filter({ hasText: name })).toHaveCount(0, { timeout: 15_000 })

  const restored = page.waitForResponse((r) => r.url().includes('/restore') && r.request().method() === 'POST')
  await page.getByTestId('undo-delete').click()
  expect((await restored).status()).toBe(200)
  await expect(toast(page)).toHaveCount(0)

  /* Back on the server, where the room's list is read from. */
  await page.reload()
  await expect(page.getByLabel('Message')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-pick]').filter({ hasText: name })).toHaveCount(1, { timeout: 15_000 })
})
