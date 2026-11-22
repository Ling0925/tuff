import { expect, test, type Page } from '@playwright/test'
import { drawnWhole, login, openProject } from './helpers.js'

/*
 * Blocks that arrived after the screen around them,
 *
 * Invisible here, where the server answers in a few milliseconds; a block
 * popping in on the deployment, where a second request lands two or three
 * hundred milliseconds after the first. So every test here puts that
 * distance back — each `/api` answer held for 200 ms — and asks of a
 * surface what somebody on the deployment sees: that it is there whole on
 * its first frame, and does not grow after it.
 */

/* 200, not more: a screen waits up to 400 ms for what it needs and then
   draws what it has, and four browsers beside the server here can add a
   hundred of their own to an answer — at 300 that left too little room,
   and the test failed on the deliberate fallback rather than on a fault. */
const SLOW = 200

async function slow(page: Page) {
  await page.route('**/api/**', async (r) => {
    await new Promise((res) => setTimeout(res, SLOW))
    await r.continue().catch(() => {})
  })
}

/** A call to the API as the signed-in person, from inside the page. */
async function call<T>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  return page.evaluate(
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
}

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

/**
 * How many of `wanted` were on the screen on the first frame `anchor` was —
 * a block that comes later is a block that was not there then.
 */
async function onFirstFrame(page: Page, anchor: string, wanted: string, open: () => Promise<void>): Promise<number> {
  await page.evaluate(
    ([anchor, wanted]) => {
      const w = window as unknown as { firstCount: number | null }
      w.firstCount = null
      const look = () => {
        const a = document.querySelector(anchor)
        if (a && a.getBoundingClientRect().height > 0) {
          w.firstCount = document.querySelectorAll(wanted).length
          return
        }
        requestAnimationFrame(look)
      }
      requestAnimationFrame(look)
    },
    [anchor, wanted] as const,
  )
  await open()
  await expect.poll(() => page.evaluate(() => (window as unknown as { firstCount: number | null }).firstCount)).not.toBeNull()
  return (await page.evaluate(() => (window as unknown as { firstCount: number | null }).firstCount))!
}

/** Each count of `rows` seen, frame by frame, once the first is drawn. */
async function rowsSeen(page: Page, rows: string, open: () => Promise<void>, ms = 1200): Promise<number[]> {
  await page.evaluate(
    ([rows, span]) => {
      const w = window as unknown as { counts: number[] }
      w.counts = []
      let first = 0
      const look = (t: number) => {
        const n = document.querySelectorAll(rows).length
        if (n > 0) {
          if (!first) first = t
          if (w.counts[w.counts.length - 1] !== n) w.counts.push(n)
        }
        if (!first || t - first < span) requestAnimationFrame(look)
      }
      requestAnimationFrame(look)
    },
    [rows, ms] as const,
  )
  await open()
  await page.waitForTimeout(ms + 300)
  return page.evaluate(() => (window as unknown as { counts: number[] }).counts)
}

const go = (page: Page, path: string) =>
  page.evaluate((p) => {
    history.pushState(null, '', p)
    dispatchEvent(new PopStateEvent('popstate'))
  }, path)

test('a task opened by its link on a slow network is drawn with its comments, not before them', async ({ page }) => {
  await login(page)
  const { projects } = await call<{ projects: { id: string; name: string }[] }>(page, 'GET', '/projects')
  const site = projects.find((p) => p.name === 'Website')!
  const title = `Whole ${Date.now()}`
  const make = async (title: string, said: string[]) => {
    const made = await call<{ id: string; number: number }>(page, 'POST', `/projects/${site.id}/tasks`, { title, body: doc('Its words.') })
    for (const s of said) await call(page, 'POST', `/tasks/${made.id}/comments`, { body: doc(s) })
    return made
  }
  const first = await make(title, ['First', 'Second', 'Third'])
  const second = await make(`${title} again`, ['Only one'])
  /* The list behind draws the rows — and seeds each task's screen from
     them, the title without the words or the comments. */
  await openProject(page, 'Website')
  await expect(page.getByText(title, { exact: true })).toBeVisible()
  await slow(page)
  const at = (n: number) => new URL(page.url()).pathname.replace(/\/tasks.*$/, `/tasks/${n}`)

  // It does not grow once it is there.
  const heights = await drawnWhole(page, '[data-task-body]', () => go(page, at(first.number)))
  expect(heights.length, `the task grew under the reader: ${heights.join(' → ')}`).toBe(1)
  await expect(page.locator('[data-comment]')).toHaveCount(3)

  // And its comments are on its first frame.
  await go(page, new URL(page.url()).pathname.replace(/\/tasks.*$/, '/tasks'))
  await expect(page.getByText(`${title} again`)).toBeVisible()
  const comments = await onFirstFrame(page, '[data-task-body]', '[data-comment]', () => go(page, at(second.number)))
  expect(comments, 'the comments came after the task').toBe(1)
})

