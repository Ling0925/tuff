import { test, expect, type Page } from '@playwright/test'
import { drawnWhole, login, openProject } from './helpers.js'

/*
 * Who is typing, a thread reply also sent to the room, a room's
 * incoming webhooks, narrowing what was said in the palette, and quoting a
 * message.
 */

/** Pictures for the task, when asked for: `SHOTS_DIR=… npx playwright test e2e/chat-more.spec.ts`. */
const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}.png` })
}

async function openChat(page: Page) {
  await openProject(page, 'Acme rebrand')
  await page.getByTestId('tool-messages').click()
  await expect(page.getByLabel('Message').first()).toBeVisible({ timeout: 30_000 })
}

/** The page's own session, for the few things a person does elsewhere. */
async function asMe<T>(page: Page, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  return page.evaluate(
    async ([p, i]) => {
      const s = JSON.parse(localStorage.getItem('session') ?? 'null') as { access_token: string }
      const r = await fetch(`/api${p}`, {
        method: i.method ?? 'GET',
        headers: { 'content-type': 'application/json', 'x-api-version': '1', authorization: `Bearer ${s.access_token}` },
        ...(i.body !== undefined ? { body: JSON.stringify(i.body) } : {}),
      })
      return (await r.json()) as unknown
    },
    [path, init] as const,
  ) as Promise<T>
}

/** The Acme rebrand's first room, which the Chat tab opens. */
async function acmeRoom(page: Page): Promise<{ project: string; room: string }> {
  const { projects } = await asMe<{ projects: { id: string; name: string }[] }>(page, '/projects')
  const project = projects.find((p) => p.name === 'Acme rebrand')!.id
  const { conversations } = await asMe<{
    conversations: { id: string; project_id: string | null; name: string | null; created_at: string }[]
  }>(page, '/conversations')
  const room = conversations.filter((c) => c.project_id === project).sort((a, b) => a.created_at.localeCompare(b.created_at))[0]!.id
  return { project, room }
}

async function say(page: Page, words: string) {
  const line = page.locator('[data-chat-composer]').first().getByLabel('Message')
  await line.fill(words)
  await line.press('Enter')
  const found = page.locator('[data-history] [data-message]').filter({ hasText: words })
  await expect(found).toBeVisible({ timeout: 15_000 })
  /* By its id from here: a quote of it says the same words. */
  return page.locator(`[data-history] [data-message-id="${await found.getAttribute('data-message-id')}"]`)
}

test('somebody typing is said under the line, in its own slot, and goes by itself', async ({ page }) => {
  await login(page)
  /* Somebody else in the room: an agent connected to the project, whose
     token can open the room's socket as anybody's can. */
  await page.locator('aside [data-project]').first().waitFor({ timeout: 30_000 })
  const { project, room } = await acmeRoom(page)
  const name = `Typer ${Date.now() % 100000}`
  const { token } = await asMe<{ token: string }>(page, '/agents', { method: 'POST', body: { name, project_ids: [project], reach: 'mcp' } })
  await openChat(page)
  const root = await say(page, `Typing root ${Date.now()}`)
  const rootId = await root.getAttribute('data-message-id')

  const line = page.locator('[data-chat-composer]').first()
  const before = await line.boundingBox()

  /* Their socket says they are typing, as their window would. */
  await page.evaluate(
    ([r, t]) => {
      const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws/conversations/${r}`)
      ;(window as unknown as { typer: WebSocket }).typer = ws
      ws.onopen = () => {
        ws.send(`auth ${t}`)
        let n = 0
        const beat = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN || n++ > 3) return clearInterval(beat)
          ws.send('typing')
        }, 900)
      }
    },
    [room, token] as const,
  )
  const said = page.locator('[data-typing]').first()
  await expect(said).toHaveText(`${name} is typing…`, { timeout: 10_000 })
  await shot(page, 'typing')
  /* Nothing moved for it: the line is where it was. */
  expect(await line.boundingBox()).toEqual(before)

  /* And it goes by itself after a few seconds of quiet. */
  await expect(page.locator('[data-typing]')).toHaveCount(0, { timeout: 15_000 })
  expect(await line.boundingBox()).toEqual(before)

  /* In a thread it is said in the thread, and not under the room's line. */
  await root.hover()
  await root.getByRole('button', { name: 'Reply in thread' }).click()
  const pane = page.locator('[data-thread]')
  await expect(pane).toBeVisible()
  await page.evaluate((thread) => (window as unknown as { typer: WebSocket }).typer.send(`typing ${thread}`), rootId)
  await expect(pane.locator('[data-typing]')).toHaveText(`${name} is typing…`, { timeout: 10_000 })
  await expect(page.locator('[data-typing]')).toHaveCount(1)
  await page.evaluate(() => (window as unknown as { typer: WebSocket }).typer.close())
})

