import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { issueApiToken } from '../src/auth/flows.js'
import { addManager, addPerson, asTableOwner, bearerFor, closeDb, makeOwner, makeProject, stamp } from './helpers.js'

/*
 * Every deletion has an Undo. A task, an
 * announcement, a comment and a channel are put back by whoever deleted
 * them, or by whoever may delete anybody's; never through a token, and
 * `404` for what the asker cannot see.
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

async function world() {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, `Acme ${stamp()}`)
  const writer = await addPerson(ctx, workspaceId, 'member', [p])
  const plain = await addPerson(ctx, workspaceId, 'member', [p])
  /* Holds nothing at all on the project. */
  const bare = await addPerson(ctx, workspaceId, 'member', [p], [])
  const deleter = await addPerson(ctx, workspaceId, 'member', [p], ['task.delete'])
  const rooms = await addPerson(ctx, workspaceId, 'member', [p], ['channel.create', 'channel.delete'])
  const runner = await addManager(ctx, workspaceId, [p])
  const offProject = await addPerson(ctx, workspaceId, 'member', [])
  const other = await makeOwner()
  const as = {
    owner,
    writer: await bearerFor(writer.actorId, workspaceId),
    plain: await bearerFor(plain.actorId, workspaceId),
    bare: await bearerFor(bare.actorId, workspaceId),
    deleter: await bearerFor(deleter.actorId, workspaceId),
    rooms: await bearerFor(rooms.actorId, workspaceId),
    runner: await bearerFor(runner.actorId, workspaceId),
    offProject: await bearerFor(offProject.actorId, workspaceId),
    stranger: other.token,
    writerTool: await issueApiToken(writer.actorId, workspaceId, 'tool'),
    ownerTool: await issueApiToken(ctx.actorId, workspaceId, 'owner tool'),
  }
  return { p, as, workspaceId, ids: { writer: writer.actorId, rooms: rooms.actorId, plain: plain.actorId, runner: runner.actorId } }
}

type As = Awaited<ReturnType<typeof world>>['as']

/* What nobody but the right people may do to a deleted one. */
async function refusedToOthers(as: As, path: string, refused: (keyof As)[]) {
  assert.equal((await call(path, as.stranger, 'POST')).status, 404, 'another workspace')
  assert.equal((await call(path, as.offProject, 'POST')).status, 404, 'off the project')
  /* A token is refused, whether or not it may see the thing at all. */
  for (const tool of [as.writerTool, as.ownerTool]) assert.ok([403, 404].includes((await call(path, tool, 'POST')).status), 'a token')
  for (const who of refused) assert.equal((await call(path, as[who], 'POST')).status, 403, who)
}

test('a task deleted from its screen is put back by whoever deleted it, or whoever may delete anybody’s', async () => {
  const { p, as } = await world()
  const make = async (who: keyof As, title: string) => {
    const r = await call(`/api/projects/${p}/tasks`, as[who], 'POST', { title })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    return r.body.id as string
  }

  /* Its author's own delete is theirs to undo, holding no right to delete. */
  const own = await make('plain', 'Typo')
  assert.equal((await call(`/api/tasks/${own}`, as.plain, 'DELETE')).status, 200)
  await refusedToOthers(as, `/api/tasks/${own}/restore`, ['bare', 'writer'])
  assert.equal((await call(`/api/tasks/${own}/restore`, as.plain, 'POST')).status, 200)
  assert.equal((await call(`/api/tasks/${own}`, as.bare)).status, 200, 'back for everybody')
  assert.equal((await call(`/api/tasks/${own}/restore`, as.plain, 'POST')).status, 404, 'a standing one is not restored')

  /* Taken down by somebody else, it is not its author's to bring back. */
  const theirs = await make('writer', 'Leaked plan')
  assert.equal((await call(`/api/tasks/${theirs}`, as.runner, 'DELETE')).status, 200)
  assert.equal((await call(`/api/tasks/${theirs}/restore`, as.writer, 'POST')).status, 403, 'not its author')
  assert.equal((await call(`/api/tasks/${theirs}/restore`, as.deleter, 'POST')).status, 200, 'task.delete')
  assert.equal((await call(`/api/tasks/${theirs}`, as.deleter, 'DELETE')).status, 200)
  assert.equal((await call(`/api/tasks/${theirs}/restore`, as.owner, 'POST')).status, 200, 'the owner')
})

