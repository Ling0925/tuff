import { test, expect } from '@playwright/test'
import { PASSWORD, letterTo, login } from './helpers.js'

/*
 * Workspaces joined before the proof,
 * Somebody joins by a link with no address, so their address is
 * not proved; when they prove it by choosing a password from the letter,
 * the workspace they joined waits for their own Join. The server's half —
 * a stranger's membership opening nothing, Leave, the press and nothing
 * else — is `server/test/joined-before-proof.test.ts`; this is the screen.
 */

test('a workspace joined before the address was confirmed is asked about, drawn whole, and joined', async ({ page, browser }) => {
  await login(page)
  const made = await page.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('session') ?? 'null') as { access_token: string }
    const h = { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1', 'content-type': 'application/json' }
    const me = (await (await fetch('/api/me', { headers: h })).json()) as { workspace: { name: string } }
    const r = await fetch('/api/invites', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ role: 'member', project_ids: [], rights: [] }),
    })
    return { token: ((await r.json()) as { token: string }).token, name: me.workspace.name }
  })
  const stamp = Date.now() % 1_000_000
  const email = `early${stamp}@example.com`

  /* In by the link, unconfirmed, and signed in once. */
  const them = await (await browser.newContext()).newPage()
  await them.goto(`/invite/${made.token}`)
  await them.getByTestId('join-name').fill(`Early ${stamp}`)
  await them.getByTestId('join-email').fill(email)
  await them.getByTestId('join-password').fill(PASSWORD)
  await them.getByTestId('join').click()
  await expect(them.getByTestId('nav-my')).toBeVisible({ timeout: 20_000 })

  /* The letter that chooses a password, followed: the address is proved. */
  await them.goto(await letterTo(email, 'reset'))
  await them.getByTestId('reset-password').fill('earlys-own-password')
  await them.getByRole('button', { name: 'Set password' }).click()
  await expect(them.getByTestId('reset-done')).toBeVisible({ timeout: 15_000 })

  /* Every height the screen has from the moment it first appears, on whichever load draws it. */
  await them.addInitScript(() => {
    const w = window as unknown as { heights: number[] }
    w.heights = []
    let first = 0
    const look = (t: number) => {
      const el = document.querySelector('[data-testid="unconfirmed"]')
      const h = el ? Math.round(el.getBoundingClientRect().height) : 0
      if (h > 0) {
        if (!first) first = t
        if (w.heights[w.heights.length - 1] !== h) w.heights.push(h)
      }
      if (!first || t - first < 1200) requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  })
  /* Signed in with the new password: the studio waits, so the question comes first. */
  await them.evaluate(() => localStorage.removeItem('session'))
  await them.goto('/signin')
  await them.getByPlaceholder('Email').fill(email)
  await them.getByPlaceholder('Password').fill('earlys-own-password')
  await them.getByRole('button', { name: 'Sign in' }).click()

  const screen = them.getByTestId('unconfirmed')
  await expect(screen).toBeVisible({ timeout: 20_000 })
  await expect(screen).toContainText('Check your workspaces')
  await expect(screen).toContainText('before you confirmed your email')
  await expect(them.getByTestId('unconfirmed-row')).toHaveCount(1)
  await expect(them.getByTestId('unconfirmed-row')).toContainText(made.name)
  await expect(them.getByTestId('unconfirmed-leave')).toBeVisible()
  await them.waitForTimeout(1500)
  expect(await them.evaluate(() => (window as unknown as { heights: number[] }).heights)).toHaveLength(1)

  /* Opening the screen answered nothing: the workspace still waits. */
  const waiting = await them.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('session') ?? 'null') as { access_token: string }
    const r = await fetch('/api/me/unconfirmed', { headers: { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1' } })
    return ((await r.json()) as { waiting: unknown[] }).waiting.length
  })
  expect(waiting).toBe(1)

  /* Join: into the workspace, and not asked again. */
  const answered = them.waitForResponse((r) => r.url().includes('/api/me/unconfirmed/') && r.request().method() === 'POST')
  await them.getByTestId('unconfirmed-join').click()
  expect((await answered).status()).toBe(200)
  await expect(them.getByTestId('nav-my')).toBeVisible({ timeout: 20_000 })
  await them.reload()
  await expect(them.getByTestId('nav-my')).toBeVisible({ timeout: 20_000 })
  await expect(them.getByTestId('unconfirmed')).toHaveCount(0)
})
