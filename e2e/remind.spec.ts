import { test, expect } from '@playwright/test'
import { add, drawnWhole, login, openProject, settleThenReload } from './helpers.js'

/**
 * Remind me. Set from the bell on the task's
 * bar, not from its facts; the menu's head says when, the bell lights
 * before the server answers, and both are still so when the task is opened
 * again. Cleared from the same menu.
 */
test('a reminder is set from the bell on the task’s bar', async ({ page }) => {
  await login(page)
  await openProject(page, 'Website')
  const title = `Remind ${Date.now()}`
  await add(page, 'new-task', title)
  await page.locator('[data-open-task]').filter({ hasText: title }).click()
  await expect(page.getByTestId('task-title')).toHaveValue(title, { timeout: 15_000 })

  const control = page.getByTestId('task-reminder')
  await expect(control).toHaveAttribute('data-at', '')
  await expect(control).toHaveAttribute('title', 'Remind me')
  // On the bar with the hours, not among the facts everybody shares.
  await expect(page.getByTestId('task-reminder-fact')).toHaveCount(0)

  // The menu opens whole: the moment of your own is there from the start.
  const heights = await drawnWhole(page, '[data-remind-menu]', () => control.click())
  expect(heights).toHaveLength(1)
  const menu = page.locator('[data-remind-menu]')
  await expect(menu.locator('[data-remind-pick="tomorrow"]')).toBeVisible()
  await expect(menu.locator('[data-remind-pick="next-week"]')).toBeVisible()
  // Nothing to take off, so no way to: the row is not drawn.
  await expect(menu.locator('[data-remind-pick="remove"]')).toHaveCount(0)
  await expect(menu.locator('[data-remind-now]')).toHaveText('No reminder set')

  await menu.locator('[data-remind-pick="tomorrow"]').click()
  await expect(menu).toHaveCount(0)
  // The bell says when, at once.
  await expect(control).toHaveAttribute('title', /^Reminder: Tomorrow, /)
  const at = await control.getAttribute('data-at')
  expect(at).toBeTruthy()

  // Opened again, it is still there — the server has it.
  await settleThenReload(page, '/reminder')
  await expect(page.getByTestId('task-reminder')).toHaveAttribute('title', /^Reminder: Tomorrow, /, { timeout: 15_000 })

  // A day and time of your own, then taken off.
  await page.getByTestId('task-reminder').click()
  await page.getByTestId('remind-time').fill('15:30')
  await page.getByTestId('remind-set').click()
  await expect(page.getByTestId('task-reminder')).toHaveAttribute('title', /15:30|3:30/)
  await page.getByTestId('task-reminder').click()
  await expect(page.locator('[data-remind-now]')).toHaveText(/15:30|3:30/)
  await page.locator('[data-remind-pick="remove"]').click()
  await expect(page.getByTestId('task-reminder')).toHaveAttribute('title', 'Remind me')
})
