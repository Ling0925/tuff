import { test, expect, type Page } from '@playwright/test'
import { login, openProject, drawnWhole, docKept } from './helpers.js'

/**
 * A callout, a toggle and the outline beside a long document.
 */

/** A document written straight into the project, opened at its address. */
async function writeDoc(page: Page, name: string, body: unknown): Promise<void> {
  const where = await page.evaluate(
    async ({ name, body }) => {
      const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
      const headers = { 'content-type': 'application/json', 'x-api-version': '1', authorization: `Bearer ${s.access_token}` }
      const me = (await (await fetch('/api/me', { headers })).json()) as { workspace: { slug: string } }
      const { projects } = (await (await fetch('/api/projects', { headers })).json()) as {
        projects: { id: string; slug: string; name: string }[]
      }
      const p = projects.find((x) => x.name === 'Website')!
      const { id } = (await (
        await fetch(`/api/projects/${p.id}/files`, { method: 'POST', headers, body: JSON.stringify({ name, body }) })
      ).json()) as { id: string }
      const { file } = (await (await fetch(`/api/files/${id}`, { headers })).json()) as { file: { number: number } }
      return `/${me.workspace.slug}/${p.slug}/files/${file.number}`
    },
    { name, body },
  )
  await page.goto(where)
  await expect(page.getByTestId('file-name')).toHaveValue(name, { timeout: 15_000 })
}

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const heading = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] })

async function newDocument(page: Page) {
  await page.getByTestId('docs-add').click()
  await page.getByTestId('create-new-document').click()
  await expect(page.getByTestId('file-name')).toHaveValue('Untitled', { timeout: 15_000 })
}

test('a callout and a toggle are put in from the slash list, and kept', async ({ page }) => {
  await login(page)
  await openProject(page, 'Website')
  await page.getByTestId('tool-files').click()
  await newDocument(page)

  const body = page.getByTestId('file-body')
  /* Bound to the shared state first, as a person who has just opened it. */
  await expect(page.locator('[data-together]')).toBeVisible({ timeout: 15_000 })
  await body.click()
  await page.keyboard.type('/callout')
  await expect(page.locator('[data-block="callout"]')).toBeVisible()
  await page.keyboard.press('Enter')
  await page.keyboard.type('Heads up')
  const callout = body.locator('[data-callout]')
  await expect(callout).toContainText('Heads up')
  await expect(callout).toHaveAttribute('data-tone', 'grey')

  /* Its look, from its emoji: drawn whole, and a tone taken at once. */
  const heights = await drawnWhole(page, '[data-callout-look]', () => callout.locator('[data-callout-emoji]').click())
  expect(heights.length).toBe(1)
  await page.locator('[data-callout-tone="blue"]').click()
  await page.locator('[data-callout-pick="⚠️"]').click()
  await expect(callout).toHaveAttribute('data-tone', 'blue')
  await expect(callout.locator('[data-callout-emoji]')).toHaveText('⚠️')
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-callout-look]')).toHaveCount(0)

  /* Enter on its empty last line steps out of it, as out of a quote. */
  await callout.getByText('Heads up').click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/toggle')
  await expect(page.locator('[data-block="toggle"]')).toBeVisible()
  await page.keyboard.press('Enter')
  /* The one just made is open, so what goes under it can be typed. */
  const toggle = body.locator('.toggle')
  await expect(toggle).toHaveClass(/is-open/)
  await page.keyboard.type('More')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Folded words')
  await expect(toggle.locator('summary')).toHaveText('More')
  await expect(toggle.locator('[data-type="detailsContent"]')).toContainText('Folded words')
  await expect(callout).not.toContainText('More')

  /* Kept: written together, it saves over its socket, not through PATCH. */
  await page.getByTestId('file-name').click()
  await docKept(page, '"tone":"blue"', 'Folded words', '"detailsSummary"')

  /* Read again, a toggle opens folded — whether it was open is not kept. */
  await page.reload()
  await expect(page.getByTestId('file-body').locator('[data-callout]')).toHaveAttribute('data-tone', 'blue', { timeout: 15_000 })
  const back = page.getByTestId('file-body').locator('.toggle')
  await expect(back.locator('summary')).toHaveText('More')
  await expect(back.locator('[data-type="detailsContent"]')).toBeHidden()
  await back.locator('[data-toggle-button]').click()
  await expect(back.locator('[data-type="detailsContent"]')).toContainText('Folded words')
})

