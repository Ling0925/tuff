import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page, type Request } from '@playwright/test'

export const PASSWORD = 'correct-horse-battery-staple'

/** The writes each signed-in page has sent — `login`, `settleThenReload`. */
const writes = new WeakMap<Page, { open: Set<Request>; done: { url: string; at: number }[] }>()

/**
 * An authenticator's code for a secret, now — RFC 6238, written out.
 * `ahead` steps into the future: a code is taken once, so a second proof
 * inside the same thirty seconds uses the next one, as a person would wait
 * for it.
 */
export function totp(secret: string, ahead = 0): string {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) bits += B32.indexOf(ch).toString(2).padStart(5, '0')
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30) + ahead))
  const mac = createHmac('sha1', Buffer.from(bytes)).update(counter).digest()
  const offset = mac[mac.length - 1]! & 0x0f
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

/**
 * Which seeded studio this spec signs into.
 *
 * The suite used to be one person, and sixty tests in ninety seconds is more
 * requests than one person is allowed in a window — so the server answered
 * 429, a screen came up empty, and a test failed on an assertion three steps
 * later. It read as flakiness for weeks because nothing printed the refusal.
 *
 * The ceiling is the product working. What was wrong is the harness. The seed
 * makes several identical studios and each spec file takes one of them, so
 * the requests are spread across as many allowances as there are studios.
 */
export function account(): string {
  const all = (process.env.E2E_EMAIL ?? '').split(',').filter(Boolean)
  if (all.length <= 1) return all[0] ?? ''
  /*
   * By test, not by file.
   *
   * Spread by file it was the same account for every test in a spec, and
   * one spec here holds sixty of them — so running that file alone put
   * sixty tests' worth of requests through one person's allowance and the
   * server refused some, exactly as it should. The failure then landed on
   * whatever assertion came next, which is how this read as flakiness for
   * weeks the last time.
   *
   * The ceiling is the product working. What was wrong is a harness that
   * pretends a suite is one person, and it pretended less in one direction
   * than the other.
   */
  /*
   * And never one another test is using at the same moment.
   *
   * The tests run side by side now, and two of them in one studio at once
   * read each other's work: a task appeared in the middle of a run being
   * shift-selected, a document went past the end of a list. Each worker
   * owns its own share of the studios — every `workers`th, from its own
   * index — and spreads its tests across those by name, as before.
   */
  const { parallelIndex, config } = test.info()
  const workers = Math.max(1, config.workers)
  /* The first studio is the operator's (`login(page, 'operator')`), and an
     operator's test can run beside anybody's: nobody else is given it. */
  const others = all.length > workers ? all.slice(1) : all
  const mine = others.filter((_, i) => i % workers === parallelIndex)
  const pool = mine.length ? mine : others
  const name = test.info().titlePath.join(' › ')
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 100_000
  return pool[hash % pool.length]!
}

