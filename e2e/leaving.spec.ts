import { test, expect, type Page } from '@playwright/test'
import { PASSWORD, account, letterTo, login, openAccount, openProject } from './helpers.js'

/*
 * Three ways to leave: the workspace, a channel,
 * and following an announcement or a document. What each refuses is the
 * server's test, `leaving.test.ts`; this is the press a person makes.
 */

const SHOTS = '/private/tmp/claude-501/-Users-yurig-Projects-project-tracker/77a589fe-11f2-437c-8ef7-5bee4fc6ef77/scratchpad/leave'

/* Light, then dark, of whatever is on the screen — for the author to read. */
async function shoot(page: Page, name: string) {
  if (!process.env.LEAVE_SHOTS) return
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${SHOTS}/${name}-light.png` })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${SHOTS}/${name}-dark.png` })
  await page.emulateMedia({ colorScheme: 'light' })
}

/* What the page's own session may ask, as the page asks it. */
const asked = (page: Page) =>
  page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
    return { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1', 'content-type': 'application/json' }
  })

test('the owner is told to hand over; a member leaves and lands in their other workspace', async ({ page }) => {
  await login(page)
  await openAccount(page)
  const row = page.getByTestId('leave-workspace-row')
  await expect(row).toContainText('Hand it over', { timeout: 15_000 })
  await expect(page.getByTestId('leave-workspace')).toHaveCount(0)
  await row.scrollIntoViewIfNeeded()
  await shoot(page, 'owner-account')

  /* Somebody from another studio joins this one by a link, and is signed in
     here as them: a member, with a workspace of their own to go back to. */
  const mine = account()
  const other = (process.env.E2E_EMAIL ?? '').split(',').find((e) => e && e !== mine)!
  const h = await asked(page)
  const joined = await page.evaluate(
    async ({ h, other, password }) => {
      const invite = (await (
        await fetch('/api/invites', { method: 'POST', headers: h, body: JSON.stringify({ role: 'member', project_ids: [], rights: [] }) })
      ).json()) as { token: string }
      const them = (await (
        await fetch('/auth/login', { method: 'POST', headers: h, body: JSON.stringify({ email: other, password }) })
      ).json()) as { access_token: string }
      const r = await fetch(`/api/invite/${invite.token}/join`, {
        method: 'POST',
        headers: { ...h, authorization: `Bearer ${them.access_token}` },
      })
      const me = (await (await fetch('/api/me', { headers: h })).json()) as { workspace: { slug: string; name: string } }
      return { status: r.status, session: await r.json(), here: me.workspace }
    },
    { h, other, password: PASSWORD },
  )
  expect(joined.status, JSON.stringify(joined.session)).toBe(200)
  await page.evaluate((s) => localStorage.setItem('session', JSON.stringify(s)), joined.session)
  await page.goto(`/${joined.here.slug}/account`)

  const leave = page.getByTestId('leave-workspace')
  await expect(leave).toBeVisible({ timeout: 15_000 })
  await leave.click()
  const dialog = page.getByTestId('leave-workspace-dialog')
  await expect(dialog).toContainText('You’ll lose access to its projects and chats.')
  await expect(dialog).toContainText('Someone can invite you back.')
  /* Somewhere else to go: no field for a new one. */
  await expect(page.getByTestId('leave-workspace-new')).toHaveCount(0)
  await shoot(page, 'leave-workspace')

  const left = page.waitForResponse((r) => r.url().endsWith('/api/me/leave'))
  await page.getByTestId('leave-workspace-go').click()
  expect((await left).status()).toBe(200)
  await page.waitForURL((u) => !u.pathname.startsWith(`/${joined.here.slug}`), { timeout: 15_000 })
  await expect(page.getByTestId('nav-my')).toBeVisible({ timeout: 30_000 })
})

