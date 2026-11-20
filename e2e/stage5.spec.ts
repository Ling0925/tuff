import { test, expect } from '@playwright/test'
import { drawnWhole, login, openAccount, openProject, openSettings } from './helpers.js'

test('a link can put somebody on one project, holding what it says', async ({ page }) => {
  await login(page)
  await page.getByTestId('nav-members').click()

  await page.getByTestId('members-add').click()
  // Which project is part of making the invitation, and so is what they may
  // do there: arriving able to everything and being cut down a minute later
  // leaves a window, and the window is long enough to use.
  const window = page.getByTestId('invite')
  await window.getByRole('checkbox', { name: 'Acme rebrand', exact: true }).check()
  await expect(window.getByLabel('Create tasks')).toBeChecked()
  await window.getByLabel('Delete tasks').check()
  await page.getByTestId('invite-link').click()

  await expect(page.getByText('Works once and expires.')).toBeVisible({ timeout: 15_000 })
})

test('the four switches are settable and nothing else is', async ({ page }) => {
  await login(page)
  await openSettings(page)
  await expect(page.getByLabel('who_creates_projects')).toBeVisible({ timeout: 15_000 })

  // Wait for the server, not for the screen. The switch moves optimistically,
  // so the new value is on screen while the request is still in flight — and
  // a reload in that window cancels it, after which the test blames the
  // server for a change it never received.
  const saved = page.waitForResponse((r) => r.url().includes('/api/workspace') && r.request().method() === 'PATCH')
  await page.getByLabel('who_creates_projects').selectOption('owner')
  await saved
  await page.reload()
  await openSettings(page)
  await expect(page.getByLabel('who_creates_projects')).toHaveValue('owner', { timeout: 15_000 })

  // Put it back, so the rest of the suite is not run against a changed
  // workspace — the switch really does change what members may do.
  await page.getByLabel('who_creates_projects').selectOption('members')
  await expect(page.getByLabel('who_creates_projects')).toHaveValue('members')
})

