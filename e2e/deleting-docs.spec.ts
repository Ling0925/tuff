import { test, expect } from '@playwright/test'
import { login, openProject, settleThenReload } from './helpers.js'

/**
 * Deleting what is in Docs, and taking it back.
 * Gone at once, with Undo in the toast and on ⌘Z, as a task is.
 */
test('a document deleted from its own screen comes back from the toast', async ({ page }) => {
  await login(page)
  await openProject(page, 'Website')
  await page.getByTestId('tool-files').click()
  await expect(page.getByTestId('docs-add')).toBeVisible({ timeout: 15_000 })

  /* A document of its own, named so it can be found. */
  const title = `Draft to bin ${Date.now()}`
  await page.getByTestId('docs-add').click()
  await page.getByTestId('create-new-document').click()
  const name = page.getByTestId('file-name')
  await expect(name).toBeVisible({ timeout: 15_000 })
  const renamed = page.waitForResponse((r) => r.url().includes('/api/files/') && r.request().method() === 'PATCH')
  await name.fill(title)
  await name.evaluate((el) => (el as HTMLElement).blur())
  await renamed

  /* Its ⋯ says what it will do, in red, last. */
  await page.getByTestId('file-menu').click()
  const deleted = page.waitForResponse((r) => /\/api\/files\/[^/]+$/.test(r.url()) && r.request().method() === 'DELETE')
  await page.getByTestId('delete-file').click()

  /* Back on the list, which does not have it, with the way back at the foot. */
  const row = page.locator('[data-file]').filter({ hasText: title })
  await expect(page.getByTestId('file-name')).toHaveCount(0, { timeout: 5_000 })
  await expect(row).toHaveCount(0)
  await expect(page.locator('[data-undo-toast]')).toContainText(title, { timeout: 5_000 })
  expect((await deleted).status()).toBe(200)

  const restored = page.waitForResponse((r) => r.url().includes('/restore') && r.request().method() === 'POST')
  await page.getByTestId('undo-delete').click()
  expect((await restored).status()).toBe(200)
  await expect(row).toHaveCount(1, { timeout: 15_000 })
  await expect(page.locator('[data-undo-toast]')).toHaveCount(0)

  /* And it is back on the server, not only on the screen. */
  await settleThenReload(page, '/api/files/')
  await expect(page.locator('[data-file]').filter({ hasText: title })).toHaveCount(1, { timeout: 15_000 })
})

test('a link deleted from its row comes back on ⌘Z', async ({ page }) => {
  await login(page)
  await openProject(page, 'Website')
  await page.getByTestId('tool-files').click()
  await expect(page.getByTestId('docs-add')).toBeVisible({ timeout: 15_000 })

  const n = Date.now() % 1_000_000
  const named = `Link to bin ${n}`
  await page.getByTestId('docs-add').click()
  await page.getByTestId('create-add-link').click()
  await page.getByTestId('draft-add-link').fill(`https://example.com/bin/${n}`)
  await page.getByTestId('draft-link-name').fill(named)
  await page.getByTestId('make-link').click()
  const row = page.locator('[data-file]').filter({ hasText: named })
  await expect(row).toHaveCount(1, { timeout: 15_000 })
  /* Its real id, not the one the screen drew it with before the answer. */
  await expect(row.getByTestId('file-row-menu')).toBeVisible({ timeout: 15_000 })

  await row.hover()
  await row.getByTestId('file-row-menu').click()
  const deleted = page.waitForResponse((r) => /\/api\/files\/[^/]+$/.test(r.url()) && r.request().method() === 'DELETE')
  await page.getByTestId('delete-file-row').click()
  await expect(row).toHaveCount(0, { timeout: 5_000 })
  await expect(page.locator('[data-undo-toast]')).toContainText(named)
  expect((await deleted).status()).toBe(200)

  /* The key, with the pointer nowhere in particular. */
  const restored = page.waitForResponse((r) => r.url().includes('/restore') && r.request().method() === 'POST')
  await page.locator('body').press('ControlOrMeta+z')
  expect((await restored).status()).toBe(200)
  await expect(row).toHaveCount(1, { timeout: 15_000 })
})
