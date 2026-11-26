import { test, expect, type Page } from '@playwright/test'
import { login, openProject, drawnWhole } from './helpers.js'

/**
 * The project's column folds into the sidebar and comes back.
 */

/** The first project in the sidebar, opened. */
async function openFirst(page: Page) {
  await login(page)
  await page.locator('aside [data-project]').first().waitFor({ timeout: 30_000 })
  const name = (await page.locator('aside [data-project] [data-name]').first().textContent())!.trim()
  await openProject(page, name)
}

/** The work's sheet, beside the column. */
const sheet = (page: Page) => page.locator('[data-tools-column] + [data-panel]')

/**
 * Every left edge the work's sheet had, one per frame, while `act` runs and
 * for a little after — the probe that says whether a change travelled or
 * jumped.
 */
async function edges(page: Page, act: () => Promise<void>, ms = 600): Promise<number[]> {
  await page.evaluate((span) => {
    const w = window as unknown as { edges: number[] }
    w.edges = []
    const start = performance.now()
    const look = (t: number) => {
      const el = document.querySelector('[data-tools-column] + [data-panel]')
      if (el) {
        const x = Math.round(el.getBoundingClientRect().left)
        if (w.edges[w.edges.length - 1] !== x) w.edges.push(x)
      }
      if (t - start < span) requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  }, ms)
  await act()
  await page.waitForTimeout(ms + 200)
  return page.evaluate(() => (window as unknown as { edges: number[] }).edges)
}

test('the project column folds into the sidebar, is navigated from there, is kept, and comes back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openFirst(page)
  const open = (await sheet(page).boundingBox())!

  /* One press, in the bar over the sidebar's edge, for both ways — and it
     stays where it is, so the second press lands where the first did. */
  const toggle = page.getByTestId('tools-fold')
  const before = (await toggle.boundingBox())!
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')

  // Folded with the pointer, it travels: many frames, one direction, no step back.
  const fold = await edges(page, () => toggle.click())
  expect(fold.length).toBeGreaterThan(3)
  for (let i = 1; i < fold.length; i++) expect(fold[i]!).toBeLessThan(fold[i - 1]!)

  await expect(page.locator('[data-tools-column]')).toHaveAttribute('data-folded', '')
  await expect(page.getByTestId('tool-tasks')).not.toBeVisible()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  expect(await toggle.boundingBox()).toEqual(before)
  // The work takes the width the column and its gap had.
  const shut = (await sheet(page).boundingBox())!
  expect(Math.round(open.x - shut.x)).toBeGreaterThan(160)
  expect(Math.round(shut.width - open.width)).toBe(Math.round(open.x - shut.x))

  // The tools are under the project's row, indented, with the open one lit.
  const nested = page.locator('aside [data-fold-tools] [data-side-tool]')
  await expect(nested.first()).toBeVisible()
  await expect(page.locator('aside [data-fold-tools] [data-selected]')).toHaveAttribute('data-side-tool', 'tasks')
  const projectRow = page.locator('aside [data-project][data-selected]')
  const rowBox = (await projectRow.boundingBox())!
  const firstTool = (await nested.first().boundingBox())!
  expect(firstTool.y).toBeGreaterThan(rowBox.y + rowBox.height - 1)
  const icon = (sel: string) =>
    page
      .locator(sel)
      .first()
      .evaluate((el) => Math.round(el.querySelector('svg, span')!.getBoundingClientRect().left))
  expect(await icon('aside [data-fold-tools] [data-side-tool]')).toBeGreaterThan(await icon('aside [data-project][data-selected]'))

  // And they go where the column's went.
  const second = nested.nth(1)
  const tool = (await second.getAttribute('data-side-tool'))!
  await second.click()
  await expect(page.locator('aside [data-fold-tools] [data-selected]')).toHaveAttribute('data-side-tool', tool)
  await expect(page).not.toHaveURL(/\/tasks/)

  // Kept on this machine.
  await page.reload()
  await expect(page.locator('aside [data-fold-tools] [data-selected]')).toHaveAttribute('data-side-tool', tool, { timeout: 30_000 })
  await expect(page.locator('[data-tools-column]')).toHaveAttribute('data-folded', '')

  // Back by the same press, which has not moved; the column opens whole.
  const heights = await drawnWhole(page, '[data-tools-column] nav', () => page.getByTestId('tools-fold').click(), 600)
  expect(heights).toHaveLength(1)
  await expect(page.locator('[data-tools-column]')).not.toHaveAttribute('data-folded', '')
  await expect(page.getByTestId(`tool-${tool}`)).toBeVisible()
  await expect(page.locator('aside [data-fold-tools]')).toHaveAttribute('inert', '')
  expect(Math.round((await sheet(page).boundingBox())!.x)).toBe(Math.round(open.x))
})

