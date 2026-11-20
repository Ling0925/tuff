import { test, expect, type Page } from '@playwright/test'
import { login } from './helpers.js'

/**
 * What a phone holds while somebody walks a project's tabs.
 *
 * Safari on an iPhone ends a tab that holds too much ("A problem repeatedly
 * occurred") and ends it again on reload. Two things are asserted here: that
 * opening a project does not decode every picture in its Docs ahead of time
 * (`holdPictures`, which did, for up to two hundred of them), and that going
 * round the tabs again and again leaves the page the size it was after the
 * first round — no screen, listener or node kept behind.
 */

/* A 1600 × 1000 PNG would make the point on a real phone; the test only
   needs to count, so the pictures are small and there are many of them. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAFAAAAAoCAIAAADmAupWAAAATklEQVR4nO3PAQ3AIADAMEAO5hCMmbv4k71VsM197viT9XXA2wzXGa4zXGe4znCd4TrDdYbrDNcZrjNcZ7jOcJ3hOsN1husM1xmuM1z3AL/zAcRgtCDyAAAAAElFTkSuQmCC',
  'base64',
)
const PICTURES = 30
const HELD_AT_MOST = 12

async function api(page: Page) {
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('session')!).access_token as string)
  return { authorization: `Bearer ${token}`, 'x-api-version': '1' }
}

/* Through the API, as the seed would: a phone has no sidebar to make one in. */
async function projectWithPictures(page: Page): Promise<{ at: string; thumbs: Set<string> }> {
  const h = await api(page)
  const made = await page.request.post('/api/projects', {
    headers: { ...h, 'content-type': 'application/json' },
    data: { name: `Phone memory ${Date.now()}` },
  })
  expect(made.ok()).toBe(true)
  const { id, slug } = (await made.json()) as { id: string; slug: string }
  for (let i = 0; i < PICTURES; i++) {
    const up = await page.request.post(`/api/projects/${id}/uploads`, {
      headers: h,
      multipart: { file: { name: `shot-${i}.png`, mimeType: 'image/png', buffer: PNG } },
    })
    expect(up.ok()).toBe(true)
  }
  const files = (await (await page.request.get(`/api/projects/${id}/files`, { headers: h })).json()) as {
    files: { thumb_url: string | null }[]
  }
  /* By path: the signature after it is the reader's and may be renewed. */
  const thumbs = new Set(files.files.map((f) => f.thumb_url?.split('?')[0]).filter((u): u is string => Boolean(u)))
  expect(thumbs.size).toBe(PICTURES)
  const ws = new URL(page.url()).pathname.split('/')[1]!
  return { at: `/${ws}/${slug}/tasks?view=board`, thumbs }
}

test('a project opened on a phone decodes only the first screen of its Docs pictures, not all of them', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)
  const { at, thumbs } = await projectWithPictures(page)
  const asked = new Set<string>()
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname
    if (thumbs.has(path)) asked.add(path)
  })
  await page.goto(at)
  await expect(page.getByTestId('tool-menu')).toBeVisible({ timeout: 20_000 })
  /* The project reads its other tools ahead a quarter of a second after it
     opens; past that, and past an idle moment, is when they were decoded. */
  await page.waitForTimeout(2500)
  expect(asked.size).toBeLessThanOrEqual(HELD_AT_MOST)
})

test('going round a project’s tabs on a phone leaves the page the size the first round left it', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'counted through the Chromium protocol')
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)
  const { at } = await projectWithPictures(page)
  await page.goto(at)
  await expect(page.getByTestId('tool-menu')).toBeVisible({ timeout: 20_000 })
  const cdp = await page.context().newCDPSession(page)
  const count = async () => {
    await cdp.send('HeapProfiler.collectGarbage')
    return cdp.send('Memory.getDOMCounters')
  }
  const round = async () => {
    for (const t of ['messages', 'files', 'activity', 'posts', 'tasks']) {
      await page.getByTestId('tool-menu').click()
      await page.locator(`[data-testid="tool-${t}"]`).last().click()
      await expect(page.getByTestId('tool-menu')).toContainText(
        { messages: 'Chat', files: 'Files', activity: 'Activity', posts: 'Announcements', tasks: 'Tasks' }[t]!,
      )
    }
  }
  await round()
  await page.waitForTimeout(500)
  const first = await count()
  for (let i = 0; i < 8; i++) await round()
  await page.waitForTimeout(500)
  const last = await count()
  /* A little room for a socket's beat redrawing a row; a screen or a
     listener per visit kept behind is eight of them, far past this. */
  expect(last.documents).toBe(first.documents)
  expect(last.nodes).toBeLessThanOrEqual(first.nodes * 1.1 + 200)
  expect(last.jsEventListeners).toBeLessThanOrEqual(first.jsEventListeners * 1.1 + 50)
})