/* The fourth switch: the screen and not the people. */
test('Members can be kept to the owner, and nobody leaves the pickers', async ({ page, browser }) => {
  test.setTimeout(90_000)
  await login(page)
  await page.goto('/')
  const stamp = Date.now()
  /* A workspace of its own, so the switch is not turned under the rest of
     the suite; the screen closed, and a link in. */
  const made = await page.evaluate(async (n) => {
    const s = JSON.parse(localStorage.getItem('session') ?? 'null') as { access_token: string }
    const ask = (path: string, token: string, body?: unknown, method?: string) =>
      fetch(path, {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        headers: { authorization: `Bearer ${token}`, 'x-api-version': '1', 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }).then((r) => r.json())
    const ws = await ask('/api/workspaces', s.access_token, { name: `Quiet ${n}` })
    const me = await ask('/api/me', ws.access_token)
    await ask('/api/workspace', ws.access_token, { who_sees_members: 'owner' }, 'PATCH')
    const into = (await ask('/api/invites', ws.access_token, { rights: [] })).token as string
    return { session: ws, slug: me.workspace.slug as string, into }
  }, stamp)

  const them = await (await browser.newContext()).newPage()
  await them.goto(`/invite/${made.into}`)
  await them.getByTestId('join-name').fill(`Lee ${stamp}`)
  await them.getByTestId('join-email').fill(`lee${stamp}@example.com`)
  await them.getByTestId('join-password').fill('correct-horse-battery-staple')
  await them.getByTestId('join').click()
  await expect(them.getByTestId('nav-my')).toBeVisible({ timeout: 20_000 })

  // No door to the screen, and its address says whose it is.
  await expect(them.getByTestId('nav-members')).toHaveCount(0)
  await them.goto(`/${made.slug}/members`)
  await expect(them.locator('[data-members-closed]')).toBeVisible({ timeout: 15_000 })
  // Everybody is still there to be picked.
  const listed = await them.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('session') ?? 'null') as { access_token: string }
    const r = await fetch('/api/people', { headers: { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1' } })
    return ((await r.json()) as { people: unknown[] }).people.length
  })
  expect(listed).toBe(2)

  // Opened again by the owner, in Settings, and the door is back.
  await page.evaluate((s) => localStorage.setItem('session', JSON.stringify(s)), made.session)
  await page.goto(`/${made.slug}/settings`)
  await expect(page.getByLabel('who_sees_members')).toHaveValue('owner', { timeout: 15_000 })
  const saved = page.waitForResponse((r) => r.url().includes('/api/workspace') && r.request().method() === 'PATCH')
  await page.getByLabel('who_sees_members').selectOption('members')
  await saved
  await them.goto(`/${made.slug}`)
  await expect(them.getByTestId('nav-members')).toBeVisible({ timeout: 15_000 })
  await them.context().close()
})

/* "Connect an agent" in the palette, for whoever may — `docs/specs/palette.md`. */
test('the palette connects an agent for whoever may, found by what they type', async ({ page, browser }) => {
  test.setTimeout(90_000)
  await login(page)
  const row = page.getByTestId('palette-row').filter({ hasText: 'Connect an agent' })
  for (const typed of ['agent', 'claude', 'mcp', 'AI']) {
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByTestId('palette-input').fill(typed)
    await expect(row, `"${typed}" finds it`).toHaveCount(1)
    await page.keyboard.press('Escape')
  }
  // Run, it opens the window on its agents tab, over People & Agents.
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByTestId('palette-input').fill('agent')
  await row.click()
  await expect(page.getByTestId('agent-connect').getByTestId('agent-name')).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveURL(/\/members(\/|$)/)
  await expect(page.getByTestId('nav-members')).toContainText('People & Agents')

  // A member nobody let connect agents is not offered it.
  await page.goto('/')
  const stamp = Date.now()
  const into = await page.evaluate(async (n) => {
    const s = JSON.parse(localStorage.getItem('session') ?? 'null') as { access_token: string }
    const ask = (path: string, token: string, body?: unknown) =>
      fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${token}`, 'x-api-version': '1', 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }).then((r) => r.json())
    const ws = await ask('/api/workspaces', s.access_token, { name: `Agentless ${n}` })
    return (await ask('/api/invites', ws.access_token, { rights: [] })).token as string
  }, stamp)
  const them = await (await browser.newContext()).newPage()
  await them.goto(`/invite/${into}`)
  await them.getByTestId('join-name').fill(`Kim ${stamp}`)
  await them.getByTestId('join-email').fill(`kim${stamp}@example.com`)
  await them.getByTestId('join-password').fill('correct-horse-battery-staple')
  await them.getByTestId('join').click()
  await expect(them.getByTestId('nav-my')).toBeVisible({ timeout: 20_000 })
  await them.keyboard.press('ControlOrMeta+k')
  await them.getByTestId('palette-input').fill('agent')
  // The place is offered, the window is not.
  await expect(them.getByTestId('palette-row').filter({ hasText: 'People & Agents' })).toBeVisible()
  await expect(them.getByTestId('palette-row').filter({ hasText: 'Connect an agent' })).toHaveCount(0)
  await them.context().close()
})

/* What somebody does, on their card — `docs/specs/person-card.md`. */
test('a person sets their title in settings, and it stays', async ({ page }) => {
  await login(page)
  await openAccount(page)
  const title = `Designer ${Date.now() % 1000}`
  const field = page.getByTestId('my-title')
  await field.fill(title)
  await field.press('Enter')
  await page.waitForResponse((r) => r.url().endsWith('/api/me') && r.request().method() === 'GET')
  await page.reload()
  await openAccount(page)
  await expect(page.getByTestId('my-title')).toHaveValue(title, { timeout: 15_000 })
})

/* A member takes themselves off a project. */
test('a member leaves a project from the projects index, after a window that says what happens', async ({ page, browser }) => {
  test.setTimeout(90_000)
  await login(page)
  await page.goto('/')
  const stamp = Date.now()
  /* A workspace of its own, so nobody else's studio gains a person; a
     project there, and a link onto it that grants nothing. */
  const made = await page.evaluate(async (n) => {
    const s = JSON.parse(localStorage.getItem('session') ?? 'null') as { access_token: string }
    const ask = (path: string, token: string, body?: unknown) =>
      fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${token}`, 'x-api-version': '1', 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }).then((r) => r.json())
    const ws = await ask('/api/workspaces', s.access_token, { name: `Leaving ${n}` })
    const me = await ask('/api/me', ws.access_token)
    const project = await ask('/api/projects', ws.access_token, { name: `Spring launch ${n}` })
    const into = (await ask('/api/invites', ws.access_token, { project_ids: [project.id], rights: [] })).token as string
    return { slug: me.workspace.slug as string, name: project.name as string, into }
  }, stamp)

  const them = await (await browser.newContext()).newPage()
  await them.goto(`/invite/${made.into}`)
  await them.getByTestId('join-name').fill(`Ren ${stamp}`)
  await them.getByTestId('join-email').fill(`ren${stamp}@example.com`)
  await them.getByTestId('join-password').fill('correct-horse-battery-staple')
  await them.getByTestId('join').click()
  await expect(them.getByTestId('nav-my')).toBeVisible({ timeout: 20_000 })
  await openProject(them, made.name)
  // Not somebody who runs it: no Settings tab, and no way out from inside it —
  // leaving is on the index, beside archiving, and nowhere a slip can reach.
  await expect(them.getByTestId('tool-settings')).toHaveCount(0)
  await expect(them.getByTestId('project-menu')).toHaveCount(0)
  await expect(them.getByTestId('leave-project')).toHaveCount(0)
  const at = new URL(them.url()).pathname

  await them.getByTestId('nav-projects-all').click()
  const row = them.locator('[data-project-row]').filter({ hasText: made.name })
  await row.getByTestId('project-row-menu').click()
  const heights = await drawnWhole(them, '[data-testid="leave-project-dialog"]', () => them.getByTestId('leave-project').click())
  expect(heights).toHaveLength(1)
  const window = them.getByTestId('leave-project-dialog')
  await expect(window).toContainText(`Leave ${made.name}?`)
  await expect(window).toContainText('You’ll no longer see its tasks, chat, files or announcements.')

  // Closing it does nothing.
  await window.getByRole('button', { name: 'Cancel' }).click()
  await expect(window).toHaveCount(0)
  await expect(them.locator('aside [data-project]').filter({ hasText: made.name })).toHaveCount(1)

  // The press in the window is what does it.
  await row.getByTestId('project-row-menu').click()
  await them.getByTestId('leave-project').click()
  const gone = them.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes('/members/'))
  await them.getByTestId('leave-project-go').click()
  expect((await gone).status()).toBe(200)

  // Still on the index, and the project is off it and off the sidebar.
  await expect(them).toHaveURL(new RegExp(`/${made.slug}/projects$`), { timeout: 15_000 })
  await expect(row).toHaveCount(0, { timeout: 15_000 })
  await expect(them.locator('aside [data-project]').filter({ hasText: made.name })).toHaveCount(0)
  expect(new URL(them.url()).pathname).not.toBe(at)
  await them.context().close()
})