test('a key folds the column without travel', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openFirst(page)
  await page.getByTestId('tools-fold').focus()
  const typed = await edges(page, () => page.keyboard.press('Enter'))
  // One edge before and one after: nothing a key does is animated.
  expect(typed.length).toBeLessThanOrEqual(2)
  await expect(page.locator('[data-tools-column]')).toHaveAttribute('data-folded', '')
})

test('with the sidebar shut too, the tools are glyphs under the project and the column comes back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openFirst(page)
  await page.getByTestId('tools-fold').click()
  await expect(page.locator('[data-tools-column]')).toHaveAttribute('data-folded', '')

  const column = page.locator('aside').first()
  const handle = page.locator('[data-resizer]').first()
  const h = (await handle.boundingBox())!

  /*
   * The sidebar's own shut travels now: it used to jump from the threshold
   * to 56 in one frame, because a drag is a held hand and a held hand had
   * the travel off.
   *
   * Asked of the browser as a travel of the width towards 56, not counted
   * in frames: two frames inside two hundred milliseconds is what a laptop
   * draws, and a machine running the whole suite drew one or none — a
   * starved browser, not a jump. A width with the travel off
   * starts no transition at all.
   */
  await page.evaluate(() => {
    const w = window as unknown as { travelled: string[] }
    w.travelled = []
    document.querySelector('aside')!.addEventListener('transitionrun', (e) => {
      if (e.target === e.currentTarget && e.propertyName === 'width') w.travelled.push((e.currentTarget as HTMLElement).style.width)
    })
  })
  await page.mouse.move(h.x + h.width / 2, h.y + 200)
  await page.mouse.down()
  await page.mouse.move(h.x - 240, h.y + 200, { steps: 8 })
  await page.mouse.up()
  await expect(column).toHaveAttribute('data-shut', '')
  await expect.poll(() => page.evaluate(() => (window as unknown as { travelled: string[] }).travelled)).toContain('56px')

  // Glyphs under the project's tile, smaller than the places above them.
  const tile = page.locator('aside [data-fold-tools] [data-side-tool]').first()
  await expect(tile).toBeVisible()
  const box = (await tile.boundingBox())!
  expect(Math.round(box.width)).toBe(32)
  expect(Math.round(box.height)).toBe(32)

  // The same press in the bar brings the column back.
  await page.getByTestId('tools-fold').click()
  await expect(page.locator('[data-tools-column]')).not.toHaveAttribute('data-folded', '')
  await expect(page.getByTestId('tool-tasks')).toBeVisible()

  // Away from a project there is nothing to fold: the press keeps its room
  // and does not show.
  await page.getByTestId('nav-my').click()
  await expect(page.getByTestId('tools-fold')).not.toBeVisible()
})

test('a tool lit under the pointer in the sidebar goes dark when its rows fold away or go', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openFirst(page)
  const toggle = page.getByTestId('tools-fold')
  await toggle.click()
  const files = page.getByTestId('side-tool-files')
  /* The light on the tool under the pointer, wherever it is. */
  const lit = () =>
    page
      .locator('aside [data-glow]')
      .evaluateAll((els) => els.filter((e) => getComputedStyle(e).opacity === '1').map((e) => (e as HTMLElement).style.transform))
  const hovered = async () => {
    await expect(files).toBeVisible()
    await files.hover()
    await expect.poll(lit).toHaveLength(1)
    return (await lit())[0]
  }

  /* The column brought back by a key, the hand still on the tool: the rows
     fold shut under it, and the light goes with them. */
  let where = await hovered()
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-fold-tools]')).not.toHaveAttribute('data-open', '')
  await expect.poll(lit).not.toContain(where)

  /* Folded again and the project left without the hand moving: the tools,
     drawn there by the project's screen, go from the sidebar. */
  await toggle.focus()
  await page.keyboard.press('Enter')
  where = await hovered()
  await page.evaluate(() => {
    const ws = location.pathname.split('/')[1]
    history.pushState(null, '', `/${ws}`)
    dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(files).toBeHidden()
  await expect.poll(lit).not.toContain(where)
})