test('an announcement comes back by Undo, with its replies, to whoever deleted it or runs the project', async () => {
  const { p, as } = await world()
  const make = async (who: keyof As, title: string) => {
    const r = await call(`/api/projects/${p}/posts`, as[who], 'POST', { title, body: doc('News') })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    return r.body.id as string
  }
  const own = await make('writer', `Kick-off ${stamp()}`)
  assert.equal((await call(`/api/posts/${own}/comments`, as.plain, 'POST', { body: doc('See you there') })).status, 201)
  assert.equal((await call(`/api/posts/${own}`, as.writer, 'DELETE')).status, 200)
  assert.equal((await call(`/api/posts/${own}`, as.plain)).status, 404, 'gone')
  /* Not by somebody who may delete others' tasks: an announcement is said,
     and taking what somebody said away is `content.edit.said`. */
  await refusedToOthers(as, `/api/posts/${own}/restore`, ['plain', 'deleter'])
  assert.equal((await call(`/api/posts/${own}/restore`, as.writer, 'POST')).status, 200)
  const back = await call(`/api/posts/${own}`, as.plain)
  assert.equal(back.status, 200)
  const replies = await call(`/api/posts/${own}/comments`, as.plain)
  assert.equal((replies.body.comments as unknown[]).length, 1, 'its replies with it')
  const listed = (await call(`/api/projects/${p}/posts`, as.plain)).body.posts as { id: string }[]
  assert.ok(
    listed.some((x) => x.id === own),
    'back on the list',
  )
  assert.equal((await call(`/api/posts/${own}/restore`, as.writer, 'POST')).status, 404, 'a standing one is not restored')

  /* A runner's delete is not its author's to undo. */
  const taken = await make('writer', 'Wrong numbers')
  assert.equal((await call(`/api/posts/${taken}`, as.runner, 'DELETE')).status, 200)
  assert.equal((await call(`/api/posts/${taken}/restore`, as.writer, 'POST')).status, 403, 'not its author')
  assert.equal((await call(`/api/posts/${taken}/restore`, as.owner, 'POST')).status, 200, 'the owner')

  /* The feed says it, by name, and so do the screens: the line is the
     project's event. */
  const feed = (await call(`/api/activity?project=${p}&object=${taken}`, as.owner)).body.events as {
    action: string
    object_title?: string
  }[]
  assert.equal(feed.find((e) => e.action === 'post.restore')?.object_title, 'Wrong numbers')
})

test('a comment comes back where it was, while the thing it is on stands', async () => {
  const { p, as } = await world()
  const task = (await call(`/api/projects/${p}/tasks`, as.writer, 'POST', { title: 'Ship it' })).body.id as string
  const say = async (who: keyof As, text: string) => {
    const r = await call(`/api/tasks/${task}/comments`, as[who], 'POST', { body: doc(text) })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    return r.body.id as string
  }
  const said = async () => ((await call(`/api/tasks/${task}`, as.plain)).body.comments as { id: string }[]).map((x) => x.id)

  const mine = await say('bare', 'On it')
  assert.equal((await call(`/api/comments/${mine}`, as.bare, 'DELETE')).status, 200)
  assert.ok(!(await said()).includes(mine))
  await refusedToOthers(as, `/api/comments/${mine}/restore`, ['plain', 'writer', 'deleter'])
  assert.equal((await call(`/api/comments/${mine}/restore`, as.bare, 'POST')).status, 200)
  assert.ok((await said()).includes(mine), 'back on the task')
  assert.equal((await call(`/api/comments/${mine}/restore`, as.bare, 'POST')).status, 404, 'a standing one is not restored')

  /* Taken away by whoever runs the project: theirs to undo, not the author's. */
  const theirs = await say('plain', 'Something rude')
  assert.equal((await call(`/api/comments/${theirs}`, as.runner, 'DELETE')).status, 200)
  assert.equal((await call(`/api/comments/${theirs}/restore`, as.plain, 'POST')).status, 403, 'not its author')
  assert.equal((await call(`/api/comments/${theirs}/restore`, as.runner, 'POST')).status, 200)

  /* On a task that has gone, it waits for the task. */
  assert.equal((await call(`/api/comments/${theirs}`, as.runner, 'DELETE')).status, 200)
  assert.equal((await call(`/api/tasks/${task}`, as.writer, 'DELETE')).status, 200)
  assert.equal((await call(`/api/comments/${theirs}/restore`, as.runner, 'POST')).status, 404)
  assert.equal((await call(`/api/tasks/${task}/restore`, as.writer, 'POST')).status, 200)
  assert.equal((await call(`/api/comments/${theirs}/restore`, as.runner, 'POST')).status, 200)
})

