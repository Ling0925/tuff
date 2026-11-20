import { test, expect, type Browser, type Page } from '@playwright/test'
import { docKept, drawnWhole, login } from './helpers.js'

/**
 * A comment on words in a document.
 * Chosen, commented on, kept on its words while somebody else types
 * before them, resolved and opened again.
 */

async function aPage(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await login(page)
  return page
}

/** A document written straight into Website, opened at its address. */
async function writeDoc(page: Page, name: string, lines: string[]): Promise<string> {
  const where = await page.evaluate(
    async ({ name, lines }) => {
      const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
      const headers = { 'content-type': 'application/json', 'x-api-version': '1', authorization: `Bearer ${s.access_token}` }
      const me = (await (await fetch('/api/me', { headers })).json()) as { workspace: { slug: string } }
      const { projects } = (await (await fetch('/api/projects', { headers })).json()) as {
        projects: { id: string; slug: string; name: string }[]
      }
      const p = projects.find((x) => x.name === 'Website')!
      const body = { type: 'doc', content: lines.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) }
      const { id } = (await (
        await fetch(`/api/projects/${p.id}/files`, { method: 'POST', headers, body: JSON.stringify({ name, body }) })
      ).json()) as {
        id: string
      }
      const { file } = (await (await fetch(`/api/files/${id}`, { headers })).json()) as { file: { number: number } }
      return `/${me.workspace.slug}/${p.slug}/files/${file.number}`
    },
    { name, lines },
  )
  await page.goto(where)
  await together(page)
  return where
}

async function together(page: Page) {
  await expect(page.locator('[data-together]')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('file-body')).toHaveAttribute('contenteditable', 'true')
}

/** The first line's words, without the carets of other people drawn in it. */
const firstLine = (page: Page) =>
  page.evaluate(() => {
    const p = document.querySelector('[data-testid="file-body"] p')?.cloneNode(true) as HTMLElement | undefined
    p?.querySelectorAll('[data-caret]').forEach((c) => c.remove())
    return p?.textContent ?? ''
  })

/** The tint a stretch of words is drawn with, or none. */
const tintOf = (page: Page, words: string) =>
  page.evaluate((w) => {
    const span = [...document.querySelectorAll('[data-testid="file-body"] [data-comment]')].find((s) => s.textContent?.includes(w))
    return span ? getComputedStyle(span).backgroundColor : null
  }, words)

test('a comment on chosen words stays on them while another page writes, and is resolved and reopened', async ({ browser }) => {
  test.setTimeout(90_000)
  const first = await aPage(browser)
  const where = await writeDoc(first, `Review ${Date.now()}`, ['The launch is on Monday.', 'Everything else is settled.'])

  // Chosen from the keyboard: the end of the first line, back over "Monday".
  const body = first.getByTestId('file-body')
  await body.locator('p').first().click()
  await first.keyboard.press('End')
  await first.keyboard.press('ArrowLeft')
  for (let i = 0; i < 'Monday'.length; i++) await first.keyboard.press('Shift+ArrowLeft')
  await expect(first.getByTestId('comment-on-words')).toBeVisible()

  // The card opens whole, with the words and a line to write on.
  const heights = await drawnWhole(first, '[data-words-card]', () => first.getByTestId('comment-on-words').click())
  expect(heights.length).toBe(1)
  const card = first.locator('[data-words-card]')
  await expect(card.locator('[data-thread-words]')).toHaveText('Monday')
  await first.getByTestId('comment-on-words-field').fill('Monday or Tuesday?')
  await first.getByTestId('comment-on-words-field').press('Enter')

  // The thread, in the card and under the document; the words are tinted.
  await expect(card.locator('[data-thread] [data-comment]')).toContainText('Monday or Tuesday?')
  const marked = body.locator('[data-comment]')
  await expect(marked).toHaveText('Monday')
  await expect.poll(() => tintOf(first, 'Monday')).not.toBe('rgba(0, 0, 0, 0)')
  await expect(first.locator('[data-discussion] [data-thread-words]')).toContainText('Monday')
  await first.keyboard.press('Escape')
  await expect(card).toHaveCount(0)

  // Another page writes before the words: the mark rides with them.
  const second = await aPage(browser)
  await second.goto(where)
  await together(second)
  await second.getByTestId('file-body').locator('p').first().click()
  await second.keyboard.press('Home')
  await second.keyboard.type('Note: ')
  await expect.poll(() => firstLine(first), { timeout: 5_000 }).toBe('Note: The launch is on Monday.')
  await expect(marked).toHaveText('Monday')
  await expect(second.getByTestId('file-body').locator('[data-comment]')).toHaveText('Monday')
  // And the stored body keeps it.
  await second.getByTestId('file-name').click()
  await docKept(first, 'Note: The launch is on ', '"type":"comment"')

  // Pressed, the words open their thread; resolved, the tint goes and the thread folds.
  await marked.click()
  await expect(card).toBeVisible()
  await card.getByTestId('resolve-thread').click()
  await expect.poll(() => tintOf(first, 'Monday')).toBe('rgba(0, 0, 0, 0)')
  const folded = first.locator('[data-discussion] [data-thread][data-resolved]')
  await expect(folded).toContainText('Monday')
  // The other page hears it from the server.
  await second.reload()
  await expect(second.locator('[data-discussion] [data-thread][data-resolved]')).toContainText('Monday', { timeout: 15_000 })

  // Found again under the document, and reopened: the tint comes back.
  await first.keyboard.press('Escape')
  await folded.click()
  await first.locator('[data-discussion]').getByTestId('reopen-thread').click()
  await expect.poll(() => tintOf(first, 'Monday')).not.toBe('rgba(0, 0, 0, 0)')
  await expect(first.locator('[data-discussion] [data-thread][data-resolved]')).toHaveCount(0)

  await first.context().close()
  await second.context().close()
})
