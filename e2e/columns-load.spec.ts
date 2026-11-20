import { test, expect, type Page } from '@playwright/test'
import { login } from './helpers.js'

/**
 * A board reads each list on its own: the head of every column and its
 * count first, the rest of a column as somebody scrolls down it.
 * A Done column of a hundred and sixty cards
 * drawn at once ended the page on a phone.
 */

const MANY = 130
const PAGE = 50

type Made = { id: string; slug: string; first: string; second: string; mover: string }

/* A project whose first list holds more than two pages, and one card in
   the second list to carry across. Through the API, as the seed would. */
async function tallProject(page: Page): Promise<{ ws: string; made: Made }> {
  await login(page)
  const ws = new URL(page.url()).pathname.split('/')[1]!
  const made = await page.evaluate(
    async ({ name, many }) => {
      const s = JSON.parse(localStorage.getItem('session') ?? 'null') as { access_token: string }
      const ask = <T>(path: string, body?: unknown) =>
        fetch(path, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1', 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }).then((r) => r.json() as Promise<T>)
      const p = await ask<{ id: string; slug: string }>('/api/projects', { name })
      const { lists } = await ask<{ lists: { id: string; intake: boolean }[] }>(`/api/projects/${p.id}/lists`)
      const open = lists.filter((l) => !l.intake)
      const first = open[0]!.id
      const second = open[1]!.id
      for (let i = 0; i < many; i++)
        await ask(`/api/projects/${p.id}/tasks`, { title: `Card ${String(i + 1).padStart(3, '0')}`, list_id: first })
      const mover = await ask<{ id: string }>(`/api/projects/${p.id}/tasks`, { title: 'Mover', list_id: second })
      return { id: p.id, slug: p.slug, first, second, mover: mover.id }
    },
    { name: `Tall columns ${Date.now()}`, many: MANY },
  )
  return { ws, made }
}

/* The server's order of a list's first cards, read as the board reads it. */
async function serverOrder(page: Page, projectId: string, listId: string): Promise<string[]> {
  return page.evaluate(
    async ({ projectId, listId }) => {
      const s = JSON.parse(localStorage.getItem('session') ?? 'null') as { access_token: string }
      const r = await fetch(`/api/projects/${projectId}/tasks?by=list&limit=10`, {
        headers: { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1' },
      })
      const page = (await r.json()) as { tasks: { title: string; list_id: string; parent_id: string | null }[] }
      return page.tasks.filter((t) => t.list_id === listId && !t.parent_id).map((t) => t.title)
    },
    { projectId, listId },
  )
}

test('a column reads its head first and the rest as it is scrolled, with nothing moving under the reader', async ({ page }) => {
  const { ws, made } = await tallProject(page)
  await page.goto(`/${ws}/${made.slug}/tasks?view=board`)
  const column = page.locator(`[data-list="${made.first}"]`)
  const scroller = column.locator('[data-column-scroll]')

  /* The head says the list's count from the first draw; one page of cards
     is drawn, and room for the rest is held under them. */
  await expect(scroller.locator('[data-card]')).toHaveCount(PAGE, { timeout: 15_000 })
  await expect(column.locator('[data-count]')).toHaveText(String(MANY))
  await expect(scroller.locator('[data-unread]')).toHaveAttribute('data-unread', String(MANY - PAGE))
  const room = await scroller.evaluate((el) => el.scrollHeight)
  const box = (await column.boundingBox())!

  /* Down to the last few cards drawn: the next page is read before the end
     is reached. Watched frame by frame from here — the card at the top of
     the column and the length of the scroll — until it lands. */
  const watched = await scroller.evaluate(async (el) => {
    const at = () => el.querySelectorAll('[data-card]')[42]!.getBoundingClientRect().top
    /* Scrolled and measured in one go, before anything could answer. */
    el.scrollTop += el.querySelectorAll('[data-card]')[42]!.getBoundingClientRect().top - el.getBoundingClientRect().top
    const start = { top: at(), height: el.scrollHeight }
    const moved: number[] = []
    const grew: number[] = []
    const t0 = performance.now()
    while (el.querySelectorAll('[data-card]').length <= 50 && performance.now() - t0 < 10_000) {
      await new Promise((done) => requestAnimationFrame(done))
      moved.push(Math.abs(at() - start.top))
      grew.push(Math.abs(el.scrollHeight - start.height))
    }
    await new Promise((done) => requestAnimationFrame(done))
    moved.push(Math.abs(at() - start.top))
    grew.push(Math.abs(el.scrollHeight - start.height))
    return { cards: el.querySelectorAll('[data-card]').length, moved: Math.max(...moved), grew: Math.max(...grew) }
  })
  expect(watched.cards).toBe(PAGE * 2)
  expect(watched.moved, 'the card being read never moved').toBeLessThanOrEqual(1)
  /* The room held was the room taken: the cards are one height, so the
     scroll's length is what it was, give or take a gap. */
  expect(watched.grew, 'the column did not grow or shrink under the reader').toBeLessThanOrEqual(12)
  expect(Math.abs((await scroller.evaluate((el) => el.scrollHeight)) - room)).toBeLessThanOrEqual(12)
  /* The column itself is the size it was. */
  const after = (await column.boundingBox())!
  expect(Math.round(after.height)).toBe(Math.round(box.height))
  await expect(column.locator('[data-count]')).toHaveText(String(MANY))

  /* And to the end: every card, once, and no room left over. */
  await expect
    .poll(
      async () => {
        await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight))
        return scroller.locator('[data-card]').count()
      },
      { timeout: 15_000 },
    )
    .toBe(MANY)
  await expect(scroller.locator('[data-unread]')).toHaveCount(0)
  const titles = await scroller.locator('[data-card] [data-open-task]').allTextContents()
  expect(new Set(titles).size).toBe(MANY)
})

