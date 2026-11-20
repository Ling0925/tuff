import { test, expect, type Page } from '@playwright/test'
import { add, docKept, drawnWhole, login, openProject, storedDoc } from './helpers.js'

/**
 * A document's versions. Opened from the
 * document's ⋯, drawn whole, an earlier one read and put back: the words
 * change in place and the history keeps going.
 */

/** A body written through the API, as an agent would — a version of its own. */
async function writeThrough(page: Page, text: string) {
  const { id } = await storedDoc(page)
  const status = await page.evaluate(
    async ([fileId, words]) => {
      const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
      const r = await fetch(`/api/files/${fileId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-api-version': '1', authorization: `Bearer ${s.access_token}` },
        body: JSON.stringify({ body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: words }] }] } }),
      })
      return r.status
    },
    [id, text] as const,
  )
  expect(status).toBe(200)
}

test('an earlier version is read in the history and restored into the open document', async ({ page }) => {
  test.setTimeout(90_000)
  await login(page)
  await openProject(page, 'Website')
  await page.getByTestId('tool-files').click()
  const name = `Versions ${Date.now()}`
  await add(page, 'new-document', name)
  await page.locator('[data-file]').filter({ hasText: name }).first().locator('[data-open-file]').click()
  await expect(page.getByTestId('file-name')).toHaveValue(name, { timeout: 15_000 })
  await expect(page.locator('[data-together]')).toBeVisible({ timeout: 15_000 })

  // Written here, then rewritten from outside: two versions, the second heard live.
  await page.getByTestId('file-body').click()
  await page.keyboard.type('The first draft of the plan.')
  await docKept(page, 'The first draft of the plan.')
  await writeThrough(page, 'A different plan altogether.')
  const body = page.getByTestId('file-body')
  await expect(body).toContainText('A different plan altogether.', { timeout: 10_000 })

  // From the ⋯, the window opens whole — its height never changes once drawn.
  await page.getByTestId('file-menu').click()
  const heights = await drawnWhole(page, '[data-testid="version-history"]', () => page.getByTestId('version-history-open').click())
  expect(heights.length).toBe(1)
  const rows = page.getByTestId('version-list').getByRole('option')
  await expect(rows.first()).toContainText(/Current version/)
  const preview = page.getByTestId('version-preview')
  await expect(preview).toContainText('A different plan altogether.')
  // The current one is not offered back.
  await expect(page.getByTestId('restore-version')).toHaveCount(0)

  // An earlier one, read-only, and put back: the one this page wrote, under the current.
  await rows.nth(1).click()
  await expect(preview).toContainText('The first draft of the plan.')
  await expect(preview).not.toContainText('A different plan altogether.')
  await expect(preview.locator('[contenteditable="true"]')).toHaveCount(0)
  const restored = page.waitForResponse((r) => r.url().includes('/restore') && r.request().method() === 'POST')
  await page.getByTestId('restore-version').click()
  expect((await restored).status()).toBe(200)
  await expect(page.getByTestId('version-history')).toHaveCount(0)

  // The open document says it at once, and keeps it.
  await expect(body).toContainText('The first draft of the plan.', { timeout: 10_000 })
  await expect(body).not.toContainText('A different plan altogether.')
  await docKept(page, 'The first draft of the plan.')

  // And the history has gone on: the newest says what it put back, the rest are still there.
  await page.getByTestId('file-menu').click()
  await page.getByTestId('version-history-open').click()
  await expect(rows.first()).toContainText(/Restored from version \d+/, { timeout: 10_000 })
  await expect(rows.nth(1)).toContainText(/\S/)
  expect(await rows.count()).toBeGreaterThanOrEqual(3)
})
