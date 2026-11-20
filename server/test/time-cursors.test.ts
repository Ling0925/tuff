import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { asTableOwner, closeDb, makeOwner, makeProject, stamp, uuidv7 } from './helpers.js'

/*
 * Time cursors keep their microseconds,
 * Every list here is walked two rows a page over rows written at
 * one moment that is not on a millisecond, and each row comes once.
 */
after(async () => {
  await closeRealtime()
  await closeDb()
})

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

async function call(path: string, token: string, method = 'GET', body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> }
}

/* An hour ago, to the second, and then 123 456 microseconds: a moment a
   Date cannot hold. Sent to the database as text, as the server does. */
const moment = () => `${new Date(Math.floor(Date.now() / 1000) * 1000 - 3_600_000).toISOString().slice(0, 19)}.123456Z`
const millisecond = (at: string) => `${at.slice(0, 23)}Z`

/* Every page of a list, by its cursor; the ids in the order read. */
async function walk(path: string, key: string, token: string): Promise<{ ids: string[]; pages: number }> {
  const ids: string[] = []
  let cursor: string | null = null
  let pages = 0
  do {
    const r: { status: number; body: Record<string, any> } = await call(
      `${path}${path.includes('?') ? '&' : '?'}limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      token,
    )
    assert.equal(r.status, 200, JSON.stringify(r.body))
    ids.push(...(r.body[key] as { id: string }[]).map((x) => x.id))
    cursor = r.body.next_cursor
    pages++
  } while (cursor && pages < 50)
  return { ids, pages }
}

function onceEach(ids: string[], made: string[], what: string) {
  assert.equal(new Set(ids).size, ids.length, `${what}: nothing twice`)
  for (const id of made) assert.ok(ids.includes(id), `${what}: nothing skipped`)
}

test('announcements of one moment, two a page, each once; a bare moment from before reads to its millisecond', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, `Posts ${stamp()}`)
  const made: string[] = []
  for (let i = 0; i < 5; i++) {
    const r = await call(`/api/projects/${p}/posts`, token, 'POST', { title: `News ${i}`, body: doc(`n${i}`) })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    made.push(r.body.id ?? r.body.post?.id)
  }
  const at = moment()
  await asTableOwner()`update post set created_at = ${at}::text::timestamptz where project_id = ${p}`

  const { ids, pages } = await walk(`/api/projects/${p}/posts`, 'posts', token)
  assert.equal(pages, 3)
  assert.equal(ids.length, 5)
  onceEach(ids, made, 'posts')

  /* An app holding a cursor from before this: the moment as a Date printed
     it. Everything of that millisecond comes again rather than not at all. */
  const old = await call(`/api/projects/${p}/posts?cursor=${encodeURIComponent(millisecond(at))}`, token)
  assert.equal(old.status, 200)
  assert.equal(old.body.posts.length, 5)
  for (const bad of ['yesterday', 'Fri Oct 23 2026', '2026-02-31T00:00:00.000Z', `${at}_nope`]) {
    assert.equal((await call(`/api/projects/${p}/posts?cursor=${encodeURIComponent(bad)}`, token)).status, 400, bad)
  }
})

test('the notifications of one moment, two a page, each once', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, `Inbox ${stamp()}`)
  const made = Array.from({ length: 5 }, () => uuidv7())
  const at = moment()
  await asTableOwner()`
    insert into notification (id, workspace_id, actor_id, reason, object_type, object_id, created_at)
    select x, ${workspaceId}, ${ctx.actorId}, 'mentioned', 'project', ${p}, ${at}::text::timestamptz
    from unnest(${made}::uuid[]) x`

  const { ids } = await walk('/api/inbox', 'notifications', token)
  onceEach(ids, made, 'inbox')
  assert.equal((await call('/api/inbox?cursor=nope', token)).status, 400)
})

test('the activity of one moment, two a page, each once', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, `Feed ${stamp()}`)
  for (let i = 0; i < 5; i++) {
    assert.equal((await call(`/api/projects/${p}/tasks`, token, 'POST', { title: `Task ${i}` })).status, 201)
  }
  const at = moment()
  const made = (
    await asTableOwner()<{ id: string }[]>`
      update activity_event set at = ${at}::text::timestamptz where project_id = ${p} returning id`
  ).map((r) => r.id)
  assert.ok(made.length >= 5)

  const { ids } = await walk(`/api/activity?project=${p}`, 'events', token)
  assert.equal(ids.length, made.length)
  onceEach(ids, made, 'activity')
  assert.equal((await call(`/api/activity?project=${p}&cursor=nope`, token)).status, 400)
})

test('projects made in one moment, two a page, each once', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const made: string[] = []
  for (let i = 0; i < 5; i++) made.push(await makeProject(ctx, workspaceId, `Same ${i} ${stamp()}`))
  await asTableOwner()`update project set created_at = ${moment()}::text::timestamptz where id = any(${made}::uuid[])`

  const { ids } = await walk('/api/projects', 'projects', token)
  onceEach(ids, made, 'projects')
  assert.equal((await call('/api/projects?cursor=~|2026-02-31T00:00:00.000000Z|00000000-0000-0000-0000-000000000000', token)).status, 400)
})

test('tasks made in one moment, newest first and oldest first, two a page, each once', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, `Made ${stamp()}`)
  const made: string[] = []
  for (let i = 0; i < 5; i++) {
    const r = await call(`/api/projects/${p}/tasks`, token, 'POST', { title: `Task ${i}` })
    assert.equal(r.status, 201)
    made.push(r.body.id ?? r.body.task?.id)
  }
  await asTableOwner()`update task set created_at = ${moment()}::text::timestamptz where project_id = ${p}`

  for (const dir of ['', '&dir=asc']) {
    const { ids, pages } = await walk(`/api/projects/${p}/tasks?order=created${dir}`, 'tasks', token)
    assert.equal(ids.length, 5, dir)
    assert.equal(pages, 3, dir)
    onceEach(ids, made, `tasks${dir}`)
  }
})

test('Recently Deleted of one moment, two a page, each once', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, `Bin ${stamp()}`)
  const made: string[] = []
  for (let i = 0; i < 5; i++) {
    const r = await call(`/api/projects/${p}/files`, token, 'POST', { name: `Link ${i}`, url: `https://example.com/${i}` })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    made.push(r.body.id)
    assert.equal((await call(`/api/files/${r.body.id}`, token, 'DELETE')).status, 200)
  }
  await asTableOwner()`update file set deleted_at = ${moment()}::text::timestamptz where id = any(${made}::uuid[])`

  const { ids, pages } = await walk(`/api/projects/${p}/files/deleted`, 'files', token)
  assert.equal(ids.length, 5)
  assert.ok(pages >= 3)
  onceEach(ids, made, 'bin')
})

