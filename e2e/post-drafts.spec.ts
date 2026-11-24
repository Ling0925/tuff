import { test, expect, type Page } from '@playwright/test'
import { drawnWhole, letterTo, login, openProject, PASSWORD } from './helpers.js'

/*
 * An announcement can wait as its author's draft.
 * Who else reads one, and what publishing sends, is asked of the server as
 * each of them in `server/test/post-drafts.test.ts`; this is the walk a
 * person takes, and what another member of the project is shown.
 */

const asked = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
    const r = await fetch(p, { headers: { 'x-api-version': '1', authorization: `Bearer ${s.access_token}` } })
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
  }, path)

test('Save draft keeps an announcement its author’s, and Publish gives it to the project', async ({ page, browser }) => {
  test.setTimeout(90_000)
  await login(page)
  await page.goto('/')
  const stamp = Date.now()
  const email = `lee${stamp}@example.com`

  /* Another member of Onboarding, who joins by the letter. */
  const projectId = await page.evaluate(async (address) => {
    const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
    const h = { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1', 'content-type': 'application/json' }
    const { projects } = (await (await fetch('/api/projects', { headers: h })).json()) as { projects: { id: string; name: string }[] }
    const p = projects.find((x) => x.name === 'Onboarding')!
    const invite = await fetch('/api/invites', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ email: address, project_ids: [p.id] }),
    })
    return invite.ok ? p.id : `invite ${invite.status}`
  }, email)
  expect(projectId).toMatch(/^[0-9a-f-]{36}$/)
  const them = await (await browser.newContext()).newPage()
  await them.goto(await letterTo(email, 'invite'))
  await them.getByTestId('join-name').fill(`Lee ${stamp}`)
  await them.getByTestId('join-email').fill(email)
  await them.getByTestId('join-password').fill(PASSWORD)
  await them.getByTestId('join').click()
  await expect(them.getByTestId('nav-my')).toBeVisible({ timeout: 20_000 })

  /* The window, drawn whole, with Save draft beside Post. */
  await openProject(page, 'Onboarding')
  await page.getByTestId('tool-posts').click()
  const opener = page.getByTestId('create-new-post')
  await expect(opener).toBeVisible({ timeout: 15_000 })
  const heights = await drawnWhole(page, '[data-testid="new-post"]', () => opener.click())
  expect(heights.length, `the window changed height as it opened: ${heights.join(' → ')}`).toBe(1)
  await expect(page.getByTestId('save-draft')).toHaveText('Save draft')
  await expect(page.getByTestId('make')).toHaveText('Post')

  const title = `Q3 plan ${stamp}`
  await page.getByTestId('new-title').fill(title)
  await page.getByTestId('new-post-body').click()
  await page.keyboard.type('Not ready for everybody yet.')

  /* Saved as a draft: the card says so where its hour would be, and offers Publish. */
  const made = page.waitForResponse((r) => r.url().endsWith(`/api/projects/${projectId}/posts`) && r.request().method() === 'POST')
  const cardHeights = await drawnWhole(page, '[data-post-draft]', () => page.getByTestId('save-draft').click())
  const sent = await made
  expect(sent.status()).toBe(201)
  expect(sent.request().postDataJSON()).toMatchObject({ title, audience: 'author' })
  expect(cardHeights.length, `the draft's card changed height as it came: ${cardHeights.join(' → ')}`).toBe(1)
  const card = page.locator('[data-post]').filter({ hasText: title }).first()
  await expect(card).toHaveAttribute('data-post-draft', 'true')
  await expect(card.locator('[data-draft-mark]')).toHaveText('Draft')
  await expect(card.getByTestId('publish-draft')).toBeVisible()
  /* Above what was published. */
  await expect(page.locator('[data-post]').first()).toContainText(title)
  const id = (await sent.json()).id as string

  /* Opened, it is the author's to write, with Publish on its bar and no replies under it. */
  await card.locator('[data-open-post]').click()
  await expect(page.getByTestId('post-title')).toHaveValue(title, { timeout: 15_000 })
  await expect(page.locator('[data-draft-only-you]')).toHaveText('Only you can see this draft')
  await expect(page.getByTestId('publish-post')).toBeVisible()
  await expect(page.locator('[data-post-draft-mark]')).toHaveText('Draft')
  await page.getByTestId('close-post').click()

  /* The other member: not in the list, not by its address, not found. */
  await openProject(them, 'Onboarding')
  await them.getByTestId('tool-posts').click()
  await expect(them.locator('[data-post]').first().or(them.getByTestId('empty-new-post'))).toBeVisible({ timeout: 15_000 })
  await expect(them.locator('[data-post]').filter({ hasText: title })).toHaveCount(0)
  expect((await asked(them, `/api/posts/${id}`)).status).toBe(404)
  const search = await asked(them, `/api/search?q=${encodeURIComponent(`Q3 plan ${stamp}`)}&type=post`)
  expect((search.body.results as { id: string }[]).some((r) => r.id === id)).toBe(false)

  /* Published from its card: out of the drafts, its hour now. */
  const published = page.waitForResponse((r) => r.url().endsWith(`/api/posts/${id}/audience`) && r.request().method() === 'PUT')
  await card.getByTestId('publish-draft').click()
  expect((await published).status()).toBe(200)
  await expect(card).not.toHaveAttribute('data-post-draft', 'true')
  await expect(card.locator('[data-draft-mark]')).toHaveCount(0)
  await expect(card).toContainText('Today at')

  /* And the other member has it, at the top. */
  await them.reload()
  await expect(them.locator('[data-post]').filter({ hasText: title })).toBeVisible({ timeout: 15_000 })
  await expect(them.locator('[data-post]').first()).toContainText(title)
  expect((await asked(them, `/api/posts/${id}`)).status).toBe(200)
  await them.context().close()
})
