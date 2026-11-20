import { test, expect, type Page } from '@playwright/test'
import { add, drawnWhole, login, openProject } from './helpers.js'

/**
 * A project's Recently Deleted, and each of Files' places at its own
 * address.
 */
const SHOTS = process.env.SHOTS_DIR ?? ''
const shot = async (page: Page, name: string, target?: ReturnType<Page['locator']>) => {
  if (!SHOTS) return
  const path = `${SHOTS}/${name}.png`
  await (target ? target.screenshot({ path }) : page.screenshot({ path }))
}

async function openFiles(page: Page) {
  await login(page)
  await openProject(page, 'Website')
  await page.getByTestId('tool-files').click()
  await expect(page.getByTestId('docs-add')).toBeVisible({ timeout: 15_000 })
}

/* Everybody's, whatever an earlier test left chosen. */
async function everybodys(page: Page) {
  await page.getByTestId('docs-whose').click()
  await page.locator('[data-docs-whose="recent"]').click()
}

async function deleteRow(page: Page, name: string) {
  const row = page.locator('[data-file]').filter({ hasText: name })
  await expect(row.getByTestId('file-row-menu')).toBeVisible({ timeout: 15_000 })
  await row.hover()
  await row.getByTestId('file-row-menu').click()
  const deleted = page.waitForResponse((r) => /\/api\/files\/[^/]+$/.test(r.url()) && r.request().method() === 'DELETE')
  await page.getByTestId('delete-file-row').click()
  expect((await deleted).status()).toBe(200)
  await expect(row).toHaveCount(0)
}

test('a deleted document waits in Recently Deleted, comes back, and another goes forever', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await openFiles(page)
  const keep = `Keep me ${Date.now()}`
  const lose = `Lose me ${Date.now()}`
  await add(page, 'new-document', keep)
  await add(page, 'new-document', lose)
  await page.locator('[data-docs-kind="docs"]').click()
  await everybodys(page)
  await deleteRow(page, keep)

  /* At the foot of whose, under a line, drawn whole. */
  const trigger = page.getByTestId('docs-whose')
  const heights = await drawnWhole(page, '[role="menu"]:has([data-docs-whose])', () => trigger.click())
  expect(heights).toHaveLength(1)
  await expect(page.locator('[data-docs-whose="deleted"]')).toHaveText('Recently Deleted')
  await shot(page, 'menu-dark', page.locator('main'))
  await page.locator('[data-docs-whose="deleted"]').click()

  /* Its own address, and every kind at once: no kind is chosen. */
  await expect(page).toHaveURL(/\/files\/deleted$/)
  await expect(page.locator('[data-docs-kind][data-on]')).toHaveCount(0)
  const kept = page.locator('[data-bin-row]').filter({ hasText: keep })
  await expect(kept).toHaveCount(1, { timeout: 15_000 })
  await expect(kept).toContainText('Deleted by you')
  await expect(kept.locator('[data-days-left]')).toHaveText('30 days left')

  /* Restored: out of the bin at once, and back among the Docs. */
  const restored = page.waitForResponse((r) => r.url().includes('/restore') && r.request().method() === 'POST')
  await kept.getByTestId('bin-restore').click()
  await expect(kept).toHaveCount(0)
  expect((await restored).status()).toBe(200)
  await page.locator('[data-docs-kind="docs"]').click()
  await expect(page).toHaveURL(/\/files\/docs$/)
  await expect(page.locator('[data-file]').filter({ hasText: keep })).toHaveCount(1, { timeout: 15_000 })

  /* Another, for good: asked first, by name, then gone and 404. */
  await deleteRow(page, lose)
  await page.goto(page.url().replace(/\/files\/docs$/, '/files/deleted'))
  const lost = page.locator('[data-bin-row]').filter({ hasText: lose })
  await expect(lost).toHaveCount(1, { timeout: 15_000 })
  await shot(page, 'bin-dark', page.locator('main'))
  await lost.getByTestId('bin-delete-forever').click()
  const dialog = page.getByTestId('purge-file')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(`Delete “${lose}” forever?`)
  await expect(dialog).toContainText('can’t be undone')
  await shot(page, 'confirm-dark')
  const purged = page.waitForResponse((r) => r.url().includes('/forever') && r.request().method() === 'DELETE')
  await page.getByTestId('purge-file-confirm').click()
  const answer = await purged
  expect(answer.status()).toBe(200)
  expect(answer.request().postDataJSON()).toHaveProperty('confirm')
  await expect(lost).toHaveCount(0)
  await expect(dialog).toHaveCount(0)

  /* Gone on the server, not only from the screen. */
  const id = /\/api\/files\/([^/]+)\/forever/.exec(answer.url())![1]!
  const status = await page.evaluate(async (fileId) => {
    const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
    const headers = { 'x-api-version': '1', authorization: `Bearer ${s.access_token}` }
    return (await fetch(`/api/files/${fileId}`, { headers })).status
  }, id)
  expect(status).toBe(404)
  await page.reload()
  await expect(page.locator('[data-bin]')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-bin-row]').filter({ hasText: lose })).toHaveCount(0)

  /* A bare /files never settles on the bin. */
  await page.goto(page.url().replace(/\/files\/deleted$/, '/files'))
  await expect(page).toHaveURL(/\/files\/(docs|images|uploads|links)$/)
})

test('each kind opens at its address, and back walks back through the tabs', async ({ page }) => {
  await openFiles(page)
  await add(page, 'new-document', `Walk ${Date.now()}`)
  await page.locator('[data-docs-kind="docs"]').click()
  await expect(page).toHaveURL(/\/files\/docs$/)
  await page.locator('[data-docs-kind="images"]').click()
  await expect(page).toHaveURL(/\/files\/images$/)
  await page.locator('[data-docs-kind="links"]').click()
  await expect(page).toHaveURL(/\/files\/links$/)

  await page.goBack()
  await expect(page).toHaveURL(/\/files\/images$/)
  await expect(page.locator('[data-docs-kind="images"]')).toHaveAttribute('data-on', 'true')
  await page.goBack()
  await expect(page).toHaveURL(/\/files\/docs$/)
  await expect(page.locator('[data-docs-kind="docs"]')).toHaveAttribute('data-on', 'true')

  /* Loaded straight from its address. */
  await page.goto(page.url().replace(/\/files\/docs$/, '/files/uploads'))
  await expect(page.locator('[data-docs-kind="uploads"]')).toHaveAttribute('data-on', 'true', { timeout: 15_000 })

  /* A document opened from Docs, and back is Docs. */
  await page.locator('[data-docs-kind="docs"]').click()
  await everybodys(page)
  await page.locator('[data-open-file]').first().click()
  await expect(page.getByTestId('file-name')).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveURL(/\/files\/\d+$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/files\/docs$/)
  await expect(page.locator('[data-docs-kind="docs"]')).toHaveAttribute('data-on', 'true')
})