export async function login(page: Page, who: 'anyone' | 'operator' = 'anyone') {
  /** When each request went out, so one that never comes back can say so. */
  const started = new Map<Request, number>()
  /* Anything the server refused, named out loud. A browser test that fails on
     an assertion three steps later tells you the screen is wrong; this tells
     you whether the screen was ever given the data. */
  page.on('response', (r) => {
    if (r.status() >= 400) {
      console.log(`  ✗ ${r.request().method()} ${r.status()} ${r.url().replace('http://localhost:5180', '')}`)
    }
  })
  page.on('pageerror', (e) => console.log('  ✗ page error:', String(e).slice(0, 200)))
  /*
   * A request that never answered at all.
   *
   * The response hook above only sees replies, so a connection that is reset
   * or hangs until the browser gives up prints nothing — and what the test
   * then reports is whatever assertion came next, fifteen seconds later,
   * with no sign that the screen was never given an answer. Twenty-three CI
   * failures read as "the dialog did not close" when the truth was that the
   * POST behind it never came back.
   */
  page.on('requestfailed', (r) => {
    started.delete(r)
    console.log(
      `  ✗ ${r.method()} — no answer — ${r.url().replace('http://localhost:5180', '')}` + ` (${r.failure()?.errorText ?? 'unknown'})`,
    )
  })

  /*
   * And the third case, which is the one that was actually happening.
   *
   * A request has three ends, not two: answered, refused, and still going.
   * The first two print above; the third printed nothing, so a POST that sat
   * open was reported fifteen seconds later as "the dialog did not close" —
   * the assertion that came next, in a different file, about a different
   * thing. Twice I read that symptom and twice it was not the dialog.
   *
   * Said once per request, while it is still happening, so the line lands
   * beside the test that is waiting rather than in a summary afterwards.
   */
  page.on('request', (r) => started.set(r, Date.now()))
  page.on('requestfinished', (r) => started.delete(r))
  const tick = setInterval(() => {
    const now = Date.now()
    for (const [r, at] of started) {
      if (now - at < 5_000) continue
      started.delete(r)
      console.log(
        `  ✗ ${r.method()} — still waiting after ${Math.round((now - at) / 1000)}s —` + ` ${r.url().replace('http://localhost:5180', '')}`,
      )
    }
  }, 2_000)
  page.on('close', () => clearInterval(tick))
  /* Every write this page sends, for `settleThenReload` to wait on. */
  const w = { open: new Set<Request>(), done: [] as { url: string; at: number }[] }
  writes.set(page, w)
  page.on('request', (r) => {
    if (r.method() !== 'GET' && r.url().includes('/api/')) w.open.add(r)
  })
  const landed = (r: Request) => {
    if (w.open.delete(r)) w.done.push({ url: r.url(), at: Date.now() })
  }
  page.on('requestfinished', landed)
  page.on('requestfailed', landed)
  /* The room's one offer of notifications already made and put away: it
     stands over the newest messages, and every test that writes in a room
     would be writing past it. Its own test clears this. */
  await page.addInitScript(() => {
    /* Every frame runs this, a sandboxed one too, whose storage is refused. */
    try {
      if (!sessionStorage.getItem('push-offer-test')) localStorage.setItem('push-offered', 'e2e')
    } catch {
      // A frame with no storage has no room to offer anything in.
    }
  })
  /* `/signin`: `/` is the landing for somebody with no session. */
  await page.goto('/signin')
  /* The seed makes the first studio's owner an operator and nobody else. */
  const email = who === 'operator' ? (process.env.E2E_EMAIL ?? '').split(',')[0]! : account()
  await page.getByPlaceholder('email').fill(email)
  await page.getByPlaceholder('password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  /*
   * The sidebar on a wide screen, the button that opens it on a narrow one.
   *
   * Waiting on the sidebar alone asserted a laptop, and every test at phone
   * width failed at the door. Asked of the viewport rather than written as
   * "either": both are in the document at every width — one of them is
   * simply not on the screen — so "either" resolves to the wrong one and
   * waits for it for ever. `docs/specs/narrow.md`.
   */
  /* And on a phone, the tabs along the foot. */
  const width = page.viewportSize()?.width ?? 1280
  await expect(page.getByTestId(width >= 1024 ? 'nav-my' : width >= 640 ? 'open-drawer' : 'tab-my')).toBeVisible({ timeout: 30_000 })
}

/**
 * The workspace's settings, the way a person reaches them.
 *
 * Behind your own face in the bar, with the rest of what is about the
 * window rather than a place in it. It was the
 * last row of the sidebar, and twelve tests pressed it there.
 */
export async function openSettings(page: Page) {
  /* The workspace's — its switches, webhooks — behind its name, apart
     from the person's own (`openAccount`). */
  await page.getByTestId('workspace-menu').first().click()
  await page.getByTestId('workspace-settings').click()
}

/** The person's own settings, behind their face in the bar. */
export async function openAccount(page: Page) {
  await page.getByTestId('my-presence').click()
  await page.getByTestId('nav-account').click()
}

/**
 * Open a project from the sidebar and wait for its tabs.
 *
 * The sidebar caps its sections, so a project can be behind "more" — which is
 * the point of the cap and also the reason this has to look there. It is what
 * a person does.
 */
export async function openProject(page: Page, name: string) {
  // The sidebar is still filling right after sign-in; looking before it has
  // any rows finds nothing and concludes the project is behind the cap.
  await page.locator('aside [data-project]').first().waitFor({ timeout: 30_000 })

  const row = page.locator('aside [data-project]').filter({ hasText: name })
  /* A project made a moment ago may not be drawn yet, and that is not the
     same as being behind the cap: looking once and pressing "more" folded
     a list that was about to show it. */
  await row
    .first()
    .waitFor({ timeout: 3_000 })
    .catch(() => {})
  if ((await row.count()) === 0) {
    const more = page.getByTestId('show-more').first()
    if (await more.count()) {
      await more.click()
      await expect(row.first()).toBeVisible({ timeout: 15_000 })
    }
  }
  await row.first().click()
  await expect(page.getByTestId('tool-tasks')).toBeVisible({ timeout: 30_000 })
}

/**
 * Make a thing the way a person does: press the button, then type.
 *
 * Written once because the shape is now the same in every tool — a control
 * that says what it makes, which becomes the field when you use it. The tests
 * used to reach straight for a placeholder, which is exactly why nobody
 * noticed there was no button to reach for.
 */
/**
 * Draw the work as a list or as a board.
 *
 * The switch is one of the View's answers, and the View stands beside the
 * list but is a menu on the board — the board needs its width for columns.
 * So going is one press and coming back is open-then-press. Written once, so
 * the asymmetry lives in one place instead of at every call.
 */
export async function shownAs(page: Page, which: 'list' | 'board') {
  /* The two drawings are a pair of chips on the bar, and `view-list` named
     the Everything chip until the lists moved into the panel — so the
     list drawing has a handle of its own now. */
  const pick = page.getByTestId(which === 'list' ? 'view-list-mode' : 'view-board')
  if (!(await pick.isVisible().catch(() => false))) {
    await page.getByTestId('view-menu').click()
  }
  await pick.click()
}

/**
 * Narrow to one list, or to every one of them.
 *
 * It was a row of chips across the top of the screen — Everything, Backlog,
 * Todo — and it is a field in the View panel now, beside the other five
 * answers about how the work is being looked at.
 */
export async function narrowTo(page: Page, name: string | null) {
  await viewAnswers(page, true)
  const field = page.getByTestId('view-which-list')
  await expect(field).toBeVisible({ timeout: 10_000 })
  await field.selectOption({ label: name ?? 'All lists' })
}

/**
 * Move a task to a list, the way a person does: press its ring, pick.
 *
 * The ring was a checkbox and this was `.check()` — one press, done or not
 * done, with the lists in between reachable only by dragging a card on the
 * board. The list is the status now, so the ring opens the list of them.
 */
export async function setStatus(page: Page, title: string, to: string) {
  const row = page.locator('[data-task]').filter({ hasText: title }).first()
  await row.locator('[data-status]').click()
  await page.locator('[data-status-menu] [role="menuitem"]').filter({ hasText: to }).click()
}

/** Which list a task is in, read off the ring that shows it. */
export function statusOf(page: Page, title: string) {
  return page.locator('[data-task]').filter({ hasText: title }).first().locator('[data-status]')
}

/**
 * Make the view's answers readable, or put them away.
 *
 * One button, two shapes: where there is room beside the work it is a switch
 * for the standing panel, and where there is not it opens a menu. Asked for
 * by what should be true afterwards rather than by pressing and hoping —
 * pressing it when the panel is already open shuts it.
 */
export async function viewAnswers(page: Page, want: boolean) {
  const button = page.getByTestId('view-menu')
  /* The screen first. Asked straight after a reload, "is the panel
     showing?" was answered before anything was drawn — no — and the press
     that followed shut a panel this machine had left open. */
  await expect(button).toBeVisible({ timeout: 15_000 })
  const showing = await page
    .getByTestId('view-who')
    .isVisible()
    .catch(() => false)
  if (showing === want) return
  await button.click()
  if (want) await expect(page.getByTestId('view-who')).toBeVisible({ timeout: 10_000 })
  else await expect(page.getByTestId('view-who')).toBeHidden({ timeout: 10_000 })
}

export async function add(page: Page, label: string, text: string) {
  /* A document opens in the editor at once, its name chosen to be typed
     over — `docs/specs/docs.md`. Named there, and back to the list. */
  if (label === 'new-document') {
    // Behind Docs' one plus, beside a file and a link.
    await page.getByTestId('docs-add').click()
    await page.getByTestId('create-new-document').click()
    const name = page.getByTestId('file-name')
    await expect(name).toHaveValue('Untitled', { timeout: 15_000 })
    const saved = page.waitForResponse((r) => r.url().includes('/api/files/') && r.request().method() === 'PATCH')
    await name.fill(text)
    // Leaving the field is what saves it; Enter would also walk into the body.
    await name.evaluate((el) => (el as HTMLElement).blur())
    await saved
    await page.goBack()
    await expect(page.locator('[data-file]').filter({ hasText: text }).first()).toBeVisible({ timeout: 15_000 })
    return
  }
  await page.getByTestId(`create-${label}`).click()
  const field = page.getByTestId(`draft-${label}`)
  const dialog = page.getByTestId('new-title')
  await expect(field.or(dialog)).toBeVisible({ timeout: 15_000 })
  // Two things a button opens now: a field, for the things with one thing to
  // say, and a dialog for a task, a list and a project. A person presses the
  // same button either way, so the helper takes the same call either way.
  if (await field.count()) {
    await field.fill(text)
    await field.press('Enter')
    return
  }
  await made(dialog, text)
  // A task leaves it open on purpose, and a modal over the screen is a modal
  // over everything the test is about to look at.
  await close(page)
}

/**
 * Make several things through the dialog, the way a handful is made.
 *
 * The dialog keeps itself open after a task and closes after a list or a
 * project, so this waits for whichever happened rather than assuming, and
 * presses the button again if it is no longer there.
 */
export async function make(page: Page, opener: Locator, ...titles: string[]) {
  const title = page.getByTestId('new-title')
  for (const t of titles) {
    if ((await title.count()) === 0) await opener.click()
    await expect(title).toBeVisible({ timeout: 15_000 })
    await made(title, t)
  }
  await close(page)
}

/**
 * Type it, create it, and wait for the dialog to go.
 *
 * It used to poll "gone, or else the title is empty", because the dialog
 * stayed open after a task and closed after a list. That switch is gone and
 * the dialog always closes now — but the two-armed check stayed, and it is
 * the reason nineteen tests failed on a slow machine.
 *
 * `count()` said one, and by the time `inputValue()` ran the dialog was
 * unmounting. `inputValue()` auto-waits for its element with no timeout of
 * its own, so the predicate never returned, the poll gave up at fifteen
 * seconds, and what it reported was "the dialog did not close" about a
 * dialog that had closed and a thing that had been made. Three rounds went
 * into that sentence before the harness was asked to say what it actually
 * saw: `title "(gone)", Create not on screen`.
 *
 * A web-first assertion instead. It polls inside Playwright, it cannot hang
 * on an element that is going away, and it says the one thing that is now
 * true.
 */
async function made(title: Locator, text: string) {
  await title.fill(text)
  await title.press('Enter')
  await expect(title).toHaveCount(0, { timeout: 15_000 })
  await backFromMade(title.page())
}

/**
 * Back to the list a task was made from.
 *
 * A task opens once it is made — and nearly every
 * test that makes one goes on to look at the list it went into. Those that
 * are about the opening say so themselves; the helpers put the list back,
 * as the back button would.
 */
export async function backFromMade(page: Page) {
  if (!/\/tasks\/[^/]+$/.test(new URL(page.url()).pathname)) return
  await expect(page.getByTestId('task-title')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('close-task').first().click()
  await expect(page.getByTestId('task-title')).toHaveCount(0, { timeout: 15_000 })
}

/** Shut it, if it is still open — which it is after a task, on purpose. */
/**
 * Shut the create dialog, whether or not it has already shut itself.
 *
 * It closes on its own once something is made, so this is only for the cases
 * where nothing was. Waited on rather than counted: `count()` catches it
 * mid-unmount, and the click that follows lands on a button that is being
 * detached — which reads as a hung test and is a race.
 */
export async function close(page: Page) {
  const title = page.getByTestId('new-title')
  try {
    await expect(title).toHaveCount(0, { timeout: 2000 })
    return
  } catch {
    await page.getByTestId('dialog-close').click()
  }
  await expect(title).toHaveCount(0)
}

/**
 * Reload, but not before the server has heard what was just done.
 *
 * Every write in this product is optimistic: the screen moves first and the
 * request follows. A reload in that window cancels the request, and the test
 * then blames the server for a change it never received. Waiting on the
 * screen is not enough — the screen already moved.
 */
export async function settleThenReload(page: Page, path: string) {
  const w = writes.get(page)
  /*
   * Until the writes to `path` have landed and none has been sent for half
   * a second — judged by what this page has sent and heard back, not by
   * waiting for the next answer.
   *
   * It waited for the next answer, and when that answer had come before
   * the wait began — a fast server, or a slow browser — it sat out its
   * whole fifteen seconds and reloaded anyway: half of a thirty-second test
   * on CI, where it timed out several tests a day.
   */
  const mine = (url: string) => url.includes(path)
  await expect
    .poll(
      () => {
        if (!w) return 'not signed in by login()'
        if ([...w.open].some((r) => mine(r.url()))) return 'sending'
        const last = w.done.filter((d) => mine(d.url)).at(-1)
        if (!last) return 'nothing sent'
        return Date.now() - last.at >= 500 ? 'landed' : 'just landed'
      },
      { timeout: 15_000, intervals: [100] },
    )
    .toBe('landed')
    .catch(() => {
      // Nothing to wait for: the assertion after the reload is what decides.
    })
  await page.reload()
}

/**
 * Make a list where lists are kept, which is the project's settings.
 *
 * There is no New list on the tasks bar any more. Everything else about a
 * list is on that row — its name, its mark, its colour, taking it away — and
 * a button that only makes one, somewhere else, was the odd half of a pair.
 *
 * It leaves the screen on Tasks, because that is where the caller was going.
 */
export async function makeList(page: Page, name: string) {
  await page.getByTestId('tool-settings').click()
  await page.getByTestId('create-add-a-list').click()
  const field = page.getByTestId('draft-add-a-list')
  await expect(field).toBeVisible({ timeout: 15_000 })
  await field.fill(name)
  await field.press('Enter')
  await expect(page.locator(`[data-list-row][data-said="${name}"]`)).toHaveCount(1, {
    timeout: 15_000,
  })
  await page.getByTestId('tool-tasks').click()
}

/**
 * A date picked the way a person picks it: the field opens the product's
 * calendar, the months are walked to the one asked for, and the day pressed.
 * The dates were the browser's own inputs and the tests typed into them;
 * there is no field to type into now.
 */
export async function pickDate(page: Page, testId: string, iso: string) {
  await page.getByTestId(testId).click()
  const menu = page.locator('[data-due-menu]')
  await expect(menu).toBeVisible({ timeout: 10_000 })
  const day = menu.locator(`[data-day="${iso}"]`)
  const [y, m] = iso.split('-').map(Number) as [number, number]
  for (let i = 0; i < 240 && !(await day.count()); i++) {
    const shown = await menu.locator('[data-day]').nth(10).getAttribute('data-day')
    const [sy, sm] = (shown ?? iso).split('-').map(Number) as [number, number]
    const later = y * 12 + m > sy * 12 + sm
    await menu.getByRole('button', { name: later ? 'Next month' : 'Previous month' }).click()
  }
  await day.click()
  await expect(menu).toHaveCount(0)
}

/**
 * A finger drawn up the screen: down at `at`, up by `distance`, lifted.
 *
 * Touch events one at a time, a frame apart, which is what a finger is.
 * `Input.synthesizeScrollGesture` did the same on a Mac and nothing at all
 * on Linux — the browser CI runs — so two tests about scrolling under a
 * finger failed there every day with the list never having moved.
 * A drag longer than the screen is laid down in strokes, each one starting
 * where a finger would land again.
 */
export async function swipeUp(page: Page, at: { x: number; y: number }, distance: number) {
  const cdp = await page.context().newCDPSession(page)
  const top = 40
  let left = distance
  try {
    while (left > 0) {
      const stroke = Math.min(left, at.y - top)
      if (stroke <= 0) break
      const steps = Math.max(6, Math.round(stroke / 40))
      const point = (y: number) => [{ x: Math.round(at.x), y: Math.round(y), id: 1 }]
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(at.y) })
      for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(at.y - (stroke * i) / steps) })
        await page.waitForTimeout(16)
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      left -= stroke
    }
  } finally {
    await cdp.detach()
  }
}

