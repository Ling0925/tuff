import { test, expect, type Page } from '@playwright/test'
import { add, drawnWhole, login, make, openProject } from './helpers.js'

/*
 * A code block's bar: its language and the colours that follow it, wrapped
 * and numbered lines kept on the block, Copy.
 */

const CODE = 'const answer: number = 42\nfunction twice(n: number) {\n  return n * 2 // doubled\n}'

/** A project with one task, opened, and a code block typed into its description. */
async function taskWithCode(page: Page, tag: string) {
  const stamp = Date.now()
  await add(page, 'new-project', `${tag} ${stamp}`)
  await openProject(page, `${tag} ${stamp}`)
  await page.getByTestId('tool-tasks').click()
  await make(page, page.getByTestId('create-new-task'), `Snippet ${stamp}`)
  await page
    .locator('[data-open-task]')
    .filter({ hasText: `Snippet ${stamp}` })
    .click()
  const body = page.getByTestId('task-body')
  await expect(body).toBeVisible({ timeout: 15_000 })
  await body.click()
  await page.keyboard.type('/code')
  await page.keyboard.press('Enter')
  /* Line by line: Enter in a code block is a new line of code, and the
     editor's own indentation is not added to what is typed. */
  for (const [i, line] of CODE.split('\n').entries()) {
    if (i > 0) await page.keyboard.press('Enter')
    await page.keyboard.type(line)
  }
  await expect(body.locator('[data-code-block]')).toHaveCount(1)
  return body
}

/** The task's id, from the write a change to its body sends. */
const bodySaved = (page: Page) =>
  page.waitForResponse((r) => /\/api\/tasks\/[0-9a-f-]{36}$/.test(r.url()) && r.request().method() === 'PATCH')

