import { test, expect, type Page } from '@playwright/test'
import { docKept, drawnWhole, login } from './helpers.js'

/**
 * Lines of a document made into tasks, and the tasks' state shown in it.
 */

async function writeDoc(page: Page, name: string, lines: string[]): Promise<void> {
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
  await expect(page.locator('[data-together]')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('file-body')).toHaveAttribute('contenteditable', 'true')
}

/** The same, from a body as it is stored. */
async function writeDocBody(page: Page, name: string, content: unknown[]): Promise<void> {
  const where = await page.evaluate(
    async ({ name, content }) => {
      const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
      const headers = { 'content-type': 'application/json', 'x-api-version': '1', authorization: `Bearer ${s.access_token}` }
      const me = (await (await fetch('/api/me', { headers })).json()) as { workspace: { slug: string } }
      const { projects } = (await (await fetch('/api/projects', { headers })).json()) as {
        projects: { id: string; slug: string; name: string }[]
      }
      const p = projects.find((x) => x.name === 'Website')!
      const { id } = (await (
        await fetch(`/api/projects/${p.id}/files`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ name, body: { type: 'doc', content } }),
        })
      ).json()) as {
        id: string
      }
      const { file } = (await (await fetch(`/api/files/${id}`, { headers })).json()) as { file: { number: number } }
      return `/${me.workspace.slug}/${p.slug}/files/${file.number}`
    },
    { name, content },
  )
  await page.goto(where)
  await expect(page.locator('[data-together]')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('file-body')).toHaveAttribute('contenteditable', 'true')
}

/** A request as this page's person, as another screen of theirs would send it. */
const asMe = (page: Page, method: string, path: string, body?: unknown) =>
  page.evaluate(
    async ({ method, path, body }) => {
      const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
      const r = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json', 'x-api-version': '1', authorization: `Bearer ${s.access_token}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      return r.json()
    },
    { method, path, body },
  )

test('two lines become two tasks, and each one’s state shows in the document both ways', async ({ page }) => {
  await login(page)
  const stamp = Date.now()
  await writeDoc(page, `Meeting ${stamp}`, [`Call the printer ${stamp}`, `Send the proofs ${stamp}`, 'Nothing for this one'])
  const body = page.getByTestId('file-body')

  // The first two lines chosen, as a hand dragging over them would, and made into tasks.
  await body.locator('p').first().click()
  await page.evaluate(() => {
    const [a, b] = [...document.querySelectorAll('[data-testid="file-body"] p')]
    const r = document.createRange()
    r.setStart(a!.firstChild!, 0)
    r.setEnd(b!.firstChild!, b!.firstChild!.textContent!.length)
    const s = window.getSelection()!
    s.removeAllRanges()
    s.addRange(r)
  })
  await page.getByTestId('task-from-words').click()

  const chips = body.locator('[data-task-chip]')
  await expect(chips).toHaveCount(2)
  await expect(chips.nth(0)).toContainText(`Call the printer ${stamp}`)
  await expect(chips.nth(1)).toContainText(`Send the proofs ${stamp}`)
  // Each takes its task's id and handle when the server answers.
  await expect(chips.nth(0)).not.toHaveAttribute('data-task-chip', '')
  await expect(chips.nth(1)).not.toHaveAttribute('data-task-chip', '')
  await expect(chips.nth(0).locator('.task-chip-handle')).toHaveText(/^[A-Z0-9]+-\d+$/)
  await expect(body.locator('p').nth(2)).toHaveText('Nothing for this one')
  const first = (await chips.nth(0).getAttribute('data-task-chip'))!
  const second = (await chips.nth(1).getAttribute('data-task-chip'))!

  // The task points back at the document.
  const read = (await asMe(page, 'GET', `/api/tasks/${first}`)) as { task: { title: string; body: unknown; list_id: string | null } }
  expect(read.task.title).toBe(`Call the printer ${stamp}`)
  expect(JSON.stringify(read.task.body)).toContain('"docref"')
  expect(read.task.list_id).not.toBeNull()

  // Done somewhere else — the board, another tab — shows done here, live.
  await asMe(page, 'PATCH', `/api/tasks/${first}`, { completed: true })
  await expect(chips.nth(0)).toHaveAttribute('data-done', 'true', { timeout: 10_000 })

  // Ticked here, the task is done.
  await chips.nth(1).locator('[data-task-tick]').click()
  await expect(chips.nth(1)).toHaveAttribute('data-done', 'true')
  await expect
    .poll(async () => ((await asMe(page, 'GET', `/api/tasks/${second}`)) as { task: { completed_at: string | null } }).task.completed_at)
    .not.toBeNull()

  // Kept: the stored body names both tasks.
  await page.getByTestId('file-name').click()
  await docKept(page, first, second, '"taskref"')

  // And the way back: the task's "From" opens the document it was made in.
  const doc = new URL(page.url()).pathname
  await chips.nth(0).locator('[data-task-open]').click()
  await expect(page).not.toHaveURL(new RegExp(`${doc}$`))
  await page.locator('[data-docref]').first().click()
  await expect(page).toHaveURL(new RegExp(`${doc}$`))
  await expect(page.getByTestId('file-body')).toBeVisible()

  // And "Mentioned in" under the document opens the task it names.
  await page
    .locator('[data-link]')
    .filter({ hasText: `Call the printer ${stamp}` })
    .click()
  await expect(page).toHaveURL(/\/tasks\/\d+$/)
})