test('Members on a slow network opens with its agents and its people together', async ({ page }) => {
  await login(page)
  const { projects } = await call<{ projects: { id: string; name: string }[] }>(page, 'GET', '/projects')
  const site = projects.find((p) => p.name === 'Website')!
  const name = `Whole agent ${Date.now()}`
  const agent = await call<{ agent_id?: string }>(page, 'POST', '/agents', { name, project_ids: [site.id], reach: 'mcp' })
  expect(agent.agent_id, 'the agent was made').toBeTruthy()
  // Nothing about Members remembered: the first visit, on the deployment.
  await page.reload()
  await expect(page.getByTestId('nav-members')).toBeVisible({ timeout: 30_000 })
  await slow(page)
  const counts = await rowsSeen(page, '[data-members-column] [data-row]', async () => {
    await page.getByTestId('nav-members').click()
  })
  expect(counts.length, `the column grew a group under the people: ${counts.join(' → ')}`).toBe(1)
  await expect(page.locator('[data-members-column] [data-agent]').filter({ hasText: name })).toBeVisible()
})

/* And at full speed, the way it is opened most: the agents were read ahead
   and known, but the list the column draws them from was taken when the
   shell first drew, so they arrived a render after the people. */
test('Members opened for the first time draws its agents with its people, at full speed', async ({ page }) => {
  await login(page)
  const { projects } = await call<{ projects: { id: string; name: string }[] }>(page, 'GET', '/projects')
  const site = projects.find((p) => p.name === 'Website')!
  const name = `Whole agent fast ${Date.now()}`
  const agent = await call<{ agent_id?: string }>(page, 'POST', '/agents', { name, project_ids: [site.id], reach: 'mcp' })
  expect(agent.agent_id, 'the agent was made').toBeTruthy()
  await page.reload()
  await expect(page.getByTestId('nav-members')).toBeVisible({ timeout: 30_000 })
  const counts = await rowsSeen(page, '[data-members-column] [data-row]', async () => {
    await page.getByTestId('nav-members').click()
  })
  expect(counts.length, `the column grew a group under the people: ${counts.join(' → ')}`).toBe(1)
  await expect(page.locator('[data-members-column] [data-agent]').filter({ hasText: name })).toBeVisible()
})

test('a thread on a slow network opens with its replies in it', async ({ page }) => {
  await login(page)
  const { conversations } = await call<{ conversations: { id: string; name: string | null; kind?: string; project_id?: string | null }[] }>(
    page,
    'GET',
    '/conversations',
  )
  const room = conversations.find((c) => c.project_id)!
  const said = `Whole thread ${Date.now()}`
  const head = await call<{ id: string }>(page, 'POST', `/conversations/${room.id}/messages`, { body: doc(said) })
  for (const r of ['One', 'Two', 'Three']) {
    await call(page, 'POST', `/conversations/${room.id}/messages`, { body: doc(`${r} ${said}`), parent_id: head.id })
  }
  await go(page, `/${new URL(page.url()).pathname.split('/')[1]}/chat/${room.id}`)
  const message = page.locator('[data-message]').filter({ hasText: said }).first()
  await expect(message.getByTestId('open-thread')).toBeVisible({ timeout: 15_000 })
  await slow(page)
  const replies = await onFirstFrame(page, '[data-thread-history]', '[data-thread-history] [data-message]', () =>
    message.getByTestId('open-thread').click(),
  )
  // The message it hangs off and its three replies.
  expect(replies, 'the replies came after the thread').toBe(4)
})
