import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { closeDb, withActor, uuidv7, makeOwner, addPerson, makeProject, bearerFor } from './helpers.js'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'

/*
 * A reply also said in the room — `docs/specs/chat-threads.md`, "Also in
 * the room". One message with a field on it, drawn in both places.
 */

after(async () => {
  await closeRealtime()
  await closeDb()
})

const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })

type Listed = { id: string; parent_id: string | null; also_in_room?: boolean; thread_said?: string | null }

async function post(token: string, room: string, body: Record<string, unknown>) {
  return app.request(`/api/conversations/${room}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function list(token: string, room: string, thread?: string): Promise<Listed[]> {
  const r = await app.request(`/api/conversations/${room}/messages${thread ? `?thread=${thread}` : ''}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(r.status, 200)
  return ((await r.json()) as { messages: Listed[] }).messages
}

async function setUp() {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const room = uuidv7()
  await withActor(
    ctx.actorId,
    (tx) => tx`insert into conversation (id, workspace_id, project_id, name) values (${room}, ${workspaceId}, ${p}, 'general')`,
  )
  return { ctx, workspaceId, token, p, room }
}

test('a reply also sent to the room is listed in both, once each, as one message', async () => {
  const { ctx, workspaceId, token, p, room } = await setUp()
  const lee = await addPerson(ctx, workspaceId, 'member', [p])
  const leeToken = await bearerFor(lee.actorId, workspaceId)
  const root = uuidv7()
  assert.equal((await post(token, room, { id: root, body: doc('shall we move the launch to Friday') })).status, 201)
  const reply = uuidv7()
  assert.equal((await post(leeToken, room, { id: reply, parent_id: root, body: doc('yes, Friday'), also_in_room: true })).status, 201)
  const quiet = uuidv7()
  assert.equal((await post(leeToken, room, { id: quiet, parent_id: root, body: doc('only here') })).status, 201)

  const top = await list(token, room)
  assert.deepEqual(
    top.map((m) => m.id),
    [root, reply],
    'the room lists the root and the reply sent to it, not the other reply',
  )
  const inRoom = top.find((m) => m.id === reply)!
  assert.equal(inRoom.also_in_room, true)
  assert.equal(inRoom.parent_id, root)
  assert.equal(inRoom.thread_said, 'shall we move the launch to Friday')
  assert.equal(top.find((m) => m.id === root)!.also_in_room, false)

  const thread = await list(token, room, root)
  assert.deepEqual(
    thread.map((m) => m.id),
    [reply, quiet],
  )
  /* One row in the database, not a copy. */
  const rows = await withActor(ctx.actorId, (tx) => tx`select count(*)::int as n from message where conversation_id = ${room}`)
  assert.equal(rows[0]!.n, 3)
})

test('a message at the top of the room cannot be also in the room', async () => {
  const { ctx, workspaceId, token, room } = await setUp()
  const id = uuidv7()
  assert.equal((await post(token, room, { id, body: doc('hello'), also_in_room: true })).status, 201)
  const [row] = await withActor(ctx.actorId, (tx) => tx`select also_in_room from message where id = ${id}`)
  assert.equal(row!.also_in_room, false, 'ignored by the endpoint')
  /* And refused by the database for anything that writes past it. */
  await assert.rejects(
    withActor(
      ctx.actorId,
      (tx) => tx`
      insert into message (id, workspace_id, conversation_id, author_id, body, also_in_room)
      values (${uuidv7()}, ${workspaceId}, ${room}, ${ctx.actorId}, ${tx.json(doc('x') as never)}, true)`,
    ),
    /message_also_in_room_is_a_reply/,
  )
})

test('a reply in the room says nothing of a thread whose message was deleted', async () => {
  const { ctx, token, room } = await setUp()
  const root = uuidv7()
  await post(token, room, { id: root, body: doc('the secret plan') })
  const reply = uuidv7()
  await post(token, room, { id: reply, parent_id: root, body: doc('agreed'), also_in_room: true })
  await withActor(ctx.actorId, (tx) => tx`update message set deleted_at = now() where id = ${root}`)
  const top = await list(token, room)
  const r = top.find((m) => m.id === reply)!
  assert.equal(r.thread_said, null)
  assert.ok(!JSON.stringify(top).includes('secret plan'))
})

test('nobody outside the room reads it, in the room or the thread', async () => {
  const { ctx, workspaceId, token, room } = await setUp()
  const other = await makeProject(ctx, workspaceId, 'Elsewhere')
  const outsider = await addPerson(ctx, workspaceId, 'member', [other])
  const outsiderToken = await bearerFor(outsider.actorId, workspaceId)
  const root = uuidv7()
  await post(token, room, { id: root, body: doc('private') })
  await post(token, room, { id: uuidv7(), parent_id: root, body: doc('also private'), also_in_room: true })
  assert.deepEqual(await list(outsiderToken, room), [])
  assert.deepEqual(await list(outsiderToken, room, root), [])
  /* Nor writes into it with the field on. */
  assert.equal((await post(outsiderToken, room, { parent_id: root, body: doc('hi'), also_in_room: true })).status, 404)
})
