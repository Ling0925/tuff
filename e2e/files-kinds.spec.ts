import { deflateSync } from 'node:zlib'
import { test, expect, type Page } from '@playwright/test'
import { add, drawnWhole, login, openProject } from './helpers.js'

/**
 * Files: four kinds and whose, pictures large, a document's mark, and a
 * pinned document drawn as a page — `docs/specs/docs.md`.
 */
const SHOTS = process.env.SHOTS_DIR ?? ''
const shot = async (page: Page, dir: string, name: string, target?: ReturnType<Page['locator']>) => {
  if (!SHOTS) return
  const path = `${SHOTS}/${dir}/${name}.png`
  await (target ? target.screenshot({ path }) : page.screenshot({ path }))
}

/** A picture of one colour, as a PNG — written here rather than kept as a file. */
function solid(w: number, h: number, [r, g, b]: number[]): Buffer {
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r!, g!, b!]).flat())])
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  const crc = (buf: Buffer) => {
    let c = ~0
    for (const byte of buf) {
      c ^= byte
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
    }
    return ~c >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(w, 0)
  head.writeUInt32BE(h, 4)
  head[8] = 8
  head[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

async function openFiles(page: Page) {
  await login(page)
  await openProject(page, 'Website')
  await page.getByTestId('tool-files').click()
  await expect(page.getByTestId('docs-add')).toBeVisible({ timeout: 15_000 })
}

test('the kinds start at Docs, and the kind and whose are kept across a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await openFiles(page)
  const name = `Mine ${Date.now()}`
  await add(page, 'new-document', name)

  const kinds = page.locator('[data-docs-kind]')
  await expect(kinds).toHaveCount(4)
  /* As drawn: a narrow screen keeps a second copy of the open one's word. */
  await expect.poll(() => kinds.allInnerTexts()).toEqual(['Docs', 'Images', 'Uploads', 'Links'])
  await expect(page.locator('[data-docs-kind="docs"]')).toHaveAttribute('data-on', 'true')

  /* Whose is a menu at the end of the row, whose button keeps its width. */
  const trigger = page.getByTestId('docs-whose')
  await expect(trigger.locator('[data-whose="recent"]')).toBeVisible()
  const wide = (await trigger.boundingBox())!.width
  const heights = await drawnWhole(page, '[role="menu"]:has([data-docs-whose])', () => trigger.click())
  expect(heights).toHaveLength(1)
  await expect(page.locator('[data-docs-whose]')).toHaveText(['Recent', 'My documents', 'Shared with me', 'Recently Deleted'])
  await expect(page.locator('[data-docs-whose="recent"]')).toHaveAttribute('aria-checked', 'true')
  await shot(page, 'tuf277', 'whose-menu-dark', page.locator('main'))

  const row = page.locator('[data-file]').filter({ hasText: name })
  await page.locator('[data-docs-whose="mine"]').click()
  await expect(row).toHaveCount(1)
  await trigger.click()
  await expect(page.locator('[data-docs-whose="mine"]')).toHaveAttribute('aria-checked', 'true')
  await page.locator('[data-docs-whose="shared"]').click()
  await expect(row).toHaveCount(0)
  expect((await trigger.boundingBox())!.width).toBe(wide)
  await shot(page, 'tuf277', 'filter-dark', page.getByTestId('docs-filter'))

  /* Kept: whose, and a kind. */
  await page.locator('[data-docs-kind="links"]').click()
  await page.reload()
  await expect(trigger.locator('[data-whose="shared"]')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-docs-kind="links"]')).toHaveAttribute('data-on', 'true')
  await page.locator('[data-docs-kind="docs"]').click()
  await trigger.click()
  await page.locator('[data-docs-whose="recent"]').click()
  await expect(row).toHaveCount(1)
})

test('a kept "all" from before opens on Docs', async ({ page }) => {
  await openFiles(page)
  await add(page, 'new-document', `Kept ${Date.now()}`)
  /* A kind picked writes the key; it is then made what an old build kept. */
  await page.locator('[data-docs-kind="links"]').click()
  const kept = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('docs-kind:'))
    for (const k of keys) localStorage.setItem(k, 'all')
    return keys.length
  })
  expect(kept).toBeGreaterThan(0)
  /* A bare `/files`, which the kept kind fills in: the address names Links
     now, and the address wins. */
  await page.goto(page.url().replace(/\/files\/links$/, '/files'))
  await expect(page.locator('[data-docs-kind="docs"]')).toHaveAttribute('data-on', 'true', { timeout: 15_000 })
})

