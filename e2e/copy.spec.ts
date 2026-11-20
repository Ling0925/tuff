import { test, expect } from '@playwright/test'
import { add, login, make, openProject, drawnWhole } from './helpers.js'

/**
 * A task copied to another project from its own menu.
 *
 * The window lists where a copy can go and says what it will be before
 * anything is made; the press opens the copy, and the original is where it
 * was.
 */
test('a task is copied to another project, and the original stays', async ({ page }) => {
  await login(page)
  const stamp = Date.now()
  await add(page, 'new-project', `Source ${stamp}`)
  await add(page, 'new-project', `Other ${stamp}`)
  await openProject(page, `Source ${stamp}`)
  await page.getByTestId('tool-tasks').click()
  await make(page, page.getByTestId('create-new-task'), `Template ${stamp}`)
  await page
    .locator('[data-open-task]')
    .filter({ hasText: `Template ${stamp}` })
    .first()
    .click()
  await expect(page.getByTestId('task-title')).toHaveValue(`Template ${stamp}`, { timeout: 15_000 })
  await expect(page).toHaveURL(/\/tasks\/\d+$/)
  const original = new URL(page.url()).pathname

  // The window opens whole: the room for what the copy will be is kept from the start.
  await page.getByTestId('task-menu').click()
  const heights = await drawnWhole(page, '[data-testid="copy-task-dialog"]', () => page.getByTestId('copy-task').click())
  expect(heights).toHaveLength(1)
  const dialog = page.getByTestId('copy-task-dialog')
  await expect(dialog.getByTestId('copy-task-go')).toBeDisabled()
  // This project is offered first: copied there, it is a duplicate.
  await expect(dialog.getByTestId('copy-task-project').first()).toContainText(`Source ${stamp}`)

  const row = dialog.getByTestId('copy-task-project').filter({ hasText: `Other ${stamp}` })
  await row.click()
  await expect(row).toHaveAttribute('aria-checked', 'true')
  await expect(dialog.getByTestId('copy-task-plan')).toContainText(`A copy in Other ${stamp}`, { timeout: 15_000 })
  await expect(dialog.getByTestId('copy-task-plan')).toContainText('stay with the original')

  await dialog.getByTestId('copy-task-go').click()
  await expect(dialog).toHaveCount(0, { timeout: 15_000 })

  // On the copy, in the other project.
  await expect(page.getByTestId('task-title')).toHaveValue(`Template ${stamp}`, { timeout: 15_000 })
  await expect(page).toHaveURL(/\/other-\d+\/tasks\/\d+$/, { timeout: 15_000 })

  // And back is the original, where it was.
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`${original}$`), { timeout: 15_000 })
  await expect(page.getByTestId('task-title')).toHaveValue(`Template ${stamp}`, { timeout: 15_000 })
})
