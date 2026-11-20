import { test, expect, type Page } from '@playwright/test'
import { login } from './helpers.js'

/*
 * The dot on a workspace's mark.
 * What the server answers, and that it
 * answers it for the person alone, is `workspace-dot.test.ts`; this is the
 * screen. The list is answered here with a second workspace beside the
 * real one, because a studio account is in one, and the dot is about the
 * other.
 */
async function another(page: Page, waiting: { now: boolean }) {
  await page.route('**/api/workspaces', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const real = await route.fetch()
    const body = (await real.json()) as { workspaces: Record<string, unknown>[]; current: string }
    body.workspaces = [
      ...body.workspaces.map((w) => ({ ...w, unread: false })),
      {
        id: '00000000-0000-7000-8000-00000000d07a',
        name: 'Zeta elsewhere',
        slug: 'zeta-elsewhere',
        role: 'member',
        mark_icon: null,
        mark_tint: 3,
        icon_url: null,
        unread: waiting.now,
      },
    ]
    await route.fulfill({ response: real, json: body })
  })
}

/* The list is asked every so often; one in flight as a test ends is let go. */
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('another workspace with something waiting puts a dot on the switcher and its row, and nothing moves', async ({ page }) => {
  const waiting = { now: false }
  await another(page, waiting)
  await login(page)
  const chip = page.locator('[data-top-bar]').getByTestId('workspace-menu')
  await expect(chip).toBeVisible()

  // Nothing waiting: no dot, on the chip or on any row.
  await chip.click()
  const zeta = page.getByTestId('workspace-option').filter({ hasText: 'Zeta elsewhere' })
  await expect(zeta).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('workspace-option-waiting')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(chip.getByTestId('workspace-waiting')).toHaveCount(0)
  const name = chip.locator('span.truncate').first()
  const before = (await name.boundingBox())!

  // Something arrives over there; the menu asks again when it opens.
  waiting.now = true
  await chip.click()
  await expect(zeta.getByTestId('workspace-option-waiting')).toBeVisible({ timeout: 15_000 })
  /* Only on the other one's row: this workspace's bell already says its own. */
  await expect(page.locator('[data-testid="workspace-option"][aria-current="true"] [data-testid="workspace-option-waiting"]')).toHaveCount(
    0,
  )
  await page.keyboard.press('Escape')
  await expect(chip.getByTestId('workspace-waiting')).toBeVisible()
  await expect(chip).toContainText('New notifications in another workspace')

  // It rides the mark: the name beside it is where it was, to the pixel.
  const after = (await name.boundingBox())!
  expect(after.x).toBe(before.x)
  expect(after.width).toBe(before.width)
  /* And it sits on the mark's corner, not beside it. */
  const dot = (await chip.getByTestId('workspace-waiting').boundingBox())!
  expect(dot.width).toBe(8)
  expect(dot.x + dot.width).toBeLessThan(after.x)
})

test('on a phone, the dot is on More, where the switch is', async ({ page }) => {
  const waiting = { now: true }
  await another(page, waiting)
  await login(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('tab-more')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('tab-more-waiting')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('tab-more-waiting')).toHaveAttribute('aria-label', 'New notifications in another workspace')

  // And on More's own switcher, and the other workspace's row in its menu.
  await page.getByTestId('tab-more').click()
  const chip = page.locator('[data-more]').getByTestId('workspace-menu')
  await expect(chip.getByTestId('workspace-waiting')).toBeVisible({ timeout: 15_000 })
  await chip.click()
  await expect(
    page
      .locator('[data-more] [data-testid="workspace-option"]')
      .filter({ hasText: 'Zeta elsewhere' })
      .getByTestId('workspace-option-waiting'),
  ).toBeVisible()
  await page.keyboard.press('Escape')

  // Read over there, the dot goes from the tab once the list is asked again.
  waiting.now = false
  await chip.click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('tab-more-waiting')).toHaveCount(0)
})