test('a channel comes back with its messages, to whoever may delete channels and could see it', async () => {
  const { p, as, ids } = await world()
  const open = async (members?: string[]) => {
    const r = await call(`/api/projects/${p}/conversations`, as.rooms, 'POST', {
      name: `launch-${stamp()}`,
      ...(members ? { member_ids: members } : {}),
    })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    return r.body.id as string
  }
  const room = await open()
  assert.equal((await call(`/api/conversations/${room}/messages`, as.writer, 'POST', { body: doc('Hello') })).status, 201)
  assert.equal((await call(`/api/conversations/${room}`, as.rooms, 'DELETE')).status, 200)
  const listed = async () => ((await call('/api/conversations', as.writer)).body.conversations as { id: string }[]).map((x) => x.id)
  assert.ok(!(await listed()).includes(room), 'gone')

  /* Making channels is not deleting them, nor is a task right. */
  await refusedToOthers(as, `/api/conversations/${room}/restore`, ['plain', 'writer', 'deleter'])
  assert.equal((await call(`/api/conversations/${room}/restore`, as.rooms, 'POST')).status, 200)
  const history = await call(`/api/conversations/${room}/messages`, as.writer)
  assert.equal(history.status, 200)
  assert.equal((history.body.messages as unknown[]).length, 1, 'its messages with it')
  assert.ok((await listed()).includes(room), 'back in the list')
  assert.equal((await call(`/api/conversations/${room}/restore`, as.rooms, 'POST')).status, 404, 'a standing one is not restored')
  /* Whoever runs the project may undo anybody's. */
  assert.equal((await call(`/api/conversations/${room}`, as.rooms, 'DELETE')).status, 200)
  assert.equal((await call(`/api/conversations/${room}/restore`, as.runner, 'POST')).status, 200)

  /* A room of chosen people stays theirs while it is deleted: the runner
     who is not in it is not told it exists, and the feed names it to nobody
     else. */
  assert.equal((await call('/api/webhooks', as.owner, 'POST', { url: 'https://example.com/hook', events: [] })).status, 201)
  const chosen = await open([ids.rooms, ids.writer])
  assert.equal((await call(`/api/conversations/${chosen}`, as.rooms, 'DELETE')).status, 200)
  assert.equal((await call(`/api/conversations/${chosen}/restore`, as.runner, 'POST')).status, 404, 'not in it')
  assert.equal((await call(`/api/conversations/${chosen}/restore`, as.writer, 'POST')).status, 403, 'in it, without the right')
  assert.equal((await call(`/api/conversations/${chosen}/restore`, as.rooms, 'POST')).status, 200)
  const lines = (await call(`/api/activity?project=${p}&object=${chosen}`, as.plain)).body.events as unknown[]
  assert.deepEqual(lines, [], 'nothing about it outside the room')
  const [queued] = await asTableOwner()<{ n: number }[]>`
    select count(*)::int as n from webhook_delivery where payload->>'object_id' = ${chosen}`
  assert.equal(queued!.n, 0, 'nor to a webhook')
})

test('a direct conversation has nothing to restore', async () => {
  const { as, ids } = await world()
  const made = await call('/api/conversations/direct', as.writer, 'POST', { actor_ids: [ids.plain] })
  assert.equal(made.status, 201)
  assert.equal((await call(`/api/conversations/${made.body.id as string}/restore`, as.writer, 'POST')).status, 404)
})

/* From the independent review of. */

test('a step deleted on its own before stays deleted when its task is put back', async () => {
  const { p, as } = await world()
  const task = (await call(`/api/projects/${p}/tasks`, as.writer, 'POST', { title: 'Launch' })).body.id as string
  const kept = (await call(`/api/projects/${p}/tasks`, as.writer, 'POST', { title: 'Kept', parent_id: task })).body.id as string
  const dropped = (await call(`/api/projects/${p}/tasks`, as.writer, 'POST', { title: 'Dropped', parent_id: task })).body.id as string
  /* Taken down by somebody else first: theirs, and not the task's Undo. */
  assert.equal((await call(`/api/tasks/${dropped}`, as.runner, 'DELETE')).status, 200)
  assert.equal((await call(`/api/tasks/${task}`, as.writer, 'DELETE')).status, 200)
  assert.equal((await call(`/api/tasks/${task}/restore`, as.writer, 'POST')).status, 200)
  const rows = await asTableOwner()<{ id: string; gone: boolean }[]>`
    select id, deleted_at is not null as gone from task where id in (${kept}, ${dropped})`
  assert.equal(rows.find((r) => r.id === kept)?.gone, false, 'the step that went with it is back')
  assert.equal(rows.find((r) => r.id === dropped)?.gone, true, 'the one deleted before stays deleted')
})

