import { expect, type Page, test } from '@playwright/test'
import { login } from './helpers.js'

/*
 * The session is renewed ahead of its end, not after a burst of 401s.
 *
 * Nobody waits a quarter of an hour here. No setting shortens the server's
 * token, and the client counts its end on its own clock (`expires_at`,
 * written on the kept session), so the tests move that instead: the kept
 * session's end, or the page's clock, the way a laptop's lid moves it.
 */

type Kept = { access_token: string; refresh_token: string; expires_at?: number }
const kept = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('session') ?? '{}') as Kept)

/* What the page asks for from here: renewals, refusals, and the token each
   API request carried. */
function watch(page: Page) {
  const seen = { renewals: 0, refused: [] as string[], bearers: [] as string[] }
  page.on('request', (r) => {
    if (r.url().endsWith('/auth/refresh')) seen.renewals++
    else if (r.url().includes('/api/')) seen.bearers.push(r.headers().authorization ?? '')
  })
  page.on('response', (r) => {
    if (r.status() === 401) seen.refused.push(r.url())
  })
  return seen
}

test('a tab opened twenty minutes after its token ran out loads its screen with nothing refused', async ({ page }) => {
  await login(page)
  /* Its token ran out twenty minutes ago. Written as one the server truly
     refuses, so a single request sent with it would be a 401 here. */
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('session')!) as Record<string, unknown>
    localStorage.setItem('session', JSON.stringify({ ...s, access_token: 'run.out.token', expires_at: Date.now() - 20 * 60_000 }))
  })
  const seen = watch(page)
  await page.reload()
  await expect(page.getByTestId('nav-my')).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => seen.bearers.filter(Boolean).length).toBeGreaterThan(0)
  expect(seen.renewals).toBe(1)
  expect(seen.refused).toEqual([])
  expect(seen.bearers.some((b) => b.includes('run.out.token'))).toBe(false)
  expect((await kept(page)).access_token).not.toBe('run.out.token')
})

test('a tab come back with less than two minutes left renews once, and the timer renews a minute ahead', async ({ page }) => {
  await page.clock.install()
  await login(page)
  const first = await kept(page)
  expect(typeof first.expires_at).toBe('number')
  const seen = watch(page)

  /* Back after thirteen and a half minutes, the timers asleep meanwhile:
     renewed on coming back — once, though the tab heard both signs. */
  await page.clock.setSystemTime(first.expires_at! - 90_000)
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
  })
  await expect.poll(async () => (await kept(page)).refresh_token).not.toBe(first.refresh_token)
  expect(seen.renewals).toBe(1)
  const second = await kept(page)

  /* Left open: the timer renews a minute before the new token's end. */
  await page.clock.fastForward(second.expires_at! - 55_000 - (await page.evaluate(() => Date.now())))
  await expect.poll(async () => (await kept(page)).refresh_token).not.toBe(second.refresh_token)
  expect(seen.renewals).toBe(2)

  /* And what is asked next carries the newest token, not refused. */
  const third = await kept(page)
  seen.bearers.length = 0
  await page.getByTestId('nav-chats').click()
  await expect(page).toHaveURL(/\/chat/)
  await expect.poll(() => seen.bearers.filter(Boolean).length).toBeGreaterThan(0)
  /* A picture's address carries no header; every request that does carries this one. */
  expect(seen.bearers.filter(Boolean).every((b) => b === `Bearer ${third.access_token}`)).toBe(true)
  expect(seen.refused).toEqual([])
})