test("a room's history and its search, of one moment, two a page, each once; a bare moment reads to its millisecond", async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, `Room ${stamp()}`)
  const room = uuidv7()
  await asTableOwner()`insert into conversation (id, workspace_id, project_id, name) values (${room}, ${workspaceId}, ${p}, 'Team')`
  const made = Array.from({ length: 5 }, () => uuidv7())
  const at = moment()
  for (const [i, id] of made.entries()) {
    await asTableOwner()`
      insert into message (id, workspace_id, conversation_id, author_id, body, created_at)
      values (${id}, ${workspaceId}, ${room}, ${ctx.actorId}, ${asTableOwner().json(doc(`Needle ${i}`) as never)},
              ${at}::text::timestamptz)`
  }

  const history = await walk(`/api/conversations/${room}/messages`, 'messages', token)
  assert.equal(history.ids.length, 5)
  onceEach(history.ids, made, 'history')

  const found = await walk(`/api/conversations/${room}/messages?q=Needle`, 'messages', token)
  assert.equal(found.ids.length, 5)
  onceEach(found.ids, made, 'search')

  /* A cursor from before, a bare moment as a Date printed it, in either. */
  for (const q of ['', '&q=Needle']) {
    const old = await call(`/api/conversations/${room}/messages?cursor=${encodeURIComponent(millisecond(at))}${q}`, token)
    assert.equal(old.status, 200)
    assert.equal(old.body.messages.length, 5, q)
    assert.equal((await call(`/api/conversations/${room}/messages?cursor=nope${q}`, token)).status, 400)
  }
})
