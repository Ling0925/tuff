import { test, expect, type Page } from '@playwright/test'
import { add, drawnWhole, login, openProject, setStatus, shownAs, viewAnswers } from './helpers.js'

/**
 * Recurring tasks. The rule is set in the due
 * date's calendar, the row wears the loop, and finishing the task puts the
 * next one in the list and in My tasks, due a week on.
 */

/* `YYYY-MM-DD` of a local date, the way the calendar names its days. */
const iso = (d: Date) => `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`

/** The next Friday after today, and the one a week after it. */
function fridays(): [string, string] {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  do d.setDate(d.getDate() + 1)
  while (d.getDay() !== 5)
  const first = iso(d)
  d.setDate(d.getDate() + 7)
  return [first, iso(d)]
}

/* Where the screenshots for the report go, when asked. */
const SHOTS = process.env.RECURRING_SHOTS

async function dayIn(page: Page, on: string) {
  const menu = page.locator('[data-due-menu]')
  const day = menu.locator(`[data-day="${on}"]`)
  if (!(await day.count())) await menu.getByRole('button', { name: 'Next month' }).click()
  await day.click()
}

test('a weekly rule set in the calendar, and the next one due a week on when it is done', async ({ page }) => {
  await login(page)
  await openProject(page, 'Acme rebrand')
  await page.getByTestId('tool-tasks').click()
  await shownAs(page, 'list')

  /* The date column, which a list does not draw until it is asked for. */
  await viewAnswers(page, true)
  const dueColumn = page.getByTestId('shows-due')
  if ((await dueColumn.getAttribute('aria-pressed')) !== 'true') await dueColumn.click()
  await viewAnswers(page, false)

  const title = `Weekly report ${Date.now()}`
  await add(page, 'new-task', title)
  const row = page.locator('[data-task]').filter({ hasText: title }).first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  const [friday, nextFriday] = fridays()

  /* The date first, in the row's own calendar. */
  const due = row.locator('button[data-due]')
  await due.click()
  await dayIn(page, friday)
  await expect(due).toHaveAttribute('data-due', friday)

  /* Then the rule, at the calendar's foot: a panel beside the month, drawn
     whole, offering what a Friday suggests. */
  await due.click()
  await expect(page.locator('[data-due-menu]')).toBeVisible()
  const heights = await drawnWhole(page, '[data-repeat-menu]', () => page.locator('[data-repeat-open]').click())
  expect(heights).toHaveLength(1)
  const weekly = page.locator(`[data-repeat-choice='{"every":"week","weekdays":[5]}']`)
  await expect(weekly).toHaveText(/Every Friday/)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/picker-with-rule.png` })

  /* The laid-out rule changes in place without the panel moving: a second
     day, then back to Fridays alone. */
  const panel = page.locator('[data-repeat-menu]')
  const before = await panel.boundingBox()
  await weekly.click()
  await expect(page.locator('[data-due-menu]')).toHaveCount(0)
  await expect(due).toHaveAttribute('data-repeats', 'Every Friday')

  await due.click()
  await page.locator('[data-repeat-open]').click()
  await page.getByTestId('repeat-weekday-1').click()
  await expect(due).toHaveAttribute('data-repeats', 'Every week on Mon, Fri')
  expect((await panel.boundingBox())?.height).toBe(before?.height)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/picker-with-custom-rule.png` })
  await page.getByTestId('repeat-weekday-1').click()
  await expect(due).toHaveAttribute('data-repeats', 'Every Friday')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-due-menu]')).toHaveCount(0)
  if (SHOTS) await row.screenshot({ path: `${SHOTS}/row-with-mark.png` })

  /* Done: the next one is in the list, open, due the Friday after. */
  const finished = page.waitForResponse((r) => r.url().includes('/api/tasks/') && r.request().method() === 'PATCH')
  await setStatus(page, title, 'Done')
  await finished
  const next = page
    .locator('[data-task]')
    .filter({ hasText: title })
    .filter({ has: page.locator(`button[data-due="${nextFriday}"]`) })
  await expect(next).toHaveCount(1, { timeout: 15_000 })
  await expect(next.locator('button[data-due]')).toHaveAttribute('data-repeats', 'Every Friday')
  await expect(next.locator('[data-status]')).not.toHaveAttribute('data-status', 'Done')

  /* A card says the rule in words. */
  await shownAs(page, 'board')
  const card = page
    .locator('[data-card]')
    .filter({ hasText: title })
    .filter({ has: page.locator('[data-card-repeat]') })
  await expect(card.first()).toBeVisible({ timeout: 15_000 })
  await expect(card.first().locator('[data-card-repeat]')).toContainText('Every Friday')
  if (SHOTS) await card.first().screenshot({ path: `${SHOTS}/card-with-mark.png` })
  await shownAs(page, 'list')

  /* And in My tasks — made by me, so under Created — on the same date. */
  const [, ws] = new URL(page.url()).pathname.split('/')
  await page.goto(`/${ws}?tab=created`)
  const mine = page
    .locator('[data-mine]')
    .filter({ hasText: title })
    .filter({ has: page.locator(`[data-due="${nextFriday}"]`) })
  await expect(mine).toHaveCount(1, { timeout: 15_000 })
  await expect(mine.locator(`[data-due="${nextFriday}"]`)).toHaveAttribute('data-repeats', 'Every Friday')
})
