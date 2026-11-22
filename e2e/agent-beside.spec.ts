import { test, expect, type Page } from '@playwright/test'
import { drawnWhole, login } from './helpers.js'

/**
 * A conversation beside the work.
 * Opened from the task an agent is on, it pushes the task aside rather than
 * lying over it, holds the room's own history and line, travels with the
 * window, survives a reload, and gives the width back when closed. Any room
 * opens beside from the Chat column — a project's channel by ⌥, a person's
 * conversation from its row's menu. On a phone the same press opens the room.
 */

type Staged = {
  ws: string
  slug: string
  number: number
  agent: string
  name: string
  room: string
  hello: string
  channel: string
  human: string
}

/** A project of its own, an agent on it, a task given to it, and a word already said to it. */
async function stage(page: Page, n: number): Promise<Staged> {
  const ws = new URL(page.url()).pathname.split('/')[1]!
  const made = await page.evaluate(async (n) => {
    const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
    const h = { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1', 'content-type': 'application/json' }
    const post = async (path: string, body: unknown) => {
      const r = await fetch(`/api${path}`, { method: 'POST', headers: h, body: JSON.stringify(body) })
      if (!r.ok) throw new Error(`${path} ${r.status}`)
      return r.json()
    }
    const p = (await post('/projects', { name: `Beside ${n}` })) as { id: string; slug: string }
    const name = `Pal ${String(n).slice(-5)}`
    const { agent_id } = (await post('/agents', { name, project_ids: [p.id], reach: 'mcp' })) as { agent_id: string }
    const t = (await post(`/projects/${p.id}/tasks`, { title: `Tidy the handler ${n}`, assignee_ids: [agent_id] })) as { id: string }
    const read = (await (await fetch(`/api/tasks/${t.id}`, { headers: h })).json()) as { task: { number: number } }
    const dm = (await post('/conversations/direct', { actor_ids: [agent_id] })) as { id: string }
    const hello = `Morning ${n}`
    await post(`/conversations/${dm.id}/messages`, {
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: hello }] }] },
    })
    /* The project's own channel, and a conversation with a person. */
    const rooms = (await (await fetch('/api/conversations', { headers: h })).json()) as {
      conversations: { id: string; project_id: string | null }[]
    }
    const channel = rooms.conversations.find((c) => c.project_id === p.id)!.id
    const me = (await (await fetch('/api/me', { headers: h })).json()) as { actor: { id: string } }
    const people = (await (await fetch('/api/people', { headers: h })).json()) as { people: { actor_id: string; agent?: boolean }[] }
    const other = people.people.find((x) => !x.agent && x.actor_id !== me.actor.id)!.actor_id
    const human = ((await post('/conversations/direct', { actor_ids: [other] })) as { id: string }).id
    return { slug: p.slug, number: read.task.number, agent: agent_id, name, room: dm.id, hello, channel, human }
  }, n)
  return { ws, ...made }
}

/* Pictures for the task, light and dark, when asked for: `SHOTS_DIR=…`. */
const shot = async (page: Page, name: string) => {
  if (!process.env.SHOTS_DIR) return
  /* The pointer off the work, and a beat after each change of scheme: a
     list's block eases its ground over 120 ms, and a picture taken in the
     same frame caught the light grey on its way to the dark one. */
  await page.mouse.move(800, 4)
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}-light.png` })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}-dark.png` })
  await page.emulateMedia({ colorScheme: 'light' })
}

const widthOf = (page: Page, sel: string) =>
  page
    .locator(sel)
    .first()
    .evaluate((el) => Math.round(el.getBoundingClientRect().width))

