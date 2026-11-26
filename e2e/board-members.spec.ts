import { test, expect, type Page, type Locator } from '@playwright/test'
import { login, drawnWhole, make, viewAnswers } from './helpers.js'

/**
 * The board by members. On a desk the board's
 * View menu asks what its columns are, Lists or Members, kept as the
 * grouping (`?group=who`). Members draws a column for each assignee: the
 * head is the face, the name, the open count and a +; the cards are the
 * board's, with the task's list where the board draws the face; a task
 * given to two is in both columns, nobody's in No assignee, last; finished
 * work is counted, not drawn. The + makes a task given to that column's
 * person; a card carried to another column is given to that person
 * instead, and to No assignee is given to nobody. A list grouped by
 * assignee switched to Board opens on the members. On a phone the choice is
 * not there and the board draws its lists. `PEOPLE_VIEW_SHOTS` names a
 * folder to keep pictures in.
 */
const SHOTS = process.env.PEOPLE_VIEW_SHOTS

type Staged = {
  ws: string
  slug: string
  me: string
  agent: string
  agentName: string
  open: string
  tasks: Record<'mine' | 'agents' | 'shared' | 'loose' | 'finished' | 'draft', { id: string; number: number; title: string }>
}

/** A project of its own, an agent on it, and six tasks spread between us. */
async function stage(page: Page, n: number): Promise<Staged> {
  const ws = new URL(page.url()).pathname.split('/')[1]!
  const made = await page.evaluate(async (n) => {
    const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
    const h = { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1', 'content-type': 'application/json' }
    const p = (await (
      await fetch('/api/projects', { method: 'POST', headers: h, body: JSON.stringify({ name: `By person ${n}` }) })
    ).json()) as {
      id: string
      slug: string
    }
    const agentName = `Helper ${String(n).slice(-5)}`
    const a = await fetch('/api/agents', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ name: agentName, project_ids: [p.id], reach: 'mcp' }),
    })
    if (!a.ok) return { error: `agents ${a.status}` }
    const { agent_id } = (await a.json()) as { agent_id: string }
    const { members } = (await (await fetch(`/api/projects/${p.id}/members`, { headers: h })).json()) as {
      members: { actor_id: string; agent?: boolean }[]
    }
    const me = members.find((m) => !m.agent)!.actor_id
    const { lists } = (await (await fetch(`/api/projects/${p.id}/lists`, { headers: h })).json()) as {
      lists: { id: string; name: string; finishes: boolean; intake?: boolean }[]
    }
    const finishing = lists.find((l) => l.finishes)!
    const make = async (title: string, assignee_ids: string[]) => {
      const t = await fetch(`/api/projects/${p.id}/tasks`, { method: 'POST', headers: h, body: JSON.stringify({ title, assignee_ids }) })
      const { id } = (await t.json()) as { id: string }
      const read = (await (await fetch(`/api/tasks/${id}`, { headers: h })).json()) as { task: { number: number; list_id: string } }
      return { id, number: read.task.number, title, list: read.task.list_id }
    }
    const mine = await make(`Write the brief ${n}`, [me])
    const agents = await make(`Read the handler ${n}`, [agent_id])
    const shared = await make(`Review the copy ${n}`, [me, agent_id])
    const loose = await make(`Pick a name ${n}`, [])
    const finished = await make(`Book the room ${n}`, [me])
    await fetch(`/api/tasks/${finished.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ list_id: finishing.id }) })
    const draft = await make(`Draft the plan ${n}`, [me])
    const open = lists.find((l) => l.id === mine.list)!.name
    return { slug: p.slug, me, agent: agent_id, agentName, open, tasks: { mine, agents, shared, loose, finished, draft } }
  }, n)
  if ('error' in made) throw new Error(String(made.error))
  return { ws, ...made }
}

/** Who the server says a task is given to. */
async function assignees(page: Page, id: string): Promise<string[]> {
  return page.evaluate(async (id) => {
    const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
    const r = await fetch(`/api/tasks/${id}`, { headers: { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1' } })
    const { task } = (await r.json()) as { task: { assignee_ids?: string[] } }
    return [...(task.assignee_ids ?? [])].sort()
  }, id)
}

/** Carry a card by the pointer and let it go over a column. */
async function carry(page: Page, card: Locator, column: Locator) {
  const from = (await card.boundingBox())!
  const onto = (await column.boundingBox())!
  await page.mouse.move(from.x + 40, from.y + 12)
  await page.mouse.down()
  await page.mouse.move(from.x + 56, from.y + 26, { steps: 4 })
  await page.mouse.move(onto.x + onto.width / 2, onto.y + 160, { steps: 20 })
  await page.mouse.up()
}

/** The titles of a column's cards, top to bottom. */
async function order(column: Locator): Promise<string[]> {
  return column.locator('[data-card] [data-open-task]').allTextContents()
}

/**
 * Carry a card and let it go with its top at `y`, over the column's middle —
 * where the board measures a drop from: the leading edge past a neighbour's
 * middle. Held where it was taken, twelve down from its top.
 */
async function carryTo(page: Page, card: Locator, column: Locator, y: number, before?: () => Promise<void>) {
  const from = (await card.boundingBox())!
  const onto = (await column.boundingBox())!
  await page.mouse.move(from.x + 40, from.y + 12)
  await page.mouse.down()
  await page.mouse.move(from.x + 56, from.y + 26, { steps: 4 })
  await page.mouse.move(onto.x + onto.width / 2, y + 12, { steps: 20 })
  await page.mouse.move(onto.x + onto.width / 2 + 2, y + 12, { steps: 2 })
  if (before) await before()
  await page.mouse.up()
}

test('on a desk, the board’s Columns choice draws a column per member, and its + and its drag give and place the work', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 900 })
  await login(page)
  const s = await stage(page, Date.now())

  /* Two drawings in the switch, and no third. */
  await page.goto(`/${s.ws}/${s.slug}/tasks?view=board`)
  await expect(page.locator('[data-card]').filter({ hasText: s.tasks.mine.title })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('view-members')).toHaveCount(0)

  /* The board's View menu asks what the columns are, first. */
  await viewAnswers(page, true)
  await expect(page.getByTestId('view-columns')).toBeVisible()
  await expect(page.getByTestId('view-columns-list')).toHaveAttribute('aria-checked', 'true')
  if (SHOTS) {
    /* Once the panel has slid in. */
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${SHOTS}/board-members-menu.png` })
  }

  /* Drawn whole: a card appears at its height and keeps it. */
  const column = (key: string) => page.locator(`[data-person-column="${key}"]`)
  const cards = (key: string) => column(key).locator('[data-card]')
  const heights = await drawnWhole(page, `[data-person-column="${s.me}"] [data-card]`, () =>
    page.getByTestId('view-columns-members').click(),
  )
  expect(heights.length, `a card's heights: ${heights.join(', ')}`).toBe(1)
  await expect(page).toHaveURL(/[?&]view=board/)
  await expect(page).toHaveURL(/[?&]group=who/)
  await viewAnswers(page, false)

  /* The heads: No assignee first, then people, then agents. */
  const keys = await page.locator('[data-person-column]').evaluateAll((els) => els.map((e) => e.getAttribute('data-person-column')))
  expect(keys).toEqual(['~', s.me, s.agent])
  await expect(column(s.agent).locator('[data-person-name]')).toHaveText(s.agentName)
  await expect(column('~').locator('[data-person-name]')).toHaveText('No assignee')

  /* Mine, in the list's order — newest first, as made: the finished one counted, not drawn. */
  await expect.poll(() => order(column(s.me))).toEqual([s.tasks.draft.title, s.tasks.shared.title, s.tasks.mine.title])
  await expect(column(s.me)).not.toContainText(s.tasks.finished.title)
  await expect(column(s.me).locator('[data-count]')).toHaveText('3')
  await expect(column(s.me).locator('[data-person-done]')).toHaveText('1 done')

  /* The status is a ring before the title, named for whoever cannot see it; no list's name in words. */
  const mine = cards(s.me).filter({ hasText: s.tasks.mine.title })
  const ring = mine.locator(`[data-card-status] [data-status="${s.open}"]`)
  await expect(ring).toHaveAttribute('aria-label', `Status: ${s.open}`)
  await expect(mine).not.toContainText(s.open)
  expect(await mine.locator('[data-card-status]').evaluate((el) => el.nextElementSibling?.matches('[data-open-task]'))).toBe(true)
  const [ringBox, titleBox] = [(await ring.boundingBox())!, (await mine.locator('[data-open-task]').boundingBox())!]
  expect(ringBox.x).toBeLessThan(titleBox.x)
  expect(Math.abs(ringBox.y + ringBox.height / 2 - (titleBox.y + 10))).toBeLessThan(4)
  /* The shared task in both, each with the other person in the corner. */
  await expect(cards(s.agent).filter({ hasText: s.tasks.shared.title })).toHaveCount(1)
  await expect(cards(s.me).filter({ hasText: s.tasks.shared.title }).locator('[data-card-others]')).toHaveCount(1)
  await expect(cards(s.me).filter({ hasText: s.tasks.mine.title }).locator('[data-card-others]')).toHaveCount(0)
  await expect(cards('~').filter({ hasText: s.tasks.loose.title })).toHaveCount(1)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/board-members.png` })

  /*
   * Reordered within my column, to the top — and no face is drawn again on
   * the way: every face in the heads and the corners is the same node after
   * the drag as before it.
   */
  await page.evaluate(() => {
    const w = window as unknown as { faces: Element[] }
    w.faces = [...document.querySelectorAll('[data-person-face] > *, [data-card-others] > *')]
  })
  const top = (await cards(s.me).first().boundingBox())!.y
  await carryTo(page, mine, column(s.me), top)
  await expect.poll(() => order(column(s.me))).toEqual([s.tasks.mine.title, s.tasks.draft.title, s.tasks.shared.title])
  const kept = await page.evaluate(() => {
    const w = window as unknown as { faces: Element[] }
    return { all: w.faces.length, kept: w.faces.filter((f) => f.isConnected).length }
  })
  expect(kept.all).toBeGreaterThan(0)
  expect(kept.kept).toBe(kept.all)

  /* Into the agent's column, between its two cards: given to the agent, placed there. */
  const shared = cards(s.agent).filter({ hasText: s.tasks.shared.title })
  await expect.poll(() => order(column(s.agent))).toEqual([s.tasks.shared.title, s.tasks.agents.title])
  const under = (await shared.boundingBox())!
  await carryTo(page, cards(s.me).filter({ hasText: s.tasks.draft.title }), column(s.agent), under.y + under.height + 4, async () => {
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/board-members-gap.png` })
  })
  await expect.poll(() => order(column(s.agent))).toEqual([s.tasks.shared.title, s.tasks.draft.title, s.tasks.agents.title])
  await expect.poll(() => assignees(page, s.tasks.draft.id), { timeout: 10_000 }).toEqual([s.agent])

  /* And after a reload, the places and the people are the server's. */
  await page.waitForLoadState('networkidle')
  await page.reload()
  await expect.poll(() => order(column(s.me)), { timeout: 15_000 }).toEqual([s.tasks.mine.title, s.tasks.shared.title])
  await expect.poll(() => order(column(s.agent))).toEqual([s.tasks.shared.title, s.tasks.draft.title, s.tasks.agents.title])

  /* The + in the agent's column makes a task given to the agent. */
  const made = `Made for the helper ${Date.now()}`
  await make(page, page.getByTestId(`add-for-${s.agent}`), made)
  await expect(page).toHaveURL(/[?&]group=who/)
  await expect(cards(s.agent).filter({ hasText: made })).toHaveCount(1, { timeout: 15_000 })

  /*
   * The shared one, to the agent's column, which already has it: I am only
   * taken off. While it is over that column, the agent's own card of it —
   * with my face in its corner — stays the same node rather than leaving
   * for a gap and coming back.
   */
  /* Every face but the carried card's own, which goes up with it. */
  await page.evaluate((carried) => {
    const w = window as unknown as { faces: Element[] }
    w.faces = [...document.querySelectorAll('[data-person-face] > *, [data-card-others] > *')].filter(
      (f) => f.closest('[data-card]')?.getAttribute('data-card') !== carried,
    )
  }, `${s.me}/${s.tasks.shared.id}`)
  const agentsShared = (await cards(s.agent).filter({ hasText: s.tasks.shared.title }).boundingBox())!
  await carryTo(page, cards(s.me).filter({ hasText: s.tasks.shared.title }), column(s.agent), agentsShared.y, async () => {
    const still = await page.evaluate(() => (window as unknown as { faces: Element[] }).faces.filter((f) => !f.isConnected).length)
    expect(still, 'faces made again while carried').toBe(0)
  })
  await expect.poll(() => assignees(page, s.tasks.shared.id), { timeout: 10_000 }).toEqual([s.agent])
  await expect(cards(s.agent).filter({ hasText: s.tasks.shared.title })).toHaveCount(1)

  /* Carried to No assignee: given to nobody. */
  await carry(page, cards(s.agent).filter({ hasText: s.tasks.agents.title }), column('~'))
  await expect(cards('~').filter({ hasText: s.tasks.agents.title })).toHaveCount(1, { timeout: 10_000 })
  await expect.poll(() => assignees(page, s.tasks.agents.id), { timeout: 10_000 }).toEqual([])

  await page.waitForLoadState('networkidle')
  await page.reload()
  await expect(cards(s.agent).filter({ hasText: s.tasks.shared.title })).toHaveCount(1, { timeout: 15_000 })
  await expect(cards('~').filter({ hasText: s.tasks.agents.title })).toHaveCount(1)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/board-members-after.png` })

  /* Pressing a card opens its task, as on the board; back is the columns. */
  await cards(s.me).filter({ hasText: s.tasks.mine.title }).locator('[data-open-task]').click()
  await expect(page).toHaveURL(new RegExp(`/tasks/${s.tasks.mine.number}(\\?|$)`))
  await expect(page.getByTestId('task-title')).toHaveValue(s.tasks.mine.title, { timeout: 15_000 })
  await page.goBack()
  await expect(page).toHaveURL(/[?&]group=who/)
  await expect(cards(s.me).filter({ hasText: s.tasks.mine.title })).toHaveCount(1)
})

test('one answer to grouped by what: a list grouped by assignee opens the board on its members, and Reset puts the lists back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 900 })
  await login(page)
  const s = await stage(page, Date.now())

  await page.goto(`/${s.ws}/${s.slug}/tasks?view=list&group=who`)
  await expect(page.locator('[data-open-task]').filter({ hasText: s.tasks.mine.title })).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('view-board').click()
  await expect(page.locator(`[data-person-column="${s.me}"] [data-card]`)).toHaveCount(3, { timeout: 15_000 })
  await expect(page).toHaveURL(/[?&]group=who/)

  /* The board's Reset: the lists again, and the grouping with them. */
  await viewAnswers(page, true)
  await page.getByTestId('view-reset').click()
  await expect(page.locator('[data-person-column]')).toHaveCount(0)
  await expect(page.locator('[data-card]').filter({ hasText: s.tasks.mine.title })).toBeVisible()
  await expect(page.getByTestId('view-columns-list')).toHaveAttribute('aria-checked', 'true')
  await expect(page).not.toHaveURL(/group=who/)

  /* A grouping the board does not draw is the list's, and the board draws lists for it. */
  await page.goto(`/${s.ws}/${s.slug}/tasks?view=board&group=priority`)
  await expect(page.locator('[data-card]').filter({ hasText: s.tasks.mine.title })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-person-column]')).toHaveCount(0)
  await expect(page).toHaveURL(/[?&]group=priority/)
})

test('dark, for the picture', async ({ page }) => {
  test.skip(!SHOTS, 'only when pictures are asked for')
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await login(page)
  const s = await stage(page, Date.now())
  await page.goto(`/${s.ws}/${s.slug}/tasks?view=board&group=who`)
  await expect(page.locator(`[data-person-column="${s.me}"] [data-card]`)).toHaveCount(3, { timeout: 15_000 })
  /* Past the window's own arrival, which fades in. */
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${SHOTS}/board-members-dark.png` })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the Columns choice is not offered, and the board draws its lists whatever the grouping', async ({ page }) => {
    await login(page)
    const s = await stage(page, Date.now())
    await page.goto(`/${s.ws}/${s.slug}/tasks?view=board&group=who`)
    await expect(page.locator('[data-card]').filter({ hasText: s.tasks.mine.title })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-person-column]')).toHaveCount(0)
    await page.getByTestId('view-menu').click()
    await expect(page.getByTestId('view-who')).toBeVisible()
    await expect(page.getByTestId('view-columns')).toHaveCount(0)
    /* The address is left as it was. */
    await expect(page).toHaveURL(/[?&]group=who/)
  })
})
