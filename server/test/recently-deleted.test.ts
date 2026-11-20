import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { issueApiToken } from '../src/auth/flows.js'
import { withActor } from '../src/db.js'
import { addManager, addPerson, asTableOwner, bearerFor, closeDb, makeOwner, makeProject, stamp } from './helpers.js'

/* A project's Recently Deleted, and Delete forever. */
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

async function world() {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const writer = await addPerson(ctx, workspaceId, 'member', [p])
  const plain = await addPerson(ctx, workspaceId, 'member', [p])
  const deleter = await addPerson(ctx, workspaceId, 'member', [p], ['task.delete'])
  const runner = await addManager(ctx, workspaceId, [p])
  const offProject = await addPerson(ctx, workspaceId, 'member', [])
  const other = await makeOwner()
  const agent = await call('/api/agents', owner, 'POST', { name: 'Helper', project_ids: [p], reach: 'mcp' })
  assert.equal(agent.status, 201, JSON.stringify(agent.body))
  const as = {
    owner,
    writer: await bearerFor(writer.actorId, workspaceId),
    plain: await bearerFor(plain.actorId, workspaceId),
    deleter: await bearerFor(deleter.actorId, workspaceId),
    runner: await bearerFor(runner.actorId, workspaceId),
    offProject: await bearerFor(offProject.actorId, workspaceId),
    stranger: other.token,
    writerTool: await issueApiToken(writer.actorId, workspaceId, 'tool'),
    ownerTool: await issueApiToken(ctx.actorId, workspaceId, 'owner tool'),
    agent: agent.body.token as string,
  }
  const make = async (who: keyof typeof as, what: Record<string, unknown>) => {
    const r = await call(`/api/projects/${p}/files`, as[who], 'POST', what)
    assert.equal(r.status, 201, JSON.stringify(r.body))
    return r.body.id as string
  }
  const bin = async (who: keyof typeof as) => call(`/api/projects/${p}/files/deleted`, as[who])
  const ids = async (who: keyof typeof as) => ((await bin(who)).body.files as { id: string }[]).map((f) => f.id)
  return { p, as, make, bin, ids, workspaceId, writerId: writer.actorId, plainId: plain.actorId, offId: offProject.actorId }
}

test('Recently Deleted lists what the asker could put back, newest deleted first, with who and until when', async () => {
  const { p, as, make, bin, ids, writerId } = await world()
  const first = await make('writer', { name: `First ${stamp()}`, body: doc('a') })
  const second = await make('writer', { name: 'Site', url: 'https://example.com' })
  const theirs = await make('plain', { name: 'Plain notes', body: doc('b') })
  const standing = await make('writer', { name: 'Still here', body: doc('c') })
  assert.equal((await call(`/api/files/${first}`, as.writer, 'DELETE')).status, 200)
  assert.equal((await call(`/api/files/${second}`, as.writer, 'DELETE')).status, 200)
  assert.equal((await call(`/api/files/${theirs}`, as.plain, 'DELETE')).status, 200)

  /* The writer sees their own two, newest deleted first; not the plain
     member's delete, which is not theirs to restore. */
  const mine = await bin('writer')
  assert.equal(mine.status, 200)
  assert.deepEqual(
    (mine.body.files as { id: string }[]).map((f) => f.id),
    [second, first],
  )
  const row = (mine.body.files as Record<string, any>[])[1]!
  assert.equal(row.kind, 'document')
  assert.equal(row.deleted_by, writerId)
  assert.ok(row.deleted_by_name)
  const left = (Date.parse(row.purge_at) - Date.now()) / 86_400_000
  assert.ok(left > 29.9 && left <= 30, `purge_at thirty days on: ${left}`)
  assert.equal(mine.body.next_cursor, null)
  assert.ok(!(await ids('writer')).includes(standing), 'a standing file is not in it')

  /* Whoever holds `file.delete` sees every one; another member only theirs. */
  for (const who of ['deleter', 'runner', 'owner'] as const) {
    const all = await ids(who)
    for (const id of [first, second, theirs]) assert.ok(all.includes(id), who)
  }
  assert.deepEqual(await ids('plain'), [theirs])

  /* Off the project, in another workspace: not told the project is there. */
  assert.equal((await bin('offProject')).status, 404)
  assert.equal((await bin('stranger')).status, 404)
  /* Never through a token, nor by an agent. */
  for (const who of ['writerTool', 'ownerTool', 'agent'] as const) assert.equal((await bin(who)).status, 403, who)

  /* A page at a time, by the last id. */
  const one = await call(`/api/projects/${p}/files/deleted?limit=1`, as.writer)
  assert.equal((one.body.files as unknown[]).length, 1)
  assert.equal(typeof one.body.next_cursor, 'string')
  assert.equal(one.body.kept_days, 30)
  const next = await call(`/api/projects/${p}/files/deleted?limit=1&cursor=${one.body.next_cursor}`, as.writer)
  assert.deepEqual(
    (next.body.files as { id: string }[]).map((f) => f.id),
    [first],
  )
  assert.equal((await call(`/api/projects/${p}/files/deleted?cursor=nope`, as.writer)).status, 400)
  assert.equal((await call(`/api/projects/${p}/files/deleted?cursor=${second}`, as.writer)).status, 400, 'a bare id is not a cursor')
  /* The cursor's own row restored between pages: the list goes on past it. */
  assert.equal((await call(`/api/files/${second}/restore`, as.writer, 'POST')).status, 200)
  const after = await call(`/api/projects/${p}/files/deleted?limit=1&cursor=${one.body.next_cursor}`, as.writer)
  assert.deepEqual(
    (after.body.files as { id: string }[]).map((f) => f.id),
    [first],
  )
  assert.equal((await call(`/api/files/${second}`, as.writer, 'DELETE')).status, 200)

  /* Restored, it leaves the list. */
  assert.equal((await call(`/api/files/${first}/restore`, as.writer, 'POST')).status, 200)
  assert.deepEqual(await ids('writer'), [second])
})

