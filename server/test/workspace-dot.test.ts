import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { sql } from '../src/db.js'
import { issueApiToken } from '../src/auth/flows.js'
import { closeRealtime } from '../src/realtime.js'
import { asTableOwner, bearerFor, closeDb, makeOwner, makeProject, uuidv7, withActor } from './helpers.js'

after(async () => {
  await closeRealtime()
  await closeDb()
})

/*
 * The dot on another workspace's mark.
 * `GET /api/workspaces` says, for
 * each, whether this person has an unread note there the bell would count:
 * one yes or no about their own notes, and nothing about anybody else's.
 */
async function call(path: string, token: string, method = 'GET', body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> }
}

type Listed = { id: string; unread?: boolean }

test('the workspace list says where this person has something unread, and only of their own notes', async () => {
  const alice = await makeOwner()
  const bob = await makeOwner()
  const p = await makeProject(bob.ctx, bob.workspaceId, 'Over there')
  // Alice is a member of Bob's workspace too, on its project.
  await asTableOwner()`
    insert into membership (id, workspace_id, actor_id, role, joined_at)
    values (${uuidv7()}, ${bob.workspaceId}, ${alice.ctx.actorId}, 'member'::role_kind, now())`
  await withActor(bob.ctx.actorId, async (tx) => {
    await tx`
      insert into project_member (id, workspace_id, project_id, actor_id, added_by)
      values (${uuidv7()}, ${bob.workspaceId}, ${p}, ${alice.ctx.actorId}, ${bob.ctx.actorId})`
  })
  const aliceThere = await bearerFor(alice.ctx.actorId, bob.workspaceId)
  const listed = async (token: string) => {
    const r = await call('/api/workspaces', token)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    return r.body.workspaces as Listed[]
  }
  const unreadIn = async (token: string, ws: string) => (await listed(token)).find((w) => w.id === ws)?.unread

  // Nothing yet, anywhere.
  assert.equal(await unreadIn(alice.token, bob.workspaceId), false)
  assert.equal(await unreadIn(alice.token, alice.workspaceId), false)

  /* Something for Bob in his own workspace is his: Alice's dot does not
     light for it. A task he gives himself, in a project she is on. */
  const own = await call(`/api/projects/${p}/tasks`, bob.token, 'POST', { title: 'Mine', assignee_ids: [bob.ctx.actorId] })
  assert.equal(own.status, 201, JSON.stringify(own.body))
  assert.equal(await unreadIn(alice.token, bob.workspaceId), false)

  // A task given to Alice over there lights it, asked from her own workspace.
  const given = await call(`/api/projects/${p}/tasks`, bob.token, 'POST', { title: 'Yours', assignee_ids: [alice.ctx.actorId] })
  assert.equal(given.status, 201, JSON.stringify(given.body))
  const fromHome = await listed(alice.token)
  assert.equal(fromHome.find((w) => w.id === bob.workspaceId)?.unread, true)
  assert.equal(fromHome.find((w) => w.id === alice.workspaceId)?.unread, false)
  // Nothing about the note itself rides along: the row is the workspace's.
  assert.deepEqual(
    Object.keys(fromHome.find((w) => w.id === bob.workspaceId)!).sort(),
    ['icon_url', 'id', 'mark_icon', 'mark_tint', 'name', 'plan', 'role', 'slug', 'unread'].sort(),
  )

  /* Bob's list is about Bob: Alice's workspace is not in it, and what is
     waiting for her in his is not lit for him — giving himself a task told
     him nothing. */
  const bobs = await listed(bob.token)
  assert.equal(bobs.length, 1)
  assert.equal(bobs[0]!.unread, false)

  // Read over there, it goes out here.
  assert.equal((await call('/api/inbox/read', aliceThere, 'POST', {})).status, 200)
  assert.equal(await unreadIn(alice.token, bob.workspaceId), false)

  /* A note about something that went away is not counted, as the bell
     does not count it. */
  const later = await call(`/api/projects/${p}/tasks`, bob.token, 'POST', { title: 'Gone soon', assignee_ids: [alice.ctx.actorId] })
  assert.equal(await unreadIn(alice.token, bob.workspaceId), true)
  assert.equal((await call(`/api/tasks/${later.body.id}`, bob.token, 'DELETE')).status, 200)
  assert.equal(await unreadIn(alice.token, bob.workspaceId), false)
})