test('a card dropped into a column not fully read lands where it was dropped, and the server agrees', async ({ page }) => {
  const { ws, made } = await tallProject(page)
  await page.goto(`/${ws}/${made.slug}/tasks?view=board`)
  const column = page.locator(`[data-list="${made.first}"]`)
  const scroller = column.locator('[data-column-scroll]')
  await expect(scroller.locator('[data-card]')).toHaveCount(PAGE, { timeout: 15_000 })

  /* Carried from the second column and let go over the lower half of the
     third card of the first, which is far above anything unread. */
  const mover = page.locator(`[data-list="${made.second}"] [data-card]`).filter({ hasText: 'Mover' })
  const from = (await mover.boundingBox())!
  const onto = (await scroller.locator('[data-card]').nth(2).boundingBox())!
  await page.mouse.move(from.x + 40, from.y + 12)
  await page.mouse.down()
  await page.mouse.move(from.x + 56, from.y + 26, { steps: 4 })
  await page.mouse.move(onto.x + 40, onto.y + onto.height - 6, { steps: 20 })
  await page.mouse.up()

  await expect(scroller.locator('[data-card]').filter({ hasText: 'Mover' })).toBeVisible({ timeout: 10_000 })
  await expect(column.locator('[data-count]')).toHaveText(String(MANY + 1))
  await expect(scroller.locator('[data-card]')).toHaveCount(PAGE + 1)
  const drawn = (await scroller.locator('[data-card] [data-open-task]').allTextContents()).slice(0, 10)
  expect(drawn.slice(0, 5)).toContain('Mover')

  /* Where the server put it is where the board drew it — the key worked
     out there between the card it was dropped after and the next one. */
  await expect.poll(() => serverOrder(page, made.id, made.first), { timeout: 10_000 }).toEqual(drawn)

  /* And after a reload, read by list again, it is still there — the
     column as deep as it was drawn, its fifty and the one dropped in, and
     not a card more: Settled first, or the
     reload cancels the move on its way, and long enough for the device to
     have kept what it drew (memory.ts writes a second after a change). */
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
  await page.reload()
  await expect(scroller.locator('[data-card]')).toHaveCount(PAGE + 1, { timeout: 15_000 })
  await page.waitForTimeout(1000)
  await expect(scroller.locator('[data-card]')).toHaveCount(PAGE + 1)
  expect((await scroller.locator('[data-card] [data-open-task]').allTextContents()).slice(0, 10)).toEqual(drawn)
  await expect(column.locator('[data-count]')).toHaveText(String(MANY + 1))
})

test.describe('a phone reading a tall board', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('draws one page of a column, counts the rest, and reads more as it is scrolled', async ({ page }) => {
    const { ws, made } = await tallProject(page)
    await page.goto(`/${ws}/${made.slug}/tasks?view=board`)
    const column = page.locator(`[data-list="${made.first}"]`)
    const scroller = column.locator('[data-column-scroll]')
    await expect(scroller.locator('[data-card]')).toHaveCount(PAGE, { timeout: 15_000 })
    await expect(column.locator('[data-count]')).toHaveText(String(MANY))

    await expect
      .poll(
        async () => {
          await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight))
          return scroller.locator('[data-card]').count()
        },
        { timeout: 15_000 },
      )
      .toBe(MANY)
    // Only the column moved; the window never did.
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  })
})