test('on a phone the kinds and whose both stay on the screen', async ({ page }) => {
  await openFiles(page)
  const name = `Phone ${Date.now()}`
  await add(page, 'new-document', name)
  /* Opened at a desk's width, where the sidebar leads to it, then narrowed. */
  await page.setViewportSize({ width: 375, height: 760 })
  const filter = page.getByTestId('docs-filter')
  await expect(filter).toBeVisible()
  const group = page.locator('[data-testid="docs-filter"] [role="group"]')
  const kinds = await group.boundingBox()
  const whose = await page.getByTestId('docs-whose').boundingBox()
  /* One row — the kinds as glyphs but the open one, whose as its glyph —
     every kind on the screen without scrolling, and nothing past the edge. */
  expect(Math.abs(whose!.y + whose!.height / 2 - (kinds!.y + kinds!.height / 2))).toBeLessThan(8)
  expect(kinds!.x + kinds!.width).toBeLessThanOrEqual(whose!.x)
  expect(await group.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(whose!.x + whose!.width).toBeLessThanOrEqual(375)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
})

test('a document’s colour and icon are chosen on its head, and show in the list', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await openFiles(page)
  const name = `Marked ${Date.now()}`
  await add(page, 'new-document', name)
  await page.locator('[data-open-file]').filter({ hasText: name }).click()
  await expect(page.getByTestId('file-name')).toHaveValue(name, { timeout: 15_000 })

  const heights = await drawnWhole(page, '[data-testid="doc-mark-rails"]', () => page.getByTestId('doc-mark-toggle').click())
  expect(heights).toHaveLength(1)
  const rails = page.getByTestId('doc-mark-rails')
  let patched = page.waitForResponse((r) => r.url().includes('/api/files/') && r.request().method() === 'PATCH')
  await rails.locator('[data-mark-pick="rocket"]').click()
  expect((await patched).status()).toBe(200)
  patched = page.waitForResponse((r) => r.url().includes('/api/files/') && r.request().method() === 'PATCH')
  await rails.locator('[data-tint-pick="3"]').click()
  expect((await patched).status()).toBe(200)
  /* On the screen at once, and in the radio. */
  await expect(page.getByTestId('doc-mark-toggle').locator('[data-doc-mark="rocket"][data-doc-tint="3"]')).toBeVisible()
  await expect(rails.locator('[data-mark-pick="rocket"]')).toHaveAttribute('aria-checked', 'true')
  await shot(page, 'tuf277', 'picker-dark', page.locator('[data-testid="doc-mark-toggle"]').locator('xpath=..'))

  /* Kept by the server. */
  await page.reload()
  await expect(page.getByTestId('doc-mark-toggle').locator('[data-doc-mark="rocket"][data-doc-tint="3"]')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('close-file').click()
  await expect(page.locator('[data-file]').filter({ hasText: name }).locator('[data-doc-mark="rocket"][data-doc-tint="3"]')).toBeVisible({
    timeout: 15_000,
  })
})

test('Images draws the pictures large, three to a row', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await openFiles(page)
  const stamp = Date.now()
  /* Four pictures of four shapes and colours: a slot is four by three
     whatever the picture is. */
  const shapes: [number, number, number[]][] = [
    [96, 64, [10, 132, 255]],
    [64, 96, [48, 209, 88]],
    [80, 80, [255, 159, 10]],
    [120, 48, [191, 90, 242]],
  ]
  await page
    .getByTestId('upload')
    .setInputFiles(shapes.map(([w, h, rgb], i) => ({ name: `grid-${stamp}-${i}.png`, mimeType: 'image/png', buffer: solid(w, h, rgb) })))
  /* Turned to Images by what went up. */
  await expect(page.locator('[data-docs-kind="images"]')).toHaveAttribute('data-on', 'true')
  const tiles = page.locator('[data-picture-grid] [data-file]').filter({ hasText: `grid-${stamp}` })
  await expect(tiles).toHaveCount(4, { timeout: 20_000 })
  const boxes = await Promise.all((await page.locator('[data-picture-grid] > [data-file]').all()).slice(0, 4).map((t) => t.boundingBox()))
  /* Three on the first row, the fourth under the first, all one size. */
  expect(Math.round(boxes[0]!.y)).toBe(Math.round(boxes[2]!.y))
  expect(boxes[3]!.y).toBeGreaterThan(boxes[0]!.y)
  expect(Math.round(boxes[0]!.height)).toBe(Math.round(boxes[3]!.height))
  /* The pictures themselves, loaded, in the room kept for them. */
  const thumb = tiles.first().locator('img[data-file-thumb]')
  await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0)
  await shot(page, 'tuf277', 'images-dark')
  /* Pressed, the picture opens over the list. */
  await tiles.first().locator('[data-open-file]').click()
  const box = page.locator('[data-lightbox]')
  await expect(box).toBeVisible({ timeout: 15_000 })
  /* Paged with the arrow, it is the same lightbox turning a page — not a
     new one opening again, dim and all, for every picture. */
  await box.evaluate((el) => {
    ;(el as HTMLElement & { seen?: boolean }).seen = true
  })
  const counter = await box.innerText()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => box.innerText()).not.toBe(counter)
  expect(await box.evaluate((el) => (el as HTMLElement & { seen?: boolean }).seen === true)).toBe(true)
})

