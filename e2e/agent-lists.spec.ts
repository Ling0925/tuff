import { test, expect, type Page } from '@playwright/test'
import { backFromMade, login, shownAs } from './helpers.js'

/**
 * A list an agent takes. Chosen in
 * the list's row in the project's settings, shown as the agent's face
 * beside the list's name on the board, and a task made there with nobody
 * on it is the agent's. What the server gives, refuses and wakes is
 * `server/test/agent-lists.test.ts`.
 */

type Staged = { ws: string; slug: string; agent: string; name: string; todo: string }

/** A project of its own with an agent on it. */
async function stage(page: Page, n: number): Promise<Staged> {
  const ws = new URL(page.url()).pathname.split('/')[1]!
  const made = await page.evaluate(async (n) => {
    const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
    const h = { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1', 'content-type': 'application/json' }
    const post = async (path: string, body: unknown) => {
      const r = await fetch(`/api${path}`, { method: 'POST', headers: h, body: JSON.stringify(body) })
      if (!r.ok) throw new Error(`${path} ${r.status}`)
      return r.json()
    }
    const p = (await post('/projects', { name: `Agent list ${n}` })) as { id: string; slug: string }
    const name = `Fixer ${String(n).slice(-5)}`
    const { agent_id } = (await post('/agents', { name, project_ids: [p.id], reach: 'mcp' })) as { agent_id: string }
    const { lists } = (await (await fetch(`/api/projects/${p.id}/lists`, { headers: h })).json()) as {
      lists: { id: string; name: string }[]
    }
    return { slug: p.slug, agent: agent_id, name, todo: lists.find((l) => l.name === 'Todo')!.id }
  }, n)
  return { ws, ...made }
}

test('a list’s agent is chosen in its settings, shows on the board, and takes a task made there', async ({ page }) => {
  await login(page)
  await page.locator('aside [data-project]').first().waitFor({ timeout: 30_000 })
  const n = Date.now()
  const s = await stage(page, n)

  await page.goto(`/${s.ws}/${s.slug}/settings`)
  const row = page.locator('[data-list-row][data-said="Todo"]')
  await expect(row).toHaveCount(1, { timeout: 30_000 })
  await row.getByRole('button', { name: 'Agent that takes new tasks in Todo' }).click()
  const saved = page.waitForResponse((r) => /\/api\/lists\//.test(r.url()) && r.request().method() === 'PATCH')
  await page.locator(`[data-who-menu] [data-who-pick="${s.agent}"]`).click()
  expect((await saved).status()).toBe(200)
  await expect(row.locator(`[data-list-agent="${s.agent}"]`)).toHaveCount(1)
  await expect(row.locator('[data-list-agent-said]')).toHaveText(`New tasks here with no one assigned go to ${s.name}.`, {
    timeout: 15_000,
  })

  // The board shows its face beside the list's name.
  await page.getByTestId('tool-tasks').click()
  await shownAs(page, 'board')
  const column = page.locator('[data-column="Todo"]')
  await expect(column.locator(`[data-list-taker="${s.agent}"]`)).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-column="Backlog"] [data-list-taker]')).toHaveCount(0)

  // A task made there with nobody chosen says it goes to the agent, and does.
  await page.getByTestId(`add-in-column-${s.todo}`).click()
  const title = page.getByTestId('new-title')
  await expect(title).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('new-assignee')).toContainText(s.name)
  await title.fill(`Login fails ${n}`)
  await title.press('Enter')
  await expect(title).toHaveCount(0, { timeout: 15_000 })
  await backFromMade(page)
  const card = column.locator('[data-card]').filter({ hasText: `Login fails ${n}` })
  await expect(card).toHaveCount(1, { timeout: 15_000 })
  await expect(card.locator(`[data-who="${s.agent}"]`)).toHaveCount(1, { timeout: 15_000 })
})