test('a thread reply also sent to the room stands in both, and opens its thread from the room', async ({ page }) => {
  await login(page)
  await openChat(page)
  const rootWords = `Launch moves to Friday ${Date.now()}`
  const root = await say(page, rootWords)
  await root.hover()
  await root.getByRole('button', { name: 'Reply in thread' }).click()
  const pane = page.locator('[data-thread]')
  const box = pane.getByTestId('also-in-room')
  await expect(box).not.toBeChecked()
  await box.check()
  const reply = `Shipped, it was the cache ${Date.now()}`
  await pane.getByLabel('Message').fill(reply)
  await pane.getByLabel('Message').press('Enter')
  await expect(pane.locator('[data-message]').filter({ hasText: reply })).toBeVisible({ timeout: 15_000 })
  /* Off again for the next answer. */
  await expect(box).not.toBeChecked()
  await expect(pane.locator('[data-message]').filter({ hasText: reply }).locator('[data-also-sent]')).toBeVisible()

  /* In the room, at once, with the thread it answers — the room is under
     the thread on a window this narrow. */
  await page.getByTestId('close-thread').click()
  const inRoom = page.locator('[data-history] [data-message]').filter({ hasText: reply })
  await expect(inRoom).toBeVisible({ timeout: 15_000 })
  await expect(inRoom.locator('[data-replied-to-thread]')).toContainText(rootWords)
  await shot(page, 'also-in-room')

  /* Still there after a reload: one message, kept with its field. */
  await page.reload()
  const again = page.locator('[data-history] [data-message]').filter({ hasText: reply })
  await expect(again).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-history] [data-message]').filter({ hasText: reply })).toHaveCount(1)
  await again.locator('[data-replied-to-thread]').click()
  await expect(page.locator('[data-thread] [data-message]').first()).toContainText(rootWords, { timeout: 15_000 })
  await expect(page.locator('[data-thread] [data-message]').filter({ hasText: reply })).toBeVisible()
})

test('a room’s incoming webhook is made in its settings, drawn whole, and posts as an app', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await login(page)
  await openChat(page)
  await page.getByTestId('room-settings').click()
  await expect(page.getByTestId('room-hooks-open')).toBeVisible()
  const heights = await drawnWhole(page, '[data-dialog-panel]:has([data-testid="room-hooks"])', async () => {
    await page.getByTestId('room-hooks-open').click()
  })
  expect(heights.length, `the window changed height as it opened: ${heights.join(' → ')}`).toBe(1)
  const name = `Deploys ${Date.now() % 100000}`
  await page.getByTestId('hook-name').fill(name)
  await page.getByTestId('add-hook').click()
  const url = await page.getByTestId('hook-url').inputValue()
  expect(url).toMatch(/\/hooks\/rooms\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{43}$/)
  await expect(page.locator('[data-hook-row]').filter({ hasText: name })).toBeVisible()
  await shot(page, 'hook-settings')

  /* A tool posts to it, as it would to Slack. */
  const posted = await page.evaluate(async (u) => {
    const r = await fetch(new URL(u).pathname, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'fallback',
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: 'Deploy finished' } },
          { type: 'section', text: { type: 'mrkdwn', text: '*main* went out in _3m 12s_ — <https://example.com/runs/42|run 42>' } },
          {
            type: 'actions',
            elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open the run' }, url: 'https://example.com/runs/42' }],
          },
          { type: 'context', elements: [{ type: 'mrkdwn', text: 'Sign in at <https://evil.example/login|bank.com (bank.com)>' }] },
        ],
      }),
    })
    return { status: r.status, said: await r.text() }
  }, url)
  expect(posted).toEqual({ status: 200, said: 'ok' })
  await page.getByTestId('room-hooks-done').click()
  const message = page.locator('[data-history] [data-message]').filter({ hasText: 'Deploy finished' })
  await expect(message).toBeVisible({ timeout: 15_000 })
  await expect(message).toContainText(name)
  await expect(message.locator('[data-from-hook]')).toHaveText('App')
  await expect(message.getByRole('link', { name: 'Open the run' })).toHaveAttribute('href', 'https://example.com/runs/42')
  await expect(message.locator('[data-from-slack]')).toHaveCount(0)
  /* Each link says where it really goes, drawn beside it, in a tile no
     words can make — whatever the words claim. */
  await expect(message.getByRole('link', { name: 'bank.com (bank.com)' })).toHaveAttribute('href', 'https://evil.example/login')
  await expect(message.locator('[data-link-host]').filter({ hasText: 'evil.example' })).toHaveCount(1)
  await expect(message.locator('[data-link-host]').filter({ hasText: 'example.com' })).toHaveCount(2)
  /* And only on a webhook's message: a person's links are drawn as they were. */
  await expect(page.locator('[data-history] [data-message]:not(:has([data-from-hook])) [data-link-host]')).toHaveCount(0)
  await message.scrollIntoViewIfNeeded()
  await shot(page, 'hook-message')
})

