import { test, expect } from '@playwright/test'
import { account, add, drawnWhole, letterTo, login, openAccount, openProject, openSettings, PASSWORD } from './helpers.js'

test('signing in lands on a workspace with its projects', async ({ page }) => {
  await login(page)
  const sidebar = page.locator('aside')
  await expect(sidebar.locator('[data-project]').filter({ hasText: 'Acme rebrand' })).toBeVisible()
  await expect(sidebar.locator('[data-project]').filter({ hasText: 'Website' })).toBeVisible()
})

test('a project can be created and is usable at once', async ({ page }) => {
  await login(page)
  const name = `Project ${Date.now()}`
  await add(page, 'new-project', name)

  const sidebar = page.locator('aside')
  await expect(sidebar.locator('[data-project]').filter({ hasText: name })).toBeVisible({
    timeout: 15_000,
  })

  // All four tools are on unless somebody turns one off: a project that has to
  // be configured before it holds anything is a form before the work.
  await sidebar.locator('[data-project]').filter({ hasText: name }).click()
  for (const tool of ['posts', 'tasks', 'files', 'messages']) {
    await expect(page.getByTestId(`tool-${tool}`)).toBeVisible()
  }
})

test('the people screen names everyone and their role', async ({ page }) => {
  await login(page)
  await page.getByTestId('nav-members').click()
  // Scoped to the main pane: the sidebar carries a project called "Acme
  // rebrand", and matching that instead would have passed for the wrong reason.
  const list = page.locator('main')
  await expect(list.getByText('Sam')).toBeVisible({ timeout: 15_000 })
  /* Everybody in one list, with nothing beside their name saying what sort
     of person they are — there are no sorts. Somebody on one project and
     somebody on all of them read the same here, and the difference is on
     the project, where it is set. */
  await expect(list.getByText('Robin', { exact: true })).toBeVisible()
})

test('settings offer four switches and nothing else', async ({ page }) => {
  await login(page)
  await openSettings(page)
  /* Said as what each decides, not as the schema's keys. */
  await expect(page.getByText('Creating projects')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Inviting people')).toBeVisible()
  await expect(page.getByText('Editing what others wrote')).toBeVisible()
  await expect(page.getByText('People & Agents page')).toBeVisible()

  // The rule is that settings exist only where teams genuinely differ. The
  // fourth, who sees Members, is a decision;
  // a fifth row here means somebody added a
  // preference instead of a default. Counted by what a switch is, not by
  // what it is styled like — the screen grew other sections and the class
  // was never the thing being asserted.
  await expect(page.locator('[data-switch]')).toHaveCount(4)
})

test('an invitation link opens a way in, and joining signs in', async ({ page, browser }) => {
  await login(page)
  await page.goto('/')
  const token = await page.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('session') ?? 'null') as { access_token?: string } | null
    const projects = (await (
      await fetch('/api/projects', { headers: { authorization: `Bearer ${s?.access_token}`, 'x-api-version': '1' } })
    ).json()) as { projects: { id: string }[] }
    const r = await fetch('/api/invites', {
      method: 'POST',
      headers: { authorization: `Bearer ${s?.access_token}`, 'x-api-version': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'member', project_ids: [projects.projects[0]!.id] }),
    })
    return ((await r.json()) as { token: string }).token
  })

  const stranger = await browser.newContext()
  const them = await stranger.newPage()
  await them.goto(`/invite/${token}`)
  await expect(them.getByText(/^Join /)).toBeVisible({ timeout: 15_000 })
  const stamp = Date.now()
  await them.getByTestId('join-name').fill('Test Person')
  await them.getByTestId('join-email').fill(`joined${stamp}@example.com`)
  await them.getByTestId('join-password').fill('correct-horse-battery-staple')
  await them.getByTestId('join').click()
  // In, and in the workspace that invited them.
  await expect(them.locator('aside [data-project]').first()).toBeVisible({ timeout: 20_000 })

  // The same link a second time is spent, and says so.
  const late = await (await browser.newContext()).newPage()
  await late.goto(`/invite/${token}`)
  await expect(late.getByText('This link is no longer valid')).toBeVisible({ timeout: 15_000 })
  await stranger.close()
})

