import { test, expect, type Page } from '@playwright/test'
import { login, make, openProject } from './helpers.js'

/**
 * A menu's lit row is a pill inside the menu, not a band across it — the
 * `[data-menu]` rule in `theme.css`. Four pixels either side of the row, its
 * own rounded corners, and Delete lit red rather than grey.
 *
 * Two menus, because there are two ways a row is lit: by its own `:hover`
 * (the task's ⋯ menu) and by the travelling light, `Fluid`, which is drawn
 * at the row's place and corner (the account menu).
 */

/** Where `lit` sits inside the menu panel, and how round it is. */
function inset(page: Page, menu: string, lit: string) {
  return page.evaluate(
    ([m, l]) => {
      const panel = document.querySelector(m)!.getBoundingClientRect()
      const it = document.querySelector(l) as HTMLElement
      const r = it.getBoundingClientRect()
      const s = getComputedStyle(it)
      return {
        left: r.left - panel.left,
        right: panel.right - r.right,
        radius: parseFloat(s.borderTopLeftRadius),
        ground: s.backgroundColor,
        shown: Number(s.opacity) > 0 && r.width > 0,
      }
    },
    [menu, lit] as const,
  )
}

test('a hovered row in the task menu is an inset rounded pill, and Delete’s is red', async ({ page }) => {
  await login(page)
  await openProject(page, 'Acme rebrand')
  await page.getByTestId('tool-tasks').click()
  const title = `Pill ${Date.now()}`
  await make(page, page.getByTestId('create-new-task'), title)
  await page.locator('[data-open-task]').filter({ hasText: title }).first().click()
  await expect(page.getByTestId('task-title')).toHaveValue(title, { timeout: 15_000 })

  await page.getByTestId('task-menu').click()
  const menu = '[data-popover] [data-menu]'
  await page.getByTestId('copy-branch').hover()
  await expect.poll(async () => (await inset(page, menu, '[data-testid="copy-branch"]')).ground).not.toBe('rgba(0, 0, 0, 0)')
  const lit = await inset(page, menu, '[data-testid="copy-branch"]')
  expect(lit.left).toBeCloseTo(4, 0)
  expect(lit.right).toBeCloseTo(4, 0)
  expect(lit.radius).toBeGreaterThan(0)

  /* The same pill under Delete, in red: not the grey of the row above. */
  await page.getByTestId('delete-task').hover()
  await expect.poll(async () => (await inset(page, menu, '[data-testid="delete-task"]')).ground).not.toBe('rgba(0, 0, 0, 0)')
  const red = await inset(page, menu, '[data-testid="delete-task"]')
  expect(red.left).toBeCloseTo(4, 0)
  expect(red.radius).toBeGreaterThan(0)
  expect(red.ground).not.toBe(lit.ground)
})

test('the travelling light in the account menu is an inset rounded pill', async ({ page }) => {
  await login(page)
  await page.getByTestId('my-presence').click()
  await page.getByTestId('nav-account').hover()
  const menu = '[data-popover] [data-menu]'
  const glow = `${menu} > [data-glow]`
  await expect.poll(async () => (await inset(page, menu, glow)).shown).toBe(true)
  const lit = await inset(page, menu, glow)
  expect(lit.left).toBeCloseTo(4, 0)
  expect(lit.right).toBeCloseTo(4, 0)
  expect(lit.radius).toBeGreaterThan(0)
})
