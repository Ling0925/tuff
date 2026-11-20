import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { startSession } from '../src/auth/flows.js'
import { addPerson, closeDb, makeOwner, makeProject, withActor, uuidv7 } from './helpers.js'

after(async () => {
  await closeDb()
})

/*
 * A project's channel made for chosen people stays theirs when the last of
 * them goes — migration 240 finding 4. "Nobody in it" used to read
 * as "everybody on the project", so the room opened, history and all, the
 * moment its last person was taken out of the workspace.
 */
const req = (method: string, path: string, token: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const tokenFor = async (actorId: string, workspaceId: string) => (await startSession(actorId, workspaceId, {}, null)).access_token
const rooms = async (token: string) =>
  ((await (await req('GET', '/api/conversations', token)).json()) as { conversations: { id: string }[] }).conversations.map((r) => r.id)

test('a room of chosen people does not open to the project when its last person is removed', async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Studio')
  const ann = await addPerson(ctx, workspaceId, 'member', [project], ['task.create', 'channel.create'])
  const ben = await addPerson(ctx, workspaceId, 'member', [project], ['task.create'])
  const annT = await tokenFor(ann.actorId, workspaceId)
  const benT = await tokenFor(ben.actorId, workspaceId)

  const made = await req('POST', `/api/projects/${project}/conversations`, annT, { name: 'secret', member_ids: [ann.actorId] })
  assert.equal(made.status, 201)
  const { id } = (await made.json()) as { id: string }
  assert.equal(
    (
      await req('POST', `/api/conversations/${id}/messages`, annT, {
        body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'only ann' }] }] },
      })
    ).status,
    201,
  )
  assert.equal((await rooms(benT)).includes(id), false)

  // Ann is taken out of the workspace: the room loses its only person.
  assert.equal((await req('DELETE', `/api/people/${ann.actorId}`, owner)).status, 200)

  assert.equal((await rooms(benT)).includes(id), false, 'ben is not let in by ann leaving')
  const read = (await (await req('GET', `/api/conversations/${id}/messages`, benT)).json()) as { messages?: unknown[] }
  assert.equal(read.messages?.length ?? 0, 0)
  assert.equal((await rooms(owner)).includes(id), false, 'nor the owner, who was never chosen')
  const seen = await withActor(ben.actorId, (tx) => tx<{ ok: boolean }[]>`select can_see_conversation(${id}) as ok`)
  assert.equal(seen[0]?.ok, false)
})

test('unticking the last person, or leaving it with nobody, keeps it closed; null hands it back', async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Studio')
  const ben = await addPerson(ctx, workspaceId, 'member', [project], ['task.create'])
  const benT = await tokenFor(ben.actorId, workspaceId)

  const { id } = (await (
    await req('POST', `/api/projects/${project}/conversations`, owner, { name: 'two', member_ids: [ctx.actorId] })
  ).json()) as { id: string }
  assert.equal((await rooms(benT)).includes(id), false)

  // Every row's way in gone, without anybody handing it back.
  await withActor(ctx.actorId, (tx) => tx`update conversation_member set joined_at = null where conversation_id = ${id}`)
  assert.equal((await rooms(benT)).includes(id), false)

  // A project's room made with nobody chosen is the project's, and stays so
  // when somebody keeps a read mark or a setting in it.
  const { id: open } = (await (await req('POST', `/api/projects/${project}/conversations`, owner, { name: 'all' })).json()) as {
    id: string
  }
  assert.equal((await rooms(benT)).includes(open), true)
  assert.equal((await req('PUT', `/api/conversations/${open}/notify`, benT, { notify: 'mentions' })).status, 200)
  assert.equal((await rooms(benT)).includes(open), true)

  // Choosing people closes it; null, and only null, opens it again.
  assert.equal((await req('PUT', `/api/conversations/${open}/members`, owner, { member_ids: [ctx.actorId] })).status, 200)
  assert.equal((await rooms(benT)).includes(open), false)
  const members = (await (await req('GET', `/api/conversations/${open}/members`, owner)).json()) as { chosen: boolean }
  assert.equal(members.chosen, true)
  assert.equal((await req('PUT', `/api/conversations/${open}/members`, owner, { member_ids: null })).status, 200)
  assert.equal((await rooms(benT)).includes(open), true)

  // A row written straight in — a seed, an import — chooses too.
  const { id: seeded } = (await (await req('POST', `/api/projects/${project}/conversations`, owner, { name: 'seeded' })).json()) as {
    id: string
  }
  await withActor(
    ctx.actorId,
    (tx) =>
      tx`insert into conversation_member (id, workspace_id, conversation_id, actor_id, joined_at)
       values (${uuidv7()}, ${workspaceId}, ${seeded}, ${ctx.actorId}, now())`,
  )
  assert.equal((await rooms(benT)).includes(seeded), false)
})

/*
 * A room nobody is in is still somebody's to end — migration 245, the
 * review of finding 4. By name only, and only to the owner and whoever may
 * delete the project's channels.
 */
