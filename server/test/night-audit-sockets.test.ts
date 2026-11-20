import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'

/*
 * The night audit's two socket findings, through the real server
 * (`src/main.ts`) on a port of its own — never 8787 — and the `ws` client.
 * 4 and 11.
 *
 * The port and the database are set before anything reads the
 * environment, so every import here is dynamic.
 *
 * On a database of its own, made and migrated here and dropped at the end,
 * as `instance.test.ts` is. The real server's start runs the edition's own
 * step on its database (`edition.ready`), and in the public repository that
 * is the community edition's: it marks the database a server of one's own,
 * names its oldest confirmed account the owner, and closes sign-up behind
 * it. On the shared database that was every other test file's sign-up
 * refused from that moment on — whichever of them happened to run after
 * this one, so a different handful failed on every run.
 */
const { migrate } = await import('../src/db/migrate.js')
const shared = process.env.DATABASE_URL!
const admin = postgres(shared, { max: 1, onnotice: () => {} })
const DB = `tracker_sockets_${randomUUID().replace(/-/g, '').slice(0, 12)}`
const at = (url: string) => {
  const u = new URL(url)
  u.pathname = `/${DB}`
  return u.href
}
/* What the end puts back, filled in as it is made — registered before the
   database is, so a migration that throws still leaves nothing behind. */
const ends: (() => Promise<unknown>)[] = []
after(async () => {
  for (const end of ends.reverse()) await end().catch((e: unknown) => console.error('[sockets.test] cleanup', e))
  /* With force: the server's own connections are still open, and nothing
     here can close them from outside. */
  await admin.unsafe(`drop database if exists ${DB} with (force)`).catch((e: unknown) => console.error('[sockets.test] cleanup', e))
  await admin.end()
  /* The server holds its port and its timers for as long as the process
     lives; nothing here can close it from outside. */
  setTimeout(() => process.exit(0), 200).unref()
})
await admin.unsafe(`create database ${DB}`)
await migrate(at(shared))
process.env.DATABASE_URL = at(shared)
process.env.DATABASE_URL_APP = at(process.env.DATABASE_URL_APP ?? shared)
if (process.env.DATABASE_URL_WORKER) process.env.DATABASE_URL_WORKER = at(process.env.DATABASE_URL_WORKER)

const PORT = 41000 + Math.floor(Math.random() * 8000)
process.env.PORT = String(PORT)
const H = await import('./helpers.js')
ends.push(() => H.closeDb())
await import('../src/main.js')
const { app } = await import('../src/http/routes.js')
const { default: WebSocket } = await import('ws')

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

async function call(method: string, path: string, token: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> }
}

function open(path: string, token: string) {
  const frames: string[] = []
  const closed: { code?: number } = {}
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}${path}`, { headers: { authorization: `Bearer ${token}` } })
  ws.on('message', (d) => frames.push(String(d)))
  const ended = new Promise<void>((r) =>
    ws.on('close', (code) => {
      closed.code = code
      r()
    }),
  )
  ws.on('error', () => {})
  const ready = new Promise<void>((r) => {
    ws.on('open', () => r())
    ws.on('close', () => r())
  })
  return { ws, frames, closed, ready, ended }
}

/** Until something is so, asked every fifty milliseconds — a wait for an
    event, not a measure of how long it took. */
async function until(what: () => boolean, label: string, most = 15_000) {
  const end = Date.now() + most
  while (!what()) {
    if (Date.now() > end) throw new Error(`never: ${label}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