test('only the last thirty days are listed', async () => {
  const { as, make, ids } = await world()
  const old = await make('writer', { name: 'Old', body: doc('x') })
  const fresh = await make('writer', { name: 'Fresh', body: doc('y') })
  assert.equal((await call(`/api/files/${old}`, as.writer, 'DELETE')).status, 200)
  assert.equal((await call(`/api/files/${fresh}`, as.writer, 'DELETE')).status, 200)
  await asTableOwner()`update file set deleted_at = now() - interval '31 days' where id = ${old}`
  assert.deepEqual(await ids('writer'), [fresh])
})

test('Delete forever takes only a deleted file, only on a request that names it, and only for who may restore it', async () => {
  const { as, make, ids } = await world()
  const id = await make('writer', { name: `Brief ${stamp()}`, body: doc('x') })
  const forever = (who: keyof typeof as, body?: unknown) => call(`/api/files/${id}/forever`, as[who], 'DELETE', body)

  /* A standing file: not through here. Deleting it is the bin's door. */
  assert.equal((await forever('writer', { confirm: id })).status, 404)
  assert.equal((await call(`/api/files/${id}`, as.writer, 'DELETE')).status, 200)

  /* No confirmation, or one naming something else: refused, nothing gone. */
  assert.equal((await forever('writer')).status, 400)
  assert.equal((await forever('writer', {})).status, 400)
  assert.equal((await forever('writer', { confirm: 'yes' })).status, 400)
  assert.equal((await forever('writer', { confirm: true })).status, 400)
  const bare = await app.request(`/api/files/${id}/forever`, { method: 'DELETE', headers: { authorization: `Bearer ${as.writer}` } })
  assert.equal(bare.status, 400)

  /* Not seen: 404. Seen, without the right: 403. A token, an agent: 403. */
  assert.equal((await forever('offProject', { confirm: id })).status, 404)
  assert.equal((await forever('stranger', { confirm: id })).status, 404)
  assert.equal((await forever('plain', { confirm: id })).status, 403)
  for (const who of ['writerTool', 'ownerTool', 'agent'] as const) assert.equal((await forever(who, { confirm: id })).status, 403, who)
  assert.ok((await ids('writer')).includes(id), 'still there after every refusal')

  /* The one who deleted it. */
  const done = await forever('writer', { confirm: id })
  assert.equal(done.status, 200, JSON.stringify(done.body))
  assert.ok(!(await ids('writer')).includes(id))
  assert.equal((await call(`/api/files/${id}/restore`, as.writer, 'POST')).status, 404, 'nothing to put back')
  assert.equal((await forever('writer', { confirm: id })).status, 404, 'and not twice')
  const [row] = await asTableOwner()<{ n: number }[]>`select count(*)::int as n from file where id = ${id}`
  assert.equal(row!.n, 0)

  /* Somebody else's delete, by whoever holds `file.delete` — and not by us. */
  const other = await make('writer', { name: 'Other', body: doc('y') })
  assert.equal((await call(`/api/files/${other}`, as.runner, 'DELETE')).status, 200)
  assert.equal((await call(`/api/files/${other}/forever`, as.writer, 'DELETE', { confirm: other })).status, 403, 'not its author')
  assert.equal((await call(`/api/files/${other}/forever`, as.deleter, 'DELETE', { confirm: other })).status, 200)
})

