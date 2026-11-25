import { test, expect, type Page } from '@playwright/test'
import { login, openProject, add, drawnWhole, docKept } from './helpers.js'

/**
 * A doc or a task linked from a body: `#` in a
 * task's description, the block menu's Link to a doc or task in a
 * document, and a draft never offered. `DOC_LINKS_SHOTS` names a folder to
 * keep pictures of the two lists in.
 */
const SHOTS = process.env.DOC_LINKS_SHOTS

/** A document of the named project, made through the API as the person signed in. */
async function docIn(page: Page, project: string, name: string, audience: 'project' | 'author') {
  return page.evaluate(
    async ({ project, name, audience }) => {
      const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
      const headers = { 'x-api-version': '1', authorization: `Bearer ${s.access_token}`, 'content-type': 'application/json' }
      const { projects } = (await (await fetch('/api/projects', { headers })).json()) as { projects: { id: string; name: string }[] }
      const p = projects.find((x) => x.name === project)!
      const r = await fetch(`/api/projects/${p.id}/files`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name,
          audience,
          body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'What we said.' }] }] },
        }),
      })
      return ((await r.json()) as { id: string }).id
    },
    { project, name, audience },
  )
}

test('# in a description links a doc of the project, and the chip opens it', async ({ page }) => {
  await login(page)
  await openProject(page, 'Website')
  const stamp = Date.now()
  const brief = `Launch brief ${stamp}`
  await docIn(page, 'Website', brief, 'project')

  const title = `Link ${stamp}`
  await add(page, 'new-task', title)
  await page.locator('[data-open-task]').filter({ hasText: title }).click()
  await expect(page.getByTestId('task-title')).toHaveValue(title, { timeout: 15_000 })

  const body = page.getByTestId('task-body')
  await body.click()
  await page.keyboard.type('See ')
  /* Drawn whole: asked as the body took the caret, so it opens with its rows. */
  const heights = await drawnWhole(page, '[data-ref-list]', () => page.keyboard.type('#'))
  expect(heights.length, `the list's heights: ${heights.join(', ')}`).toBe(1)
  const list = page.locator('[data-ref-list]')
  /* Docs before tasks. */
  await expect(list.locator('[data-ref-row]').first()).toHaveAttribute('data-ref-kind', 'doc')
  await page.keyboard.type('brief')
  const row = list.locator('[data-ref-row]').filter({ hasText: brief })
  await expect(row).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/doc-links-hash.png` })
  await page.keyboard.type(` ${stamp}`)
  await expect(list.locator('[data-ref-row]')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(list).toHaveCount(0)
  const chip = body.locator('[data-docref]')
  await expect(chip).toHaveText(brief)
  expect(await body.innerText()).not.toContain('#')

  /* Kept through a save and a reload. */
  const saved = page.waitForResponse((r) => /\/api\/tasks\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH')
  await page.getByTestId('task-title').click()
  expect((await saved).status()).toBe(200)
  await page.reload()
  await expect(chip).toHaveText(brief, { timeout: 15_000 })

  /* And it opens the document at its address. */
  await chip.click()
  await expect(page).toHaveURL(/\/files\/[^/]+$/, { timeout: 15_000 })
  await expect(page.getByTestId('file-name')).toHaveValue(brief, { timeout: 15_000 })
})

test('the block menu’s Link to a doc or task puts a task’s chip in a document', async ({ page }) => {
  await login(page)
  await openProject(page, 'Website')
  const stamp = Date.now()
  const task = `Footer copy ${stamp}`
  await add(page, 'new-task', task)

  await page.getByTestId('tool-files').click()
  await expect(page.getByTestId('docs-add')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('docs-add').click()
  await page.getByTestId('create-new-document').click()
  const name = page.getByTestId('file-name')
  await expect(name).toHaveValue('Untitled', { timeout: 15_000 })
  await name.fill(`Links ${stamp}`)
  await name.press('Enter')

  const body = page.getByTestId('file-body')
  await expect(body).toBeFocused({ timeout: 15_000 })
  /* Found by a word it does not say. */
  await page.keyboard.type('/page')
  const entry = page.locator('[data-testid="block-list"] [data-block="ref"]')
  await expect(entry).toHaveText('Link to a doc or task')
  for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace')
  await page.keyboard.type('link')
  await expect(entry).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/doc-links-slash.png` })

  /* Closed without a pick, the `#` it wrote goes with the `/link`. */
  await entry.click()
  const list = page.locator('[data-ref-list]')
  await expect(list).toBeVisible()
  await expect(page.getByTestId('block-list')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(list).toHaveCount(0)
  expect((await body.innerText()).trim()).toBe('')

  /* Picked, the chip stands where the `/link` was. */
  await page.keyboard.type('/link')
  await entry.click()
  await expect(list).toBeVisible()
  await page.keyboard.type(`footer copy ${stamp}`)
  const row = list.locator('[data-ref-row]').filter({ hasText: task })
  await expect(row).toBeVisible()
  await expect(list.locator('[data-ref-row]')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(body.locator('[data-task-chip]')).toContainText(task)
  const words = await body.innerText()
  expect(words).not.toContain('/link')
  expect(words).not.toContain('#')
  await docKept(page, '"taskref"', task)
})