test('a token made for its whole workspace does not hear its person’s other workspace on /ws/me (4)', async () => {
  const a = await H.makeOwner()
  const b = await H.makeOwner()
  const P = a.ctx.actorId
  const aProject = await H.makeProject(a.ctx, a.workspaceId, 'A work')
  const bProject = await H.makeProject(b.ctx, b.workspaceId, 'B work')
  await H.asTableOwner()`insert into membership (id, workspace_id, actor_id, role, joined_at)
                         values (${H.uuidv7()}, ${b.workspaceId}, ${P}, 'member'::role_kind, now())`
  await H.asTableOwner()`insert into project_member (id, workspace_id, project_id, actor_id, added_by)
                         values (${H.uuidv7()}, ${b.workspaceId}, ${bProject}, ${P}, ${b.ctx.actorId})`
  const mate = await H.addPerson(a.ctx, a.workspaceId, 'member', [aProject])
  const mateToken = await H.bearerFor(mate.actorId, a.workspaceId)

  const whole = await call('POST', '/api/tokens', a.token, { name: 'tool for A' })
  assert.equal(whole.status, 201)
  const s = open('/ws/me', whole.body.token)
  await s.ready

  // B first: a task given to P and a word to P, from B's owner.
  const bTask = (await call('POST', `/api/projects/${bProject}/tasks`, b.token, { title: 'B secret task', assignee_ids: [P] })).body.id
  const bRoom = (await call('POST', '/api/conversations/direct', b.token, { actor_ids: [P] })).body.id
  assert.equal((await call('POST', `/api/conversations/${bRoom}/messages`, b.token, { body: doc('hello from B') })).status, 201)
  // Then A: the same, from somebody in A.
  const aTask = (await call('POST', `/api/projects/${aProject}/tasks`, mateToken, { title: 'A task', assignee_ids: [P] })).body.id
  const aRoom = (await call('POST', '/api/conversations/direct', mateToken, { actor_ids: [P] })).body.id
  assert.equal((await call('POST', `/api/conversations/${aRoom}/messages`, mateToken, { body: doc('hello from A') })).status, 201)

  // A's words arrive — the filter lets its own workspace through…
  await until(() => s.frames.some((f) => f.includes(aTask)), 'the note about A’s task')
  await until(() => s.frames.some((f) => f.includes(aRoom)), 'the word about A’s room')
  // …and nothing of B's was among what came, though B's was said first.
  const heardOfB = s.frames.filter((f) => f.includes(bTask) || f.includes(bRoom))
  assert.deepEqual(heardOfB, [])
  s.ws.close()
})

test('the sixty-first socket is closed before a document is read for it (11)', async () => {
  const o = await H.makeOwner()
  const p = await H.makeProject(o.ctx, o.workspaceId, 'Docs')
  const made = await call('POST', `/api/projects/${p}/files`, o.token, { name: 'Written', body: doc('a document of somebody’s') })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const tok = (await call('POST', '/api/tokens', o.token, { name: 'sockets' })).body.token as string

  // A document socket under the ceiling is handed the document.
  const first = open(`/ws/docs/${made.body.id}`, tok)
  await first.ready
  await until(() => synced(first), 'the first socket’s sync')
  first.ws.close()
  await first.ended

  // Sixty held, the ceiling.
  const held = Array.from({ length: 60 }, () => open('/ws/me', tok))
  await Promise.all(held.map((h) => h.ready))
  try {
    assert.equal(held.filter((h) => h.closed.code !== undefined).length, 0)
    const extra = open(`/ws/docs/${made.body.id}`, tok)
    await extra.ended
    assert.equal(extra.closed.code, 4429)
    assert.deepEqual(
      extra.frames.filter((f) => f !== 'tick'),
      [],
    )
  } finally {
    for (const h of held) h.ws.close()
    await Promise.all(held.map((h) => h.ended))
  }

  // And the slots go back: under the ceiling again, the document is read —
  // once the server has heard the sixty close, which it hears after they do.
  let read = false
  for (let i = 0; i < 100 && !read; i++) {
    const again = open(`/ws/docs/${made.body.id}`, tok)
    await until(() => again.closed.code !== undefined || synced(again), 'an answer to the socket')
    read = synced(again)
    again.ws.close()
    await again.ended
  }
  assert.equal(read, true)
})

const synced = (s: { frames: string[] }) => s.frames.some((f) => f.startsWith('{') && JSON.parse(f).t === 'sync')