/**
 * Where something is once it has stopped arriving.
 *
 * A panel slides in, and a box read in the middle of the slide is a place
 * the panel is about to leave: a finger put there lands on nothing, or off
 * the screen altogether ("Position out of bounds"). Asked until two reads a
 * frame apart agree.
 */
export async function stillBox(target: Locator) {
  let last = ''
  let box: { x: number; y: number; width: number; height: number } | null = null
  await expect
    .poll(
      async () => {
        await target.page().evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))))
        box = await target.boundingBox()
        const now = JSON.stringify(box)
        const same = box !== null && now === last
        last = now
        return same
      },
      { timeout: 10_000, intervals: [50] },
    )
    .toBe(true)
  return box!
}

/**
 * Whether a surface opens whole.
 *
 * Starts watching before `open` runs, records the surface's height on every
 * frame for `ms` after it first appears, and answers with each height it
 * had. One height is a window drawn with what goes in it; two or more is a
 * frame that filled in under the reader.
 */
export async function drawnWhole(page: Page, selector: string, open: () => Promise<void>, ms = 1200): Promise<number[]> {
  await page.evaluate(
    ([sel, span]) => {
      const w = window as unknown as { heights: number[] }
      w.heights = []
      let first = 0
      const look = (t: number) => {
        const el = document.querySelector(sel)
        const h = el ? Math.round(el.getBoundingClientRect().height) : 0
        if (h > 0) {
          if (!first) first = t
          if (w.heights[w.heights.length - 1] !== h) w.heights.push(h)
        }
        if (!first || t - first < span) requestAnimationFrame(look)
      }
      requestAnimationFrame(look)
    },
    [selector, ms] as const,
  )
  await open()
  await page.waitForTimeout(ms + 300)
  return page.evaluate(() => (window as unknown as { heights: number[] }).heights)
}