test('a long document has its headings beside it, which follow the reading and do not move it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page)
  await openProject(page, 'Website')
  const filler = Array.from({ length: 30 }, (_, i) => para(`Line ${i + 1} of a long document.`))
  const name = `Outline ${Date.now()}`
  await writeDoc(page, name, { type: 'doc', content: [heading(1, 'Start here'), ...filler, ...filler] })

  /* One heading is not an outline. */
  await expect(page.getByTestId('file-body')).toContainText('Line 30')
  await expect(page.locator('[data-outline]')).toHaveCount(0)
  const title = page.getByTestId('file-name')
  const before = (await title.boundingBox())!

  /* A second, typed at the end: the outline comes, and the words stay put. */
  await page.getByTestId('file-body').locator('p').last().click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('## The end')
  await expect(page.locator('[data-outline-row]')).toHaveCount(2)
  const outline = page.locator('[data-outline]')
  await expect(outline).toBeVisible()
  const after = (await title.boundingBox())!
  expect(after.x).toBe(before.x)
  expect(after.width).toBe(before.width)

  /* Pressed, a heading is scrolled to and marked. */
  await outline.locator('[data-outline-row]').filter({ hasText: 'Start here' }).click()
  await expect(outline.locator('[data-current]')).toHaveText('Start here')
  await outline.locator('[data-outline-row]').filter({ hasText: 'The end' }).click()
  await expect(outline.locator('[data-current]')).toHaveText('The end')
  await expect
    .poll(async () => {
      const h = await page.getByTestId('file-body').locator('h2').boundingBox()
      return h ? Math.round(h.y) : 10_000
    })
    .toBeLessThan(800)

  /* Scrolled back up by hand, the mark follows. */
  await page.locator('[data-foot]:has([data-testid="file-body"])').evaluate((el) => el.scrollTo({ top: 0 }))
  await expect(outline.locator('[data-current]')).toHaveText('Start here')

  /* Opened afresh, it is there on the first frame and never changes height. */
  await page.getByTestId('file-name').click()
  await page.getByTestId('close-file').click()
  const row = page.locator('[data-open-file]').filter({ hasText: name })
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.hover()
  const heights = await drawnWhole(page, '[data-outline]', () => row.click())
  expect(heights.length).toBe(1)

  /* A narrow window has no room for it, and the document does not move. */
  await page.setViewportSize({ width: 1100, height: 900 })
  await expect(page.locator('[data-outline]')).toHaveCount(0)
})

/* ── A toggle's ins and outs. ── */

const toggleOf = (summary: string, ...inside: string[]) => ({
  type: 'details',
  content: [
    { type: 'detailsSummary', content: summary ? [{ type: 'text', text: summary }] : [] },
    { type: 'detailsContent', content: (inside.length ? inside : ['']).map((t) => (t ? para(t) : { type: 'paragraph' })) },
  ],
})

/** Written together and editable: the state every document is written in. */
async function ready(page: Page) {
  await expect(page.locator('[data-together]')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('file-body')).toHaveAttribute('contenteditable', 'true')
}

/** The caret at the end of the words of the element `text` is in. */
async function caretAtEnd(page: Page, text: string) {
  await page.getByTestId('file-body').getByText(text, { exact: true }).last().click()
  /* The editor reads where the press put the caret on its next turn. */
  await page.waitForTimeout(150)
  await page.keyboard.press('End')
}

/** The top-level blocks of the body, as their tag and words. */
const blocks = (page: Page) =>
  page
    .getByTestId('file-body')
    .evaluate((el) =>
      [...el.children].map((c) =>
        c.matches('[data-type="details"]')
          ? `toggle:${c.querySelector('summary')?.textContent ?? ''}`
          : `${c.tagName.toLowerCase()}:${c.textContent}`,
      ),
    )

