import { test, expect, type Page } from '@playwright/test'
import { login, openProject } from './helpers.js'

/*
 * A room's line lit while files are carried over
 * it, a message opened for editing from the keyboard, and the thread's head
 * clear of the line above it.
 */

/** Pictures for the task, when asked for: `SHOTS_DIR=… npx playwright test e2e/chat-keys.spec.ts`. */
const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS_DIR) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.waitForTimeout(250)
      await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}-${scheme}.png` })
    }
    await page.emulateMedia({ colorScheme: 'light' })
  }
}

async function openChat(page: Page) {
  await openProject(page, 'Acme rebrand')
  await page.getByTestId('tool-messages').click()
  await expect(page.getByLabel('Message').first()).toBeVisible({ timeout: 30_000 })
}

async function say(page: Page, words: string) {
  const line = page.locator('[data-chat-composer]').first().getByLabel('Message')
  await line.fill(words)
  await line.press('Enter')
  const found = page.locator('[data-history] [data-message]').filter({ hasText: words })
  await expect(found).toBeVisible({ timeout: 15_000 })
  return page.locator(`[data-history] [data-message-id="${await found.getAttribute('data-message-id')}"]`)
}

/** A drag event over the element `sel`, carrying a file or only words. */
async function drag(page: Page, sel: string, kind: 'dragenter' | 'dragleave' | 'drop', carry: 'file' | 'text' = 'file') {
  await page.evaluate(
    ([s, k, c]) => {
      const el = document.querySelector(s)!
      const dt = new DataTransfer()
      if (c === 'file') dt.items.add(new File(['hello'], 'note.txt', { type: 'text/plain' }))
      else dt.setData('text/plain', 'just words')
      const r = el.getBoundingClientRect()
      el.dispatchEvent(new DragEvent(k, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 24, clientY: r.top + 24 }))
    },
    [sel, kind, carry] as const,
  )
}

test('files carried over the line light it, at its own size, and it goes dark when they leave', async ({ page }) => {
  await login(page)
  await openChat(page)
  const box = page.locator('[data-chat-composer]').first()
  const before = await box.boundingBox()
  const ground = await box.evaluate((el) => getComputedStyle(el).backgroundColor)

  /* Only words dragged across: nothing the line would take, so no light. */
  await drag(page, '[data-chat-composer] [data-message-field]', 'dragenter', 'text')
  await expect(box).not.toHaveAttribute('data-files-over')

  await drag(page, '[data-chat-composer] [data-message-field]', 'dragenter')
  await expect(box).toHaveAttribute('data-files-over')
  /* Into a button inside it: a leave and an enter, and it stays lit. */
  await drag(page, '[data-chat-composer] button', 'dragenter')
  await drag(page, '[data-chat-composer] [data-message-field]', 'dragleave')
  await expect(box).toHaveAttribute('data-files-over')
  await page.waitForTimeout(250)
  const lit = await box.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(lit).not.toBe(ground)
  const accent = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.background = 'var(--accent-soft)'
    document.body.append(probe)
    const c = getComputedStyle(probe).backgroundColor
    probe.remove()
    return c
  })
  expect(lit).toBe(accent)
  /* Colour only: not a pixel of the box moved. */
  expect(await box.boundingBox()).toEqual(before)
  await shot(page, 'drag-tint')

  await drag(page, '[data-chat-composer] button', 'dragleave')
  await expect(box).not.toHaveAttribute('data-files-over')

  /* And let go of: dark again, the file waiting in the line. */
  await drag(page, '[data-chat-composer] [data-message-field]', 'dragenter')
  await expect(box).toHaveAttribute('data-files-over')
  await drag(page, '[data-chat-composer] [data-message-field]', 'drop')
  await expect(box).not.toHaveAttribute('data-files-over')
  await expect(box.locator('[data-composer-tray]')).toContainText('note.txt', { timeout: 15_000 })
})

test('↑ in an empty line edits your last message, and E edits the one under the pointer', async ({ page }) => {
  await login(page)
  await openChat(page)
  const stamp = Date.now()
  const first = await say(page, `First said ${stamp}`)
  const last = await say(page, `Last said ${stamp}`)
  const line = page.locator('[data-chat-composer]').first().getByLabel('Message')

  /* With words in the line ↑ is the caret's. */
  await line.fill('half a thought')
  await line.press('ArrowUp')
  await expect(page.locator('[data-history] [data-editing]')).toHaveCount(0)
  await line.fill('')

  /* Empty: the last one you wrote opens, the caret in it. */
  await line.press('ArrowUp')
  const editor = last.locator('[data-message-editor] [data-message-field]')
  await expect(editor).toBeFocused()
  /* Escape lets it go as it was, and the hand is back in the line. */
  await page.keyboard.press('Escape')
  await expect(last.locator('[data-message-editor]')).toHaveCount(0)
  await expect(line).toBeFocused()

  /* Enter saves. */
  await line.press('ArrowUp')
  await expect(editor).toBeFocused()
  await page.keyboard.press('Meta+a')
  await page.keyboard.type(`Last, changed ${stamp}`)
  await page.keyboard.press('Enter')
  await expect(last).toContainText(`Last, changed ${stamp}`)
  await expect(last.locator('[data-edited]')).toBeVisible()
  await expect(line).toBeFocused()

  /* E while typing is a letter. */
  await line.pressSequentially('e')
  await expect(page.locator('[data-history] [data-editing]')).toHaveCount(0)
  await line.fill('')

  /* Out of the line, E over a message opens that one. */
  await page.keyboard.press('Escape')
  await first.hover()
  await page.keyboard.press('e')
  await expect(first.locator('[data-message-editor] [data-message-field]')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(first.locator('[data-message-editor]')).toHaveCount(0)
})

test('the thread’s head stands clear of the line above it, and the pane does not change height', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page)
  /* From the sidebar, where the room's head is a bar with a line under it. */
  await page.locator('aside').getByText('acme-rebrand-main').click()
  await expect(page.locator('[data-room-bar]')).toBeVisible({ timeout: 30_000 })
  const root = await say(page, `Thread head ${Date.now()}`)
  await root.hover()
  await root.getByRole('button', { name: 'Reply in thread' }).click()
  const pane = page.locator('[data-thread]')
  await expect(pane.locator('[data-message]').first()).toBeVisible({ timeout: 15_000 })
  const head = pane.locator('[data-thread-head]')
  const height = (await pane.boundingBox())!.height
  const m = await page.evaluate(() => {
    const bar = document.querySelector('[data-room-bar]')!.getBoundingClientRect()
    const title = document.querySelector('[data-thread-head] [data-thread-title]')!.getBoundingClientRect()
    const close = document.querySelector('[data-thread] [data-testid="close-thread"]')!.getBoundingClientRect()
    const pane = document.querySelector('[data-thread]')!.getBoundingClientRect()
    return {
      gap: title.top - bar.bottom,
      titleMid: title.top + title.height / 2,
      closeMid: close.top + close.height / 2,
      closeRight: close.right,
      paneRight: pane.right,
    }
  })
  expect(m.gap).toBeGreaterThanOrEqual(12)
  expect(Math.abs(m.titleMid - m.closeMid)).toBeLessThanOrEqual(1)
  expect(m.paneRight - m.closeRight).toBeLessThanOrEqual(8)
  await expect(head).toBeVisible()
  await shot(page, 'thread-head')
  /* Nothing settles after it appears. */
  await page.waitForTimeout(400)
  expect((await pane.boundingBox())!.height).toBe(height)
})

test('a thread beside the room is as wide as it is dragged, and over the room its whole head is the way back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page)
  await page.locator('aside').getByText('acme-rebrand-main').click()
  await expect(page.locator('[data-room-bar]')).toBeVisible({ timeout: 30_000 })
  const words = `Thread width ${Date.now()}`
  const root = await say(page, words)
  await root.hover()
  await root.getByRole('button', { name: 'Reply in thread' }).click()
  const pane = page.locator('[data-thread]')
  await expect(pane.locator('[data-message]').first()).toBeVisible({ timeout: 15_000 })
  const width = () => pane.evaluate((el) => Math.round(el.getBoundingClientRect().width))
  await expect.poll(width).toBe(360)
  const room = () =>
    page
      .locator('[data-room-bar]')
      .first()
      .evaluate((el) => Math.round(el.getBoundingClientRect().width))
  const roomBefore = await room()
  /* The pane rides in on its frame for a fifth of a second; the handle is
     taken where it comes to rest, not where it was on the way. */
  const handleAt = () =>
    page
      .locator('[data-resizer="Thread Width"]')
      .boundingBox()
      .then((b) => Math.round(b?.x ?? 0))
  let was = -1
  await expect
    .poll(async () => {
      const now = await handleAt()
      const still = now === was
      was = now
      return still
    })
    .toBe(true)

  /* Dragged left from its left edge, it widens; the room keeps its width. */
  const handle = page.locator('[data-resizer="Thread Width"]')
  const box = (await handle.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 50, y, { steps: 4 })
  await page.mouse.move(x - 100, y, { steps: 4 })
  await page.mouse.up()
  await expect.poll(width).toBe(460)
  expect(Math.abs((await room()) - roomBefore)).toBeLessThanOrEqual(1)

  /* Kept through a reload — a thread opened again opens at that width —
     then put back by a double-click. */
  await page.reload()
  const again = page.locator('[data-history] [data-message]').filter({ hasText: words })
  await again.hover({ timeout: 15_000 })
  await again.getByRole('button', { name: 'Reply in thread' }).click()
  await expect(pane.locator('[data-message]').first()).toBeVisible({ timeout: 15_000 })
  await expect.poll(width).toBe(460)
  await handle.dblclick()
  await expect.poll(width).toBe(360)

  /* Too narrow for both: over the room, and the arrow, the word and the
     room's name are one button that goes back. */
  await page.setViewportSize({ width: 800, height: 900 })
  const back = pane.getByTestId('close-thread')
  await expect(back.locator('[data-thread-title]')).toBeVisible()
  await expect(back).toContainText('main')
  await back.click()
  await expect(pane).toHaveCount(0)
})
