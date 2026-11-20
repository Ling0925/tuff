import { test, expect } from '@playwright/test'
import { login, openProject, drawnWhole } from './helpers.js'

/**
 * A document starts as its author's and is published to chosen people.
 * Who else reads it is asked of the server
 * as each of them in `server/test/private-docs.test.ts`; this is the walk
 * a person takes, and what the server kept from it.
 */
test('a new document is a draft, published to one chosen person and not the other', async ({ page }) => {
  await login(page)
  await openProject(page, 'Acme rebrand')
  await page.getByTestId('tool-files').click()
  await expect(page.getByTestId('docs-add')).toBeVisible({ timeout: 15_000 })

  const title = `Private notes ${Date.now()}`
  await page.getByTestId('docs-add').click()
  await page.getByTestId('create-new-document').click()
  const name = page.getByTestId('file-name')
  await expect(name).toBeVisible({ timeout: 15_000 })
  const renamed = page.waitForResponse((r) => r.url().includes('/api/files/') && r.request().method() === 'PATCH')
  await name.fill(title)
  await name.evaluate((el) => (el as HTMLElement).blur())
  await renamed

  /* A draft: Publish in its head, and Draft on its row. */
  const access = page.getByTestId('doc-access')
  await expect(access).toHaveText('Publish', { timeout: 15_000 })
  await page.getByTestId('close-file').click()
  const row = page.locator('[data-file]').filter({ hasText: title }).first()
  await expect(row.locator('[data-file-draft]')).toHaveText('Draft', { timeout: 15_000 })
  await row.locator('[data-open-file]').click()
  await expect(access).toHaveText('Publish', { timeout: 15_000 })

  /* The panel opens whole, the project's people in it from its first frame. */
  await access.hover()
  const heights = await drawnWhole(page, '[data-testid="doc-access-panel"]', () => access.click())
  expect(heights.length).toBe(1)
  const sam = page.locator('[data-pick-member]').filter({ hasText: 'Sam' })
  const robin = page.locator('[data-pick-member]').filter({ hasText: 'Robin' })
  await expect(sam).toBeVisible()
  await expect(robin).toBeVisible()

  /* Chosen people: Sam, not Robin. */
  await page.getByTestId('audience-chosen').click()
  await sam.locator('input[type="checkbox"]').check()
  await expect(robin.locator('input[type="checkbox"]')).not.toBeChecked()
  const saved = page.waitForResponse((r) => r.url().includes('/audience') && r.request().method() === 'PUT')
  await page.getByTestId('doc-access-save').click()
  expect((await saved).status()).toBe(200)
  await expect(access).toHaveText('Shared with 1 person')

  /* What the server kept: chosen, Sam alone — Robin, on the same project, is not on it. */
  const kept = await page.evaluate(async (named) => {
    const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
    const headers = { 'x-api-version': '1', authorization: `Bearer ${s.access_token}` }
    const get = async <T>(path: string) => (await (await fetch(path, { headers })).json()) as T
    const { projects } = await get<{ projects: { id: string; name: string }[] }>('/api/projects')
    const p = projects.find((x) => x.name === 'Acme rebrand')!
    const { files } = await get<{ files: { id: string; name: string; audience: string }[] }>(`/api/projects/${p.id}/files`)
    const f = files.find((x) => x.name === named)!
    const { file } = await get<{ file: { audience: string; reader_ids: string[] } }>(`/api/files/${f.id}`)
    const { members } = await get<{ members: { actor_id: string; name: string }[] }>(`/api/projects/${p.id}/members`)
    const who = (id: string) => members.find((m) => m.actor_id === id)?.name
    return { listed: f.audience, audience: file.audience, readers: file.reader_ids.map(who) }
  }, title)
  expect(kept).toEqual({ listed: 'chosen', audience: 'chosen', readers: ['Sam'] })

  /* Back in Docs, a lock says it is not the project's. */
  await page.getByTestId('close-file').click()
  await expect(row.locator('[data-file-chosen]')).toBeVisible({ timeout: 15_000 })
  await expect(row.locator('[data-file-draft]')).toHaveCount(0)
})

test('an agent on the project is offered with whose it is, and Select all shares with it too', async ({ page }) => {
  await login(page)
  /* An agent on the project for the length of this test: the panel lists
     it after the people, says whose agent it is under its name, and Select
     all takes it with them. */
  const scout = `Scout ${Date.now()}`
  const agentId = await page.evaluate(async (named) => {
    const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
    const headers = { 'x-api-version': '1', 'content-type': 'application/json', authorization: `Bearer ${s.access_token}` }
    const { projects } = (await (await fetch('/api/projects', { headers })).json()) as { projects: { id: string; name: string }[] }
    const p = projects.find((x) => x.name === 'Acme rebrand')!
    const r = await fetch('/api/agents', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: named, project_ids: [p.id], reach: 'mcp' }),
    })
    return ((await r.json()) as { agent_id: string }).agent_id
  }, scout)
  try {
    await openProject(page, 'Acme rebrand')
    await page.getByTestId('tool-files').click()
    await expect(page.getByTestId('docs-add')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('docs-add').click()
    await page.getByTestId('create-new-document').click()
    const access = page.getByTestId('doc-access')
    await expect(access).toHaveText('Publish', { timeout: 15_000 })

    await access.hover()
    await access.click()
    await expect(page.locator('[data-pick-member]').filter({ hasText: 'Sam' })).toBeVisible({ timeout: 15_000 })
    const agentRow = page.locator('[data-pick-member]').filter({ hasText: scout })
    await expect(agentRow).toHaveCount(1)
    await expect(agentRow.locator('[data-pick-second]')).toHaveText(/’s agent$/)
    /* A person's row has no second line. */
    await expect(page.locator('[data-pick-member]').filter({ hasText: 'Sam' }).locator('[data-pick-second]')).toHaveCount(0)
    await page.getByTestId('audience-chosen').click()
    await page.getByTestId('doc-access-panel').getByRole('button', { name: 'Select all' }).click()
    await expect(agentRow.locator('input[type="checkbox"]')).toBeChecked()
    const saved = page.waitForResponse((r) => r.url().includes('/audience') && r.request().method() === 'PUT')
    await page.getByTestId('doc-access-save').click()
    const answer = await saved
    expect(answer.status()).toBe(200)
    expect(((await answer.json()) as { reader_ids: string[] }).reader_ids).toContain(agentId)
    await expect(access).toHaveText(/^Shared with /)
  } finally {
    await page.evaluate(async (id) => {
      const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
      await fetch(`/api/agents/${id}`, { method: 'DELETE', headers: { 'x-api-version': '1', authorization: `Bearer ${s.access_token}` } })
    }, agentId)
  }
})
