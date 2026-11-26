import { test, expect, type Page } from '@playwright/test'
import { login, drawnWhole } from './helpers.js'

/**
 * Tasks by person. On a desk, a third option
 * beside List and Board draws a card for each assignee with their open
 * tasks and each task's list; a task given to two is in both cards, one
 * given to nobody in the last; finished work is counted, not drawn; an
 * agent's live status is the card's second line, the card no taller for
 * it; a task opens as a board card does. On a phone the option is not
 * there and `?view=people` draws the list. `PEOPLE_VIEW_SHOTS` names a
 * folder to keep a picture of the cards in.
 */
const SHOTS = process.env.PEOPLE_VIEW_SHOTS

type Staged = {
  ws: string
  slug: string
  me: string
  agent: string
  token: string
  agentName: string
  open: string
  done: string
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
    const { agent_id, token } = (await a.json()) as { agent_id: string; token: string }
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
    return {
      slug: p.slug,
      me,
      agent: agent_id,
      token,
      agentName,
      open,
      done: finishing.name,
      tasks: { mine, agents, shared, loose, finished },
    }
  }, n)
  if ('error' in made) throw new Error(String(made.error))
  return { ws, ...made }
}

test('on a desk, People draws a card per assignee with their open tasks and each one’s list', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page)
  const s = await stage(page, Date.now())

  await page.goto(`/${s.ws}/${s.slug}/tasks?view=list`)
  await expect(page.locator('[data-open-task]').filter({ hasText: s.tasks.mine.title })).toBeVisible({ timeout: 15_000 })
  const option = page.getByTestId('view-people')
  await expect(option).toBeVisible()

  /* Drawn whole: the card appears at its height and keeps it. */
  const mineCard = page.locator(`[data-person-card="${s.me}"]`)
  const heights = await drawnWhole(page, `[data-person-card="${s.me}"]`, () => option.click())
  expect(heights.length, `my card's heights: ${heights.join(', ')}`).toBe(1)
  await expect(page).toHaveURL(/[?&]view=people/)

  /* Mine: my own task and the shared one, not the finished one, which is counted. */
  const rows = (card: string) => page.locator(`[data-person-card="${card}"] [data-person-task]`)
  await expect(rows(s.me)).toHaveCount(2)
  /* In the board's order: one list, and in it the newer task first, as the
     board draws a list ordered by hand. */
  await expect(rows(s.me).nth(0)).toContainText(s.tasks.shared.title)
  await expect(rows(s.me).nth(1)).toContainText(s.tasks.mine.title)
  await expect(mineCard).not.toContainText(s.tasks.finished.title)
  await expect(mineCard.locator('[data-count]')).toHaveText('2')
  await expect(mineCard.locator('[data-person-second]')).toHaveText('1 done')
  /* Each task's status is its list. */
  await expect(rows(s.me).nth(0).locator('[data-person-task-status]')).toHaveText(s.open)

  /* The agent's: its own and the shared one — a task on two people is on both cards. */
  const agentCard = page.locator(`[data-person-card="${s.agent}"]`)
  await expect(agentCard.locator('[data-person-name]')).toHaveText(s.agentName)
  await expect(rows(s.agent)).toHaveCount(2)
  await expect(agentCard).toContainText(s.tasks.agents.title)
  await expect(agentCard).toContainText(s.tasks.shared.title)
  await expect(agentCard.locator('[data-person-second]')).toHaveText('Nothing done yet')

  /* Nobody's work in the last card. */
  const cards = page.locator('[data-person-card]')
  await expect(cards).toHaveCount(3)
  await expect(cards.last()).toHaveAttribute('data-person-card', '~')
  await expect(cards.last()).toContainText('No assignee')
  await expect(cards.last()).toContainText(s.tasks.loose.title)

  /* The agent says what it is doing: the second line, live, and the card no taller. */
  const before = await agentCard.evaluate((el) => Math.round(el.getBoundingClientRect().height))
  const said = await page.evaluate(
    async ({ token, taskId }) =>
      (
        await fetch('/api/me/status', {
          method: 'PUT',
          headers: { authorization: `Bearer ${token}`, 'x-api-version': '1', 'content-type': 'application/json' },
          body: JSON.stringify({ task_id: taskId, doing: 'reading the handler' }),
        })
      ).status,
    { token: s.token, taskId: s.tasks.agents.id },
  )
  expect(said).toBe(200)
  await expect(agentCard.locator('[data-person-second]')).toHaveText('reading the handler', { timeout: 15_000 })
  expect(await agentCard.evaluate((el) => Math.round(el.getBoundingClientRect().height))).toBe(before)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/people-view.png` })

  /* Pressing a task opens it, as a card on the board does; back is the cards. */
  await rows(s.me).filter({ hasText: s.tasks.mine.title }).click()
  await expect(page).toHaveURL(new RegExp(`/tasks/${s.tasks.mine.number}\\b`))
  await expect(page.getByTestId('task-title')).toHaveValue(s.tasks.mine.title, { timeout: 15_000 })
  await page.goBack()
  await expect(page).toHaveURL(/[?&]view=people/)
  await expect(rows(s.me)).toHaveCount(2)

  /* Whose narrows the cards: mine is my card alone. */
  await page.goto(`/${s.ws}/${s.slug}/tasks?view=people&who=mine`)
  await expect(cards).toHaveCount(1, { timeout: 15_000 })
  await expect(cards.first()).toHaveAttribute('data-person-card', s.me)
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('People is not offered, and ?view=people draws the list', async ({ page }) => {
    await login(page)
    const s = await stage(page, Date.now())
    await page.goto(`/${s.ws}/${s.slug}/tasks?view=people`)
    await expect(page.locator('[data-open-task]').filter({ hasText: s.tasks.mine.title })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('view-people')).toHaveCount(0)
    await expect(page.locator('[data-person-card]')).toHaveCount(0)
    /* The address is left as it was. */
    await expect(page).toHaveURL(/[?&]view=people/)
  })
})