/**
 * Whether the server under test sends no mail: a server of one's own with
 * none set up, which `GET /auth/providers` says as `no_mail` (always false
 * on the service). There an invitation's link is handed over by hand, and
 * no confirmation or reset letter goes anywhere — as it should, so a test
 * that follows a letter skips itself there and says why, rather than
 * waiting ten seconds for a letter that was never going to be written.
 * `invite-by-hand.spec.ts` is the test of that server, and runs only there.
 * Asked once per worker: the answer does not change during a run.
 */
let mailless: Promise<boolean> | null = null
export function withoutMail(): Promise<boolean> {
  mailless ??= fetch(new URL('/auth/providers', test.info().project.use.baseURL ?? 'http://localhost:5180'))
    .then((r) => r.json() as Promise<{ no_mail?: boolean }>)
    .then((b) => b.no_mail === true)
  return mailless
}

/** What a test that follows a letter says when it skips itself — `withoutMail`. */
export const NEEDS_MAIL = 'follows a letter, and this server has no mail set up'

/**
 * The link in the last letter to an address — `/reset/…`, `/verify/…` —
 * read from the file the server writes its letters to when `pnpm check` or
 * CI starts it (`MAIL_OUTBOX_FILE`, `server/src/mail.ts`). Waited for: the
 * letter is sent after the answer.
 */