test('somebody signed in joins a second workspace with one press, and the owner hands it to them', async ({ page, browser }) => {
  test.setTimeout(90_000)
  await login(page)
  await page.goto('/')
  const stamp = Date.now()
  /* A workspace of the owner's own for this, so the studio every test
     shares keeps its owner; and two links — one to bring a new person into
     the studio, one into the new workspace. */
  const made = await page.evaluate(async (n) => {
    const s = JSON.parse(localStorage.getItem('session') ?? 'null') as { access_token: string }
    const ask = (path: string, token: string, body?: unknown) =>
      fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${token}`, 'x-api-version': '1', 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }).then((r) => r.json())
    const second = await ask('/api/workspaces', s.access_token, { name: `Handed ${n}` })
    const me = await ask('/api/me', second.access_token)
    const projects = (await ask('/api/projects', s.access_token)).projects as { id: string }[]
    const into = (await ask('/api/invites', s.access_token, { project_ids: [projects[0]!.id] })).token as string
    const there = (await ask('/api/invites', second.access_token, { rights: [] })).token as string
    return { session: second, slug: me.workspace.slug as string, into, there }
  }, stamp)

  // Somebody new comes in by the first link and is signed in.
  const them = await (await browser.newContext()).newPage()
  await them.goto(`/invite/${made.into}`)
  await them.getByTestId('join-name').fill(`Kit ${stamp}`)
  await them.getByTestId('join-email').fill(`kit${stamp}@example.com`)
  await them.getByTestId('join-password').fill('correct-horse-battery-staple')
  await them.getByTestId('join').click()
  await expect(them.locator('aside [data-project]').first()).toBeVisible({ timeout: 20_000 })

  /* A link with no address proves nothing about the one typed: until Kit
     confirms it, the second invitation says so plainly and stays unspent. */
  await them.goto(`/invite/${made.there}`)
  await them.getByTestId('join-as-me').click()
  await expect(them.locator('[data-join-said]')).toHaveText(
    'Confirm your email first. Open the link we sent you to choose a password, then join.',
    { timeout: 15_000 },
  )
  // Kit opens the letter, chooses a password, and signs in with it.
  await them.goto(await letterTo(`kit${stamp}@example.com`, 'reset'))
  await them.getByTestId('reset-password').fill('kits-own-password-now')
  await them.getByRole('button', { name: 'Set password' }).click()
  await expect(them.getByTestId('reset-done')).toBeVisible({ timeout: 15_000 })
  // Choosing it ended the session the link gave: signed in again, by password.
  await them.evaluate(() => localStorage.removeItem('session'))
  await them.goto('/signin')
  await them.getByPlaceholder('Email').fill(`kit${stamp}@example.com`)
  await them.getByPlaceholder('Password').fill('kits-own-password-now')
  await them.getByRole('button', { name: 'Sign in' }).click()
  /* The studio was joined before the address was confirmed, so it is asked
     about first. Kit joins it. */
  await expect(them.getByTestId('unconfirmed')).toBeVisible({ timeout: 20_000 })
  await them.getByTestId('unconfirmed-join').click()
  await expect(them.locator('aside [data-project]').first()).toBeVisible({ timeout: 20_000 })

  // The second link, signed in: one press, no password.
  await them.goto(`/invite/${made.there}`)
  await expect(them.locator('[data-join-as]')).toContainText(`Kit ${stamp}`, { timeout: 15_000 })
  await expect(them.getByTestId('join-password')).toHaveCount(0)
  await them.getByTestId('join-as-me').click()
  await expect(them).toHaveURL(new RegExp(`/${made.slug}`), { timeout: 20_000 })

  // The owner of that workspace hands it over, from its settings.
  await page.evaluate((s) => localStorage.setItem('session', JSON.stringify(s)), made.session)
  await page.goto(`/${made.slug}/settings`)
  const heights = await drawnWhole(page, '[data-dialog-panel]', () => page.getByTestId('handover').click())
  expect(heights).toHaveLength(1)
  await expect(page.getByTestId('handover-send')).toContainText(`Kit ${stamp}`)
  await page.getByTestId('handover-password').fill('correct-horse-battery-staple')
  await page.getByTestId('handover-send').click()
  await page.waitForURL((u) => !u.pathname.endsWith('/settings'), { timeout: 15_000 })
  // A member now: the workspace's settings are somebody else's.
  await page.goto(`/${made.slug}/settings`)
  await expect(page.getByText('Only the owner can change this workspace’s settings.')).toBeVisible({ timeout: 15_000 })
})

/*
 * An agent elsewhere asks to be connected. The
 * page names it and the workspace, Allow sends the browser back with a code
 * and the state it was given, Cancel with access_denied; and somebody not
 * signed in signs in first and lands back on the same question.
 */
test('an agent asking to be connected is allowed, refused, and waited for through a sign-in', async ({ page, browser }) => {
  test.setTimeout(90_000)
  await login(page)
  const back = 'http://localhost:5180/welcome'
  const client = await page.evaluate(async (uri) => {
    const r = await fetch('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'Test agent', redirect_uris: [uri] }),
    })
    return ((await r.json()) as { client_id: string }).client_id
  }, back)
  const asking = (state: string) =>
    `/oauth/authorize?response_type=code&client_id=${client}&redirect_uri=${encodeURIComponent(back)}` +
    `&code_challenge=${'a'.repeat(43)}&code_challenge_method=S256&state=${state}`

  await page.goto(asking('one'))
  await expect(page.getByTestId('connect')).toContainText('Test agent', { timeout: 15_000 })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Connect Test agent')
  // The name is the agent's own word; where the code goes is not.
  await expect(page.getByTestId('connect-goes-to')).toContainText('localhost:5180')
  await page.getByTestId('connect-allow').click()
  await page.waitForURL(/\/welcome\?/, { timeout: 15_000 })
  const given = new URL(page.url())
  expect(given.searchParams.get('code')).toMatch(/^code_/)
  expect(given.searchParams.get('state')).toBe('one')

  await page.goto(asking('two'))
  await page.getByTestId('connect-cancel').click()
  await page.waitForURL(/error=access_denied/, { timeout: 15_000 })
  expect(new URL(page.url()).searchParams.get('state')).toBe('two')

  // Nobody signed in: sign in, and the same question again.
  const them = await (await browser.newContext()).newPage()
  await them.goto(asking('three'))
  await them.getByTestId('connect-sign-in').click()
  await them.getByPlaceholder('email').fill(account())
  await them.getByPlaceholder('password').fill(PASSWORD)
  await them.getByRole('button', { name: 'Sign in' }).click()
  await expect(them.getByTestId('connect')).toContainText('Test agent', { timeout: 20_000 })
  expect(new URL(them.url()).searchParams.get('state')).toBe('three')
})

/*
 * Signed in as an agent.
 * The page offers the agents the person manages beside themselves;
 * a `login_hint` naming one only preselects it, the page saying what that
 * means, and only Allow sends it — the code then becomes the agent's token.
 */
test('an agent asking to be connected can be signed in as one of your agents, chosen by a press', async ({ page }) => {
  test.setTimeout(90_000)
  await login(page)
  const back = 'http://localhost:5180/welcome'
  const stamp = String(Date.now()).slice(-6)
  const staged = await page.evaluate(
    async ({ uri, stamp }) => {
      const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
      const h = { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1', 'content-type': 'application/json' }
      const p = (await (
        await fetch('/api/projects', { method: 'POST', headers: h, body: JSON.stringify({ name: `Routine ${stamp}` }) })
      ).json()) as {
        id: string
      }
      const a = await fetch('/api/agents', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ name: `Routine ${stamp}`, project_ids: [p.id], reach: 'mcp' }),
      })
      const { agent_id } = (await a.json()) as { agent_id: string }
      const r = await fetch('/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_name: 'Routine client', redirect_uris: [uri] }),
      })
      return { agent: agent_id, client: ((await r.json()) as { client_id: string }).client_id }
    },
    { uri: back, stamp },
  )
  const verifier = 'v'.repeat(43)
  const challenge = await page.evaluate(async (v) => {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))
    return btoa(String.fromCharCode(...d))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  }, verifier)
  await page.goto(
    `/oauth/authorize?response_type=code&client_id=${staged.client}&redirect_uri=${encodeURIComponent(back)}` +
      `&code_challenge=${challenge}&code_challenge_method=S256&state=as&login_hint=${staged.agent}`,
  )
  const choice = page.getByTestId('connect-as')
  await expect(choice).toBeVisible({ timeout: 15_000 })
  // Preselected by the hint, and the page says what that means.
  const theAgent = choice.locator(`[data-connect-as="${staged.agent}"]`)
  await expect(theAgent).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('connect-wants')).toContainText(`as Routine ${stamp}`)
  // Back to me and to the agent again, by pressing.
  await choice.locator('[data-connect-as="me"]').click()
  await expect(page.getByTestId('connect-wants')).toContainText('as you')
  await theAgent.click()
  await expect(theAgent).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('connect-allow').click()
  await page.waitForURL(/\/welcome\?/, { timeout: 15_000 })
  const code = new URL(page.url()).searchParams.get('code')!
  // The code becomes the agent's token.
  const me = await page.evaluate(
    async ({ code, client, uri, verifier }) => {
      const t = await fetch('/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: client,
          redirect_uri: uri,
          code_verifier: verifier,
        }),
      })
      const { access_token } = (await t.json()) as { access_token: string }
      const m = await fetch('/api/me', { headers: { authorization: `Bearer ${access_token}`, 'x-api-version': '1' } })
      return ((await m.json()) as { actor: { id: string } }).actor.id
    },
    { code, client: staged.client, uri: back, verifier },
  )
  expect(me).toBe(staged.agent)
})

/*
 * The settings screens open whole.
 * Their sections each read something, and each used to draw itself when its
 * answer landed: the plan after the page, labels and sprints after the rest.
 * Measured from the first frame they show: their height never changes.
 */
test('the workspace, account and project settings open whole, each in one piece', async ({ page }) => {
  test.setTimeout(60_000)
  await login(page)
  await page.goto('/')
  await expect(page.getByTestId('nav-my')).toBeVisible({ timeout: 15_000 })
  for (const [whole, open] of [
    ['settings', () => openSettings(page)],
    ['account', () => openAccount(page)],
  ] as const) {
    const heights = await drawnWhole(page, `[data-whole="${whole}"]`, open)
    expect(heights, whole).toHaveLength(1)
  }
  await openProject(page, 'Website')
  const heights = await drawnWhole(page, '[data-whole="project-settings"]', () => page.getByTestId('tool-settings').click())
  expect(heights).toHaveLength(1)
})

test('two windows open on a session that has to be renewed, and both stay signed in', async ({ page }) => {
  test.setTimeout(60_000)
  await login(page)
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('session')!) as { access_token: string }
    localStorage.setItem('session', JSON.stringify({ ...s, access_token: 'run.out.token' }))
  })
  const other = await page.context().newPage()
  await Promise.all([page.goto('/'), other.goto('/')])
  for (const p of [page, other]) {
    await expect(p.getByTestId('nav-my')).toBeVisible({ timeout: 20_000 })
    await expect(p.getByPlaceholder('email')).toHaveCount(0)
  }
  // Still signed in after a reload: the session kept is a live one.
  await other.reload()
  await expect(other.getByTestId('nav-my')).toBeVisible({ timeout: 20_000 })
})

/*
 * Signing up.
 * A name and an address, and the account waits for its letter: the screen
 * says where it went.
 */
test('signing up asks for a name and an email, and waits for the letter', async ({ page }) => {
  await page.goto('/signup')
  const stamp = Date.now()
  const email = `new-${stamp}@example.com`
  await page.getByTestId('signup-name').fill('Nell New')
  // An address that is not one says so once it is left.
  await page.getByTestId('signup-email').fill('not-an-address')
  await page.getByTestId('signup-name').focus()
  await expect(page.getByText('That doesn’t look like an email address.')).toBeVisible()
  await expect(page.getByTestId('signup-go')).toBeDisabled()
  await page.getByTestId('signup-email').fill(email)
  // No password here: it is chosen from the letter.
  await expect(page.getByTestId('signup').locator('input[type="password"]')).toHaveCount(0)
  await page.getByTestId('signup-go').click()
  await expect(page.getByTestId('check-email')).toContainText(email, { timeout: 15_000 })

  // A link that is not one says so, with the way back.
  await page.goto('/verify/vfy_not-a-real-one-at-all')
  await expect(page.getByTestId('verify')).toHaveAttribute('data-state', 'gone', { timeout: 15_000 })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('This link is no longer valid.')
})

/*
 * The whole way in: sign up, open the letter, choose a password, and land
 * in the workspace made with the account.
 * The screen that asks for the password is drawn whole, and typing into it
 * moves nothing.
 */
test('the letter asks for a password, and choosing it lands in the new workspace', async ({ page }) => {
  await page.goto('/signup')
  const stamp = Date.now()
  const email = `chooser-${stamp}@example.com`
  await page.getByTestId('signup-name').fill('Cleo Chooser')
  await page.getByTestId('signup-email').fill(email)
  await page.getByTestId('signup-go').click()
  await expect(page.getByTestId('check-email')).toContainText(email, { timeout: 15_000 })

  const link = await letterTo(email, 'reset')
  expect(link).toMatch(/^\/reset\/chs_/)
  await page.goto(link)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Choose a password.')
  await expect(page.getByTestId('choose-password')).toBeVisible()
  const heights = await drawnWhole(page, '[data-testid="reset-form"]', async () => {
    await page.getByTestId('reset-password').fill('short')
    await page.getByTestId('reset-password').fill('a-password-of-her-own')
  })
  expect(heights).toHaveLength(1)
  await expect(page.getByTestId('password-rule')).toHaveText('Long enough')
  await page.getByRole('button', { name: 'Set password' }).click()

  // In, without signing in again: the workspace made with the account.
  await expect(page.getByTestId('nav-my')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('workspace-menu').first()).toContainText('Cleo’s workspace')

  // And the password is the way back in.
  await page.evaluate(() => localStorage.removeItem('session'))
  await page.goto('/signin')
  await page.getByPlaceholder('Email').fill(email)
  await page.getByPlaceholder('Password').fill('a-password-of-her-own')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByTestId('nav-my')).toBeVisible({ timeout: 20_000 })
})

test('a forgotten password has a way back, and a spent link says so', async ({ page }) => {
  await page.goto('/signin')
  await page.getByTestId('to-forgot').click()
  await page.getByTestId('forgot-email').fill(`nobody-${Date.now()}@example.com`)
  await page.getByRole('button', { name: 'Send link' }).click()
  // The same answer whether or not there is an account.
  await expect(page.getByTestId('forgot-sent')).toBeVisible({ timeout: 15_000 })

  await page.goto('/reset/rst_not-a-real-one-at-all')
  await page.getByTestId('reset-password').fill('a-new-one-entirely')
  await page.getByRole('button', { name: 'Set password' }).click()
  await expect(page.getByText('This link was already used or has expired.')).toBeVisible({ timeout: 15_000 })
})

test('a ticket leaves the sign-in address as soon as it is read', async ({ page }) => {
  await page.goto('/signin?linked=lkd_not-a-real-one&ways=failed&invite=keep-me')
  await expect(page).toHaveURL(/\/signin\?invite=keep-me$/, { timeout: 15_000 })
  // A sign-in ticket that has run out says so, and is gone from the address too.
  await page.goto('/signin?handoff=hof_not-a-real-one-at-all')
  await expect(page.getByText('Your sign-in expired. Sign in again.')).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveURL(/\/signin$/)
})