test.describe('wide', () => {
  test.use({ viewport: { width: 1600, height: 900 } })

  test('an agent opens beside its task, pushing it aside, and stays through moves and a reload until closed', async ({ page }) => {
    await login(page)
    const s = await stage(page, Date.now())
    await page.goto(`/${s.ws}/${s.slug}/tasks/${s.number}`)
    const who = page.getByTestId('task-assignees')
    await expect(who).toContainText(s.name, { timeout: 15_000 })
    const before = await widthOf(page, 'main')

    /* Drawn whole, with what was said already in it. */
    const panel = page.locator('[data-beside-panel]')
    const heights = await drawnWhole(page, '[data-beside-panel]', () => page.getByTestId('talk-beside').click())
    expect(heights.length).toBe(1)
    await expect(panel.locator('[data-history] [data-message]').filter({ hasText: s.hello })).toBeVisible()
    await expect(panel.locator('[data-dm-head]')).toContainText(s.name)
    expect(new URL(page.url()).searchParams.get('beside')).toBe(s.room)
    expect(new URL(page.url()).pathname).toBe(`/${s.ws}/${s.slug}/tasks/${s.number}`)

    /* The task is still there, narrower by the panel and its gap. */
    await expect(who).toBeVisible()
    await expect.poll(() => widthOf(page, 'main')).toBe(before - 408)
    expect(await widthOf(page, '[data-beside-panel]')).toBe(400)

    /* Said in the panel, it lands there. */
    const line = panel.locator('[data-chat-composer]').first().getByLabel('Message')
    await line.fill('Take this one, please')
    await line.press('Enter')
    await expect(panel.locator('[data-history] [data-message]').filter({ hasText: 'Take this one, please' })).toBeVisible({
      timeout: 15_000,
    })
    await shot(page, 'beside-task')

    /* It travels: back to the list, and the panel comes along. */
    await page.getByTestId('close-task').click()
    await expect(page).toHaveURL(new RegExp(`/${s.slug}/tasks\\?beside=${s.room}$`))
    await expect(panel).toBeVisible()

    /* A reload keeps it, drawn at once, with the conversation in it. */
    await page.reload()
    await expect(panel.locator('[data-history] [data-message]').filter({ hasText: 'Take this one, please' })).toBeVisible({
      timeout: 15_000,
    })
    expect(await widthOf(page, '[data-beside-panel]')).toBe(400)
    await shot(page, 'beside-list')

    /* Closed, the work has its width back and the address forgets it. */
    await panel.getByTestId('beside-close').click()
    await expect(panel).toHaveCount(0)
    await expect.poll(() => widthOf(page, 'main')).toBe(before)
    expect(new URL(page.url()).searchParams.get('beside')).toBeNull()
  })

  test('a person on the task is one press from a conversation beside it, the button on a ground of its own', async ({ page }) => {
    await login(page)
    const ws = new URL(page.url()).pathname.split('/')[1]!
    const made = await page.evaluate(async (n) => {
      const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
      const h = { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1', 'content-type': 'application/json' }
      const get = async (path: string) => (await fetch(`/api${path}`, { headers: h })).json()
      const me = (await get('/me')) as { actor: { id: string } }
      const { projects } = (await get('/projects')) as { projects: { id: string; slug: string; name: string }[] }
      const site = projects.find((p) => p.name === 'Website')!
      const { members } = (await get(`/projects/${site.id}/members`)) as {
        members: { actor_id: string; name: string; agent?: boolean }[]
      }
      const other = members.find((m) => !m.agent && m.actor_id !== me.actor.id)!
      const r = await fetch(`/api/projects/${site.id}/tasks`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ title: `Ask a person ${n}`, assignee_ids: [other.actor_id] }),
      })
      const t = (await r.json()) as { id?: string; task?: { id: string } }
      const read = (await get(`/tasks/${t.id ?? t.task!.id}`)) as { task: { number: number } }
      return { slug: site.slug, number: read.task.number, name: other.name }
    }, Date.now())
    await page.goto(`/${ws}/${made.slug}/tasks/${made.number}`)
    await expect(page.getByTestId('task-assignees')).toContainText(made.name, { timeout: 15_000 })
    const talk = page.getByTestId('talk-beside')
    await expect(talk).toBeVisible()
    /* Outside the assignees' own pressable ground, not inside it. */
    expect(await page.getByTestId('task-assignees').locator('[data-testid="talk-beside"]').count()).toBe(0)
    await talk.click()
    const panel = page.locator('[data-beside-panel]')
    await expect(panel.locator('[data-dm-head]')).toContainText(made.name, { timeout: 15_000 })
  })

  test('any room opens beside from the Chat column: a channel by ⌥, a person from the menu', async ({ page }) => {
    await login(page)
    const s = await stage(page, Date.now())
    await page.goto(`/${s.ws}/${s.slug}/tasks/${s.number}`)
    await expect(page.getByTestId('task-assignees')).toContainText(s.name, { timeout: 15_000 })
    const panel = page.locator('[data-beside-panel]')

    /* ⌥ on the project's channel: beside the task, not in its place. */
    const channel = page.locator(`aside [data-room][data-order="${s.channel}"]`)
    await expect(channel).toBeVisible({ timeout: 15_000 })
    await channel.click({ modifiers: ['Alt'] })
    await expect(panel.locator('[data-room-title]')).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(`/${s.ws}/${s.slug}/tasks/${s.number}`)
    expect(new URL(page.url()).searchParams.get('beside')).toBe(s.channel)
    await expect(page.getByTestId('task-assignees')).toBeVisible()
    await shot(page, 'beside-channel')

    /* It stays across moves: to the list, and to another tool. */
    await page.getByTestId('close-task').click()
    await expect(page).toHaveURL(new RegExp(`/${s.slug}/tasks\\?beside=${s.channel}$`))
    await page.getByTestId('tool-files').click()
    /* Files settles on its kind — `/files/docs` — and keeps the panel. */
    await expect(page).toHaveURL(new RegExp(`/${s.slug}/files/(docs|images|uploads|links)\\?beside=${s.channel}$`))
    await expect(panel.locator('[data-room-title]')).toBeVisible()

    /* The project's own Chat tab on the same room: not twice on one window. */
    await page.getByTestId('tool-messages').click()
    await expect(panel).toHaveCount(0)
    await page.getByTestId('tool-files').click()
    await expect(panel).toBeVisible()

    /* A person's conversation, from its row's menu: the panel moves to it. */
    const human = page.locator(`aside [data-room][data-order="${s.human}"]`)
    await expect(human).toBeVisible()
    await human.click({ button: 'right' })
    await page.getByTestId('room-beside').click()
    await expect(panel.locator('[data-dm-head]')).toBeVisible()
    expect(new URL(page.url()).searchParams.get('beside')).toBe(s.human)
    expect(new URL(page.url()).pathname).toMatch(new RegExp(`^/${s.ws}/${s.slug}/files/(docs|images|uploads|links)$`))

    /* Open in Chat: the room as a screen, and no panel beside it. */
    await panel.getByTestId('beside-full').click()
    await expect(page).toHaveURL(new RegExp(`/chat/${s.human}$`))
    await expect(panel).toHaveCount(0)
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('on a phone the same press opens the conversation as a screen', async ({ page }) => {
    await login(page)
    const s = await stage(page, Date.now())
    await page.goto(`/${s.ws}/${s.slug}/tasks/${s.number}`)
    await page.getByTestId('talk-beside').click()
    await expect(page).toHaveURL(new RegExp(`/chat/${s.room}$`), { timeout: 15_000 })
    await expect(page.locator('[data-beside-panel]')).toHaveCount(0)
    await expect(page.locator('[data-history] [data-message]').filter({ hasText: s.hello })).toBeVisible({ timeout: 15_000 })
  })
})

test.describe('tablet', () => {
  test.use({ viewport: { width: 900, height: 900 } })

  test('below the side column’s width an address carrying the panel does not draw it', async ({ page }) => {
    await login(page)
    const s = await stage(page, Date.now())
    /* An address carrying the panel does not draw it here either. */
    await page.goto(`/${s.ws}/${s.slug}/tasks/${s.number}?beside=${s.channel}`)
    await expect(page.getByTestId('task-assignees')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-beside-panel]')).toHaveCount(0)
  })
})