test('the palette narrows what was said: from a person, has a link, in threads, oldest first', async ({ page }) => {
  await login(page)
  await openChat(page)
  const word = `zebu${Date.now() % 1000000}`
  await say(page, `${word} plain words`)
  await say(page, `${word} with https://example.com/spec`)
  const third = await say(page, `${word} third`)
  await third.hover()
  await third.getByRole('button', { name: 'Reply in thread' }).click()
  const pane = page.locator('[data-thread]')
  await pane.getByLabel('Message').fill(`${word} in a thread`)
  await pane.getByLabel('Message').press('Enter')
  await expect(pane.locator('[data-message]').filter({ hasText: `${word} in a thread` })).toBeVisible({ timeout: 15_000 })

  await page.keyboard.press('Escape')
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByTestId('palette-input').fill(word)
  const hits = page.locator('[data-hit]')
  await expect(hits).toHaveCount(4, { timeout: 15_000 })

  /* The second row is there only with Chat the one kind chosen. */
  const chatRow = page.locator('[data-palette-chat-filters]')
  await expect(chatRow).toHaveAttribute('aria-hidden', 'true')
  await page.getByTestId('filter-message').click()
  await expect(chatRow).not.toHaveAttribute('aria-hidden')
  await expect(page.getByTestId('filter-has-link')).toBeVisible()
  await page.getByTestId('filter-has-link').click()
  await expect(hits).toHaveCount(1, { timeout: 15_000 })
  await expect(hits.first()).toContainText('https://example.com/spec')
  await shot(page, 'search-filters')
  await page.getByTestId('filter-has-link').click()

  await page.getByTestId('filter-in-threads').click()
  await expect(hits).toHaveCount(1, { timeout: 15_000 })
  await expect(hits.first()).toContainText('in a thread')
  await page.getByTestId('filter-in-threads').click()

  await page.getByTestId('filter-sort').selectOption('oldest')
  await expect(hits.first()).toContainText(`${word} plain words`, { timeout: 15_000 })
  await page.getByTestId('filter-sort').selectOption('newest')
  await expect(hits.first()).toContainText(`${word} in a thread`, { timeout: 15_000 })

  /* From one person: me, with the words taken away — a question with none. */
  const { actor } = await asMe<{ actor: { id: string } }>(page, '/me')
  await page.getByTestId('filter-from').selectOption(actor.id)
  await expect(hits).toHaveCount(4, { timeout: 15_000 })
  await page.getByTestId('palette-input').fill('')
  await expect(hits.first()).toBeVisible({ timeout: 15_000 })
  await expect(hits.first()).toContainText(`${word} in a thread`)
  /* Nothing typed and nothing narrowing: nothing asked. */
  await page.getByTestId('filter-from').selectOption('')
  await expect(hits).toHaveCount(0, { timeout: 15_000 })
})

test('Quote puts a message into the line with who said it and a way back, in a room and a thread', async ({ page }) => {
  await login(page)
  await openChat(page)
  const words = `Quote me on this ${Date.now()}`
  const row = await say(page, words)
  await row.hover()
  await row.getByTestId('message-menu').click()
  await page.getByTestId('quote-message').click()
  const line = page.locator('[data-chat-composer]').first().getByLabel('Message')
  await expect(line.locator('blockquote')).toContainText(words)
  await expect(line.locator('blockquote a')).toHaveText('View message')
  await expect(line).toBeFocused()
  await page.keyboard.type('Agreed.')
  await shot(page, 'quote')
  await line.press('Enter')
  const answer = page.locator('[data-history] [data-message]').filter({ hasText: 'Agreed.' }).last()
  await expect(answer.locator('blockquote')).toContainText(words, { timeout: 15_000 })
  /* The way back opens the room at the message it quotes, lit. */
  await answer.locator('blockquote').getByRole('link', { name: 'View message' }).click()
  await expect(page.locator('[data-history] [data-message][data-found-at]').filter({ hasText: words }).first()).toBeVisible({
    timeout: 15_000,
  })

  /* And in a thread, into the thread's own line. */
  await row.hover()
  await row.getByRole('button', { name: 'Reply in thread' }).click()
  const pane = page.locator('[data-thread]')
  const head = pane.locator('[data-message]').first()
  await head.hover()
  await head.getByTestId('message-menu').click()
  await page.getByTestId('quote-message').click()
  await expect(pane.getByLabel('Message').locator('blockquote')).toContainText(words)
})
