import { test, expect, type Page } from '@playwright/test'
import { login } from './helpers.js'

/**
 * What an agent says it is doing now. Said
 * through its token, it reaches the open board live, on the card's head and
 * the list's row, without the card changing height; on the task it stands in
 * for the assignees' line; and it goes when the agent stops or three minutes
 * after it last said anything. Who may say it and who may see it are the
 * server's tests (`agent-status.test.ts`).
 */

type Staged = { ws: string; slug: string; taskId: string; number: number; agent: string; token: string; name: string }

/** A project of its own, an agent on it, and a task given to the agent. */
async function stage(page: Page, n: number): Promise<Staged> {
  const ws = new URL(page.url()).pathname.split('/')[1]!
  const made = await page.evaluate(async (n) => {
    const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
    const h = { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1', 'content-type': 'application/json' }
    const p = (await (
      await fetch('/api/projects', { method: 'POST', headers: h, body: JSON.stringify({ name: `Agent at work ${n}` }) })
    ).json()) as {
      id: string
      slug: string
    }
    const name = `Worker ${String(n).slice(-5)}`
    const agent = await fetch('/api/agents', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ name, project_ids: [p.id], reach: 'mcp' }),
    })
    if (!agent.ok) return { error: `agents ${agent.status}` }
    const { agent_id, token } = (await agent.json()) as { agent_id: string; token: string }
    const t = await fetch(`/api/projects/${p.id}/tasks`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ title: `Read the handler ${n}`, assignee_ids: [agent_id] }),
    })
    if (!t.ok) return { error: `task ${t.status}` }
    const { id } = (await t.json()) as { id: string }
    const read = (await (await fetch(`/api/tasks/${id}`, { headers: h })).json()) as { task: { number: number } }
    return { slug: p.slug, taskId: id, number: read.task.number, agent: agent_id, token, name }
  }, n)
  if ('error' in made) throw new Error(String(made.error))
  return { ws, ...made }
}

/** The agent says it, through its own token. */
async function say(page: Page, s: Staged, doing: string | null) {
  const status = await page.evaluate(
    async ({ token, taskId, doing }) =>
      (
        await fetch('/api/me/status', {
          method: 'PUT',
          headers: { authorization: `Bearer ${token}`, 'x-api-version': '1', 'content-type': 'application/json' },
          body: JSON.stringify({ task_id: doing === null ? null : taskId, doing }),
        })
      ).status,
    { token: s.token, taskId: s.taskId, doing },
  )
  expect(status).toBe(200)
}

test('an agent’s status reaches the board live, the list and the task, and goes when it stops or goes quiet', async ({ page }) => {
  await page.clock.install()
  await login(page)
  const n = Date.now()
  const s = await stage(page, n)

  /* The board, open before the agent says anything: it hears it live. */
  await page.goto(`/${s.ws}/${s.slug}/tasks?view=board`)
  const card = page.locator(`[data-card="${s.taskId}"]`)
  await expect(card).toBeVisible({ timeout: 15_000 })
  await expect(card.locator('[data-agent-doing]')).toHaveCount(0)
  const before = await card.evaluate((el) => Math.round(el.getBoundingClientRect().height))

  await say(page, s, 'reading server/src/http/tasks.ts')
  const line = card.locator('[data-agent-doing]')
  await expect(line).toHaveText(/Working · 1 min · reading server\/src\/http\/tasks\.ts/, { timeout: 15_000 })
  /* The card no taller for it. */
  expect(await card.evaluate((el) => Math.round(el.getBoundingClientRect().height))).toBe(before)
  /* Given to the agent, it is ringed as one at work, whatever list. */
  await expect(card.locator('[data-agent-working]')).toHaveCount(1)

  /* Stopped: gone, live, and the card the same height again. */
  await say(page, s, null)
  await expect(card.locator('[data-agent-doing]')).toHaveCount(0, { timeout: 15_000 })
  expect(await card.evaluate((el) => Math.round(el.getBoundingClientRect().height))).toBe(before)

  /* The list's row, after the title. */
  await say(page, s, 'running the tests')
  await page.goto(`/${s.ws}/${s.slug}/tasks?view=list`)
  const row = page
    .locator('[data-open-task]')
    .filter({ hasText: `Read the handler ${n}` })
    .locator('xpath=..')
  await expect(row.locator('[data-agent-doing]')).toHaveText(/Working · \d+ min · running the tests/, { timeout: 15_000 })

  /* On the task, in the assignees' line, with its name. */
  await page.goto(`/${s.ws}/${s.slug}/tasks/${s.number}`)
  const who = page.getByTestId('task-assignees')
  await expect(who.locator('[data-agent-doing]')).toHaveText(new RegExp(`${s.name} · Working · \\d+ min · running the tests`), {
    timeout: 15_000,
  })

  /* Three minutes with nothing said: gone by itself, and the line says what it said before. */
  await page.clock.fastForward('04:00')
  await expect(who.locator('[data-agent-doing]')).toHaveCount(0, { timeout: 15_000 })
  await expect(who).toContainText(s.name)
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the status fits the card’s head and pushes nothing sideways', async ({ page }) => {
    await login(page)
    const s = await stage(page, Date.now())
    await say(page, s, `reading ${'a/very/long/path/'.repeat(6)}handler.ts`)
    await page.goto(`/${s.ws}/${s.slug}/tasks?view=board`)
    const card = page.locator(`[data-card="${s.taskId}"]`)
    const line = card.locator('[data-agent-doing]')
    await expect(line).toBeVisible({ timeout: 15_000 })
    /* Cut short inside the card, not carried out of it. */
    const [c, l] = await Promise.all([card.boundingBox(), line.boundingBox()])
    expect(l!.x + l!.width).toBeLessThanOrEqual(c!.x + c!.width + 0.5)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    /* One line: no taller than the face beside it. */
    expect(l!.height).toBeLessThanOrEqual(20)
  })
})