test('a room nobody is in is ended by the owner or a runner, by name only; nobody else knows it is there', async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Studio')
  const ann = await addPerson(ctx, workspaceId, 'member', [project], ['task.create', 'channel.create'])
  const runner = await addPerson(ctx, workspaceId, 'member', [project], ['channel.delete'])
  const ben = await addPerson(ctx, workspaceId, 'member', [project], ['task.create'])
  const annT = await tokenFor(ann.actorId, workspaceId)
  const runT = await tokenFor(runner.actorId, workspaceId)
  const benT = await tokenFor(ben.actorId, workspaceId)
  const empties = async (token: string) =>
    ((await (await req('GET', `/api/projects/${project}/empty-channels`, token)).json()) as { channels: { id: string; name: string }[] })
      .channels
  const make = async (name: string) =>
    (
      (await (await req('POST', `/api/projects/${project}/conversations`, annT, { name, member_ids: [ann.actorId] })).json()) as {
        id: string
      }
    ).id

  const one = await make('one')
  const two = await make('two')
  await req('POST', `/api/conversations/${one}/messages`, annT, {
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'secret' }] }] },
  })
  // While Ann is in them they are hers: nobody else is told they exist.
  assert.deepEqual(await empties(owner), [])
  assert.equal((await req('DELETE', `/api/conversations/${one}`, owner)).status, 404)
  assert.equal((await req('PUT', `/api/conversations/${one}/members`, owner, { member_ids: null })).status, 404)

  assert.equal((await req('DELETE', `/api/people/${ann.actorId}`, owner)).status, 200)
  assert.deepEqual((await empties(owner)).map((r) => r.name).sort(), ['one', 'two'])
  assert.deepEqual((await empties(runT)).map((r) => r.name).sort(), ['one', 'two'])
  assert.deepEqual(await empties(benT), [], 'not to somebody who may not delete channels')
  assert.equal((await req('DELETE', `/api/conversations/${one}`, benT)).status, 404)
  // Nothing said in it is anybody's yet.
  const read = (await (await req('GET', `/api/conversations/${one}/messages`, owner)).json()) as { messages?: unknown[] }
  assert.equal(read.messages?.length ?? 0, 0)
  // A list of people is not how it is ended.
  assert.equal((await req('PUT', `/api/conversations/${one}/members`, owner, { member_ids: [ctx.actorId] })).status, 404)

  // Opened to the project by the runner: everybody on it has it now.
  assert.equal((await req('PUT', `/api/conversations/${one}/members`, runT, { member_ids: null })).status, 200)
  assert.equal((await rooms(benT)).includes(one), true)
  // Deleted by the owner.
  assert.equal((await req('DELETE', `/api/conversations/${two}`, owner)).status, 200)
  assert.deepEqual(await empties(owner), [])
})

test('a channel chosen for nobody on the project is refused, not made empty', async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Studio')
  const outsider = await addPerson(ctx, workspaceId, 'member', [])
  // The owner off the project, naming somebody who is not on it either.
  await withActor(
    ctx.actorId,
    (tx) => tx`update project_member set deleted_at = now() where project_id = ${project} and actor_id = ${ctx.actorId}`,
  )
  const r = await req('POST', `/api/projects/${project}/conversations`, owner, { name: 'nobody', member_ids: [outsider.actorId] })
  assert.equal(r.status, 400)
  const [n] = await withActor(
    ctx.actorId,
    (tx) => tx<{ n: number }[]>`select count(*)::int as n from conversation where project_id = ${project} and name = 'nobody'`,
  )
  assert.equal(n?.n, 0)
})

/*
 * The re-review's reproduction (migration 247): a room is not empty while
 * anybody in it can still see it — an owner off the project included.
 */
test('an owner off the project still in their own room keeps it from being “empty”', async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Studio')
  const runner = await addPerson(ctx, workspaceId, 'member', [project], ['channel.delete'])
  const ben = await addPerson(ctx, workspaceId, 'member', [project], ['task.create'])
  const runT = await tokenFor(runner.actorId, workspaceId)
  const benT = await tokenFor(ben.actorId, workspaceId)

  const made = await req('POST', `/api/projects/${project}/conversations`, owner, { name: 'mine', member_ids: [ctx.actorId] })
  assert.equal(made.status, 201)
  const { id } = (await made.json()) as { id: string }
  const said = await req('POST', `/api/conversations/${id}/messages`, owner, {
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'the owner only' }] }] },
  })
  assert.equal(said.status, 201)
  // The owner steps off the project, and still reads the room.
  await withActor(
    ctx.actorId,
    (tx) => tx`update project_member set deleted_at = now() where project_id = ${project} and actor_id = ${ctx.actorId}`,
  )
  assert.equal((await rooms(owner)).includes(id), true)

  // So it is nobody's to open or delete but the owner's own.
  const listed = (await (await req('GET', `/api/projects/${project}/empty-channels`, runT)).json()) as { channels: { id: string }[] }
  assert.deepEqual(listed.channels, [])
  assert.equal((await req('PUT', `/api/conversations/${id}/members`, runT, { member_ids: null })).status, 404)
  assert.equal((await req('DELETE', `/api/conversations/${id}`, runT)).status, 404)
  assert.equal((await rooms(benT)).includes(id), false)
  const read = (await (await req('GET', `/api/conversations/${id}/messages`, benT)).json()) as { messages?: unknown[] }
  assert.equal(read.messages?.length ?? 0, 0)
  // And the check is nobody's to call directly.
  await assert.rejects(
    withActor(runner.actorId, (tx) => tx`select room_is_empty(${id})`),
    /permission denied/,
  )
})