test('a line with a link and a thread becomes one chip whose link still opens and whose thread is still reachable, and a chip nobody finished goes back to its line', async ({
  page,
}) => {
  await page.clock.install()
  await login(page)
  const stamp = Date.now()
  /* A line with a link; and a chip begun long ago on a page that closed, holding a line of its own. */
  await writeDocBody(page, `Links ${stamp}`, [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Read ' },
        { type: 'text', text: 'the brief', marks: [{ type: 'link', attrs: { href: 'https://example.com/brief' } }] },
        { type: 'text', text: ` today ${stamp}` },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'taskref',
          attrs: {
            title: `Left behind ${stamp}`,
            making: '1000:gone',
            line: [
              { type: 'text', text: 'Left ' },
              { type: 'text', text: 'behind', marks: [{ type: 'link', attrs: { href: 'https://example.com/left' } }] },
              { type: 'text', text: ` ${stamp}` },
            ],
          },
        },
      ],
    },
  ])
  const body = page.getByTestId('file-body')
  /* Counted from when this page first saw it: still a chip, then its line
     — the link with it — once thirty seconds have gone by on this page's clock. */
  await expect(body.locator('[data-task-chip]')).toHaveCount(1)
  await page.clock.fastForward('00:41')
  await expect(body.locator('p').nth(1)).toHaveText(`Left behind ${stamp}`)
  await expect(body.locator('p').nth(1).locator('a[href="https://example.com/left"]')).toHaveText('behind')
  await expect(body.locator('[data-task-chip]')).toHaveCount(0)

  // A thread on the line's last words, chosen as a hand would choose them.
  const tail = ` today ${stamp}`.trim()
  await body.locator('p').first().click()
  await page.evaluate((w) => {
    const p = document.querySelector('[data-testid="file-body"] p')!
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
    let t: Node | null = walker.nextNode()
    while (t && !(t.textContent ?? '').includes(w)) t = walker.nextNode()
    const at = (t!.textContent ?? '').indexOf(w)
    const r = document.createRange()
    r.setStart(t!, at)
    r.setEnd(t!, at + w.length)
    const s = window.getSelection()!
    s.removeAllRanges()
    s.addRange(r)
  }, tail)
  await expect(page.getByTestId('comment-on-words')).toBeVisible()
  await page.getByTestId('comment-on-words').click()
  await page.getByTestId('comment-on-words-field').fill('Which brief?')
  await page.getByTestId('comment-on-words-field').press('Enter')
  await expect(body.locator('[data-comment]')).toHaveText(tail)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-words-card]')).toHaveCount(0)

  await page.evaluate(() => {
    const p = document.querySelector('[data-testid="file-body"] p')!
    const r = document.createRange()
    r.selectNodeContents(p)
    const s = window.getSelection()!
    s.removeAllRanges()
    s.addRange(r)
  })
  await page.getByTestId('task-from-words').click()
  const chip = body.locator('[data-task-chip]')
  await expect(chip).toHaveCount(1)
  await expect(chip).not.toHaveAttribute('data-task-chip', '')

  // One chip, the whole line: nothing is left beside it.
  await expect(chip.locator('.task-chip-title')).toHaveText(`Read the brief ${tail}`)
  const outside = await page.evaluate(() => {
    const p = document.querySelector('[data-testid="file-body"] p')!.cloneNode(true) as HTMLElement
    p.querySelectorAll('[data-task-chip], [data-caret]').forEach((c) => c.remove())
    return p.textContent?.trim() ?? ''
  })
  expect(outside).toBe('')

  // The link inside the chip opens its address, not the task.
  await page.evaluate(() => {
    const w = window as unknown as { opened: string[] }
    w.opened = []
    window.open = ((u: string) => {
      w.opened.push(String(u))
      return null
    }) as typeof window.open
  })
  const link = chip.locator('a[data-chip-link]')
  await expect(link).toHaveText('the brief')
  const here = page.url()
  await link.click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { opened: string[] }).opened)).toEqual(['https://example.com/brief'])
  expect(page.url()).toBe(here)

  // The thread is still on words — inside the chip — and reachable from the list under the document.
  await expect(chip.locator('[data-comment]')).toHaveText(tail)
  const listed = page.locator('[data-discussion] [data-thread-words] button').first()
  await expect(listed).toBeEnabled()
  await expect(listed).not.toContainText('On deleted text')
  await listed.click()
  await expect(page.locator('[data-words-card]')).toBeVisible()
  await expect(page.locator('[data-words-card]')).toContainText('Which brief?')
  await page.keyboard.press('Escape')

  // The task's description holds the line, link and all, above the way back.
  const id = await chip.getAttribute('data-task-chip')
  const task = JSON.stringify(await asMe(page, 'GET', `/api/tasks/${id}`))
  expect(task).toContain('"href":"https://example.com/brief"')
  expect(task).not.toContain('"type":"comment"')
  // And the stored body keeps the line in the chip.
  await page.getByTestId('file-name').click()
  await docKept(page, '"line":', 'https://example.com/brief')
})