test('a channel is left from its menu, and goes from the list', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await login(page)
  const h = await asked(page)
  const name = `leave-${Date.now() % 1_000_000}`
  /* A channel of chosen people outside every project — first in the list. */
  const made = await page.evaluate(
    async ({ h, name }) => {
      const me = (await (await fetch('/api/me', { headers: h })).json()) as { actor: { id: string } }
      const people = (await (await fetch('/api/people', { headers: h })).json()) as { people: { actor_id: string; agent?: boolean }[] }
      const someone = people.people.find((p) => p.actor_id !== me.actor.id && !p.agent)!
      const r = await fetch('/api/conversations/channels', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ name, member_ids: [me.actor.id, someone.actor_id] }),
      })
      return (await r.json()) as { id: string }
    },
    { h, name },
  )
  await page.reload()
  const room = page.locator(`aside [data-room][data-order="${made.id}"]`)
  await expect(room).toBeVisible({ timeout: 15_000 })
  /* Not in the side column's menu: there it stood beside Hide. In the
     room's own settings. */
  await room.click({ button: 'right' })
  await expect(page.locator('[data-room-menu]')).toBeVisible()
  await expect(page.getByTestId('room-leave')).toHaveCount(0)
  /* The room itself, by its address, and its settings from its head. */
  const ws = new URL(page.url()).pathname.split('/')[1]
  await page.goto(`/${ws}/chat/${made.id}`)
  await page.getByTestId('room-settings').click()
  await expect(page.getByTestId('room-leave')).toBeVisible()
  await shoot(page, 'channel-menu')
  await page.getByTestId('room-leave').click()
  const dialog = page.getByTestId('leave-channel-dialog')
  await expect(dialog).toContainText(`You’ll stop seeing #${name}. Someone in it can add you back.`)
  await shoot(page, 'leave-channel')
  const left = page.waitForResponse((r) => r.url().endsWith(`/api/conversations/${made.id}/leave`))
  await page.getByTestId('leave-channel-go').click()
  expect((await left).status()).toBe(200)
  await expect(room).toHaveCount(0, { timeout: 15_000 })
  await page.reload()
  await expect(page.locator('aside [data-room]').first()).toBeVisible({ timeout: 15_000 })
  await expect(room).toHaveCount(0)
})

test('an announcement is unfollowed from its head and a document from its menu, and both stay so', async ({ page }) => {
  await login(page)
  await openProject(page, 'Onboarding')
  const h = await asked(page)
  const stamp = Date.now() % 1_000_000
  const made = await page.evaluate(
    async ({ h, stamp }) => {
      const projects = (await (await fetch('/api/projects', { headers: h })).json()) as { projects: { id: string; name: string }[] }
      const p = projects.projects.find((x) => x.name === 'Onboarding')!
      const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'To follow.' }] }] }
      await fetch(`/api/projects/${p.id}/posts`, { method: 'POST', headers: h, body: JSON.stringify({ title: `Followed ${stamp}`, body }) })
      await fetch(`/api/projects/${p.id}/files`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ name: `Followed doc ${stamp}`, body }),
      })
      return { post: `Followed ${stamp}`, doc: `Followed doc ${stamp}` }
    },
    { h, stamp },
  )

  /* The announcement: its author follows it, and stops. */
  await page.getByTestId('tool-posts').click()
  await page.locator('[data-open-post]').filter({ hasText: made.post }).first().click()
  const post = page.getByTestId('follow-post')
  await expect(post).toHaveText('Subscribed', { timeout: 15_000 })
  await shoot(page, 'post-subscribed')
  const off = page.waitForResponse((r) => r.url().includes('/subscription') && r.request().method() === 'DELETE')
  await post.click()
  await expect(post).toHaveText('Subscribe')
  expect((await off).status()).toBe(200)
  await page.reload()
  await expect(page.getByTestId('follow-post')).toHaveText('Subscribe', { timeout: 15_000 })

  /* The document, the same. */
  await page.getByTestId('tool-files').click()
  await page.locator('[data-file]').filter({ hasText: made.doc }).first().click()
  /* On a document it is a switch in ⋯, not a pill on the head. */
  await expect(page.getByTestId('file-menu')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: /^Subscribed?$/ })).toHaveCount(0)
  await page.getByTestId('file-menu').click()
  const doc = page.getByTestId('follow-file')
  await expect(doc).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 })
  const off2 = page.waitForResponse((r) => r.url().includes('/subscription') && r.request().method() === 'DELETE')
  await doc.click()
  await expect(doc).toHaveAttribute('aria-checked', 'false')
  expect((await off2).status()).toBe(200)
  await shoot(page, 'doc-unsubscribed')
  await page.reload()
  await page.getByTestId('file-menu').click()
  await expect(page.getByTestId('follow-file')).toHaveAttribute('aria-checked', 'false', { timeout: 15_000 })
})