export async function letterTo(email: string, path: string): Promise<string> {
  const file = process.env.MAIL_OUTBOX_FILE ?? '/tmp/tuff-outbox.jsonl'
  const find = new RegExp(`/${path}/([^\\s"<]+)`)
  let link: string | null = null
  await expect
    .poll(
      async () => {
        const lines = (await readFile(file, 'utf8').catch(() => '')).split('\n').filter(Boolean)
        const last = lines
          .map((l) => JSON.parse(l) as { to: string; text: string })
          .filter((m) => m.to === email)
          .at(-1)
        const found = last && find.exec(last.text)
        link = found ? `/${path}/${found[1]}` : null
        return link
      },
      { timeout: 10_000, message: `a letter to ${email} with a /${path}/ link, in ${file}` },
    )
    .not.toBeNull()
  return link!
}

/**
 * Where an invitation to an address is followed from: its letter, or the
 * link the invitation's own answer carried (`token`), which is how a
 * server with no mail hands it over instead of sending it
 * (`invite-by-hand.spec.ts`). The service answers an invitation it mailed
 * with no token. Either way, whoever follows it proves the address it was
 * for, so a test that only needs somebody in by an invitation runs on both.
 */
export async function invitationTo(email: string, token: string | undefined): Promise<string> {
  return token ? `/invite/${token}` : letterTo(email, 'invite')
}

