import { test, expect, type Page, type Locator } from '@playwright/test'
import { login, drawnWhole, make } from './helpers.js'

/**
 * Tasks by person. On a desk, a third option
 * beside List and Board draws the board with a column for each assignee:
 * the head is the face, the name, the open count and a +; the cards are the
 * board's, with the task's list where the board draws the face; a task
 * given to two is in both columns, nobody's in No assignee, last; finished
 * work is counted, not drawn. The + makes a task given to that column's
 * person; a card carried to another column is given to that person
 * instead, and to No assignee is given to nobody. On a phone the option is
 * not there and `?view=people` draws the list. `PEOPLE_VIEW_SHOTS` names a
 * folder to keep a picture of the columns in.
 */
const SHOTS = process.env.PEOPLE_VIEW_SHOTS

type Staged = {
  ws: string
  slug: string
  me: string
  agent: string
  agentName: string
  open: string
  tasks: Record<'mine' | 'agents' | 'shared' | 'loose' | 'finished', { id: string; number: number; title: string }>
}

/** A project of its own, an agent on it, and five tasks spread between us. */
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
    const open = lists.find((l) => l.id === mine.list)!.name
    return { slug: p.slug, me, agent: agent_id, agentName, open, tasks: { mine, agents, shared, loose, finished } }
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

test('on a desk, People is the board with a column per assignee, and its + and its drag give the work', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await login(page)
  const s = await stage(page, Date.now())

  await page.goto(`/${s.ws}/${s.slug}/tasks?view=list`)
  await expect(page.locator('[data-open-task]').filter({ hasText: s.tasks.mine.title })).toBeVisible({ timeout: 15_000 })
  const option = page.getByTestId('view-people')
  await expect(option).toBeVisible()

  /* Drawn whole: a card appears at its height and keeps it. */
  const column = (key: string) => page.locator(`[data-person-column="${key}"]`)
  const cards = (key: string) => column(key).locator('[data-card]')
  const heights = await drawnWhole(page, `[data-person-column="${s.me}"] [data-card]`, () => option.click())
  expect(heights.length, `a card's heights: ${heights.join(', ')}`).toBe(1)
  await expect(page).toHaveURL(/[?&]view=people/)

  /* The heads: people, then agents, then No assignee, always last. */
  const keys = await page.locator('[data-person-column]').evaluateAll((els) => els.map((e) => e.getAttribute('data-person-column')))
  expect(keys).toEqual([s.me, s.agent, '~'])
  await expect(column(s.agent).locator('[data-person-name]')).toHaveText(s.agentName)
  await expect(column('~').locator('[data-person-name]')).toHaveText('No assignee')

  /* Mine: my task and the shared one; the finished one counted, not drawn. */
  await expect(cards(s.me)).toHaveCount(2)
  await expect(column(s.me)).not.toContainText(s.tasks.finished.title)
  await expect(column(s.me).locator('[data-count]')).toHaveText('2')
  await expect(column(s.me).locator('[data-person-done]')).toHaveText('1 done')
  /* The card's status where the board has the face: the list's ring and its name. */
  const mine = cards(s.me).filter({ hasText: s.tasks.mine.title })
  await expect(mine.locator('[data-card-status]')).toContainText(s.open)
  await expect(mine.locator(`[data-status="${s.open}"]`)).toHaveCount(1)
  /* The shared task in both, each with the other person beside its status. */
  await expect(cards(s.agent).filter({ hasText: s.tasks.shared.title })).toHaveCount(1)
  await expect(cards(s.me).filter({ hasText: s.tasks.shared.title }).locator('[data-card-others]')).toHaveCount(1)
  await expect(cards('~').filter({ hasText: s.tasks.loose.title })).toHaveCount(1)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/people-view.png` })

  /* The + in the agent's column makes a task given to the agent. */
  const made = `Made for the helper ${Date.now()}`
  await make(page, page.getByTestId(`add-for-${s.agent}`), made)
  await expect(page).toHaveURL(/[?&]view=people/)
  await expect(cards(s.agent).filter({ hasText: made })).toHaveCount(1, { timeout: 15_000 })

  /* Carried from my column to the agent's: I am taken off, the agent put on. */
  await carry(page, cards(s.me).filter({ hasText: s.tasks.mine.title }), column(s.agent))
  await expect(cards(s.agent).filter({ hasText: s.tasks.mine.title })).toHaveCount(1, { timeout: 10_000 })
  await expect(cards(s.me).filter({ hasText: s.tasks.mine.title })).toHaveCount(0)
  await expect.poll(() => assignees(page, s.tasks.mine.id), { timeout: 10_000 }).toEqual([s.agent])

  /* The shared one, to the agent's column, which already has it: I am only taken off. */
  await carry(page, cards(s.me).filter({ hasText: s.tasks.shared.title }), column(s.agent))
  await expect.poll(() => assignees(page, s.tasks.shared.id), { timeout: 10_000 }).toEqual([s.agent])
  await expect(cards(s.agent).filter({ hasText: s.tasks.shared.title })).toHaveCount(1)

  /* Carried to No assignee: given to nobody. */
  await carry(page, cards(s.agent).filter({ hasText: s.tasks.agents.title }), column('~'))
  await expect(cards('~').filter({ hasText: s.tasks.agents.title })).toHaveCount(1, { timeout: 10_000 })
  await expect.poll(() => assignees(page, s.tasks.agents.id), { timeout: 10_000 }).toEqual([])

  /* And after a reload, the columns say what the server holds. */
  await page.waitForLoadState('networkidle')
  await page.reload()
  await expect(cards(s.agent).filter({ hasText: s.tasks.mine.title })).toHaveCount(1, { timeout: 15_000 })
  await expect(cards(s.agent).filter({ hasText: s.tasks.shared.title })).toHaveCount(1)
  await expect(cards('~').filter({ hasText: s.tasks.agents.title })).toHaveCount(1)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/people-view-after.png` })

  /* Pressing a card opens its task, as on the board; back is the columns. */
  await cards(s.agent).filter({ hasText: s.tasks.mine.title }).locator('[data-open-task]').click()
  await expect(page).toHaveURL(new RegExp(`/tasks/${s.tasks.mine.number}(\\?|$)`))
  await expect(page.getByTestId('task-title')).toHaveValue(s.tasks.mine.title, { timeout: 15_000 })
  await page.goBack()
  await expect(page).toHaveURL(/[?&]view=people/)
  await expect(cards(s.agent).filter({ hasText: s.tasks.mine.title })).toHaveCount(1)
})

test('dark, for the picture', async ({ page }) => {
  test.skip(!SHOTS, 'only when pictures are asked for')
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await login(page)
  const s = await stage(page, Date.now())
  await page.goto(`/${s.ws}/${s.slug}/tasks?view=people`)
  await expect(page.locator(`[data-person-column="${s.me}"] [data-card]`)).toHaveCount(2, { timeout: 15_000 })
  /* Past the window's own arrival, which fades in. */
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${SHOTS}/people-view-dark.png` })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('People is not offered, and ?view=people draws the list', async ({ page }) => {
    await login(page)
    const s = await stage(page, Date.now())
    await page.goto(`/${s.ws}/${s.slug}/tasks?view=people`)
    await expect(page.locator('[data-open-task]').filter({ hasText: s.tasks.mine.title })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('view-people')).toHaveCount(0)
    await expect(page.locator('[data-person-column]')).toHaveCount(0)
    /* The address is left as it was. */
    await expect(page).toHaveURL(/[?&]view=people/)
  })
})