test('leaving the last workspace lands on No workspaces, where an invitation is joined', async ({ page, browser }) => {
  await login(page)
  const h = await asked(page)
  const stamp = Date.now() % 1_000_000
  const email = `drifter${stamp}@example.com`
  const link = await page.evaluate(async (h) => {
    const r = await fetch('/api/invites', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ role: 'member', project_ids: [], rights: [] }),
    })
    return ((await r.json()) as { token: string }).token
  }, h)

  /* Somebody new joins by the link, proves the address, and signs in. */
  const them = await (await browser.newContext()).newPage()
  await them.goto(`/invite/${link}`)
  await them.getByTestId('join-name').fill(`Drifter ${stamp}`)
  await them.getByTestId('join-email').fill(email)
  await them.getByTestId('join-password').fill(PASSWORD)
  await them.getByTestId('join').click()
  await expect(them.getByTestId('nav-my')).toBeVisible({ timeout: 20_000 })
  await them.goto(await letterTo(email, 'reset'))
  await them.getByTestId('reset-password').fill('drifters-own-password')
  await them.getByRole('button', { name: 'Set password' }).click()
  await expect(them.getByTestId('reset-done')).toBeVisible({ timeout: 15_000 })
  await them.evaluate(() => localStorage.removeItem('session'))
  await them.goto('/signin')
  await them.getByPlaceholder('Email').fill(email)
  await them.getByPlaceholder('Password').fill('drifters-own-password')
  await them.getByRole('button', { name: 'Sign in' }).click()
  await expect(them.getByTestId('nav-my')).toBeVisible({ timeout: 20_000 })

  /* Their only workspace, left: the screen for no workspace. */
  await them.getByTestId('my-presence').click()
  await them.getByTestId('nav-account').click()
  await them.getByTestId('leave-workspace').click()
  await them.getByTestId('leave-workspace-go').click()
  await expect(them.getByTestId('nowhere')).toBeVisible({ timeout: 20_000 })
  await expect(them.getByTestId('nowhere-create')).toBeVisible()
  await expect(them.getByTestId('nowhere')).toContainText(`Signed in as ${email}`)

  /* Signed out and in again, it is where they land. */
  await them.getByTestId('nowhere-sign-out').click()
  await them.waitForURL(/\/signin/, { timeout: 15_000 })
  await them.getByPlaceholder('Email').fill(email)
  await them.getByPlaceholder('Password').fill('drifters-own-password')
  await them.getByRole('button', { name: 'Sign in' }).click()
  await expect(them.getByTestId('nowhere')).toBeVisible({ timeout: 20_000 })

  /* Invited again by address, the invitation waits there and is joined. */
  await page.evaluate(
    async ({ h, email }) => {
      await fetch('/api/invites', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ role: 'member', email, project_ids: [], rights: [] }),
      })
    },
    { h, email },
  )
  await them.reload()
  await expect(them.getByTestId('nowhere-join')).toBeVisible({ timeout: 15_000 })
  await shoot(them, 'no-workspaces')
  await them.getByTestId('nowhere-join').click()
  await expect(them.getByTestId('nav-my')).toBeVisible({ timeout: 20_000 })
})