test('a pinned document is a page, drawn whole', async ({ page }) => {
  test.setTimeout(60_000)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await openFiles(page)
  const name = `Launch plan ${Date.now()}`
  /* Named and written in one visit: Enter at the end of the name walks
     into the body. */
  await page.getByTestId('docs-add').click()
  await page.getByTestId('create-new-document').click()
  const title = page.getByTestId('file-name')
  await expect(title).toHaveValue('Untitled', { timeout: 15_000 })
  const named = page.waitForResponse((r) => r.url().includes('/api/files/') && r.request().method() === 'PATCH')
  await title.fill(name)
  await title.press('Enter')
  await named
  await page.keyboard.type('# What we ship\n')
  await page.keyboard.type('The site, the app and the letter to everybody who waited.')
  /* Written through the shared editor, which saves on its own beat. */
  await page.waitForTimeout(1500)
  await page.getByTestId('close-file').click()

  const row = page.locator('[data-file]').filter({ hasText: name }).first()
  await row.hover()
  await row.getByTestId('file-pin').click()
  const card = page.locator('[data-pinned] [data-pinned-card]').filter({ hasText: name })
  await expect(card.locator('[data-paper]')).toContainText('What we ship', { timeout: 15_000 })

  /* Drawn with the list, whole, when the list comes back. */
  await page.getByTestId('tool-tasks').click()
  const heights = await drawnWhole(page, '[data-pinned]', () => page.getByTestId('tool-files').click())
  expect(heights).toHaveLength(1)
  await page.mouse.move(0, 0)
  await page.waitForTimeout(300)
  await shot(page, 'tuf280', 'pinned-page-rest-dark', page.locator('[data-pinned]'))
  await card.locator('[data-paper]').hover({ position: { x: 40, y: 40 } })
  await page.waitForTimeout(300)
  await shot(page, 'tuf280', 'pinned-page-hover-dark', page.locator('[data-pinned]'))
  /* A US Letter page, 17 by 22; lifted under the pointer, never turned. */
  const page17 = (await card.locator('[data-paper]').boundingBox())!
  expect(Math.abs(page17.width / page17.height - 17 / 22)).toBeLessThan(0.02)
  const lifted = await card.locator('[data-paper]').evaluate((el) => getComputedStyle(el).transform)
  expect(lifted).toMatch(/^matrix\(1, 0, 0, 1, 0, -2\)$/)

  /* The row of pages is as wide as the list under it: both fill the
     column they stand in, edge to edge. */
  const edges = await page.locator('[data-pinned]').evaluate((el) => {
    const grid = (el.firstElementChild as HTMLElement).getBoundingClientRect()
    let col = el.parentElement!
    while (getComputedStyle(col).display === 'contents') col = col.parentElement!
    const c = col.getBoundingClientRect()
    const cs = getComputedStyle(col)
    return {
      left: grid.left - (c.left + Number.parseFloat(cs.paddingLeft)),
      right: grid.right - (c.right - Number.parseFloat(cs.paddingRight)),
    }
  })
  expect(Math.abs(edges.left)).toBeLessThan(1)
  expect(Math.abs(edges.right)).toBeLessThan(1)

  /* Under the page, only when it changed. */
  await expect(card.locator('> span')).toHaveText(/^Updated /)
  /* Let go, for the next run. */
  await card.getByTestId('file-pin').click()
  await expect(card).toHaveCount(0, { timeout: 15_000 })
})

