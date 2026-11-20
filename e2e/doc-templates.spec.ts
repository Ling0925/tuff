import { test, expect } from '@playwright/test'
import { login, openProject, drawnWhole } from './helpers.js'

/**
 * A document started from a template, and a document saved as one.
 */
test('a document starts from a built-in template, and one saved as a template is offered back', async ({ page }) => {
  await login(page)
  await openProject(page, 'Website')
  await page.getByTestId('tool-files').click()
  await expect(page.getByTestId('docs-add')).toBeVisible({ timeout: 15_000 })

  /* The plus opens whole, the templates in it from its first frame. */
  const heights = await drawnWhole(page, '[role="menu"]:has([data-template-rows])', () => page.getByTestId('docs-add').click())
  expect(heights.length).toBe(1)
  await expect(page.getByTestId('template-brief')).toBeVisible()
  await expect(page.getByTestId('template-spec')).toBeVisible()
  await expect(page.getByTestId('template-report')).toBeVisible()

  /* Meeting notes: named for today, filled with the project, in its shape. */
  await page.getByTestId('template-meeting').click()
  const name = page.getByTestId('file-name')
  await expect(name).toHaveValue(/^Meeting notes \d{1,2} [A-Z][a-z]+ \d{4}$/, { timeout: 15_000 })
  const body = page.getByTestId('file-body')
  await expect(body).toContainText('Attendees')
  await expect(body).toContainText('Action items')
  await expect(body).toContainText('Website ·')
  await expect(body).not.toContainText('{date}')

  /* Renamed and saved as a template, from its ⋯. */
  const stamp = Date.now()
  const renamed = page.waitForResponse((r) => r.url().includes('/api/files/') && r.request().method() === 'PATCH')
  await name.fill(`Weekly ${stamp}`)
  await name.evaluate((el) => (el as HTMLElement).blur())
  await renamed
  await page.getByTestId('file-menu').click()
  const save = page.getByTestId('save-as-template')
  await expect(save).toHaveAttribute('aria-checked', 'false')
  const saved = page.waitForResponse((r) => r.url().includes('/template') && r.request().method() === 'PUT')
  await save.click()
  expect((await saved).status()).toBe(200)
  await expect(save).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')

  /* Back in Docs the row says so, and the plus offers it. */
  await page.getByTestId('close-file').click()
  const row = page
    .locator('[data-file]')
    .filter({ hasText: `Weekly ${stamp}` })
    .first()
  await expect(row.locator('[data-file-template]')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('docs-add').click()
  const offered = page.locator('[data-saved-template]').filter({ hasText: `Weekly ${stamp}` })
  await expect(offered).toBeVisible()
  await expect(offered).toContainText('Website')
  await offered.click()

  /* A copy of its words, under its name — and not a template itself. */
  await expect(name).toHaveValue(`Weekly ${stamp}`, { timeout: 15_000 })
  await expect(page.getByTestId('file-body')).toContainText('Attendees')
  await page.getByTestId('file-menu').click()
  await expect(page.getByTestId('save-as-template')).toHaveAttribute('aria-checked', 'false')
})
