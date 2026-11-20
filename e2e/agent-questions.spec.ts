import { test, expect } from '@playwright/test'
import { drawnWhole, login, openProject } from './helpers.js'

/**
 * An agent asks, a person answers with one press.
 * Once from the inbox's Needs you, where the row stays and says the answer,
 * and once on the task, where the buttons give way to the answer and it is
 * still so when the task is opened again. Who may ask and answer, and the
 * second answer refused, are the server's tests (`questions.test.ts`).
 */
test('a question from an agent is answered from Needs you and on the task', async ({ page }) => {
  await login(page)
  await openProject(page, 'Website')
  const stamp = Date.now()

  /* An agent on the project asks two questions on two tasks given to me. */
  const made = await page.evaluate(async (n) => {
    const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
    const h = { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1', 'content-type': 'application/json' }
    const me = (await (await fetch('/api/me', { headers: h })).json()) as { actor: { id: string } }
    const projects = (await (await fetch('/api/projects', { headers: h })).json()) as { projects: { id: string; name: string }[] }
    const p = projects.projects.find((x) => x.name === 'Website')!
    const agent = await fetch('/api/agents', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ name: `Asker ${String(n).slice(-5)}`, project_ids: [p.id], reach: 'mcp' }),
    })
    if (!agent.ok) return { error: `agents ${agent.status}` }
    const { token } = (await agent.json()) as { token: string }
    const said = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
    const titles: string[] = []
    for (const [title, question] of [
      [`Inbox question ${n}`, `Keep the old route ${n}?`],
      [`Task question ${n}`, `Which name for the table ${n}?`],
    ] as const) {
      const t = await fetch(`/api/projects/${p.id}/tasks`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ title, assignee_ids: [me.actor.id] }),
      })
      if (!t.ok) return { error: `task ${t.status}` }
      const { id } = (await t.json()) as { id: string }
      const q = await fetch(`/api/tasks/${id}/comments`, {
        method: 'POST',
        headers: { ...h, authorization: `Bearer ${token}` },
        body: JSON.stringify({ body: said(question), choices: [{ label: 'Keep it' }, { label: 'Remove it', recommended: true }] }),
      })
      if (!q.ok) return { error: `ask ${q.status}` }
      titles.push(title)
    }
    return { titles }
  }, stamp)
  expect(made, JSON.stringify(made)).toEqual({ titles: [`Inbox question ${stamp}`, `Task question ${stamp}`] })
  await page.reload()

  /* Needs you, in the inbox: the panel opens whole. */
  const heights = await drawnWhole(page, '[data-notes-panel]', () => page.getByTestId('nav-notifications').click())
  expect(heights).toHaveLength(1)
  await page.getByTestId('notes-needs-you').click()
  const row = page.locator('[data-question-row]').filter({ hasText: `Keep the old route ${stamp}?` })
  await expect(row).toBeVisible({ timeout: 15_000 })
  await expect(row.locator('[data-recommended]')).toHaveText(/Remove it/)
  await row.locator('[data-choice="0"]').click()
  /* Answered in place: the row stays and says so, nothing moves under the pointer. */
  await expect(row.locator('[data-answered]')).toHaveText(/Answered: Keep it/)
  await expect(row.locator('[data-choice]')).toHaveCount(0)
  await page.getByTestId('close-notes').click()

  /* Opened again, it is gone: answered is not waiting. */
  await page.getByTestId('nav-notifications').click()
  await page.getByTestId('notes-needs-you').click()
  await expect(page.locator('[data-question-row]').filter({ hasText: `Keep the old route ${stamp}?` })).toHaveCount(0)
  await page.getByTestId('close-notes').click()

  /* On the task: the buttons under the question, pressed, become the answer. */
  await page
    .locator('[data-open-task]')
    .filter({ hasText: `Task question ${stamp}` })
    .click()
  const asked = page.locator('[data-question]')
  await expect(asked).toBeVisible({ timeout: 15_000 })
  await asked.locator('[data-choice="1"]').click()
  await expect(asked.locator('[data-answered]')).toHaveText(/Answered: Remove it/)
  await expect(asked.locator('[data-choice]')).toHaveCount(0)
  /* The server has it. */
  await page.reload()
  await expect(page.locator('[data-question] [data-answered]')).toHaveText(/Answered: Remove it/, { timeout: 15_000 })
})
