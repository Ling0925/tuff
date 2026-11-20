import { test, expect } from '@playwright/test'
import { login, openProject } from './helpers.js'

/*
 * The owner, or whoever runs a project, may take away an announcement
 * somebody else wrote, after saying yes to whose it is.
 * Who may not is the server's test, `post-delete.test.ts`.
 */
test('the project’s owner deletes an announcement somebody else wrote', async ({ page }) => {
  await login(page)
  await openProject(page, 'Onboarding')
  await page.getByTestId('tool-posts').click()

  /* Somebody else's: an agent on the project writes it, with its own token. */
  const stamp = Date.now()
  const theirs = await page.evaluate(async (title) => {
    const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
    const h = { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1', 'content-type': 'application/json' }
    const projects = (await (await fetch('/api/projects', { headers: h })).json()) as { projects: { id: string; name: string }[] }
    const p = projects.projects.find((x) => x.name === 'Onboarding')!
    const made = await fetch('/api/agents', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ name: `Scribe ${title.slice(-5)}`, project_ids: [p.id], reach: 'mcp' }),
    })
    if (!made.ok) return { error: `agents ${made.status}` }
    const { token } = (await made.json()) as { token: string }
    const said = await fetch(`/api/projects/${p.id}/posts`, {
      method: 'POST',
      headers: { ...h, authorization: `Bearer ${token}` },
      body: JSON.stringify({
        title,
        body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'From the agent.' }] }] },
      }),
    })
    return said.ok ? { title } : { error: `post ${said.status}` }
  }, `By the scribe ${stamp}`)
  expect(theirs, JSON.stringify(theirs)).toEqual({ title: `By the scribe ${stamp}` })
  await page.reload()

  await page.locator('[data-open-post]').filter({ hasText: theirs.title }).first().click()
  await expect(page.getByTestId('post-title')).toHaveValue(theirs.title, { timeout: 15_000 })
  await page.getByTestId('post-menu').click()
  await page.getByTestId('delete-post').click()
  /* Somebody else's: asked first, saying whose and that it goes for
     everyone, and nothing goes yet. Undo follows. */
  await expect(page.getByTestId('delete-post-ask')).toContainText('for everyone')
  await expect(page.getByTestId('post-title')).toHaveValue(theirs.title)
  await page.getByTestId('delete-post-confirm').click()
  await expect(page.locator('[data-open-post]').filter({ hasText: theirs.title })).toHaveCount(0, { timeout: 15_000 })
  /* Gone on the server, not only from the list it was taken out of. */
  await page.reload()
  await expect(page.locator('[data-open-post]').filter({ hasText: theirs.title })).toHaveCount(0)
})
