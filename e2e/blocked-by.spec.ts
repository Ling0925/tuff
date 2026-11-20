import { test, expect } from '@playwright/test'
import { login, shownAs } from './helpers.js'

/**
 * Blocked by.
 *
 * A blocker added on the task's screen, the "Waiting on" mark on its row
 * and its card, the blocker finished, the mark gone, and the person the
 * waiting task is on told they can start. In a workspace of its own, so
 * nobody else's studio gains a person.
 */
const SHOTS = process.env.BLOCKED_BY_SHOTS

test('a blocker added on the task screen marks the row and the card, and finishing it tells the assignee', async ({ page, browser }) => {
  test.setTimeout(120_000)
  await login(page)
  await page.goto('/')
  const stamp = Date.now()

  const made = await page.evaluate(async (n) => {
    const s = JSON.parse(localStorage.getItem('session') ?? 'null') as { access_token: string }
    const ask = (path: string, token: string, body?: unknown, method?: string) =>
      fetch(path, {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        headers: { authorization: `Bearer ${token}`, 'x-api-version': '1', 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }).then((r) => r.json())
    const ws = await ask('/api/workspaces', s.access_token, { name: `Waiting ${n}` })
    const me = await ask('/api/me', ws.access_token)
    const project = await ask('/api/projects', ws.access_token, { name: `Landing ${n}` })
    const read = await ask(`/api/projects/${project.id}`, ws.access_token)
    const into = (await ask('/api/invites', ws.access_token, { project_ids: [project.id], rights: [] })).token as string
    return {
      session: ws,
      slug: me.workspace.slug as string,
      projectId: project.id as string,
      projectSlug: read.slug as string,
      key: read.key as string,
      into,
    }
  }, stamp)

  /* The person the waiting task will be on. */
  const them = await (await browser.newContext()).newPage()
  await them.goto(`/invite/${made.into}`)
  await them.getByTestId('join-name').fill(`Ana ${stamp}`)
  await them.getByTestId('join-email').fill(`ana${stamp}@example.com`)
  await them.getByTestId('join-password').fill('correct-horse-battery-staple')
  await them.getByTestId('join').click()
  await expect(them.getByTestId('nav-my')).toBeVisible({ timeout: 20_000 })
  const themId = await them.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('session') ?? 'null') as { access_token: string }
    const r = await fetch('/api/me', { headers: { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1' } })
    return ((await r.json()) as { actor: { id: string } }).actor.id
  })

  /* Two tasks: the copy to approve, and the page that waits on it, on Ana. */
  const tasks = await page.evaluate(
    async ({ m, who }) => {
      const ask = (path: string, body?: unknown) =>
        fetch(path, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { authorization: `Bearer ${m.session.access_token}`, 'x-api-version': '1', 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }).then((r) => r.json())
      const lists = (await ask(`/api/projects/${m.projectId}/lists`)).lists as {
        id: string
        name: string
        finishes: boolean
        intake?: boolean
      }[]
      const open = lists.find((l) => !l.finishes && !l.intake)!
      const copy = await ask(`/api/projects/${m.projectId}/tasks`, { title: 'Approve the copy', list_id: open.id })
      const landing = await ask(`/api/projects/${m.projectId}/tasks`, {
        title: 'Build the landing page',
        list_id: open.id,
        assignee_ids: [who],
      })
      return { copy: copy.number as number, landing: landing.number as number, done: lists.find((l) => l.finishes)!.name }
    },
    { m: made, who: themId },
  )
  const copyHandle = `${made.key}-${tasks.copy}`
  const landingHandle = `${made.key}-${tasks.landing}`

  /* The owner, in that workspace, on the waiting task's screen. */
  await page.evaluate((s) => localStorage.setItem('session', JSON.stringify(s)), made.session)
  await page.goto(`/${made.slug}/${made.projectSlug}/tasks/${tasks.landing}`)
  await expect(page.getByTestId('task-title')).toHaveValue('Build the landing page', { timeout: 20_000 })

  const section = page.getByTestId('blockers')
  /* With nothing under the description yet, Add a blocker stands beside
     Add a sub-task, one row — not inside the blockers' own section. */
  const subtask = await page.getByTestId('add-subtask').boundingBox()
  const blocker = await page.getByTestId('add-blocker').boundingBox()
  expect(Math.abs(subtask!.y - blocker!.y)).toBeLessThanOrEqual(1)
  await page.getByTestId('add-blocker').click()
  await page.getByTestId('blocker-find').fill('Approve')
  const option = page.getByTestId('blocker-found').getByRole('option').filter({ hasText: copyHandle })
  await expect(option).toBeVisible({ timeout: 15_000 })
  const added = page.waitForResponse((r) => r.url().includes('/blocked-by') && r.request().method() === 'POST')
  await option.click()
  // Drawn at once, and the server took it.
  await expect(section.locator('[data-related]')).toContainText(copyHandle)
  expect((await added).status()).toBe(201)
  await expect(section.getByRole('heading', { name: 'Blocked by' })).toBeVisible()
  if (SHOTS) await section.screenshot({ path: `${SHOTS}/blocked-by-section.png` })

  // The row says what it waits on.
  await page.goto(`/${made.slug}/${made.projectSlug}/tasks`)
  const row = page.locator('[data-task]').filter({ hasText: 'Build the landing page' })
  await expect(row.locator('[data-waiting]')).toHaveText(`Waiting on ${copyHandle}`, { timeout: 20_000 })
  await expect(page.locator('[data-task]').filter({ hasText: 'Approve the copy' }).locator('[data-waiting]')).toHaveCount(0)
  if (SHOTS) await row.screenshot({ path: `${SHOTS}/blocked-by-row.png` })

  // And so does the card, where the board's people left it.
  await page.goto(`/${made.slug}/${made.projectSlug}/tasks?view=board`)
  const card = page.locator('[data-card]').filter({ hasText: 'Build the landing page' })
  await expect(card.locator('[data-waiting]')).toHaveText(`Waiting on ${copyHandle}`, { timeout: 20_000 })
  const before = await card.boundingBox()
  if (SHOTS) await card.screenshot({ path: `${SHOTS}/blocked-by-card.png` })

  // The copy is approved: moved to the list that finishes, from the list.
  await page.goto(`/${made.slug}/${made.projectSlug}/tasks`)
  /* The drawing is remembered on this device, and the board was the last. */
  await expect(page.getByTestId('view-menu')).toBeVisible({ timeout: 20_000 })
  await shownAs(page, 'list')
  const copyRow = page.locator('[data-task]').filter({ hasText: 'Approve the copy' }).first()
  const moved = page.waitForResponse((r) => /\/api\/tasks\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH')
  await copyRow.locator('[data-status]').click()
  await page.locator('[data-status-menu] [role="menuitem"]').filter({ hasText: tasks.done }).click()
  expect((await moved).status()).toBe(200)
  // The mark goes in place.
  await expect(row.locator('[data-waiting]')).toHaveCount(0, { timeout: 15_000 })
  await page.goto(`/${made.slug}/${made.projectSlug}/tasks?view=board`)
  await expect(card).toBeVisible({ timeout: 20_000 })
  await expect(card.locator('[data-waiting]')).toHaveCount(0)
  // Not moved for it: still in its column, at the top where it was.
  const after = await card.boundingBox()
  expect(Math.round(after!.x)).toBe(Math.round(before!.x))

  // Ana hears it once, in her own inbox.
  await them.goto(`/${made.slug}`)
  await them.getByTestId('nav-notifications').click()
  const note = them.locator('[data-note]').filter({ hasText: `${copyHandle} is done — you can start ${landingHandle}` })
  await expect(note).toHaveCount(1, { timeout: 20_000 })
  if (SHOTS) await them.locator('[data-notes-panel]').screenshot({ path: `${SHOTS}/blocked-by-note.png` })
  await them.context().close()
})
