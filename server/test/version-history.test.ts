import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import type { WSContext } from 'hono/ws'
import { addPerson, asTableOwner, bearerFor, closeDb, makeOwner, makeProject, uuidv7, withActor } from './helpers.js'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { authenticate, type AuthContext } from '../src/auth/context.js'
import { heard, join, leave, type Seat } from '../src/coedit.js'
import { FRAGMENT, bodyOf, toElement } from '../src/yjson.js'

/*
 * A document's versions. When one is
 * kept, who may read them and who may put one back, what putting one back
 * does to the people in the document, and that they go with the document.
 */

after(async () => {
  await closeRealtime()
  await closeDb()
})

const doc = (...lines: string[]) => ({
  type: 'doc',
  content: lines.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })),
})
const words = (body: unknown) =>
  ((body as { content?: { content?: { text?: string }[] }[] }).content ?? []).map((p) => (p.content ?? []).map((t) => t.text).join(''))

async function call(token: string, method: string, path: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}

type V = {
  id: string
  version: number
  created_at: string
  restored_version: number | null
  contributors: { actor_id: string; name: string; avatar_url: string | null }[]
}
const list = async (token: string, id: string, q = '') =>
  (await call(token, 'GET', `/api/files/${id}/versions${q}`)).body as { versions: V[]; next_cursor: string | null }

async function aDocument(token: string, projectId: string, ...lines: string[]): Promise<string> {
  const made = await call(token, 'POST', `/api/projects/${projectId}/files`, { name: 'Brief', body: doc(...lines) })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  return made.body.id as string
}

async function ctxOf(actorId: string, workspaceId: string): Promise<AuthContext> {
  const ctx = await authenticate(`Bearer ${await bearerFor(actorId, workspaceId)}`)
  assert.ok(ctx)
  return ctx
}

function socket() {
  const said: { t: string; u?: string; version?: number }[] = []
  const ws = { send: (f: string) => said.push(JSON.parse(f)), close: () => {}, readyState: 1 } as unknown as WSContext
  return { ws, said }
}

/** A page in the room: the state it was sent, and every update since. */
function page(said: { t: string; u?: string }[]) {
  const d = new Y.Doc()
  for (const f of said) if ((f.t === 'sync' || f.t === 'u') && f.u) Y.applyUpdate(d, new Uint8Array(Buffer.from(f.u, 'base64')))
  return d
}
function adding(d: Y.Doc, text: string): string {
  let out: Uint8Array | null = null
  const grab = (u: Uint8Array) => {
    out = u
  }
  d.on('update', grab)
  const f = d.getXmlFragment(FRAGMENT)
  f.insert(f.length, [toElement({ type: 'paragraph', content: [{ type: 'text', text }] })])
  d.off('update', grab)
  return Buffer.from(out!).toString('base64')
}
async function send(seat: Seat, u: string) {
  heard(seat, JSON.stringify({ t: 'u', u }))
  await seat.queue
}

