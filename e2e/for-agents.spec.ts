import { test, expect } from '@playwright/test'
import { login, openProject } from './helpers.js'

/**
 * A project's instructions for agents: a document it marks For agents.
 * Who may, and what agents are told, are asked
 * of the server in `server/test/for-agents.test.ts`; this is the walk.
 */
test('a published document is marked For agents from its menu, and says so by its title and in Docs', async ({ page }) => {
  await login(page)
  await openProject(page, 'Website')
  await page.getByTestId('tool-files').click()
  await expect(page.getByTestId('docs-add')).toBeVisible({ timeout: 15_000 })

  const title = `How agents work here ${Date.now()}`
  await page.getByTestId('docs-add').click()
  await page.getByTestId('create-new-document').click()
  const name = page.getByTestId('file-name')
  await expect(name).toBeVisible({ timeout: 15_000 })
  const renamed = page.waitForResponse((r) => r.url().includes('/api/files/') && r.request().method() === 'PATCH')
  await name.fill(title)
  await name.evaluate((el) => (el as HTMLElement).blur())
  await renamed

  /* A draft is not offered: agents could not read it. */
  const access = page.getByTestId('doc-access')
  await expect(access).toHaveText('Publish', { timeout: 15_000 })
  await page.getByTestId('file-menu').click()
  await expect(page.getByTestId('save-as-template')).toBeVisible()
  await expect(page.getByTestId('for-agents')).toHaveCount(0)
  await page.keyboard.press('Escape')

  /* Published to the whole project, it is. */
  await access.hover()
  await access.click()
  await page.getByTestId('audience-project').click()
  const published = page.waitForResponse((r) => r.url().includes('/audience') && r.request().method() === 'PUT')
  await page.getByTestId('doc-access-save').click()
  expect((await published).status()).toBe(200)

  const titleAt = await name.boundingBox()
  await page.getByTestId('file-menu').click()
  const forAgents = page.getByTestId('for-agents')
  await expect(forAgents).toHaveAttribute('aria-checked', 'false')
  const marked = page.waitForResponse((r) => r.url().includes('/for-agents') && r.request().method() === 'PUT')
  await forAgents.click()
  expect((await marked).status()).toBe(200)
  await expect(forAgents).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')

  /* The label by its title, on the mark's row: the title has not moved. */
  await expect(page.getByTestId('for-agents-label')).toHaveText('For agents')
  expect((await name.boundingBox())?.y).toBe(titleAt?.y)

  /* What the project now says agents read first. */
  const pointer = await page.evaluate(async (named) => {
    const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
    const headers = { 'x-api-version': '1', authorization: `Bearer ${s.access_token}` }
    const get = async <T>(path: string) => (await (await fetch(path, { headers })).json()) as T
    const { projects } = await get<{ projects: { id: string; name: string }[] }>('/api/projects')
    const p = projects.find((x) => x.name === 'Website')!
    const read = await get<{ for_agents: { name: string } | null }>(`/api/projects/${p.id}`)
    return read.for_agents?.name === named
  }, title)
  expect(pointer).toBe(true)

  /* Back in Docs, its row says so. */
  await page.getByTestId('close-file').click()
  const row = page.locator('[data-file]').filter({ hasText: title }).first()
  await expect(row.locator('[data-file-for-agents]')).toContainText('For agents', { timeout: 15_000 })

  /* And taken off again, the label goes. */
  await row.locator('[data-open-file]').click()
  await page.getByTestId('file-menu').click()
  const off = page.waitForResponse((r) => r.url().includes('/for-agents') && r.request().method() === 'PUT')
  await page.getByTestId('for-agents').click()
  expect((await off).status()).toBe(200)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('for-agents-label')).toHaveCount(0)
})