/*
 * The owner finds who removed somebody, and who changed what they could do,
 * in the audit log. From the workspace's
 * settings, one press to the log and one on a filter.
 */
test('the owner finds in the audit log who removed a person and who changed their rights', async ({ page }) => {
  test.setTimeout(90_000)
  await login(page)
  await page.goto('/')
  const stamp = Date.now()
  /* A workspace of its own, so nobody is removed from a studio the rest of
     the suite counts on; somebody joins it, has their rights changed and is
     taken out, through the endpoints the screens use. */
  const made = await page.evaluate(async (n) => {
    const s = JSON.parse(localStorage.getItem('session') ?? 'null') as { access_token: string }
    const ask = async (path: string, token: string | null, body?: unknown, method?: string) => {
      const r = await fetch(path, {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          'x-api-version': '1',
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      return r.json()
    }
    const ws = await ask('/api/workspaces', s.access_token, { name: `Audited ${n}` })
    const me = await ask('/api/me', ws.access_token)
    const into = (await ask('/api/invites', ws.access_token, { rights: [] })).token as string
    const lee = await ask(`/auth/invite/${into}/accept`, null, {
      name: `Lee ${n}`,
      email: `lee${n}@example.com`,
      password: 'correct-horse-battery-staple',
    })
    await ask(`/api/people/${lee.actor_id}`, ws.access_token, { may_create_projects: false }, 'PATCH')
    await ask(`/api/people/${lee.actor_id}`, ws.access_token, undefined, 'DELETE')
    return { session: ws, slug: me.workspace.slug as string, owner: me.actor.name as string, lee: lee.actor_id as string }
  }, stamp)

  /* Closed again afterwards: a second workspace on this account turns the
     switcher's first choice into this one for the tests that come after. */
  try {
    await page.evaluate((s) => localStorage.setItem('session', JSON.stringify(s)), made.session)
    await page.goto(`/${made.slug}`)
    await openSettings(page)

    // One press from the settings, and the page opens with its lines in it.
    const heights = await drawnWhole(page, '[data-audit-log]', () => page.getByTestId('open-audit').click())
    expect(heights).toHaveLength(1)
    await expect(page).toHaveURL(new RegExp(`/${made.slug}/settings/audit$`))

    // Narrowed to people: who took Lee out, said as a sentence.
    await page.getByTestId('audit-type').selectOption('people')
    await expect(page).toHaveURL(/\/settings\/audit\?type=people$/)
    const removed = page.locator('[data-audit-kind="people.remove"]')
    await expect(removed).toHaveCount(1, { timeout: 15_000 })
    await expect(removed).toContainText(`${made.owner} removed Lee ${stamp} from the workspace`)
    await expect(page.locator('[data-audit-kind="login"]')).toHaveCount(0)

    // Narrowed to permissions: who changed what Lee could do.
    await page.getByTestId('audit-type').selectOption('rights')
    const rights = page.locator('[data-audit-kind="people.rights"]')
    await expect(rights).toHaveCount(1, { timeout: 15_000 })
    await expect(rights).toContainText(`${made.owner} changed what Lee ${stamp} can do in the workspace`)
    await expect(removed).toHaveCount(0)

    // Or by the person, who is no longer a member and is still in the list:
    // everything done by them or to them.
    await page.getByTestId('audit-type').selectOption('')
    await expect(page.getByTestId('audit-who').locator('option', { hasText: `Lee ${stamp} (removed)` })).toHaveCount(1)
    await page.getByTestId('audit-who').selectOption(made.lee)
    await expect(page.locator('[data-audit-kind="people.remove"]')).toHaveCount(1, { timeout: 15_000 })
    await expect(page.locator('[data-audit-kind="people.rights"]')).toHaveCount(1)
    await expect(page.locator('[data-audit-kind="invite_accepted"]')).toHaveCount(1)

    // The address holds the filter, so it can be sent and comes back.
    await page.reload()
    await expect(page.getByTestId('audit-who')).toHaveValue(made.lee, { timeout: 15_000 })
    await expect(page.locator('[data-audit-kind="people.remove"]')).toHaveCount(1)
  } finally {
    await page.request.post('/api/workspace/delete', {
      headers: { authorization: `Bearer ${made.session.access_token as string}`, 'x-api-version': '1' },
      data: { name: `Audited ${stamp}`, password: 'correct-horse-battery-staple' },
    })
  }
})
