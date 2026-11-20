import { test, expect, type Page, type Request } from '@playwright/test'

/*
 * Your own server's first opening.
 *
 * The check's server is the service's edition, where `/auth/setup` does
 * not exist and `/setup` is an address like any other. So the screen is
 * given what a fresh server of one's own answers, by `page.route`, and the
 * preview's page — which no server wrote, as on the dev server — opens the
 * setup screen from the link's own token. What is under test is the
 * screen: the token out of the address bar and into a header, the two
 * steps, what skipping says, and what is sent. The server's half is
 * `server/test/first-run.test.ts`.
 */

const TOKEN = 'a'.repeat(64)
const NONE = { source: null, via: null, host: null, port: null, security: null, user: null, secret_set: false, sender: null }

type Seen = { method: string; path: string; token: string | null; body: unknown }

async function freshServer(page: Page, opts: { ownerEmail?: string | null; bad?: boolean } = {}): Promise<Seen[]> {
  const seen: Seen[] = []
  let mail: Record<string, unknown> = NONE
  /* Nothing reaches the check's server: the app the last step opens on is
     told this session is nobody's, as a fresh server would never be asked. */
  await page.route(
    (u) => u.pathname.startsWith('/api/') || (u.pathname.startsWith('/auth/') && !u.pathname.startsWith('/auth/setup')),
    (r) => r.fulfill({ status: 401, json: { error: { code: 'unauthorized' } } }),
  )
  await page.routeWebSocket(/\/ws(\?|$)/, (ws) => ws.close())
  await page.route(
    (u) => u.pathname === '/auth/providers',
    (r) => r.fulfill({ json: { google: false, apple: false, github: false, mail: false, no_mail: true, sign_up: false } }),
  )
  await page.route(
    (u) => u.pathname.startsWith('/auth/setup'),
    async (r) => {
      const q: Request = r.request()
      const path = new URL(q.url()).pathname
      const body = q.postData() ? JSON.parse(q.postData()!) : null
      seen.push({ method: q.method(), path, token: (await q.allHeaders())['x-setup-token'] ?? null, body })
      if (opts.bad) return r.fulfill({ status: 403, json: { error: { code: 'bad_token', message: 'This setup link doesn’t work.' } } })
      if (path === '/auth/setup') return r.fulfill({ json: { owner_email: opts.ownerEmail ?? null, mail_setup: mail } })
      if (path === '/auth/setup/mail' && q.method() === 'PUT') {
        const b = body as Record<string, string | number | null>
        mail = {
          source: 'saved',
          via: b.via,
          host: b.host ?? null,
          port: b.port ?? null,
          security: b.security ?? null,
          user: b.user ?? null,
          secret_set: true,
          sender: b.sender,
        }
        return r.fulfill({ json: { mail_setup: mail } })
      }
      if (path === '/auth/setup/mail' && q.method() === 'DELETE') {
        mail = NONE
        return r.fulfill({ json: { mail_setup: mail } })
      }
      if (path === '/auth/setup/mail/test') return r.fulfill({ json: { sent: true, mail: true } })
      if (path === '/auth/setup/owner') {
        return r.fulfill({
          status: 201,
          json: {
            access_token: 'not-a-real-token',
            refresh_token: 'rft_not_real',
            expires_in: 900,
            actor_id: '00000000-0000-0000-0000-000000000001',
            workspace_id: '00000000-0000-0000-0000-000000000002',
          },
        })
      }
      return r.fulfill({ status: 404, json: { error: { code: 'not_found' } } })
    },
  )
  return seen
}

test('the setup link: the token leaves the address bar, email is set up and tested, and the owner is made in one press', async ({
  page,
}) => {
  const seen = await freshServer(page, { ownerEmail: 'owner@example.com' })
  await page.goto(`/setup?token=${TOKEN}`)
  await expect(page.getByTestId('setup-mail')).toBeVisible()
  /* Out of the address bar at once: no history, bookmark or Referer carries it. */
  expect(new URL(page.url()).search).toBe('')

  await page.getByTestId('mail-host').fill('smtp.example.com')
  await page.getByTestId('mail-user').fill('owner@example.com')
  await page.getByTestId('mail-password').fill('smtp-password-1')
  await page.getByTestId('mail-sender').fill('Tuff <tuff@example.com>')
  /* Filled with the owner's address, and sent there. */
  await expect(page.getByTestId('setup-test-to')).toHaveValue('owner@example.com')
  await page.getByTestId('setup-test').click()
  await expect(page.getByTestId('setup-test-said')).not.toHaveText('')
  const put = seen.find((s) => s.path === '/auth/setup/mail' && s.method === 'PUT')
  expect(put?.body).toEqual({
    via: 'smtp',
    host: 'smtp.example.com',
    port: 465,
    security: 'tls',
    user: 'owner@example.com',
    password: 'smtp-password-1',
    sender: 'Tuff <tuff@example.com>',
  })
  expect(seen.find((s) => s.path === '/auth/setup/mail/test')?.body).toEqual({ to: 'owner@example.com' })

  await page.getByTestId('setup-continue').click()
  await expect(page.getByTestId('setup-owner')).toBeVisible()
  /* The address OWNER_EMAIL names, and no other. */
  await expect(page.getByTestId('setup-email')).toHaveValue('owner@example.com')
  await expect(page.getByTestId('setup-email')).toHaveAttribute('readonly', '')
  await page.getByTestId('setup-name').fill('Olga Owner')
  await page.getByTestId('setup-password').fill('a-long-enough-password')
  await page.getByTestId('setup-create').click()
  await page.waitForURL((u) => u.pathname === '/' || !u.pathname.startsWith('/setup'))
  expect(seen.find((s) => s.path === '/auth/setup/owner')?.body).toEqual({
    name: 'Olga Owner',
    email: 'owner@example.com',
    password: 'a-long-enough-password',
  })
  /* Every request carried the token in its header, and none in an address. */
  for (const s of seen) {
    expect(s.token, `${s.method} ${s.path}`).toBe(TOKEN)
  }
})

test('skipping email says what won’t work, and goes on to the account', async ({ page }) => {
  const seen = await freshServer(page)
  await page.goto(`/setup?token=${TOKEN}`)
  await page.getByTestId('setup-skip-open').click()
  const skip = page.getByTestId('setup-skip')
  await expect(skip).toBeVisible()
  await expect(skip.locator('li')).toHaveCount(3)
  await page.getByTestId('setup-skip-go').click()
  await expect(page.getByTestId('setup-owner')).toBeVisible()
  /* Nothing was saved, so nothing is cleared. */
  expect(seen.filter((s) => s.path === '/auth/setup/mail')).toEqual([])
  /* Any address, when none is named. */
  await expect(page.getByTestId('setup-email')).not.toHaveAttribute('readonly', '')
})

test('a wrong link says so and offers nothing else', async ({ page }) => {
  await freshServer(page, { bad: true })
  await page.goto(`/setup?token=${'b'.repeat(64)}`)
  await expect(page.getByTestId('setup-closed')).toHaveAttribute('data-state', 'bad')
  await expect(page.getByTestId('setup-mail')).toHaveCount(0)
})