test('gone for good takes its bytes, comments, followers and versions, and the feed names it', async () => {
  const { p, as, ids } = await world()
  const form = new FormData()
  form.append('file', new File([new Uint8Array([104, 105])], 'notes.txt', { type: 'text/plain' }))
  const sent = await app.request(`/api/projects/${p}/uploads`, {
    method: 'POST',
    headers: { authorization: `Bearer ${as.writer}` },
    body: form,
  })
  assert.equal(sent.status, 201)
  const { id } = (await sent.json()) as { id: string }
  assert.equal((await call(`/api/files/${id}/comments`, as.plain, 'POST', { body: doc('Seen') })).status, 201)
  const [f] = await asTableOwner()<{ storage_key: string }[]>`select storage_key from file where id = ${id}`
  assert.ok(f?.storage_key)

  assert.equal((await call(`/api/files/${id}`, as.writer, 'DELETE')).status, 200)
  assert.ok((await ids('writer')).includes(id))
  assert.equal((await call(`/api/files/${id}/forever`, as.writer, 'DELETE', { confirm: id })).status, 200)

  const [left] = await asTableOwner()<{ c: number; s: number; o: number }[]>`
    select (select count(*)::int from comment where object_type = 'file' and object_id = ${id}) as c,
           (select count(*)::int from subscription where object_type = 'file' and object_id = ${id}) as s,
           (select count(*)::int from storage_orphan where key = ${f!.storage_key}) as o`
  assert.deepEqual(left, { c: 0, s: 0, o: 1 }, 'comments and followers gone, the bytes queued for storage')

  const feed = (await call(`/api/activity?project=${p}&object=${id}`, as.owner)).body
  const line = (feed.events as { action: string; object_title?: string }[]).find((e) => e.action === 'file.purge')
  assert.equal(line?.object_title, 'notes.txt')
})

test('a written document’s versions go with it', async () => {
  const { as, make } = await world()
  const id = await make('writer', { name: 'Versioned', body: doc('one') })
  assert.equal((await call(`/api/files/${id}`, as.writer, 'PATCH', { body: doc('two') })).status, 200)
  const count = async () => (await asTableOwner()<{ n: number }[]>`select count(*)::int as n from file_version where file_id = ${id}`)[0]!.n
  assert.ok((await count()) > 0)
  assert.equal((await call(`/api/files/${id}`, as.writer, 'DELETE')).status, 200)
  assert.equal((await call(`/api/files/${id}/forever`, as.writer, 'DELETE', { confirm: id })).status, 200)
  assert.equal(await count(), 0)
})

/* The database asks the restore rule itself, beside `can()`: whoever calls
   the function straight, as the application, without the right is refused. */
test('purge_file refuses a caller who neither deleted it nor holds the right, and one who cannot see it', async () => {
  const { as, make, workspaceId, plainId, offId, writerId } = await world()
  const id = await make('writer', { name: 'Guarded', body: doc('x') })
  assert.equal((await call(`/api/files/${id}`, as.writer, 'DELETE')).status, 200)
  const purge = (actor: string, fn: 'purge_file' | 'purge_file_row') =>
    withActor(actor, workspaceId, async (tx) => (await tx.unsafe<{ ok: boolean }[]>(`select ${fn}($1) as ok`, [id]))[0]!.ok)
  assert.equal(await purge(plainId, 'purge_file'), false, 'on the project, without the right')
  assert.equal(await purge(plainId, 'purge_file_row'), false, 'the definer asks the rule too')
  assert.equal(await purge(offId, 'purge_file'), false, 'off the project: not found by the policies')
  const [still] = await asTableOwner()<{ n: number }[]>`select count(*)::int as n from file where id = ${id}`
  assert.equal(still!.n, 1)
  assert.equal(await purge(writerId, 'purge_file'), true, 'whoever deleted it')
})