test('a toggle has a glyph, wraps only its own line, and is gone into and left by the keys', async ({ page }) => {
  await login(page)
  await writeDoc(page, `Toggle keys ${Date.now()}`, {
    type: 'doc',
    content: [para('Before'), para('Middle'), para('After one'), para('After two')],
  })
  await ready(page)
  const body = page.getByTestId('file-body')

  /* Put in from the slash list, where it has a drawing like every other block. */
  await caretAtEnd(page, 'Middle')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/toggle')
  await expect(page.locator('[data-block="toggle"] svg')).toBeVisible()
  await page.keyboard.press('Enter')
  const toggle = body.locator('.toggle')
  await expect(toggle).toHaveCount(1)
  await expect(toggle).toHaveClass(/is-open/)
  /* Only its own line: what came after it is still after it. */
  expect(await blocks(page)).toEqual(['p:Before', 'p:Middle', 'toggle:', 'p:After one', 'p:After two'])

  /* Enter on its line goes into its body; Enter on the body's empty last line leaves it. */
  await page.keyboard.type('Title')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Inside')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Out')
  expect(await blocks(page)).toEqual(['p:Before', 'p:Middle', 'toggle:Title', 'p:Out', 'p:After one', 'p:After two'])
  await expect(toggle.locator('[data-type="detailsContent"] > p')).toHaveText(['Inside'])

  /* Folded, Enter at the end of its line opens it and goes in, on a new first line. */
  await toggle.locator('[data-toggle-button]').click()
  await expect(toggle).not.toHaveClass(/is-open/)
  await caretAtEnd(page, 'Title')
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveClass(/is-open/)
  await page.keyboard.type('First')
  await expect(toggle.locator('[data-type="detailsContent"] > p')).toHaveText(['First', 'Inside'])

  /* Backspace at the start of an empty line turns a toggle back into a line of words. */
  await caretAtEnd(page, 'After two')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/toggle')
  await page.keyboard.press('Enter')
  await expect(body.locator('.toggle')).toHaveCount(2)
  await page.keyboard.press('Backspace')
  await expect(body.locator('.toggle')).toHaveCount(1)
  await page.keyboard.type('Plain again')
  const now = await blocks(page)
  expect(now[now.indexOf('p:After two') + 1]).toBe('p:Plain again')

  /* Kept as it was left, over the shared state. */
  await page.getByTestId('file-name').click()
  await docKept(page, 'First', 'Inside', 'Plain again', '"text":"Out"')
})

test('the arrows and a press under the last block go past a toggle or a callout that ends the document', async ({ page }) => {
  await login(page)
  const callout = { type: 'callout', attrs: { emoji: '💡', tone: 'grey' }, content: [para('Aside')] }
  await writeDoc(page, `Past the end ${Date.now()}`, { type: 'doc', content: [para('Start'), toggleOf('Last', 'Hidden')] })
  await ready(page)

  /* A folded toggle at the end: Down from its line is a new line after it, not its hidden body. */
  await caretAtEnd(page, 'Last')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.type('Below')
  expect(await blocks(page)).toEqual(['p:Start', 'toggle:Last', 'p:Below'])
  await expect(page.getByTestId('file-body').locator('.toggle')).not.toHaveClass(/is-open/)

  /* A callout at the end: Right at the end of its last line goes out of it. */
  await writeDoc(page, `Past a callout ${Date.now()}`, { type: 'doc', content: [para('Start'), callout] })
  await ready(page)
  await caretAtEnd(page, 'Aside')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type('After it')
  expect(await blocks(page)).toEqual(['p:Start', 'div:💡Aside', 'p:After it'])

  /* And a press under the last block gives a line to write on, every time. */
  await writeDoc(page, `Room under ${Date.now()}`, { type: 'doc', content: [para('Start'), toggleOf('Open me', 'Inside')] })
  await ready(page)
  await page.locator('[data-body-room]').click()
  await page.keyboard.type('Written under')
  expect(await blocks(page)).toEqual(['p:Start', 'toggle:Open me', 'p:Written under'])
  /* Pressed again, the empty line it ends on is used rather than another made. */
  await page.keyboard.press('Enter')
  await page.locator('[data-body-room]').click()
  await page.keyboard.type('Same line')
  expect(await blocks(page)).toEqual(['p:Start', 'toggle:Open me', 'p:Written under', 'p:Same line'])
})

