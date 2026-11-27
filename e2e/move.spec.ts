import { test, expect } from '@playwright/test'
import { add, login, make, openProject } from './helpers.js'

/**
 * A task moved to another project from its row menu.
 *
 * The window asks the two answers the move needs — the project, and where
 * in it — in the pickers the rest of the product uses, and the server's plan
 * is read before the press. Moved, the row leaves this project's list.
 */
test('a task is moved to another project', async ({ page }) => {
  await login(page)
  const stamp = Date.now()
  await add(page, 'new-project', `Source ${stamp}`)
  await add(page, 'new-project', `Other ${stamp}`)
  await openProject(page, `Source ${stamp}`)
  await page.getByTestId('tool-tasks').click()
  await make(page, page.getByTestId('create-new-task'), `Move me ${stamp}`)

  const row = page
    .locator('[data-task]')
    .filter({ hasText: `Move me ${stamp}` })
    .first()
  await row.click({ button: 'right' })
  await page.getByTestId('task-move').click()
  const dialog = page.getByTestId('move-task-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('move-task-go')).toBeDisabled()
  await expect(dialog.getByTestId('move-task-plan')).toContainText('Choose the project')

  await dialog.getByTestId('move-task-project').click()
  await page
    .locator('[data-project-option]')
    .filter({ hasText: `Other ${stamp}` })
    .click()
  await expect(dialog.getByTestId('move-task-plan')).toContainText(`The task itself moves to Other ${stamp}`, { timeout: 15_000 })
  await expect(dialog.getByTestId('move-task-plan')).toContainText('repeating chain stay behind')
  await expect(dialog.getByTestId('move-task-list')).toHaveValue('')

  await dialog.getByTestId('move-task-go').click()
  await expect(dialog).toHaveCount(0, { timeout: 15_000 })
  await expect(row).toHaveCount(0)

  await openProject(page, `Other ${stamp}`)
  await page.getByTestId('tool-tasks').click()
  await expect(
    page
      .locator('[data-task]')
      .filter({ hasText: `Move me ${stamp}` })
      .first(),
  ).toBeVisible({ timeout: 15_000 })
})
