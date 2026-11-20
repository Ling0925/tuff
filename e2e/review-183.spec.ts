import { test, expect } from '@playwright/test'
import { login, openProject } from './helpers.js'

/*
 * What the review of asked of the screens.
 *
 * Both are about answers the seeded studio never gives — a server of one's
 * own with sign-up closed, a channel whose people have all gone — so the
 * answer is said to the page, and what is checked is what the page draws
 * and asks. The server's half is `server/test/instance.test.ts` and
 * `server/test/chosen-room.test.ts`.
 */

test('“New workspace” is offered only to whoever may make one', async ({ page }) => {
  await login(page)
  const menu = page.getByTestId('workspace-menu').first()
  await menu.click()
  await expect(page.getByTestId('workspace-new')).toBeVisible()
  await page.keyboard.press('Escape')

  /* As a closed server answers a member: no `workspace.create`. */
  await page.route('**/api/me', async (route) => {
    const r = await route.fetch()
    const me = (await r.json()) as { can: string[] }
    await route.fulfill({ response: r, json: { ...me, can: me.can.filter((a) => a !== 'workspace.create') } })
  })
  await page.reload()
  await expect(menu).toBeVisible({ timeout: 15_000 })
  await menu.click()
  await expect(page.getByTestId('workspace-option').first()).toBeVisible()
  await expect(page.getByTestId('workspace-new')).toHaveCount(0)
})

test('a channel nobody is in is offered to its project’s runner to open or delete', async ({ page }) => {
  await login(page)
  const ended: string[] = []
  let left = [
    { id: '00000000-0000-7000-8000-000000000001', name: 'gone-quiet', created_at: '2026-11-01T00:00:00Z' },
    { id: '00000000-0000-7000-8000-000000000002', name: 'old-crew', created_at: '2026-11-02T00:00:00Z' },
  ]
  await page.route('**/api/projects/*/empty-channels', (route) => route.fulfill({ json: { channels: left } }))
  await page.route(
    (url) => url.pathname.startsWith('/api/conversations/00000000-0000-7000-8000-00000000000'),
    async (route) => {
      const r = route.request()
      ended.push(`${r.method()} ${new URL(r.url()).pathname} ${r.postData() ?? ''}`.trim())
      left = left.filter((x) => !r.url().includes(x.id))
      await route.fulfill({ json: { ok: true } })
    },
  )

  await openProject(page, 'Website')
  await page.getByTestId('tool-settings').click()
  const section = page.getByTestId('empty-channels')
  await expect(section).toBeVisible({ timeout: 15_000 })
  await expect(section.getByTestId('empty-channel')).toHaveCount(2)
  await expect(section).toContainText('Nobody is in this channel')
  await expect(section).toContainText('#gone-quiet')

  /* Opening says first what it reveals, and does nothing until asked again. */
  await section.getByTestId('empty-channel').first().getByTestId('empty-channel-open').click()
  await expect(section.getByTestId('empty-channel-reveals')).toContainText(
    'Everyone on Website will see this channel’s messages and files.',
  )
  expect(ended).toEqual([])
  await section.getByTestId('empty-channel-cancel').click()
  await expect(section.getByTestId('empty-channel-reveals')).toHaveCount(0)
  await section.getByTestId('empty-channel').first().getByTestId('empty-channel-open').click()
  await section.getByTestId('empty-channel-open-go').click()
  await expect(section.getByTestId('empty-channel')).toHaveCount(1)
  await section.getByTestId('empty-channel-delete').click()
  await expect(section).toHaveCount(0)
  expect(ended).toEqual([
    'PUT /api/conversations/00000000-0000-7000-8000-000000000001/members {"member_ids":null}',
    'DELETE /api/conversations/00000000-0000-7000-8000-000000000002',
  ])
})