test('a body written through the API keeps a version each time, after the one it had before, naming who wrote', async () => {
  const { workspaceId, ctx, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Versions')
  const writer = await addPerson(ctx, workspaceId, 'member', [p])
  const theirs = await bearerFor(writer.actorId, workspaceId)
  const id = await aDocument(token, p, 'First')

  // Nothing kept before anybody's first edit.
  assert.deepEqual((await list(token, id)).versions, [])

  assert.equal((await call(theirs, 'PATCH', `/api/files/${id}`, { body: doc('Second') })).status, 200)
  assert.equal((await call(token, 'PATCH', `/api/files/${id}`, { body: doc('Third') })).status, 200)
  // A name alone is not a version; nor a body that says the same again.
  assert.equal((await call(token, 'PATCH', `/api/files/${id}`, { name: 'Renamed' })).status, 200)
  assert.equal((await call(token, 'PATCH', `/api/files/${id}`, { body: doc('Third') })).status, 200)

  const { versions } = await list(token, id)
  assert.equal(versions.length, 3, JSON.stringify(versions))
  const [third, second, first] = versions
  assert.equal(first!.version, 1)
  assert.deepEqual(first!.contributors, [])
  assert.deepEqual(
    second!.contributors.map((c) => c.actor_id),
    [writer.actorId],
  )
  assert.deepEqual(
    third!.contributors.map((c) => c.actor_id),
    [ctx.actorId],
  )
  assert.ok(third!.version > second!.version && second!.version > first!.version)

  // Each read whole, read-only.
  const read = await call(token, 'GET', `/api/files/${id}/versions/${first!.id}`)
  assert.equal(read.status, 200)
  assert.deepEqual(words((read.body.version as { body: unknown }).body), ['First'])

  // A page at a time, nothing missed or repeated.
  const one = await list(token, id, '?limit=1')
  assert.equal(one.versions.length, 1)
  assert.ok(one.next_cursor)
  const two = await list(token, id, `?limit=2&cursor=${one.next_cursor}`)
  assert.deepEqual(
    [...one.versions, ...two.versions].map((v) => v.id),
    versions.map((v) => v.id),
  )
  assert.equal(two.next_cursor, null)
  assert.equal((await call(token, 'GET', `/api/files/${id}/versions?cursor=nope`)).status, 400)
})

test('readers read versions, only editors restore, and anybody else is told there is nothing', async () => {
  const { workspaceId, ctx, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Rights')
  const reader = await addPerson(ctx, workspaceId, 'member', [p], [])
  const off = await addPerson(ctx, workspaceId, 'member', [])
  const stranger = await makeOwner()
  const as = { reader: await bearerFor(reader.actorId, workspaceId), off: await bearerFor(off.actorId, workspaceId) }
  assert.equal((await call(token, 'PATCH', '/api/workspace', { edit_others_content: 'own_only' })).status, 200)

  const id = await aDocument(token, p, 'Mine')
  assert.equal((await call(token, 'PATCH', `/api/files/${id}`, { body: doc('Mine, edited') })).status, 200)
  const [, original] = (await list(token, id)).versions
  assert.ok(original)

  // A reader of the document reads its versions, and may not put one back.
  assert.equal((await list(as.reader, id)).versions.length, 2)
  assert.equal((await call(as.reader, 'GET', `/api/files/${id}/versions/${original.id}`)).status, 200)
  assert.equal((await call(as.reader, 'POST', `/api/files/${id}/versions/${original.id}/restore`)).status, 403)

  // Off the project, or in another workspace: nothing there.
  for (const t of [as.off, stranger.token]) {
    assert.equal((await call(t, 'GET', `/api/files/${id}/versions`)).status, 404)
    assert.equal((await call(t, 'GET', `/api/files/${id}/versions/${original.id}`)).status, 404)
    assert.equal((await call(t, 'POST', `/api/files/${id}/versions/${original.id}/restore`)).status, 404)
  }
  // A version of another document is not one of this one's.
  const other = await aDocument(token, p, 'Other')
  assert.equal((await call(token, 'GET', `/api/files/${other}/versions/${original.id}`)).status, 404)
  assert.equal((await call(token, 'POST', `/api/files/${other}/versions/${original.id}/restore`)).status, 404)
  // A link has no versions.
  const link = await call(token, 'POST', `/api/projects/${p}/files`, { name: 'Site', url: 'https://example.com/' })
  assert.equal((await call(token, 'GET', `/api/files/${link.body.id as string}/versions`)).status, 404)

  // Nor can anybody plant one by hand: the table is written only where the server asked who may edit.
  await assert.rejects(
    withActor(
      reader.actorId,
      (tx) => tx`
      insert into file_version (workspace_id, id, file_id, version, body)
      values (${workspaceId}, ${uuidv7()}, ${id}, 99, ${tx.json(doc('Planted') as never)})`,
    ),
  )
  await assert.rejects(withActor(ctx.actorId, (tx) => tx`delete from file_version where file_id = ${id}`))

  // Still nothing changed by any of it.
  assert.deepEqual(words(((await call(token, 'GET', `/api/files/${id}`)).body.file as { body: unknown }).body), ['Mine, edited'])
})

test('a version restored is an edit the people in the document see, and a new version; nothing is erased', async () => {
  const { workspaceId, ctx, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Restore')
  const id = await aDocument(token, p, 'One')
  assert.equal((await call(token, 'PATCH', `/api/files/${id}`, { body: doc('One', 'Two') })).status, 200)
  assert.equal((await call(token, 'PATCH', `/api/files/${id}`, { body: doc('Three') })).status, 200)
  const before = (await list(token, id)).versions
  assert.equal(before.length, 3)
  const target = before[1]! // "One, Two"

  // Somebody has the document open.
  const writer = await addPerson(ctx, workspaceId, 'member', [p])
  const s = socket()
  const seat = await join(await ctxOf(writer.actorId, workspaceId), id, s.ws)
  assert.ok(seat)
  try {
    const restored = await call(token, 'POST', `/api/files/${id}/versions/${target.id}/restore`)
    assert.equal(restored.status, 200, JSON.stringify(restored.body))
    const version = restored.body.version as number

    // The room heard it: what the open page shows is the restored words.
    for (let i = 0; i < 40 && !s.said.some((f) => f.t === 'saved' && f.version === version); i++)
      await new Promise((r) => setTimeout(r, 50))
    assert.deepEqual(words(bodyOf(page(s.said))), ['One', 'Two'])
    assert.ok(s.said.some((f) => f.t === 'saved' && f.version === version))

    // Stored, a new version naming the restorer, and the ones after it still there.
    const file = (await call(token, 'GET', `/api/files/${id}`)).body.file as { body: unknown; version: number }
    assert.deepEqual(words(file.body), ['One', 'Two'])
    assert.equal(file.version, version)
    const after_ = (await list(token, id)).versions
    assert.equal(after_.length, 4)
    assert.equal(after_[0]!.restored_version, target.version)
    assert.equal(after_[0]!.version, version)
    assert.deepEqual(
      after_[0]!.contributors.map((c) => c.actor_id),
      [ctx.actorId],
    )
    assert.deepEqual(
      after_.slice(1).map((v) => v.id),
      before.map((v) => v.id),
    )

    // Restoring what it already says keeps nothing.
    const again = await call(token, 'POST', `/api/files/${id}/versions/${target.id}/restore`)
    assert.equal(again.status, 200)
    assert.equal(again.body.version, version)
    assert.equal((await list(token, id)).versions.length, 4)

    // The feed says so.
    const feed = (await call(token, 'GET', `/api/activity?object=${id}`)).body.events as {
      action: string
      meta: Record<string, unknown> | null
    }[]
    assert.ok(
      feed.some((e) => e.action === 'file.update' && e.meta?.restored_version === target.version),
      JSON.stringify(feed),
    )
  } finally {
    await leave(seat)
  }
})

test('writing together keeps a version when the last editor leaves, naming everybody who wrote', async () => {
  const { workspaceId, ctx, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Together')
  const id = await aDocument(token, p, 'Start')
  const a = await addPerson(ctx, workspaceId, 'member', [p])
  const b = await addPerson(ctx, workspaceId, 'member', [p])
  const sa = socket()
  const sb = socket()
  const seatA = await join(await ctxOf(a.actorId, workspaceId), id, sa.ws)
  const seatB = await join(await ctxOf(b.actorId, workspaceId), id, sb.ws)
  assert.ok(seatA && seatB)
  await send(seatA, adding(page(sa.said), 'From A'))
  await send(seatB, adding(page(sb.said), 'From B'))
  await leave(seatA)
  await leave(seatB)

  const { versions } = await list(token, id)
  assert.equal(versions.length, 2, JSON.stringify(versions))
  assert.deepEqual(versions[1]!.contributors, [])
  assert.deepEqual(
    versions[0]!.contributors.map((c) => c.actor_id),
    [a.actorId, b.actorId],
  )
  const newest = await call(token, 'GET', `/api/files/${id}/versions/${versions[0]!.id}`)
  assert.deepEqual(words((newest.body.version as { body: unknown }).body), ['Start', 'From A', 'From B'])
})

test('versions thin as they age, and go with the document', async () => {
  const { workspaceId, ctx, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Thin')
  const id = await aDocument(token, p, 'Body')
  const db = asTableOwner()
  /* Four a day, a minute apart, for sixty days back, as if kept then. */
  const at = (daysAgo: number, minute: number) => new Date(Date.now() - daysAgo * 86_400_000 - minute * 60_000)
  let n = 1
  for (let d = 60; d >= 2; d--) {
    for (let h = 0; h < 4; h++) {
      await db`insert into file_version (workspace_id, id, file_id, version, body, created_at)
               values (${workspaceId}, ${uuidv7()}, ${id}, ${n++}, ${db.json(doc(`v${n}`) as never)}, ${at(d, h)})`
    }
  }
  // A write now keeps a version, and the insert thins the rest.
  assert.equal((await call(token, 'PATCH', `/api/files/${id}`, { body: doc('Now') })).status, 200)
  const rows = await db<{ created_at: Date }[]>`select created_at from file_version where file_id = ${id} order by created_at`
  const days = (r: { created_at: Date }) => (Date.now() - r.created_at.getTime()) / 86_400_000
  const recent = rows.filter((r) => days(r) <= 30)
  const old = rows.filter((r) => days(r) > 30)
  // One a day for the last thirty, one a week before, and the newest.
  assert.ok(recent.length <= 31 && recent.length >= 28, String(recent.length))
  assert.ok(old.length >= 4 && old.length <= 6, String(old.length))

  // In the bin, not readable; taken by the clear-out, gone.
  assert.equal((await call(token, 'DELETE', `/api/files/${id}`)).status, 200)
  assert.equal((await call(token, 'GET', `/api/files/${id}/versions`)).status, 404)
  await db`delete from file where id = ${id}`
  const [left] = await db<{ n: number }[]>`select count(*)::int as n from file_version where file_id = ${id}`
  assert.equal(left!.n, 0)
})