/*
 * Somebody in many workspaces is answered from one transaction, so one
 * connection: one per workspace at once took the pool's twenty for
 * somebody in twenty, every two minutes. Counted where every transaction
 * starts. Found by the independent review of.
 */
test('somebody in twenty-six workspaces is answered from one connection, each workspace still its own', async () => {
  const alice = await makeOwner()
  const owner = asTableOwner()
  const others: string[] = []
  for (let i = 0; i < 25; i++) {
    const ws = uuidv7()
    others.push(ws)
    await owner`insert into workspace (id, name, slug) values (${ws}, ${`Many ${i}`}, ${`many-${ws.replace(/-/g, '').slice(-16)}`})`
    await owner`
      insert into membership (id, workspace_id, actor_id, role, joined_at)
      values (${uuidv7()}, ${ws}, ${alice.ctx.actorId}, 'member'::role_kind, now())`
  }
  // Something for Alice in the seventeenth, and nowhere else.
  const lit = others[16]!
  await owner`
    insert into notification (id, workspace_id, actor_id, reason, object_type, object_id, deliver_after)
    values (${uuidv7()}, ${lit}, ${alice.ctx.actorId}, 'joined'::notify_reason, 'actor'::object_kind, ${alice.ctx.actorId}, now())`

  const pool = sql as unknown as { begin: (...a: unknown[]) => unknown }
  const begin = pool.begin
  let opened = 0
  pool.begin = (...args: unknown[]) => {
    opened += 1
    return begin.apply(sql, args)
  }
  let r: Awaited<ReturnType<typeof call>>
  try {
    r = await call('/api/workspaces', alice.token)
  } finally {
    pool.begin = begin
  }
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const rows = r.body.workspaces as Listed[]
  assert.equal(rows.length, 26)
  assert.deepEqual(
    rows.filter((w) => w.unread).map((w) => w.id),
    [lit],
  )
  assert.ok(rows.every((w) => typeof w.unread === 'boolean'))
  /* Who is asking, the list, and every workspace's answer: three
     transactions at most, whatever the number of workspaces. */
  assert.ok(opened <= 3, `${opened} transactions for 26 workspaces`)
})

/* A token is one workspace's key: what is waiting in another is not its to know. */
test('through a token, the list says nothing about what is waiting anywhere', async () => {
  const alice = await makeOwner()
  const bob = await makeOwner()
  await asTableOwner()`
    insert into membership (id, workspace_id, actor_id, role, joined_at)
    values (${uuidv7()}, ${bob.workspaceId}, ${alice.ctx.actorId}, 'member'::role_kind, now())`
  await asTableOwner()`
    insert into notification (id, workspace_id, actor_id, reason, object_type, object_id, deliver_after)
    values (${uuidv7()}, ${bob.workspaceId}, ${alice.ctx.actorId}, 'joined'::notify_reason, 'actor'::object_kind, ${alice.ctx.actorId}, now())`
  // A session sees it.
  const seen = (await call('/api/workspaces', alice.token)).body.workspaces as Listed[]
  assert.equal(seen.find((w) => w.id === bob.workspaceId)?.unread, true)
  // A token of hers does not: no `unread` on any row.
  const tool = await issueApiToken(alice.ctx.actorId, alice.workspaceId, 'tool')
  const r = await call('/api/workspaces', tool)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const rows = r.body.workspaces as Listed[]
  assert.ok(rows.length >= 1)
  assert.ok(
    rows.every((w) => !('unread' in w)),
    JSON.stringify(rows),
  )
})