test('a pin moves the row to the head rather than redrawing it there', async ({ page }) => {
  /* `docs/specs/docs.md`, "Pinning moves": the page rises from where the
     row was, on a transform, and a reload draws it still. */
  await login(page)
  await openProject(page, 'Website')
  await page.getByTestId('tool-files').click()
  const stamp = Date.now()
  await add(page, 'new-document', `Moves ${stamp}`)
  const row = page.locator('[data-file][data-row]').filter({ hasText: `Moves ${stamp}` })
  await row.hover()
  await row.getByTestId('file-pin').click()
  const card = page.locator('[data-pinned-card]').filter({ hasText: `Moves ${stamp}` })
  await expect(card).toBeVisible({ timeout: 15_000 })
  /* Moving the moment it is drawn: an animation on transform and opacity. */
  const moving = await card.evaluate((el) =>
    el
      .getAnimations()
      /* Not the lift under the pointer, which is a CSS transition. */
      .filter((a) => !(a instanceof CSSTransition))
      .map((a) => {
        const k = (a.effect as KeyframeEffect).getKeyframes()[0] ?? {}
        return Object.keys(k).filter((p) => !['offset', 'easing', 'composite', 'computedOffset'].includes(p))
      }),
  )
  expect(moving.length).toBeGreaterThan(0)
  expect(moving.flat().every((p) => p === 'transform' || p === 'opacity')).toBe(true)
  await page.reload()
  const again = page.locator('[data-pinned-card]').filter({ hasText: `Moves ${stamp}` })
  await expect(again).toBeVisible({ timeout: 15_000 })
  expect(await again.evaluate((el) => el.getAnimations().filter((a) => !(a instanceof CSSTransition)).length)).toBe(0)
  // Put back, so the fixture's head is as it was.
  await again.getByTestId('file-pin').click()
  await expect(again).toHaveCount(0, { timeout: 15_000 })
})

test('a long list reads further as it is scrolled, and nothing above moves', async ({ page, browser }) => {
  /* A hundred a page. A project of its own,
     made through the API, so the count is known. */
  test.setTimeout(60_000)
  await login(page)
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('session')!).access_token as string)
  const h = { authorization: `Bearer ${token}`, 'x-api-version': '1', 'content-type': 'application/json' }
  const made = await page.request.post('/api/projects', { headers: h, data: { name: `Long list ${Date.now()}` } })
  expect(made.ok()).toBe(true)
  const { id, slug } = (await made.json()) as { id: string; slug: string }
  const LINKS = 130
  for (let i = 0; i < LINKS; i += 10) {
    await Promise.all(
      Array.from({ length: 10 }, (_, k) =>
        page.request.post(`/api/projects/${id}/files`, {
          headers: h,
          data: { name: `Link ${String(i + k).padStart(3, '0')}`, url: `https://example.com/${i + k}` },
        }),
      ),
    )
  }
  const ws = new URL(page.url()).pathname.split('/')[1]!
  await page.goto(`/${ws}/${slug}/files/links`)
  const rows = page.locator('[data-file]')
  await expect(rows).toHaveCount(100, { timeout: 15_000 })
  /* The first row, where it stands, while the rest arrive below. */
  const first = rows.first()
  const before = (await first.boundingBox())!.y
  const name = await first.innerText()
  await rows.nth(99).scrollIntoViewIfNeeded()
  await expect(rows).toHaveCount(LINKS, { timeout: 15_000 })
  await page.locator('[data-foot]').evaluate((el) => el.scrollTo({ top: 0 }))
  expect(await first.innerText()).toBe(name)
  expect(Math.round((await first.boundingBox())!.y)).toBe(Math.round(before))
  /* Words find a row past the first page too: a browser that has not been
     here holds a hundred, and the same words go to the server. */
  const fresh = await (await browser.newContext({ baseURL: 'http://localhost:5180' })).newPage()
  await login(fresh)
  await fresh.goto(`/${ws}/${slug}/files/links`)
  const theirRows = fresh.locator('[data-file]')
  await expect(theirRows).toHaveCount(100, { timeout: 15_000 })
  await fresh.getByTestId('find-docs').click()
  await fresh.getByTestId('find-docs-field').fill('Link 003')
  await expect(theirRows).toHaveCount(1, { timeout: 15_000 })
  await expect(theirRows.first()).toContainText('Link 003')
})

/* Named, left and opened again at once — the copy this screen kept
   from before said "Untitled", chose it to be typed over, and a click into
   the body wrote "Untitled" back over the name. */
test('a document named and opened again at once keeps its name, and a click into it writes nothing over it', async ({ page }) => {
  await openFiles(page)
  const name = `Named ${Date.now()}`
  await add(page, 'new-document', name)
  const renames: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'PATCH' && /\/api\/files\/[^/]+$/.test(r.url())) {
      const said = r.postDataJSON() as { name?: string } | null
      if (said?.name !== undefined) renames.push(said.name)
    }
  })
  /* Straight back in, and straight into the body. */
  await page.locator('[data-file]').filter({ hasText: name }).first().click()
  const title = page.getByTestId('file-name')
  await expect(title).toHaveValue(name, { timeout: 15_000 })
  await page.locator('.prose-body .ProseMirror').first().click()
  await page.waitForTimeout(800)
  expect(renames).toEqual([])
  await page.reload()
  await expect(page.getByTestId('file-name')).toHaveValue(name, { timeout: 15_000 })
})
