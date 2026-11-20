import { test, expect, type Page } from '@playwright/test'
import { login } from './helpers.js'

/*
 * "A new version is out" on a server of one's own,
 *
 * The check's server is the service's edition, which has no instance
 * owners and sends no `server`; a community server at `0.0.0` would show
 * no notice either, by rule. So the screen is given what a released
 * server of one's own tells its owner: `/api/me`'s real answer with
 * `instance` among `can` and a `server`, and `/api/instance` whole. What
 * is under test is the screen — the row, the dot and where they are —
 * and the server's half is `server/test/updates.test.ts` and
 * `server/test/instance.test.ts`.
 */

type Latest = { version: string; url: string; published_at: string; security: boolean } | null

async function asOwner(page: Page, server: { current: string; commit: string; check: boolean; latest: Latest }) {
  await page.route(
    (u) => u.pathname === '/api/me',
    async (r) => {
      if (r.request().method() !== 'GET') return r.continue()
      const res = await r.fetch()
      const body = (await res.json()) as { can: string[]; actor: { id: string; name: string } }
      await r.fulfill({ response: res, json: { ...body, can: [...body.can, 'instance'], server } })
    },
  )
  await page.route(
    (u) => u.pathname === '/api/instance',
    (r) =>
      r.fulfill({
        json: {
          sign_up_open: false,
          owners: [
            {
              actor_id: '00000000-0000-0000-0000-000000000001',
              name: 'Owner',
              email: 'owner@example.com',
              added_at: '2026-11-01T00:00:00Z',
            },
          ],
          mail: true,
          version: server,
        },
      }),
  )
}

const NOTES = 'https://github.com/usetuff/tuff/releases/tag/v1.3.0'

test('a security release: a red dot on the owner’s face and on Server settings, and the row with its notes and the command', async ({
  page,
}) => {
  await asOwner(page, {
    current: '1.2.0',
    commit: 'abc1234',
    check: true,
    latest: { version: '1.3.0', url: NOTES, published_at: '2026-11-10T12:00:00Z', security: true },
  })
  await login(page)
  const face = page.getByTestId('my-presence')
  await expect(face).toBeVisible({ timeout: 20_000 })
  await expect(face.getByTestId('security-dot')).toBeVisible()
  await expect(face.getByRole('img', { name: 'A security update is available' })).toBeVisible()

  await face.click()
  const door = page.getByTestId('nav-instance')
  await expect(door).toBeVisible()
  await expect(door.getByTestId('security-dot')).toBeVisible()
  await door.click()

  const version = page.getByTestId('instance-version')
  await expect(version).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('instance-version-current')).toHaveText('Version 1.2.0')
  await expect(version).toContainText('Tuff checks for new versions once a day.')
  const row = page.getByTestId('instance-version-latest')
  await expect(row).toHaveAttribute('data-security', 'yes')
  await expect(row).toContainText('Version 1.3.0 is out')
  await expect(row).toContainText('Security update')
  await expect(row.locator('code')).toHaveText('scripts/update.sh')
  await expect(row.getByTestId('security-dot')).toBeVisible()
  const notes = row.getByTestId('instance-version-notes')
  await expect(notes).toHaveText('Release notes')
  await expect(notes).toHaveAttribute('href', NOTES)
  await expect(notes).toHaveAttribute('target', '_blank')
  expect(page.url()).toMatch(/\/instance$/)
})

test('an ordinary release is a quiet row and no dot; a check turned off says so in one line', async ({ page }) => {
  await asOwner(page, {
    current: '1.2.0',
    commit: 'abc1234',
    check: false,
    latest: {
      version: '1.2.1',
      url: 'https://github.com/usetuff/tuff/releases/tag/v1.2.1',
      published_at: '2026-11-10T12:00:00Z',
      security: false,
    },
  })
  await login(page)
  const face = page.getByTestId('my-presence')
  await expect(face).toBeVisible({ timeout: 20_000 })
  await expect(face.getByTestId('security-dot')).toHaveCount(0)
  await face.click()
  await expect(page.getByTestId('nav-instance').getByTestId('security-dot')).toHaveCount(0)
  await page.getByTestId('nav-instance').click()

  const row = page.getByTestId('instance-version-latest')
  await expect(row).toBeVisible({ timeout: 15_000 })
  await expect(row).toHaveAttribute('data-security', 'no')
  await expect(row).toContainText('Version 1.2.1 is out')
  await expect(row).not.toContainText('Security update')
  await expect(page.getByTestId('instance-version')).toContainText('Checking for new versions is off.')
})

test('nothing newer: the version alone, no row, no dot', async ({ page }) => {
  await asOwner(page, { current: '1.3.0', commit: 'abc1234', check: true, latest: null })
  await login(page)
  const face = page.getByTestId('my-presence')
  await expect(face).toBeVisible({ timeout: 20_000 })
  await expect(face.getByTestId('security-dot')).toHaveCount(0)
  await face.click()
  await page.getByTestId('nav-instance').click()
  await expect(page.getByTestId('instance-version-current')).toHaveText('Version 1.3.0', { timeout: 15_000 })
  await expect(page.getByTestId('instance-version-latest')).toHaveCount(0)
})