test('a restore the row’s policy refuses, or one already made, answers 404 and logs nothing', async () => {
  const { p, as, ids } = await world()
  const task = (await call(`/api/projects/${p}/tasks`, as.writer, 'POST', { title: 'Talk' })).body.id as string
  const said = (await call(`/api/tasks/${task}/comments`, as.plain, 'POST', { body: doc('Hm') })).body.id as string
  assert.equal((await call(`/api/comments/${said}`, as.runner, 'DELETE')).status, 200)
  /* Its deleter no longer runs the project: the token still says so, the
     database does not. */
  await asTableOwner()`update project_member set rights = '{}' where project_id = ${p} and actor_id = ${ids.runner}`
  assert.equal((await call(`/api/comments/${said}/restore`, as.runner, 'POST')).status, 404)
  const [none] = await asTableOwner()<{ n: number }[]>`
    select count(*)::int as n from activity_event where action = 'task.comment.restore' and object_id = ${task}`
  assert.equal(none!.n, 0, 'nothing logged')

  /* Twice at once: one puts it back, the other finds nothing to. */
  const mine = (await call(`/api/tasks/${task}/comments`, as.plain, 'POST', { body: doc('Again') })).body.id as string
  assert.equal((await call(`/api/comments/${mine}`, as.plain, 'DELETE')).status, 200)
  const both = await Promise.all([1, 2].map(() => call(`/api/comments/${mine}/restore`, as.plain, 'POST')))
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 404])

  const room = (await call(`/api/projects/${p}/conversations`, as.rooms, 'POST', { name: `twice-${stamp()}` })).body.id as string
  assert.equal((await call(`/api/conversations/${room}`, as.rooms, 'DELETE')).status, 200)
  const twice = await Promise.all([1, 2].map(() => call(`/api/conversations/${room}/restore`, as.rooms, 'POST')))
  assert.deepEqual(twice.map((r) => r.status).sort(), [200, 404])
  const [n] = await asTableOwner()<{ n: number }[]>`
    select count(*)::int as n from activity_event where action = 'conversation.restore' and object_id = ${room}`
  assert.equal(n!.n, 1, 'logged once')
})

test('what is said on a file in a room of chosen people is told to nobody outside it', async () => {
  const { p, as, workspaceId, ids } = await world()
  assert.equal((await call('/api/webhooks', as.owner, 'POST', { url: 'https://example.com/hook', events: [] })).status, 201)
  const room = (
    await call(`/api/projects/${p}/conversations`, as.rooms, 'POST', {
      name: `quiet-${stamp()}`,
      member_ids: [ids.rooms, ids.writer],
    })
  ).body.id as string
  const form = new FormData()
  form.append('file', new File([new Uint8Array([104, 105])], 'offer-letter.txt', { type: 'text/plain' }))
  const sent = await app.request(`/api/conversations/${room}/uploads`, {
    method: 'POST',
    headers: { authorization: `Bearer ${as.writer}` },
    body: form,
  })
  assert.equal(sent.status, 201)
  const { id } = (await sent.json()) as { id: string }
  const said = await call(`/api/files/${id}/comments`, as.writer, 'POST', { body: doc('Signed') })
  assert.equal(said.status, 201, JSON.stringify(said.body))
  const cid = said.body.id as string
  assert.equal((await call(`/api/comments/${cid}`, as.writer, 'PATCH', { body: doc('Signed, sealed') })).status, 200)
  assert.equal((await call(`/api/comments/${cid}`, as.writer, 'DELETE')).status, 200)
  assert.equal((await call(`/api/comments/${cid}/restore`, as.writer, 'POST')).status, 200)
  const [r] = await asTableOwner()<{ lines: number; hooks: number }[]>`
    select (select count(*)::int from activity_event where object_id = ${id}) as lines,
           (select count(*)::int from webhook_delivery
             where workspace_id = ${workspaceId} and payload->>'object_id' = ${id}) as hooks`
  assert.deepEqual({ ...r }, { lines: 0, hooks: 0 })
})