test('a project opened from behind "n more" takes the last place before it, and its tools fold under it', async ({ page }) => {
  /* The window's own height, on purpose: the point is a column that cuts. */
  test.setTimeout(60_000)
  await login(page)
  const rows = page.locator('aside [data-project]')
  await rows.first().waitFor({ timeout: 30_000 })
  /* The projects' own "n more" — the rooms' list has one too. */
  const more = page.locator('aside [data-order-list]:has([data-project]) > [data-testid="show-more"]')

  /* More projects than the column has room for, made through the API only
     if the studio has not got them already, and put away again after. */
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('session')!).access_token as string)
  const h = { authorization: `Bearer ${token}`, 'x-api-version': '1', 'content-type': 'application/json' }
  const made: string[] = []
  const stamp = Date.now()
  for (let round = 0; round < 4 && (await more.count()) === 0; round++) {
    for (let i = 0; i < 6; i++) {
      const r = await page.request.post('/api/projects', { headers: h, data: { name: `Crowd ${stamp} ${round}${i}` } })
      expect(r.ok()).toBe(true)
      made.push(((await r.json()) as { id: string }).id)
    }
    await page.reload()
    await rows.first().waitFor({ timeout: 30_000 })
    await more.waitFor({ timeout: 3_000 }).catch(() => {})
  }
  await expect(more).toHaveAttribute('aria-expanded', 'false')

  /* Where each row is, the column scrolled to its head: pressing a row in
     the open list may have scrolled it, and that is not a row moving. */
  const drawn = async () => {
    await page
      .locator('aside [data-fluid]')
      .first()
      .evaluate((el) => (el.scrollTop = 0))
    return rows.evaluateAll((els) =>
      els.map((e) => ({ id: (e as HTMLElement).dataset.order!, y: Math.round(e.getBoundingClientRect().top) })),
    )
  }
  const before = await drawn()
  const said = (await more.textContent())!.trim()

  // The last project in the order is behind "n more".
  await more.click()
  const all = await rows.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.order!))
  const last = all[all.length - 1]!
  expect(before.map((r) => r.id)).not.toContain(last)
  await page.locator(`aside [data-project][data-order="${last}"]`).click()
  await expect(page.getByTestId('tool-tasks')).toBeVisible({ timeout: 30_000 })
  await more.click()
  await expect(more).toHaveAttribute('aria-expanded', 'false')

  /* In the column now, lit, in the last place before "n more": as many rows
     as before, every other one where it was, and "n more" counting the same. */
  const open = page.locator(`aside [data-project][data-order="${last}"]`)
  await expect(open).toBeVisible()
  await expect(page.locator(`aside [data-project][data-selected][data-order="${last}"]`)).toBeVisible()
  const after = await drawn()
  expect(after).toHaveLength(before.length)
  expect(after.slice(0, -1)).toEqual(before.slice(0, -1))
  expect(after[after.length - 1]).toEqual({ id: last, y: before[before.length - 1]!.y })
  await expect(more).toHaveText(said)

  // So its tools have somewhere to fold into, and do.
  await page.getByTestId('tools-fold').click()
  await expect(page.locator('[data-tools-column]')).toHaveAttribute('data-folded', '')
  const tool = page.locator('aside [data-fold-tools] [data-side-tool]').first()
  await expect(tool).toBeVisible()
  const row = (await open.boundingBox())!
  expect((await tool.boundingBox())!.y).toBeGreaterThan(row.y + row.height - 1)
  expect(await drawn()).toEqual(after)

  // Back as it was: the column open, and the projects made here put away.
  await page.getByTestId('tools-fold').click()
  for (const id of made) await page.request.post(`/api/projects/${id}/archive`, { headers: h })
})
