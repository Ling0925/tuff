import { createRequire } from 'node:module'
import { test, expect, type Page } from '@playwright/test'
import { login, openProject } from './helpers.js'

/*
 * An agent called in a thread is seen working there,
 * Asked in a thread to look
 * at the Triage, a Grok agent worked three minutes and nothing showed it
 * had taken it up. Who sees it and what clears it on the server are
 * `server/test/agent-working.test.ts`.
 */

/* The worker is not running beside the browser, so the wake is settled
   here as the worker settles it: the delivery marked sent, the wake
   recorded, the room told. As the tables' owner, as the server's tests. */
const require = createRequire(new URL('../server/package.json', import.meta.url))
const postgres = require('postgres') as typeof import('postgres').default

async function wake(agent: string) {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
  try {
    const [d] = await sql<{ id: string }[]>`
      select d.id from webhook_delivery d join webhook w on w.id = d.webhook_id
      where w.agent_id = ${agent} and d.event = 'agent.mentioned' and d.delivered_at is null
      order by d.created_at desc limit 1`
    if (!d) throw new Error('no wake was queued')
    await sql`select record_webhook_attempt(${d.id}, 200, null, true)`
    const rows = await sql<{ conversation_id: string; agent_id: string }[]>`select * from agent_was_woken(${d.id})`
    for (const r of rows) {
      await sql`select pg_notify('realtime', ${JSON.stringify({
        topic: `conversation:${r.conversation_id}`,
        kind: 'agent.working',
        payload: { conversation_id: r.conversation_id, agent_id: r.agent_id },
      })})`
    }
  } finally {
    await sql.end()
  }
}

/* Pictures for the task, light and dark, when asked for: `SHOTS_DIR=…`. */
const shot = async (page: Page, name: string) => {
  if (!process.env.SHOTS_DIR) return
  await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}-light.png` })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}-dark.png` })
  await page.emulateMedia({ colorScheme: 'light' })
}

async function asMe<T>(page: Page, path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  return page.evaluate(
    async ([p, i]) => {
      const s = JSON.parse(localStorage.getItem('session') ?? 'null') as { access_token: string }
      const r = await fetch(`/api${p}`, {
        method: i.method ?? 'GET',
        headers: {
          'content-type': 'application/json',
          'x-api-version': '1',
          authorization: `Bearer ${i.token ?? s.access_token}`,
        },
        ...(i.body !== undefined ? { body: JSON.stringify(i.body) } : {}),
      })
      return (await r.json()) as unknown
    },
    [path, init] as const,
  ) as Promise<T>
}

const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })

test('an agent called in a thread is seen working under its line, with its words, until it answers', async ({ page }) => {
  await login(page)
  await page.locator('aside [data-project]').first().waitFor({ timeout: 30_000 })
  const { projects } = await asMe<{ projects: { id: string; name: string }[] }>(page, '/projects')
  const project = projects.find((p) => p.name === 'Acme rebrand')!.id
  const { conversations } = await asMe<{ conversations: { id: string; project_id: string | null; created_at: string }[] }>(
    page,
    '/conversations',
  )
  const room = conversations.filter((c) => c.project_id === project).sort((a, b) => a.created_at.localeCompare(b.created_at))[0]!.id
  const name = `Grok ${Date.now() % 100000}`
  const made = await asMe<{ agent_id: string; token: string }>(page, '/agents', {
    method: 'POST',
    body: { name, project_ids: [project], reach: 'webhook', url: 'https://93.184.215.14/tuff' },
  })
  expect(made.agent_id).toBeTruthy()

  /* A thread, and the agent named in it. */
  const root = await asMe<{ id: string }>(page, `/conversations/${room}/messages`, {
    method: 'POST',
    body: { body: doc(`Triage is long ${Date.now()}`) },
  })
  await asMe(page, `/conversations/${room}/messages`, {
    method: 'POST',
    body: {
      parent_id: root.id,
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'mention', attrs: { id: made.agent_id, label: name } },
              { type: 'text', text: ' review the triage' },
            ],
          },
        ],
      },
    },
  })

  await openProject(page, 'Acme rebrand')
  await page.getByTestId('tool-messages').click()
  const head = page.locator(`[data-history] [data-message-id="${root.id}"]`)
  await expect(head).toBeVisible({ timeout: 30_000 })
  await head.hover()
  await head.getByRole('button', { name: 'Reply in thread' }).click()
  const pane = page.locator('[data-thread]')
  await expect(pane).toBeVisible()
  const line = pane.locator('[data-chat-composer]').first()
  const before = await line.boundingBox()

  /* Woken: the thread says so, and the room's own line does not. */
  await wake(made.agent_id)
  const working = pane.locator('[data-working]')
  await expect(working).toHaveText(`${name} is working…`, { timeout: 10_000 })
  await expect(page.locator('[data-working]')).toHaveCount(1)
  await shot(page, 'working')
  expect(await line.boundingBox()).toEqual(before)

  /* It says what it is doing, for this thread: its words, in the same slot. */
  await asMe(page, '/me/status', {
    method: 'PUT',
    token: made.token,
    body: { conversation_id: room, thread_id: root.id, doing: 'reading the triage' },
  })
  await expect(working).toHaveText(`${name} · reading the triage…`, { timeout: 10_000 })
  await shot(page, 'working-doing')
  expect(await line.boundingBox()).toEqual(before)

  /* Its answer in the thread is the end of it. */
  await asMe(page, `/conversations/${room}/messages`, {
    method: 'POST',
    token: made.token,
    body: { parent_id: root.id, body: doc('Three to close, two to merge.') },
  })
  await expect(pane.getByText('Three to close, two to merge.')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('[data-working]')).toHaveCount(0, { timeout: 10_000 })
  expect(await line.boundingBox()).toEqual(before)
})