/**
 * The stored body of the document open on this page, as the API answers it.
 *
 * A document written together saves over its socket, not through `PATCH`,
 * so a test that waited for that request
 * waited for something that no longer happens. This asks the server for
 * what it kept, by the address the page is at.
 */
export async function storedDoc(page: Page): Promise<{ id: string; body: unknown; version: number }> {
  return page.evaluate(async () => {
    const [, , slug, , number] = location.pathname.split('/')
    const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
    const headers = { 'x-api-version': '1', authorization: `Bearer ${s.access_token}` }
    const { projects } = (await (await fetch('/api/projects', { headers })).json()) as { projects: { id: string; slug: string }[] }
    const p = projects.find((x) => x.slug === decodeURIComponent(slug ?? ''))
    if (!p) throw new Error(`no project at ${location.pathname}`)
    const { files } = (await (await fetch(`/api/projects/${p.id}/files`, { headers })).json()) as {
      files: { id: string; number: number }[]
    }
    /* A document just made is at its id until its number is known. */
    const f = files.find((r) => String(r.number) === number || r.id === number)
    if (!f) throw new Error(`no file at ${location.pathname}: ${files.map((r) => r.number).join(',')}`)
    const { file } = (await (await fetch(`/api/files/${f.id}`, { headers })).json()) as {
      file: { id: string; body: unknown; version: number }
    }
    return file
  })
}

/** Until the stored body of the open document holds every one of `words`. */
export async function docKept(page: Page, ...words: string[]): Promise<void> {
  await expect
    .poll(
      async () => {
        const said = JSON.stringify((await storedDoc(page).catch((e) => ({ body: String(e) })))?.body ?? null)
        return words.filter((w) => !said.includes(w))
      },
      { timeout: 15_000, intervals: [250] },
    )
    .toEqual([])
}

/**
 * A list read to its end. A column or a band
 * reads its first fifty and the rest as it is scrolled near, so a test that
 * wants every card of a long one scrolls down until they are all there, and
 * then back to the top where it found it.
 */
export async function readToEnd(scroller: Locator, rows: Locator, n: number) {
  await expect
    .poll(
      async () => {
        await scroller.evaluate((el) => {
          el.scrollTop = el.scrollHeight
        })
        return rows.count()
      },
      { timeout: 30_000 },
    )
    .toBe(n)
  await scroller.evaluate((el) => {
    el.scrollTop = 0
  })
}
