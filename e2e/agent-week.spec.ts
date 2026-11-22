import { test, expect } from '@playwright/test'
import { drawnWhole, login, openProject } from './helpers.js'

/**
 * What an agent did this week, on its page.
 * The page opens with the week already in it, a number pressed opens the
 * tasks it counted, whole, and a task opens from there. What is counted,
 * and that a reader sees nothing of a project they are not on, are the
 * server's tests (`agent-week.test.ts`).
 */
test('an agent’s week: the numbers, a press on one, and its tasks', async ({ page }) => {
  await login(page)
  await openProject(page, 'Website')
  const stamp = Date.now()

  /* An agent on the project, given two tasks — one finished — asking a
     question on one and reporting what it spent on it. */
  const made = await page.evaluate(async (n) => {
    const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
    const h = { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1', 'content-type': 'application/json' }
    const projects = (await (await fetch('/api/projects', { headers: h })).json()) as { projects: { id: string; name: string }[] }
    const p = projects.projects.find((x) => x.name === 'Website')!
    const agent = await fetch('/api/agents', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ name: `Weekly ${String(n).slice(-5)}`, project_ids: [p.id], reach: 'mcp' }),
    })
    if (!agent.ok) return { error: `agents ${agent.status}` }
    const { agent_id, token } = (await agent.json()) as { agent_id: string; token: string }
    const as = { ...h, authorization: `Bearer ${token}` }
    const ids: string[] = []
    for (const title of [`Week open ${n}`, `Week done ${n}`]) {
      const t = await fetch(`/api/projects/${p.id}/tasks`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ title, assignee_ids: [agent_id] }),
      })
      if (!t.ok) return { error: `task ${t.status}` }
      ids.push(((await t.json()) as { id: string }).id)
    }
    const done = await fetch(`/api/tasks/${ids[1]}`, { method: 'PATCH', headers: h, body: JSON.stringify({ completed: true }) })
    if (!done.ok) return { error: `finish ${done.status}` }
    const said = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keep the old route?' }] }] }
    const q = await fetch(`/api/tasks/${ids[0]}/comments`, {
      method: 'POST',
      headers: as,
      body: JSON.stringify({ body: said, choices: [{ label: 'Keep it' }, { label: 'Remove it' }] }),
    })
    if (!q.ok) return { error: `ask ${q.status}` }
    const spent = await fetch(`/api/tasks/${ids[0]}/spend`, {
      method: 'POST',
      headers: as,
      body: JSON.stringify({ client: 'Claude Code', tokens: 1_200_000, cost_usd: 4.8, session: `s-${n}` }),
    })
    if (!spent.ok) return { error: `spend ${spent.status}` }
    return { agent: agent_id }
  }, stamp)
  expect(made, JSON.stringify(made)).toHaveProperty('agent')
  const agent = (made as { agent: string }).agent

  /* Its row read ahead under the pointer, and the page opens with the week in it. */
  await page.getByTestId('nav-members').click()
  const row = page.locator(`[data-members-column] [data-agent="${agent}"]`)
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.hover()
  await page.waitForTimeout(400)
  const opening = await drawnWhole(page, '[data-agent-week]', () => row.click())
  expect(opening).toHaveLength(1)
  const week = page.locator('[data-agent-week]')
  await expect(week).toContainText('This week')
  await expect(week.locator('[data-agent-tile="took"] [data-n]')).toHaveText('2')
  await expect(week.locator('[data-agent-tile="finished"] [data-n]')).toHaveText('1')
  await expect(week.locator('[data-agent-tile="open"] [data-n]')).toHaveText('1')
  await expect(week.locator('[data-agent-tile="asked"] [data-n]')).toHaveText('1')
  await expect(week.locator('[data-agent-tile="spend"] [data-n]')).toHaveText('1.2M')
  await expect(week.locator('[data-agent-tile="spend"]')).toContainText('$4.80')
  /* Its latest lines: the question it asked. */
  await expect(week.locator('[data-agent-latest] [data-event]').first()).toBeVisible()

  /* A number pressed: its tasks, drawn with their rows. */
  const took = week.locator('[data-agent-tile="took"]')
  await took.hover()
  await page.waitForTimeout(400)
  const list = await drawnWhole(page, '[data-agent-week-list="took"]', () => took.click())
  expect(list).toHaveLength(1)
  const rows = week.locator('[data-agent-week-list="took"] [data-agent-week-task]')
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: `Week open ${stamp}` })).toHaveCount(1)
  await expect(rows.filter({ hasText: `Week done ${stamp}` })).toHaveCount(1)

  /* Pressed again, it closes; the spend opens its task with what it took. */
  await took.click()
  await expect(week.locator('[data-agent-week-list]')).toHaveCount(0)
  await week.locator('[data-agent-tile="spend"]').click()
  const spent = week.locator('[data-agent-week-list="spend"] [data-agent-week-task]')
  await expect(spent).toHaveCount(1)
  await expect(spent).toContainText('1.2M · $4.80')

  /* The month: the same numbers here, under its own heading. */
  await page.getByTestId('agent-week-month').click()
  await expect(week).toContainText('This month')
  await expect(week.locator('[data-agent-tile="took"] [data-n]')).toHaveText('2')

  /* A task opens from its row. */
  await spent.locator('[data-open-work]').click()
  await expect(page).toHaveURL(/\/tasks\/\d+/, { timeout: 15_000 })
  await expect(page.getByText(`Week open ${stamp}`).first()).toBeVisible()
})
