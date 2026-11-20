import { test, expect, type Page } from '@playwright/test'
import { add, login, openProject, shownAs } from './helpers.js'

/**
 * An edit on a task's own screen changes its row in the list behind it in
 * place, from the write's own answer, and never reads the project again.
 * A refused write is
 * put back, on the screen and on the row.
 */

/* Every read of the project's task list from here on. */
function countReads(page: Page): string[] {
  const reads: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'GET' && /\/api\/projects\/[^/]+\/tasks(\?|$)/.test(r.url())) reads.push(r.url())
  })
  return reads
}

const patched = (page: Page) =>
  page.waitForResponse((r) => /\/api\/(tasks|steps)\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH')

test('edits on a task’s screen change its row in place, without reading the project again', async ({ page }) => {
  test.setTimeout(90_000)
  await login(page)
  await openProject(page, 'Acme rebrand')
  await page.getByTestId('tool-tasks').click()
  await shownAs(page, 'list')

  const title = `In place ${Date.now()}`
  await add(page, 'new-task', title)
  const row = page.locator('[data-task]:not([data-part])').filter({ hasText: title }).first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  const listBefore = await row.locator('[data-status]').getAttribute('data-status')

  const reads = countReads(page)
  await row.locator('[data-open-task]').click()
  const field = page.getByTestId('task-title')
  await expect(field).toHaveValue(title, { timeout: 15_000 })
  const facts = page.locator('[data-task-facts]')

  /* The title, as it is kept on leaving the field. The answer carries the row. */
  const renamed = `${title} renamed`
  let saved = patched(page)
  await field.fill(renamed)
  await field.evaluate((el) => (el as HTMLElement).blur())
  const said = await (await saved).json()
  expect(said.task?.title).toBe(renamed)

  /* The priority. */
  saved = patched(page)
  await facts.locator('button[data-priority]').click()
  await page.locator('[data-priority-menu] [data-priority-pick="high"]').click()
  await saved

  /* Another open list, through the same ring the row has. */
  saved = patched(page)
  await facts.locator('[data-status]').click()
  const into = page
    .locator('[data-status-menu] [role="menuitem"]')
    .filter({ hasNotText: listBefore ?? '' })
    .filter({ hasNotText: /Done|Canceled/ })
    .first()
  const listAfter = (await into.locator('.truncate').innerText()).trim()
  await into.click()
  const moved = await (await saved).json()
  expect(moved.task?.list_id).toBeTruthy()

  /* A part made, then ticked: the parent's count is the list's rows. */
  const part = `Part of ${title}`
  await page.getByTestId('add-subtask').click()
  await page.getByTestId('new-step').fill(part)
  await page.getByTestId('new-step').press('Enter')
  const step = page.locator('[data-step]').filter({ hasText: part })
  await expect(step).toBeVisible({ timeout: 15_000 })
  saved = patched(page)
  await step.getByRole('checkbox').click()
  await saved

  await page.getByTestId('close-task').click()
  await expect(field).toHaveCount(0)

  /* The row as the screen left it, at once. */
  const back = page.locator('[data-task]:not([data-part])').filter({ hasText: renamed }).first()
  await expect(back).toBeVisible()
  await expect(back.locator('button[data-priority]')).toHaveAttribute('data-priority', 'high')
  await expect(back.locator('[data-status]')).toHaveAttribute('data-status', listAfter)
  await expect(back.locator('[data-parts]')).toHaveText('1/1')
  await expect(page.locator('[data-task][data-part]').filter({ hasText: part })).toHaveCount(1)

  /* And nothing read the project for any of it. */
  await page.waitForTimeout(1000)
  expect(reads).toEqual([])
})

test('a write the server refuses is put back, on the task’s screen and on its row', async ({ page }) => {
  test.setTimeout(60_000)
  await login(page)
  await openProject(page, 'Acme rebrand')
  await page.getByTestId('tool-tasks').click()
  await shownAs(page, 'list')

  const title = `Refused ${Date.now()}`
  await add(page, 'new-task', title)
  const row = page.locator('[data-task]:not([data-part])').filter({ hasText: title }).first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.locator('[data-open-task]').click()
  await expect(page.getByTestId('task-title')).toHaveValue(title, { timeout: 15_000 })
  const facts = page.locator('[data-task-facts]')

  /* Set once, for real. */
  let saved = patched(page)
  await facts.locator('button[data-priority]').click()
  await page.locator('[data-priority-menu] [data-priority-pick="high"]').click()
  await saved

  /* Then refused. */
  const reads = countReads(page)
  await page.route('**/api/tasks/*', (r) =>
    r.request().method() === 'PATCH'
      ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'invalid' } }) })
      : r.fallback(),
  )
  saved = patched(page)
  await facts.locator('button[data-priority]').click()
  await page.locator('[data-priority-menu] [data-priority-pick="low"]').click()
  await saved
  await expect(facts.locator('button[data-priority]')).toHaveAttribute('data-priority', 'high')

  await page.getByTestId('close-task').click()
  await expect(row.locator('button[data-priority]')).toHaveAttribute('data-priority', 'high')
  await page.waitForTimeout(500)
  expect(reads).toEqual([])
})