/** Words chosen in the body, from the start of one text to the end of another. */
async function choose(page: Page, fromText: string, toText: string) {
  await page.getByTestId('file-body').evaluate(
    (el, [a, b]) => {
      const find = (t: string) => {
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        for (let n = walk.nextNode(); n; n = walk.nextNode()) if (n.textContent === t) return n
        throw new Error(`no text ${t}`)
      }
      const r = document.createRange()
      r.setStart(find(a!), 0)
      const end = find(b!)
      r.setEnd(end, end.textContent!.length)
      const s = window.getSelection()!
      s.removeAllRanges()
      s.addRange(r)
    },
    [fromText, toText],
  )
  /* ProseMirror reads the selection on its next turn. */
  await page.waitForTimeout(100)
}

/** Cut or copy what is chosen, as the keys do, and hand back the clipboard. */
const clip = (page: Page, kind: 'cut' | 'copy') =>
  page.getByTestId('file-body').evaluate((el, k) => {
    const data = new DataTransfer()
    el.dispatchEvent(new ClipboardEvent(k, { clipboardData: data, bubbles: true, cancelable: true }))
    return { html: data.getData('text/html'), text: data.getData('text/plain') }
  }, kind)

/** Paste it where the caret is. */
const paste = (page: Page, got: { html: string; text: string }) =>
  page.getByTestId('file-body').evaluate((el, g) => {
    const data = new DataTransfer()
    data.setData('text/html', g.html)
    data.setData('text/plain', g.text)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, got)

test('words cut out of a toggle or a callout paste as words, and only the whole toggle pastes as a toggle', async ({ page }) => {
  await login(page)
  const callout = { type: 'callout', attrs: { emoji: '💡', tone: 'blue' }, content: [para('Aside one'), para('Aside two')] }
  await writeDoc(page, `Paste out ${Date.now()}`, {
    type: 'doc',
    content: [toggleOf('Head', 'Inside one', 'Inside two'), callout, para('Landing')],
  })
  await ready(page)
  const body = page.getByTestId('file-body')
  await body.locator('[data-toggle-button]').click()

  /* Cut from inside the toggle's body, pasted after the last line: two plain lines. */
  await choose(page, 'Inside one', 'Inside two')
  const fromToggle = await clip(page, 'cut')
  await caretAtEnd(page, 'Landing')
  await page.keyboard.press('Enter')
  await paste(page, fromToggle)
  await expect(body.locator('.toggle')).toHaveCount(1)
  expect((await blocks(page)).slice(-2)).toEqual(['p:Inside one', 'p:Inside two'])

  /* Copied from inside a callout: words, not a second callout. */
  await choose(page, 'Aside one', 'Aside one')
  const fromCallout = await clip(page, 'copy')
  await caretAtEnd(page, 'Inside two')
  await page.keyboard.press('Enter')
  await paste(page, fromCallout)
  await expect(body.locator('[data-callout]')).toHaveCount(1)
  expect((await blocks(page)).at(-1)).toBe('p:Aside one')

  /* The whole toggle, from the start of its line to the end of its body: a toggle. */
  await body.locator('.toggle [data-type="detailsContent"] p').first().click()
  await page.keyboard.type('Kept')
  await choose(page, 'Head', 'Kept')
  const whole = await clip(page, 'copy')
  await caretAtEnd(page, 'Aside one')
  await page.keyboard.press('Enter')
  await paste(page, whole)
  await expect(body.locator('.toggle')).toHaveCount(2)
  await expect(body.locator('.toggle summary').last()).toHaveText('Head')
})

test('the room a press under the last block writes in adds no height: the comments stand 24 under the last line', async ({ page }) => {
  await login(page)
  await writeDoc(page, `Gap ${Date.now()}`, { type: 'doc', content: [para('One'), para('Last line')] })
  await ready(page)
  const gap = async () =>
    page.evaluate(() => {
      const last = document.querySelector('[data-testid="file-body"]')!.lastElementChild!.getBoundingClientRect().bottom
      const heading = [...document.querySelectorAll('main *')].find((e) => e.children.length === 0 && e.textContent?.trim() === 'Comments')!
      return Math.round(heading.getBoundingClientRect().top - last)
    })
  /* The task's rhythm under the words, as before the room was there. */
  expect(await gap()).toBe(24)
  /* The room lies over that gap, and a press in it writes on a new last line. */
  const room = (await page.locator('[data-body-room]').boundingBox())!
  expect(room.height).toBe(24)
  await page.locator('[data-body-room]').click()
  await page.keyboard.type('Under')
  expect(await blocks(page)).toEqual(['p:One', 'p:Last line', 'p:Under'])
  expect(await gap()).toBe(24)
})