test('a code block takes a language, keeps its wrapping and numbers, and copies its code', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await login(page)
  const body = await taskWithCode(page, 'Highlit')
  const block = body.locator('[data-code-block]')
  const bar = block.locator('[data-code-bar]')

  // The caret is in the block, so its bar is up: the language, the
  // sliders, Copy and the bin. Auto detect until one is chosen.
  await expect(bar).toHaveCSS('opacity', '1')
  await expect(bar.getByTestId('code-language')).toContainText('Auto detect')
  await expect(bar.locator('[data-code-remove]')).toBeVisible()

  // The list: Auto detect first, and checked.
  const list = page.locator('[data-code-languages]')
  await bar.getByTestId('code-language').click()
  await expect(list.locator('[data-code-language]').first()).toHaveAttribute('data-code-language', 'auto')
  await expect(list.locator('[data-code-language="auto"]')).toHaveAttribute('aria-checked', 'true')

  // TypeScript, and the block is coloured as TypeScript — without the
  // block changing height as the colours arrive.
  const saved = bodySaved(page)
  const heights = await drawnWhole(page, '[data-testid="task-body"] [data-code-block]', () =>
    list.locator('[data-code-language="typescript"]').click(),
  )
  expect(heights.length, `the block moved as it was coloured: ${heights.join(' → ')}`).toBe(1)
  const taskId = /\/api\/tasks\/([0-9a-f-]{36})$/.exec((await saved).url())![1]!
  await expect(bar.getByTestId('code-language')).toContainText('TypeScript')
  await expect(block.locator('pre .hljs-keyword').first()).toHaveText('const')
  await expect(block.locator('pre .hljs-title.function_')).toHaveText('twice')
  await expect(block.locator('pre .hljs-comment')).toHaveText('// doubled')
  // The colour is a token's, not the ink.
  const keyword = await block
    .locator('pre .hljs-keyword')
    .first()
    .evaluate((el) => getComputedStyle(el).color)
  const ink = await block.locator('pre').evaluate((el) => getComputedStyle(el).color)
  expect(keyword).not.toBe(ink)

  // The list says what is chosen when it opens again.
  await block.hover()
  await bar.getByTestId('code-language').click()
  await expect(list.locator('[data-code-language="typescript"]')).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  await expect(list).toHaveCount(0)

  // Wrap lines and Show line numbers, from the sliders.
  await block.hover()
  await bar.getByTestId('code-options').click()
  const wrapSaved = bodySaved(page)
  await page.getByTestId('code-wrap').click()
  await wrapSaved
  const linesSaved = bodySaved(page)
  await page.getByTestId('code-line-numbers').click()
  await linesSaved
  await expect(page.getByTestId('code-wrap')).toBeChecked()
  await expect(page.getByTestId('code-line-numbers')).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(block).toHaveAttribute('data-wrap')
  await expect(block).toHaveAttribute('data-lines')
  await expect(block.locator('.code-ln')).toHaveCount(4)
  // The numbers stand left of the code, each beside its own line.
  const first = await block.locator('.code-ln').first().boundingBox()
  const second = await block.locator('.code-ln').nth(1).boundingBox()
  const code = await block.locator('pre code').boundingBox()
  expect(first!.x + first!.width).toBeLessThanOrEqual(code!.x)
  expect(second!.y).toBeGreaterThan(first!.y)

  // Copy: the code, and a check that says so.
  await block.hover()
  await bar.locator('[data-code-copy]').click()
  await expect(bar.locator('[data-code-copy]')).toHaveAttribute('aria-label', 'Copied')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CODE)

  // Kept on the block: after a reload it is still TypeScript, wrapped and
  // numbered — and drawn at one height from its first frame while it is
  // coloured again. Watched from the page's start: a reload is a new page.
  await page.addInitScript(() => {
    const w = window as unknown as { codeHeights: number[] }
    w.codeHeights = []
    let first = 0
    const look = (t: number) => {
      const el = document.querySelector('[data-testid="task-body"] [data-code-block]')
      const h = el ? Math.round(el.getBoundingClientRect().height) : 0
      if (h > 0) {
        if (!first) first = t
        if (w.codeHeights[w.codeHeights.length - 1] !== h) w.codeHeights.push(h)
      }
      if (!first || t - first < 1500) requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  })
  await page.reload()
  await page.waitForTimeout(2500)
  const again = await page.evaluate(() => (window as unknown as { codeHeights: number[] }).codeHeights)
  expect(again.length, `the block moved as it came back: ${again.join(' → ')}`).toBe(1)
  const back = page.getByTestId('task-body').locator('[data-code-block]')
  await expect(back).toHaveAttribute('data-wrap')
  await expect(back).toHaveAttribute('data-lines')
  await expect(back.locator('.code-ln')).toHaveCount(4)
  await expect(back.locator('pre .hljs-keyword').first()).toHaveText('const')
  await back.hover()
  await expect(back.getByTestId('code-language')).toContainText('TypeScript')

  // Read, in a comment: coloured, the language as words, Copy, numbered — no picker.
  await page.evaluate(
    async ({ id, code }) => {
      const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
      await fetch(`/api/tasks/${id}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${s.access_token}` },
        body: JSON.stringify({
          body: {
            type: 'doc',
            content: [{ type: 'codeBlock', attrs: { language: 'py', lineNumbers: true }, content: [{ type: 'text', text: code }] }],
          },
        }),
      })
    },
    { id: taskId, code: 'def twice(n):\n    return n * 2  # doubled' },
  )
  await page.reload()
  const read = page.locator('[data-code-block][data-read]')
  await expect(read).toHaveCount(1, { timeout: 15_000 })
  await expect(read.locator('pre .hljs-keyword').first()).toHaveText('def')
  await expect(read.locator('.code-ln')).toHaveCount(2)
  await read.hover()
  await expect(read.locator('[data-code-name]')).toHaveText('Python')
  await expect(read.getByTestId('code-language')).toHaveCount(0)
  await read.locator('[data-code-copy]').click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('def twice(n):\n    return n * 2  # doubled')
})

test('on a phone the bar fits the screen and the languages come up as a sheet', async ({ page }) => {
  await login(page)
  await taskWithCode(page, 'Phone code')
  // Leaving the body saves it.
  const saved = bodySaved(page)
  await page.getByTestId('task-title').click()
  await saved
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  const block = page.getByTestId('task-body').locator('[data-code-block]')
  await expect(block).toHaveCount(1, { timeout: 15_000 })
  // The caret in the block brings its bar; no pointer to hover with.
  await block.locator('pre').click()
  const bar = block.locator('[data-code-bar]')
  await expect(bar).toHaveCSS('opacity', '1')
  const box = await bar.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  // The block keeps to the screen: no page wider than the phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  await bar.getByTestId('code-language').click()
  const list = page.locator('[data-code-languages]')
  await expect(list).toBeVisible()
  const sheet = await page.locator('[data-popover]').boundingBox()
  expect(Math.round(sheet!.x)).toBe(0)
  expect(Math.round(sheet!.width)).toBe(390)
  await list.locator('[data-code-language="python"]').scrollIntoViewIfNeeded()
  await list.locator('[data-code-language="python"]').click()
  await expect(bar.getByTestId('code-language')).toContainText('Python')
  await expect(block.locator('pre [class^="hljs-"]').first()).toBeVisible()
})