test('lines joined by a hard break become a task each, the whole line its title, and a long chip wraps like the words it replaced', async ({
  page,
}) => {
  await login(page)
  const stamp = Date.now()
  const first = `Call the printer ${stamp}`
  const long = `Send the proofs to the printer by Friday ${stamp}, in CMYK with three millimetres of bleed, and tell the binder that the cover goes to them separately on Monday morning.`
  await writeDocBody(page, `Lines ${stamp}`, [
    { type: 'paragraph', content: [{ type: 'text', text: first }, { type: 'hardBreak' }, { type: 'text', text: long }] },
  ])
  const body = page.getByTestId('file-body')
  const chips = body.locator('[data-task-chip]')

  /* The paragraph chosen whole, as a hand dragging over both its lines would. */
  await body.locator('p').first().click()
  await page.evaluate(() => {
    const p = document.querySelector('[data-testid="file-body"] p')!
    const r = document.createRange()
    r.selectNodeContents(p)
    const s = window.getSelection()!
    s.removeAllRanges()
    s.addRange(r)
  })
  /* Drawn whole: one height from "Making…" to the task's handle. */
  const heights = await drawnWhole(page, '[data-task-chip]', () => page.getByTestId('task-from-words').click())
  expect(heights.length).toBe(1)

  /* Two lines, two tasks, each titled by the whole of its line. */
  await expect(chips).toHaveCount(2)
  await expect(chips.nth(0).locator('.task-chip-title')).toHaveText(first)
  await expect(chips.nth(1).locator('.task-chip-title')).toHaveText(long)
  await expect(chips.nth(0)).not.toHaveAttribute('data-task-chip', '')
  await expect(chips.nth(1)).not.toHaveAttribute('data-task-chip', '')
  const made = (await chips.nth(1).getAttribute('data-task-chip'))!
  const task = (await asMe(page, 'GET', `/api/tasks/${made}`)) as { task: { title: string } }
  expect(task.task.title).toBe(long)

  /* Nothing left behind: the paragraph holds the two chips and the break between them, and no words of its own. */
  const loose = await body
    .locator('p')
    .first()
    .evaluate((p) => [...p.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== '').length)
  expect(loose).toBe(0)

  /* The long one wraps across lines like a sentence, each line a line below the last — never over it. */
  const lines = await chips
    .nth(1)
    .locator('.task-chip-title')
    .evaluate((el) => [...el.getClientRects()].map((r) => ({ top: Math.round(r.top), bottom: Math.round(r.bottom) })))
  expect(lines.length).toBeGreaterThanOrEqual(2)
  for (let i = 1; i < lines.length; i++) {
    expect(lines[i]!.top).toBeGreaterThanOrEqual(lines[i - 1]!.bottom)
    expect(lines[i]!.top - lines[i - 1]!.top).toBe(24)
  }
  /* The paragraph is as tall as its lines: one for the first chip, the long one's own. */
  const p = (await body.locator('p').first().boundingBox())!
  expect(Math.round(p.height)).toBe(24 * (1 + lines.length))
})

