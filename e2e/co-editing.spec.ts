import { test, expect, type Browser, type Page } from '@playwright/test'
import { add, login, openProject } from './helpers.js'

/**
 * Two people in one document. Each sees the
 * other's words as they are typed and the other's caret where it is, and
 * nothing either of them typed is lost.
 */

async function aPage(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await login(page)
  return page
}

/** The document, open and bound to the shared state. */
async function together(page: Page) {
  await expect(page.locator('[data-together]')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('file-body')).toHaveAttribute('contenteditable', 'true')
}

test('two pages write one document at once, see each other’s caret, and lose nothing', async ({ browser }) => {
  test.setTimeout(90_000)
  const first = await aPage(browser)
  await openProject(first, 'Website')
  await first.getByTestId('tool-files').click()
  const name = `Together ${Date.now()}`
  await add(first, 'new-document', name)
  await first.locator('[data-file]').filter({ hasText: name }).first().locator('[data-open-file]').click()
  await expect(first.getByTestId('file-name')).toHaveValue(name, { timeout: 15_000 })
  await together(first)

  const second = await aPage(browser)
  await second.goto(first.url())
  await together(second)

  // A line from the first page reaches the second as it is typed.
  await first.getByTestId('file-body').click()
  await first.keyboard.type('First line from one.')
  await expect(second.getByTestId('file-body')).toContainText('First line from one.', { timeout: 5_000 })

  // Both at once, on lines of their own.
  await first.keyboard.press('Enter')
  await second.getByTestId('file-body').click()
  await second.keyboard.press('ControlOrMeta+ArrowDown')
  await second.keyboard.press('End')
  await second.keyboard.press('Enter')
  await Promise.all([
    first.keyboard.type('Alpha alpha alpha alpha.', { delay: 15 }),
    second.keyboard.type('Beta beta beta beta.', { delay: 15 }),
  ])
  for (const page of [first, second]) {
    const body = page.getByTestId('file-body')
    await expect(body).toContainText('First line from one.', { timeout: 5_000 })
    await expect(body).toContainText('Alpha alpha alpha alpha.', { timeout: 5_000 })
    await expect(body).toContainText('Beta beta beta beta.', { timeout: 5_000 })
  }

  // Each sees the other's caret, with a name on it, and not their own.
  for (const page of [first, second]) {
    const caret = page.getByTestId('file-body').locator('[data-caret]')
    await expect(caret).toHaveCount(1, { timeout: 5_000 })
    await expect(caret).not.toHaveText('')
  }

  /*
   * An edit reaches the other page inside the budget — a hundred
   * milliseconds on the same server. Timed in the pages, on the one clock
   * this machine has: from just before the words go in on one page to the
   * moment the other page's body holds them. Asserted with room for four
   * browsers on one machine; the number is printed.
   */
  await second.evaluate(() => {
    const body = document.querySelector('[data-testid="file-body"]')!
    ;(window as unknown as { arrived: Promise<number> }).arrived = new Promise<number>((done) => {
      const watch = new MutationObserver(() => {
        if (body.textContent?.includes('Quick.')) {
          watch.disconnect()
          done(Date.now())
        }
      })
      watch.observe(body, { childList: true, subtree: true, characterData: true })
    })
  })
  const sent = await first.evaluate(() => Date.now())
  await first.keyboard.insertText(' Quick.')
  const took = (await second.evaluate(() => (window as unknown as { arrived: Promise<number> }).arrived)) - sent
  console.log(`  an edit reached the other page in ${took} ms`)
  expect(took).toBeLessThan(300)

  // Kept: the second page, read afresh, has every word.
  await first.getByTestId('file-name').click()
  await expect(first.getByText(/Version \d+/)).toBeVisible()
  await second.reload()
  const body = second.getByTestId('file-body')
  for (const words of ['First line from one.', 'Alpha alpha alpha alpha.', 'Beta beta beta beta.', 'Quick.']) {
    await expect(body).toContainText(words, { timeout: 15_000 })
  }
  await first.context().close()
  await second.context().close()
})

/*
 * Typed into at once: the keys pressed while the editor is handed over to
 * the shared state land in the body. The caret was handed over only if the
 * body had it at the render before the press, so one time in three the
 * words went to no field — and a letter that is a shortcut opened a new
 * task instead.
 */
test('a new document typed into at once keeps every word', async ({ page }) => {
  await login(page)
  await openProject(page, 'Website')
  await page.getByTestId('tool-files').click()
  for (let i = 0; i < 3; i++) {
    await page.getByTestId('docs-add').click()
    await page.getByTestId('create-new-document').click()
    await expect(page.getByTestId('file-name')).toHaveValue('Untitled', { timeout: 15_000 })
    const body = page.getByTestId('file-body')
    await body.click()
    await page.keyboard.type(`Quick words ${i}`)
    /* Left: saved, and the shared editor has the words. */
    await page.getByTestId('file-name').click()
    await together(page)
    await expect(body).toContainText(`Quick words ${i}`)
    await expect(page.getByTestId('new-title')).toHaveCount(0)
    await page.getByTestId('tool-files').click()
  }
})
