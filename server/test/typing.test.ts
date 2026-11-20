import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { closeDb, withActor, uuidv7, makeOwner, addPerson, makeProject } from './helpers.js'
import { closeRealtime, subscribe } from '../src/realtime.js'
import { typed, TYPING_EVERY } from '../src/typing.js'

/*
 * Who is typing. A word on the room's socket,
 * throttled, passed on only for somebody who may read the room, and
 * stored nowhere.
 */

after(async () => {
  await closeRealtime()
  await closeDb()
})

async function room(ownerId: string, ws: string, project: string) {
  const id = uuidv7()
  await withActor(
    ownerId,
    (tx) => tx`insert into conversation (id, workspace_id, project_id, name) values (${id}, ${ws}, ${project}, 'general')`,
  )
  return id
}

async function heardOn(topic: string, run: () => Promise<void>) {
  const seen: { kind: string; payload: unknown }[] = []
  const off = await subscribe(topic, (e) => seen.push({ kind: e.kind, payload: e.payload }))
  await run()
  await new Promise((r) => setTimeout(r, 300))
  off()
  return seen.filter((e) => e.kind === 'typing')
}

test('a word from somebody in the room reaches the room, with the thread it is in', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const lee = await addPerson(ctx, workspaceId, 'member', [p])
  const r = await room(ctx.actorId, workspaceId, p)
  const thread = uuidv7()
  const seen = await heardOn(`conversation:${r}`, async () => {
    assert.equal(await typed(lee, r, 'typing'), true)
    assert.equal(await typed(lee, r, `typing ${thread}`, Date.now() + TYPING_EVERY + 1), true)
  })
  assert.deepEqual(
    seen.map((e) => e.payload),
    [
      { conversation_id: r, actor_id: lee.actorId, thread: null },
      { conversation_id: r, actor_id: lee.actorId, thread },
    ],
  )
})

test('a word inside the throttle is dropped', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const r = await room(ctx.actorId, workspaceId, p)
  const now = Date.now()
  const seen = await heardOn(`conversation:${r}`, async () => {
    assert.equal(await typed(ctx, r, 'typing', now), true)
    assert.equal(await typed(ctx, r, 'typing', now + 500), false)
    assert.equal(await typed(ctx, r, 'typing', now + TYPING_EVERY - 1), false)
  })
  assert.equal(seen.length, 1)
})

test('somebody who may not read the room is not heard in it', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const other = await makeProject(ctx, workspaceId, 'Elsewhere')
  /* In the workspace, on another project: the room is not theirs. */
  const outsider = await addPerson(ctx, workspaceId, 'member', [other])
  /* And somebody from another company altogether. */
  const stranger = (await makeOwner()).ctx
  const r = await room(ctx.actorId, workspaceId, p)
  const seen = await heardOn(`conversation:${r}`, async () => {
    assert.equal(await typed(outsider, r, 'typing'), false)
    assert.equal(await typed(stranger, r, 'typing'), false)
  })
  assert.equal(seen.length, 0)
})

test('somebody taken off the project mid-sentence stops being heard', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const lee = await addPerson(ctx, workspaceId, 'member', [p])
  const r = await room(ctx.actorId, workspaceId, p)
  assert.equal(await typed(lee, r, 'typing'), true)
  await withActor(
    ctx.actorId,
    (tx) => tx`update project_member set deleted_at = now() where project_id = ${p} and actor_id = ${lee.actorId}`,
  )
  assert.equal(await typed(lee, r, 'typing', Date.now() + TYPING_EVERY + 1), false)
})

test('only the two shapes of word are taken', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const r = await room(ctx.actorId, workspaceId, p)
  const seen = await heardOn(`conversation:${r}`, async () => {
    for (const frame of ['', 'hello', 'typing ', 'typing not-a-uuid', `typing ${uuidv7()} extra`, '{"kind":"typing"}']) {
      assert.equal(await typed(ctx, r, frame), false, frame)
    }
  })
  assert.equal(seen.length, 0)
})
