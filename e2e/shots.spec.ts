import { test } from '@playwright/test'
import { login, openProject, shownAs } from './helpers.js'

/*
 * Not a test — it asserts nothing. It walks the product and photographs it,
 * which is how three of the defects in this repository were found: a tab that
 * reset, a settings page that saved and never loaded, an app that died at
 * sign-in. None of them failed a test and all three were obvious in a picture.
 *
 * Skipped unless asked for, because it wants the demo workspace by name and
 * the suite runs against a throwaway one:
 *
 *   SHOTS=1 E2E_EMAIL=dev@example.com npx playwright test e2e/shots.spec.ts
 */
test('every screen', async ({ page }) => {
  test.skip(!process.env.SHOTS, 'run with SHOTS=1 against the demo workspace')
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await login(page)
  await page.locator('aside [data-room]').first().waitFor({ timeout: 15_000 })
  await page.screenshot({ path: '/tmp/shots/01-my-tasks.png' })

  await openProject(page, 'Studio site')
  await page.waitForTimeout(400)
  await page.screenshot({ path: '/tmp/shots/02-tasks.png' })

  await shownAs(page, 'board')
  await page.waitForTimeout(300)
  await page.screenshot({ path: '/tmp/shots/03-board.png' })

  await shownAs(page, 'list')
  const first = page.locator('[data-open-task]').first()
  if (await first.count()) {
    await first.click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: '/tmp/shots/04-task.png' })
  }

  await openProject(page, 'Studio site')
  await page.getByTestId('tool-messages').click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: '/tmp/shots/05-chat.png' })

  await page.getByTestId('tool-posts').click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: '/tmp/shots/06-announcements.png' })

  await page.getByTestId('tool-files').click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: '/tmp/shots/06b-docs.png' })

  await page.getByTestId('nav-members').click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: '/tmp/shots/06c-members.png' })

  await page.getByTestId('nav-notifications').click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: '/tmp/shots/07-notifications.png' })

  await page.keyboard.press('ControlOrMeta+k')
  await page.getByTestId('palette-input').fill('a')
  await page.waitForTimeout(400)
  await page.screenshot({ path: '/tmp/shots/08-palette.png' })
})
