import { test, expect, type Page } from '@playwright/test'
import { login } from './helpers.js'

/**
 * The board by labels, on a phone.
 *
 * Labels is a drawing of its own beside List and Board — a column for each
 * label, the open work wearing it as cards — and it answers at every width:
 * the columns scroll sideways exactly as the status board's do, which the
 * narrow spec already promises of the board. Held to a desk, pressing
 * Labels on a phone changed the address and nothing else: the screen under
 * it stayed the list, and the switch read as broken.
 *
 * And the switch itself is glyphs below 640, the open one keeping its word:
 * three segments with their words beside the tab menu and the view button
 * are wider than a phone's bar, and the third word was the one that tipped
 * it over (`docs/specs/tool-bar.md`). `LABEL_BOARD_SHOTS` names a folder to
 * keep pictures in.
 */
const SHOTS = process.env.LABEL_BOARD_SHOTS

type Staged = {
  ws: string
  slug: string
  labels: { id: string; name: string }[]
  tasks: Record<'bug' | 'both' | 'plain' | 'finished', { id: string; title: string }>
}

/** A project of its own, its labels as they arrive, and four tasks spread across them. */
async function stage(page: Page, n: number): Promise<Staged> {
  const ws = new URL(page.url()).pathname.split('/')[1]!
  const made = await page.evaluate(async (n) => {
    const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
    const h = { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1', 'content-type': 'application/json' }
    const p = (await (
      await fetch('/api/projects', { method: 'POST', headers: h, body: JSON.stringify({ name: `By label ${n}` }) })
    ).json()) as { id: string; slug: string }
    const { labels } = (await (await fetch(`/api/projects/${p.id}/labels`, { headers: h })).json()) as {
      labels: { id: string; name: string }[]
    }
    if (labels.length < 2) return { error: `a new project starts with labels, got ${labels.length}` }
    const [bug, feature] = labels
    const make = async (title: string, labelIds: string[]) => {
      const t = await fetch(`/api/projects/${p.id}/tasks`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ title, labels: labelIds }),
      })
      const { id } = (await t.json()) as { id: string }
      return { id, title }
    }
    const bugTask = await make(`Mend the hinge ${n}`, [bug!.id])
    const both = await make(`Paint the door ${n}`, [bug!.id, feature!.id])
    const plain = await make(`Sweep the step ${n}`, [])
    const finished = await make(`Oil the lock ${n}`, [bug!.id])
    const { lists } = (await (await fetch(`/api/projects/${p.id}/lists`, { headers: h })).json()) as {
      lists: { id: string; finishes: boolean }[]
    }
    const finishing = lists.find((l) => l.finishes)!
    await fetch(`/api/tasks/${finished.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ list_id: finishing.id }) })
    return { slug: p.slug, labels, tasks: { bug: bugTask, both, plain, finished } }
  }, n)
  if ('error' in made) throw new Error(String(made.error))
  return { ws, ...made }
}

/** The label columns on the screen, keyed by their names as the heads say them. */
function column(page: Page, key: string) {
  return page.locator(`[data-label-column="${key}"]`)
}

test('on a phone the switch fits the bar, and Labels draws the label columns', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)
  const s = await stage(page, Date.now())

  await page.goto(`/${s.ws}/${s.slug}/tasks`)
  await expect(page.locator('[data-open-task]').filter({ hasText: s.tasks.bug.title })).toBeVisible({ timeout: 15_000 })

  /*
   * The bar fits: the switch and the round view button are whole inside 390,
   * and the page itself does not scroll sideways. Three words beside the tab
   * menu and the button were wider than the bar, and the button past the
   * edge was a control nobody could press.
   */
  const menu = page.getByTestId('view-menu')
  await expect(menu).toBeVisible()
  const box = await menu.boundingBox()
  expect(box, 'the view button is on the screen').not.toBeNull()
  expect(box!.x).toBeGreaterThan(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  const track = page.getByTestId('view-labels-mode').locator('..')
  const trackBox = (await track.boundingBox())!
  expect(trackBox.x + trackBox.width).toBeLessThanOrEqual(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  /* Below 640 the closed segments are their glyphs and the open one keeps
     its word, so the row still says where you are. */
  const worded = async (testId: string) =>
    page.getByTestId(testId).evaluate((el) => {
      const spans = [...el.querySelectorAll('span')]
      return spans.some((s) => s.textContent?.trim() && getComputedStyle(s).display !== 'none')
    })
  expect(await worded('view-list-mode')).toBe(true)
  expect(await worded('view-board')).toBe(false)
  expect(await worded('view-labels-mode')).toBe(false)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-list-bar.png` })

  /* Pressed, Labels is the labels board: the address says so, and a column
     stands for each label with the work that wears it — a task with two in
     both — and No labels first with the rest. Finished work is counted, not
     drawn. */
  await page.getByTestId('view-labels-mode').click()
  await expect(page).toHaveURL(/[?&]view=labels/)
  await expect(page.locator('[data-label-board]')).toBeVisible({ timeout: 15_000 })
  const keys = await page.locator('[data-label-column]').evaluateAll((els) => els.map((e) => e.getAttribute('data-label-column')))
  expect(keys.length).toBe(1 + s.labels.length)
  expect(keys[0]).toBe('~')
  for (const l of s.labels) expect(keys).toContain(l.id)
  const [bug, feature] = s.labels
  await expect(column(page, bug!.id).locator('[data-card]').filter({ hasText: s.tasks.bug.title })).toHaveCount(1)
  await expect(column(page, bug!.id).locator('[data-card]').filter({ hasText: s.tasks.both.title })).toHaveCount(1)
  await expect(column(page, feature!.id).locator('[data-card]').filter({ hasText: s.tasks.both.title })).toHaveCount(1)
  await expect(column(page, '~').locator('[data-card]').filter({ hasText: s.tasks.plain.title })).toHaveCount(1)
  await expect(column(page, bug!.id).locator('[data-card]').filter({ hasText: s.tasks.finished.title })).toHaveCount(0)
  await expect(column(page, bug!.id).locator('[data-label-done]')).toHaveCount(1)
  /* And the open segment keeps its word, so the row says where you are. */
  expect(await worded('view-labels-mode')).toBe(true)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-labels.png` })

  /* The columns scroll sideways rather than squeezing: more of them than
     the screen is wide, and the board's own scroller answers for it. */
  const board = page.locator('[data-label-board]')
  expect(await board.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  /* And the switch still answers the other two: the board of lists, and the
     list itself. */
  await page.getByTestId('view-board').click()
  await expect(page).toHaveURL(/[?&]view=board/)
  await expect(page.locator('[data-card]').filter({ hasText: s.tasks.bug.title })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-label-board]')).toHaveCount(0)
  await page.getByTestId('view-list-mode').click()
  await expect(page.locator('[data-open-task]').filter({ hasText: s.tasks.bug.title })).toBeVisible({ timeout: 15_000 })
  await expect(page).not.toHaveURL(/[?&]view=(labels|board)/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  /* Reloaded at the address, the labels board is what a link opens on a
     phone too. */
  await page.goto(`/${s.ws}/${s.slug}/tasks?view=labels`)
  await expect(page.locator('[data-label-board]')).toBeVisible({ timeout: 15_000 })
  await expect(column(page, bug!.id).locator('[data-card]').filter({ hasText: s.tasks.both.title })).toHaveCount(1)
})

test('on a desk the switch keeps its words and Labels still draws the columns', async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 900 })
  await login(page)
  const s = await stage(page, Date.now())

  await page.goto(`/${s.ws}/${s.slug}/tasks`)
  await expect(page.locator('[data-open-task]').filter({ hasText: s.tasks.bug.title })).toBeVisible({ timeout: 15_000 })
  for (const testId of ['view-list-mode', 'view-board', 'view-labels-mode']) {
    const said = await page
      .getByTestId(testId)
      .evaluate((el) => [...el.querySelectorAll('span')].some((s) => s.textContent?.trim() && getComputedStyle(s).display !== 'none'))
    expect(said, `${testId} keeps its word on a desk`).toBe(true)
  }

  await page.getByTestId('view-labels-mode').click()
  await expect(page).toHaveURL(/[?&]view=labels/)
  const [bug] = s.labels
  await expect(column(page, bug!.id).locator('[data-card]').filter({ hasText: s.tasks.both.title })).toHaveCount(1, { timeout: 15_000 })
})