test('a draft is never offered, somebody else’s or your own; a published doc is', async ({ page, browser }) => {
  test.setTimeout(120_000)
  await login(page)
  await page.goto('/')
  const stamp = Date.now()

  /* A workspace of its own, so nobody else's studio gains a person. */
  const made = await page.evaluate(async (n) => {
    const s = JSON.parse(localStorage.getItem('session') ?? 'null') as { access_token: string }
    const ask = (path: string, token: string, body?: unknown) =>
      fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${token}`, 'x-api-version': '1', 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }).then((r) => r.json())
    const ws = await ask('/api/workspaces', s.access_token, { name: `Links ${n}` })
    const me = await ask('/api/me', ws.access_token)
    const project = await ask('/api/projects', ws.access_token, { name: `Brand ${n}` })
    const read = await ask(`/api/projects/${project.id}`, ws.access_token)
    const into = (await ask('/api/invites', ws.access_token, { project_ids: [project.id], rights: [] })).token as string
    const lists = (await ask(`/api/projects/${project.id}/lists`, ws.access_token)).lists as {
      id: string
      finishes: boolean
      intake?: boolean
    }[]
    const open = lists.find((l) => !l.finishes && !l.intake)!
    const task = await ask(`/api/projects/${project.id}/tasks`, ws.access_token, { title: 'Write the brief', list_id: open.id })
    return {
      session: ws,
      slug: me.workspace.slug as string,
      projectId: project.id as string,
      projectSlug: read.slug as string,
      into,
      task: task.number as number,
    }
  }, stamp)

  /* Ana joins and writes a draft of her own and one for the project. */
  const ana = await (await browser.newContext()).newPage()
  await ana.goto(`/invite/${made.into}`)
  await ana.getByTestId('join-name').fill(`Ana ${stamp}`)
  await ana.getByTestId('join-email').fill(`ana${stamp}@example.com`)
  await ana.getByTestId('join-password').fill('correct-horse-battery-staple')
  await ana.getByTestId('join').click()
  await expect(ana.getByTestId('nav-my')).toBeVisible({ timeout: 20_000 })
  const write = (who: Page, token: string | null, name: string, audience: 'author' | 'project') =>
    who.evaluate(
      async ({ project, name, audience, token }) => {
        const s = JSON.parse(localStorage.getItem('session') ?? 'null') as { access_token: string }
        const r = await fetch(`/api/projects/${project}/files`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token ?? s.access_token}`, 'x-api-version': '1', 'content-type': 'application/json' },
          body: JSON.stringify({
            name,
            audience,
            body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'notes' }] }] },
          }),
        })
        return r.status
      },
      { project: made.projectId, name, audience, token },
    )
  expect(await write(ana, null, `Plan Ana draft ${stamp}`, 'author')).toBe(201)
  expect(await write(ana, null, `Plan Ana shared ${stamp}`, 'project')).toBe(201)
  /* And the owner a draft of their own. */
  expect(await write(page, made.session.access_token, `Plan owner draft ${stamp}`, 'author')).toBe(201)
  await ana.context().close()

  await page.evaluate((s) => localStorage.setItem('session', JSON.stringify(s)), made.session)
  await page.goto(`/${made.slug}/${made.projectSlug}/tasks/${made.task}`)
  await expect(page.getByTestId('task-title')).toHaveValue('Write the brief', { timeout: 20_000 })
  await page.getByTestId('task-body').click()
  await page.keyboard.type('#plan')
  const rows = page.locator('[data-ref-list] [data-ref-row]')
  await expect(rows.filter({ hasText: `Plan Ana shared ${stamp}` })).toBeVisible({ timeout: 15_000 })
  await expect(rows).toHaveCount(1)
})
