import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { startSession } from '../src/auth/flows.js'
import { addPerson, closeDb, makeOwner, makeProject } from './helpers.js'

after(async () => {
  await closeDb()
})

async function call(method: string, path: string, token: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json()) as Record<string, unknown> }
}

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'text', text }] })

/**
 * Four ways a task is somebody's.
 *
 * Through HTTP and through the endpoints that make tasks and comments, so the
 * subscription and the activity row come from where they really come from
 * rather than from inserts this test would have to keep in step with them.
 */
test('my tasks, by assigned, created, subscribed and my own activity', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [project])
  const samToken = (await startSession(sam.actorId, workspaceId, {}, null)).access_token

  const make = async (as: string, title: string, assignee: string | null = null) => {
    const r = await call('POST', `/api/projects/${project}/tasks`, as, {
      title,
      assignee_id: assignee,
    })
    assert.equal(r.status, 201, title)
    return r.body.id as string
  }
  const onSam = await make(token, 'On Sam', sam.actorId)
  await make(samToken, 'Raised by Sam')
  await make(token, 'Nothing to do with Sam')
  // Commenting subscribes, and is the most recent thing Sam did.
  assert.equal((await call('POST', `/api/tasks/${onSam}/comments`, samToken, { body: doc('on it') })).status, 201)

  const titles = async (tab: string) => {
    const r = await call('GET', `/api/my/tasks?tab=${tab}`, samToken)
    assert.equal(r.status, 200, tab)
    return (r.body.tasks as { title: string }[]).map((t) => t.title)
  }

  assert.deepEqual(await titles('assigned'), ['On Sam'])
  assert.deepEqual(await titles('created'), ['Raised by Sam'])
  assert.deepEqual((await titles('subscribed')).sort(), ['On Sam', 'Raised by Sam'])
  assert.deepEqual(await titles('activity'), ['On Sam', 'Raised by Sam'])

  // No tab is the screen as it always was.
  const plain = await call('GET', '/api/my/tasks', samToken)
  assert.deepEqual(
    (plain.body.tasks as { title: string }[]).map((t) => t.title),
    ['On Sam'],
  )

  assert.equal((await call('GET', '/api/my/tasks?tab=everything', samToken)).status, 400)
})

/**
 * Several people on one task. Each of them has it
 * in Assigned, the list replaces what was there, only the people new to it
 * are told, and an app that knows one person still says one person.
 */
test('a task given to several is on each of them, and one app sends one', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [project])
  const dana = await addPerson(ctx, workspaceId, 'member', [project])
  const outsider = await addPerson(ctx, workspaceId, 'member')
  const samToken = (await startSession(sam.actorId, workspaceId, {}, null)).access_token
  const danaToken = (await startSession(dana.actorId, workspaceId, {}, null)).access_token

  const made = await call('POST', `/api/projects/${project}/tasks`, token, {
    title: 'Both of them',
    assignee_ids: [sam.actorId, dana.actorId, sam.actorId],
  })
  assert.equal(made.status, 201)
  const id = made.body.id as string

  const assigned = async (as: string) =>
    ((await call('GET', '/api/my/tasks?tab=assigned', as)).body.tasks as { title: string }[]).map((t) => t.title)
  assert.deepEqual(await assigned(samToken), ['Both of them'])
  assert.deepEqual(await assigned(danaToken), ['Both of them'])

  const read = async () => (await call('GET', `/api/tasks/${id}`, token)).body.task as { assignee_ids: string[]; assignee_id: string }
  assert.deepEqual((await read()).assignee_ids, [sam.actorId, dana.actorId], 'once each, in order')
  assert.equal((await read()).assignee_id, sam.actorId)

  const card = (await call('GET', `/api/tasks/${id}/card`, token)).body.card as { assignees: { id: string }[] }
  assert.deepEqual(
    card.assignees.map((a) => a.id),
    [sam.actorId, dana.actorId],
  )

  // Somebody not on the project, among people who are, refuses the whole write.
  assert.equal((await call('PATCH', `/api/tasks/${id}`, token, { assignee_ids: [sam.actorId, outsider.actorId] })).status, 400)
  assert.deepEqual((await read()).assignee_ids, [sam.actorId, dana.actorId])

  // The list replaces: Dana is off it, and it is no longer in her Assigned.
  assert.equal((await call('PATCH', `/api/tasks/${id}`, token, { assignee_ids: [sam.actorId] })).status, 200)
  assert.deepEqual(await assigned(danaToken), [])

  // One person from an app that knows one is the list of that one.
  assert.equal((await call('PATCH', `/api/tasks/${id}`, token, { assignee_id: dana.actorId })).status, 200)
  assert.deepEqual((await read()).assignee_ids, [dana.actorId])
  assert.equal((await call('PATCH', `/api/tasks/${id}`, token, { assignee_id: null })).status, 200)
  assert.deepEqual((await read()).assignee_ids, [])

  // Past ten is refused rather than cut.
  const many = Array.from({ length: 11 }, () => sam.actorId)
  assert.equal((await call('PATCH', `/api/tasks/${id}`, token, { assignee_ids: many })).status, 400)
})
