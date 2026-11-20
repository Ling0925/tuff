import { test, expect, type Page } from '@playwright/test'
import { add, login, openProject, setStatus, shownAs, statusOf } from './helpers.js'

/** This file always works in the same project. */
async function open(page: Page) {
  await login(page)
  await openProject(page, 'Acme rebrand')
}

test('the four tools are one navigation, not four screens', async ({ page }) => {
  await open(page)
  for (const tool of ['posts', 'tasks', 'files', 'messages']) {
    await expect(page.getByTestId(`tool-${tool}`)).toBeVisible()
  }
})

test('a task is the same row in all three views', async ({ page }) => {
  await open(page)
  await page.getByTestId('tool-tasks').click()

  const title = `Task ${Date.now()}`
  await add(page, 'new-task', title)
  await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 })

  // The board is a view, not a second tool: the task that was just typed into
  // the list is already a card, with no import or sync step in between.
  await shownAs(page, 'board')
  await expect(page.locator('[data-column="Backlog"]').getByText(title)).toBeVisible()

  // Moving it is a decision, and the card's age counts from that rather than
  // from when it was created.
  // The card that was just made, not whichever one is first: a board that has
  // been used has more than one card in a column.
  /*
   * Reached the way it is meant to be reached: with the keyboard.
   *
   * The move buttons sit over the card and are shown on focus that came from
   * a key. Shown on hover they were still there to be pressed while
   * invisible, and on a two-line card that put a dead strip across the
   * middle — the place a pointer takes hold of. Shown on any focus they
   * appeared on a click, which is how somebody who drags cards found a row
   * of them written across the one they had just pressed. A pointer drags a
   * card; a keyboard uses these.
   */
  const card = page.locator('[data-column="Backlog"] [data-card]').filter({ hasText: title })
  /* Faded out and taking no pointer, which is not the same as gone: it is
     drawn either way, and what changes is whether anybody can see or press
     it. Asked of the strip it lives in, because that is what carries both. */
  const moves = card.locator('[data-moves]')
  // Focus on its own is not enough, because a click gives that too.
  await card.locator('[data-open-task]').focus()
  await expect(moves).toHaveCSS('opacity', '0')
  // A key, and they are there — the next stop after the title is the first
  // of them, so this is also the way somebody actually arrives.
  await page.keyboard.press('Tab')
  await expect(moves).toHaveCSS('opacity', '1')
  // The next list along, which a project starts with as Todo.
  await card.getByRole('button', { name: '→ Todo' }).click()
  await expect(page.locator('[data-column="Todo"]').getByText(title)).toBeVisible({
    timeout: 15_000,
  })

  await shownAs(page, 'list')
  await expect(page.getByText(title)).toBeVisible()
})

test('a post and a document are created in their own tool', async ({ page }) => {
  await open(page)

  await page.getByTestId('tool-posts').click()
  const post = `Post ${Date.now()}`
  await add(page, 'new-post', post)
  await expect(page.getByText(post)).toBeVisible({ timeout: 15_000 })

  await page.getByTestId('tool-files').click()
  const doc = `Doc ${Date.now()}`
  await add(page, 'new-document', doc)
  await expect(page.getByText(doc)).toBeVisible({ timeout: 15_000 })
  // A document is a file edited in place, so it is the same row with a body.
  await expect(page.locator('[data-file]').filter({ hasText: doc })).toContainText('Document')
})

test('completing a task holds after a reload', async ({ page }) => {
  await open(page)
  await page.getByTestId('tool-tasks').click()

  const title = `Done ${Date.now()}`
  await add(page, 'new-task', title)
  await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 })

  // The ring moves optimistically, so it shows the new list before the
  // request has landed — and a reload in that window cancels it.
  const saved = page.waitForResponse((r) => r.url().includes('/api/tasks/') && r.request().method() === 'PATCH')
  await setStatus(page, title, 'Done')
  await saved
  await page.reload()
  await openProject(page, 'Acme rebrand')
  await page.getByTestId('tool-tasks').click()

  /* Finished work is in the list that finishes, which is where it is now —
     there is no fold under the list any more, because that was a third place
     saying the same thing. */
  await expect(statusOf(page, title)).toHaveAttribute('data-status', 'Done', {
    timeout: 15_000,
  })
})

test('an announcement is made in a window with its title and its words', async ({ page }) => {
  await open(page)
  await page.getByTestId('tool-posts').click()
  await page.getByTestId('create-new-post').click()
  const title = `Launch moved ${Date.now()}`
  await page.getByTestId('new-title').fill(title)
  await page.getByTestId('new-post-body').click()
  await page.keyboard.type('The launch moves to Thursday. Nothing else changes.')
  await page.getByTestId('make').click()
  await expect(page.getByTestId('new-title')).toHaveCount(0, { timeout: 15_000 })
  const post = page.locator('[data-post]').filter({ hasText: title }).first()
  await expect(post).toBeVisible({ timeout: 15_000 })
  await expect(post).toContainText('The launch moves to Thursday.')
})

test('an address written as words is a link in a task’s body and its comments', async ({ page }) => {
  /*
   * A description written through the API kept a pasted address
   * as plain words: the editor's autolink marks one only as it is typed.
   * Now the editor draws it as a link without changing what is stored, and
   * a comment does through the reader — `docs/specs/rich-text.md`.
   */
  await login(page)
  const url = 'https://example.com/tuf-149?x=1'
  const where = await page.evaluate(async (url) => {
    const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
    const headers = { 'content-type': 'application/json', 'x-api-version': '1', authorization: `Bearer ${s.access_token}` }
    const me = (await (await fetch('/api/me', { headers })).json()) as { workspace: { slug: string } }
    const { projects } = (await (await fetch('/api/projects', { headers })).json()) as {
      projects: { id: string; slug: string; name: string }[]
    }
    const p = projects.find((x) => x.name === 'Acme rebrand')!
    const words = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
    const task = (await (
      await fetch(`/api/projects/${p.id}/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: `Links ${Date.now()}`,
          body: {
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: `The brief is at ${url}. Read it (www.example.org/a).` }] },
              { type: 'codeBlock', content: [{ type: 'text', text: 'curl https://example.com/not-a-link' }] },
            ],
          },
        }),
      })
    ).json()) as { id: string; number: number }
    await fetch(`/api/tasks/${task.id}/comments`, { method: 'POST', headers, body: JSON.stringify({ body: words(`See ${url}, please`) }) })
    return { path: `/${me.workspace.slug}/${p.slug}/tasks/${task.number}`, id: task.id }
  }, url)
  await page.goto(where.path)

  // The description, in the editor: a link to where it says, and the
  // sentence's full stop and the bracket left out of it.
  const body = page.getByTestId('task-body')
  await expect(body.locator(`a[href="${url}"]`)).toHaveText(url, { timeout: 15_000 })
  await expect(body.locator('a[href="https://www.example.org/a"]')).toHaveText('www.example.org/a')
  // Code is never linked.
  await expect(body.locator('pre a')).toHaveCount(0)

  // The comment, drawn by the reader, by the same rule.
  const comment = page.locator('[data-comment]').filter({ hasText: 'please' }).first()
  await expect(comment.locator(`a[href="${url}"]`)).toHaveText(url)

  // Looking was all: the stored body is the words it was.
  const stored = await page.evaluate(async (id) => {
    const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
    const r = await fetch(`/api/tasks/${id}`, { headers: { 'x-api-version': '1', authorization: `Bearer ${s.access_token}` } })
    return JSON.stringify(((await r.json()) as { task: { body: unknown } }).task.body)
  }, where.id)
  expect(stored).not.toContain('"link"')
})