test('a chip in a list stands on the bullet’s line, not under it', async ({ page }) => {
  await login(page)
  const stamp = Date.now()
  await writeDocBody(page, `List chip ${stamp}`, [
    {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Book the hall ${stamp}` }] }] }],
    },
  ])
  const body = page.getByTestId('file-body')
  await body.locator('li p').click()
  await page.evaluate(() => {
    const p = document.querySelector('[data-testid="file-body"] li p')!
    const r = document.createRange()
    r.selectNodeContents(p)
    const s = window.getSelection()!
    s.removeAllRanges()
    s.addRange(r)
  })
  await page.getByTestId('task-from-words').click()
  const chip = body.locator('li [data-task-chip]')
  await expect(chip).not.toHaveAttribute('data-task-chip', '')
  /* The list item stays one line high, and the chip is inside that line. */
  const li = (await body.locator('li').boundingBox())!
  const box = (await chip.boundingBox())!
  expect(li.height).toBe(24)
  expect(box.y).toBeGreaterThanOrEqual(li.y)
  expect(box.y + box.height).toBeLessThanOrEqual(li.y + li.height)
})

/*
 * A task deleted while its document is open: its chip is the words again —
 * no tint, no tick, nothing that opens a task that is not there. It went on
 * being drawn alive, the last card kept over the server's "not found", and
 * a press opened the deleted task. Brought back from the bin, it is a chip
 * again: the document kept it.
 */
test('a task deleted is words again in its document, and comes back a chip when restored', async ({ page }) => {
  await login(page)
  const stamp = Date.now()
  await writeDoc(page, `Deleted ${stamp}`, [`Order the banners ${stamp}`])
  const body = page.getByTestId('file-body')
  await body.locator('p').first().click()
  await page.evaluate(() => {
    const p = document.querySelector('[data-testid="file-body"] p')!
    const r = document.createRange()
    r.selectNodeContents(p)
    const s = window.getSelection()!
    s.removeAllRanges()
    s.addRange(r)
  })
  await page.getByTestId('task-from-words').click()
  const chip = body.locator('[data-task-chip]')
  await expect(chip).not.toHaveAttribute('data-task-chip', '')
  await expect(chip.locator('[data-task-tick]')).toBeVisible()
  const id = (await chip.getAttribute('data-task-chip'))!

  await asMe(page, 'DELETE', `/api/tasks/${id}`)
  await expect(chip).toHaveAttribute('data-gone', 'true', { timeout: 10_000 })
  await expect(chip).toHaveText(`Order the banners ${stamp}`)
  await expect(chip.locator('[data-task-tick]')).toHaveCount(0)
  await expect(chip.locator('[data-task-open]')).toHaveCount(0)
  const tint = await chip.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(tint).toBe('rgba(0, 0, 0, 0)')
  const at = page.url()
  await chip.click()
  await expect(page).toHaveURL(at)

  // Out of the bin, it is the task again — the next read says so.
  await asMe(page, 'POST', `/api/tasks/${id}/restore`)
  await page.reload()
  await expect(body.locator('[data-task-chip]')).not.toHaveAttribute('data-gone', 'true', { timeout: 15_000 })
  await expect(body.locator('[data-task-chip] [data-task-tick]')).toBeVisible()
})

/* A chip that wraps keeps a gap between its lines' tints, in a heading as in
   the body: at the old padding a heading's two tints lay over each other. */
test('a chip wrapped over two lines keeps its tints apart, in a heading and in the body', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 })
  await login(page)
  const api = <T>(method: string, path: string, body?: unknown) =>
    page.evaluate(
      async ([method, path, body]) => {
        const s = JSON.parse(localStorage.getItem('session') ?? 'null') as { access_token: string }
        const r = await fetch(`/api${path}`, {
          method,
          headers: { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1', 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return (await r.json()) as T
      },
      [method, path, body] as const,
    ) as Promise<T>
  const { projects } = await api<{ projects: { id: string; slug: string; key: string; name: string }[] }>('GET', '/projects')
  const site = projects.find((p) => p.name === 'Website')!
  const title = `The session is renewed ahead of time, not after a burst of refusals ${Date.now()}`
  const made = await api<{ id?: string; task?: { id: string; number: number }; number?: number }>('POST', `/projects/${site.id}/tasks`, {
    title,
  })
  const taskId = made.id ?? made.task!.id
  const task = await api<{ task: { number: number } }>('GET', `/tasks/${taskId}`)
  const chip = { type: 'taskref', attrs: { id: taskId, projectId: site.id, number: task.task.number, key: site.key, title } }
  const body = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'What the review found ' }, chip] },
      { type: 'paragraph', content: [{ type: 'text', text: 'And in the words of a paragraph, ' }, chip] },
    ],
  }
  const file = await api<{ id: string }>('POST', `/projects/${site.id}/files`, { name: `Chips ${Date.now()}`, body })
  const read = await api<{ file: { number: number } }>('GET', `/files/${file.id}`)
  const ws = new URL(page.url()).pathname.split('/')[1]
  await page.goto(`/${ws}/${site.slug}/files/${read.file.number}`)
  for (const where of ['h2', 'p']) {
    const el = page.locator(`.ProseMirror ${where} [data-task-chip]`).first()
    await expect(el).toBeVisible({ timeout: 15_000 })
    /* Polled: the chip's view is drawn again once its task is read, and a
       read taken between the two found a node with no boxes at all. */
    await expect
      .poll(() => el.evaluate((n) => n.getClientRects().length), { message: `the chip in the ${where} wraps`, timeout: 5_000 })
      .toBeGreaterThan(1)
    const rects = await el.evaluate((n) => [...n.getClientRects()].map((r) => ({ top: r.top, bottom: r.bottom })))
    for (let i = 1; i < rects.length; i++) {
      expect(rects[i]!.top - rects[i - 1]!.bottom, `the ${where} chip's line ${i} lies over the one above`).toBeGreaterThan(0)
    }
  }
})
