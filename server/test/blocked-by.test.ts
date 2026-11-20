import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { closeDb, makeOwner, makeProject, addPerson, bearerFor } from './helpers.js'

after(async () => {
  await closeDb()
})

/**
 * Blocked by.
 *
 * Added and taken away, no loops, nothing shown or reachable across a
 * project the reader cannot see, one note when the last blocker is done,
 * deleting and copying, and the agent's way in.
 */

type J = Record<string, any>
async function call(method: string, path: string, token: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as J }
}
const post = (path: string, token: string, body: unknown = {}) => call('POST', path, token, body)
const get = (path: string, token: string) => call('GET', path, token)
const patch = (path: string, token: string, body: unknown) => call('PATCH', path, token, body)
const del = (path: string, token: string) => call('DELETE', path, token)

async function list(project: string, token: string, name: string, finishes = false): Promise<string> {
  const r = await post(`/api/projects/${project}/lists`, token, { name, finishes })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  return r.body.id as string
}

async function task(project: string, token: string, title: string, more: J = {}): Promise<{ id: string; handle: string }> {
  const r = await post(`/api/projects/${project}/tasks`, token, { title, ...more })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  const read = await get(`/api/tasks/${r.body.id}`, token)
  const p = await get(`/api/projects/${project}`, token)
  return { id: r.body.id as string, handle: `${p.body.key}-${read.body.task.number}` }
}

/** Two projects and three people: one on both, one on Website alone. */
async function scene() {
  const owner = await makeOwner()
  const { ctx, workspaceId, token } = owner
  const web = await makeProject(ctx, workspaceId, 'Website')
  const mob = await makeProject(ctx, workspaceId, 'Mobile')
  const webTodo = await list(web, token, 'Todo')
  const webDone = await list(web, token, 'Done', true)
  const mobTodo = await list(mob, token, 'Todo')
  const mobDone = await list(mob, token, 'Done', true)
  const both = await addPerson(ctx, workspaceId, 'member', [web, mob])
  const onlyWeb = await addPerson(ctx, workspaceId, 'member', [web])
  return {
    ...owner,
    web,
    mob,
    webTodo,
    webDone,
    mobTodo,
    mobDone,
    both: { ...both, token: await bearerFor(both.actorId, workspaceId) },
    onlyWeb: { ...onlyWeb, token: await bearerFor(onlyWeb.actorId, workspaceId) },
  }
}

const rowOf = async (project: string, token: string, id: string) =>
  ((await get(`/api/projects/${project}/tasks`, token)).body.tasks as J[]).find((t) => t.id === id)!

async function unblockedNotes(token: string, taskId: string): Promise<J[]> {
  const r = await get('/api/inbox', token)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return (r.body.notifications as J[]).filter((n) => n.reason === 'unblocked' && n.object_id === taskId)
}

test('a blocker is added once, read from both ends and on the row, and taken away', async () => {
  const s = await scene()
  const page = await task(s.web, s.token, 'Landing page', { list_id: s.webTodo })
  const copy = await task(s.mob, s.token, 'Approve the copy', { list_id: s.mobTodo })

  const added = await post(`/api/tasks/${page.id}/blocked-by`, s.token, { task_id: copy.id })
  assert.equal(added.status, 201, JSON.stringify(added.body))
  assert.equal(added.body.blocker.id, copy.id)
  assert.equal(`${added.body.blocker.project_key}-${added.body.blocker.number}`, copy.handle)
  const again = await post(`/api/tasks/${page.id}/blocked-by`, s.token, { task_id: copy.id })
  assert.equal(again.status, 200, 'already there is not an error')

  const waiting = await get(`/api/tasks/${page.id}`, s.token)
  assert.deepEqual(
    waiting.body.task.blocked_by.map((b: J) => b.id),
    [copy.id],
  )
  assert.deepEqual(waiting.body.task.blocks, [])
  const blocking = await get(`/api/tasks/${copy.id}`, s.token)
  assert.deepEqual(
    blocking.body.task.blocks.map((b: J) => b.id),
    [page.id],
  )
  assert.deepEqual((await rowOf(s.web, s.token, page.id)).waiting_on, [copy.handle])
  assert.deepEqual((await rowOf(s.mob, s.token, copy.id)).waiting_on, [])

  // A finished blocker no longer marks the row, and is still listed on the screen.
  assert.equal((await patch(`/api/tasks/${copy.id}`, s.token, { completed: true })).status, 200)
  assert.deepEqual((await rowOf(s.web, s.token, page.id)).waiting_on, [])
  assert.equal((await get(`/api/tasks/${page.id}`, s.token)).body.task.blocked_by.length, 1)

  const gone = await del(`/api/tasks/${page.id}/blocked-by/${copy.id}`, s.token)
  assert.equal(gone.status, 200)
  assert.deepEqual((await get(`/api/tasks/${page.id}`, s.token)).body.task.blocked_by, [])
  assert.equal((await del(`/api/tasks/${page.id}/blocked-by/${copy.id}`, s.token)).status, 200, 'nothing to remove is ok')
})

test('a task cannot wait on itself or on anything that already waits on it', async () => {
  const s = await scene()
  const a = await task(s.web, s.token, 'A')
  const b = await task(s.web, s.token, 'B')
  const c = await task(s.mob, s.token, 'C')

  assert.equal((await post(`/api/tasks/${a.id}/blocked-by`, s.token, { task_id: a.id })).status, 400)
  assert.equal((await post(`/api/tasks/${a.id}/blocked-by`, s.token, { task_id: b.id })).status, 201)
  assert.equal((await post(`/api/tasks/${b.id}/blocked-by`, s.token, { task_id: c.id })).status, 201)
  const loop = await post(`/api/tasks/${c.id}/blocked-by`, s.token, { task_id: a.id })
  assert.equal(loop.status, 409, JSON.stringify(loop.body))
  assert.equal(loop.body.error.code, 'cycle')
  const direct = await post(`/api/tasks/${b.id}/blocked-by`, s.token, { task_id: a.id })
  assert.equal(direct.status, 409)
  assert.deepEqual((await get(`/api/tasks/${c.id}`, s.token)).body.task.blocked_by, [])
})

test('nothing shows or is reachable across a project the reader cannot see', async () => {
  const s = await scene()
  const page = await task(s.web, s.token, 'Landing page')
  const secret = await task(s.mob, s.token, 'Secret launch')
  assert.equal((await post(`/api/tasks/${page.id}/blocked-by`, s.token, { task_id: secret.id })).status, 201)

  // Somebody on Website alone sees the task and nothing of what it waits on.
  const read = await get(`/api/tasks/${page.id}`, s.onlyWeb.token)
  assert.equal(read.status, 200)
  assert.deepEqual(read.body.task.blocked_by, [])
  assert.deepEqual((await rowOf(s.web, s.onlyWeb.token, page.id)).waiting_on, [])
  assert.equal(JSON.stringify(read.body).includes(secret.id), false)

  // Their own task, which they may edit: the other side is 404, both ways.
  const mine = await task(s.web, s.onlyWeb.token, 'Mine')
  assert.equal((await post(`/api/tasks/${mine.id}/blocked-by`, s.onlyWeb.token, { task_id: secret.id })).status, 404)
  assert.equal((await del(`/api/tasks/${page.id}/blocked-by/${secret.id}`, s.onlyWeb.token)).status, 404)
  assert.equal((await get(`/api/tasks/${secret.id}`, s.onlyWeb.token)).status, 404)
  // Somebody else's task: the right asked is the one that edits it, so the
  // answer is the one a change of its date gets.
  const edits = (await patch(`/api/tasks/${page.id}`, s.onlyWeb.token, { due_on: '2030-01-01' })).status
  const waits = (await post(`/api/tasks/${page.id}/blocked-by`, s.onlyWeb.token, { task_id: mine.id })).status
  assert.equal(waits, edits === 200 ? 201 : 403)
  // Whatever they added, the relation they cannot see is still there.
  assert.equal((await get(`/api/tasks/${page.id}`, s.token)).body.task.blocked_by.filter((b: J) => b.id === secret.id).length, 1)

  // Somebody on both sees it.
  assert.ok((await rowOf(s.web, s.both.token, page.id)).waiting_on.includes(secret.handle))

  // Another workspace's task is not there.
  const other = await makeOwner()
  const theirs = await makeProject(other.ctx, other.workspaceId, 'Theirs')
  const far = await task(theirs, other.token, 'Far away')
  assert.equal((await post(`/api/tasks/${page.id}/blocked-by`, s.token, { task_id: far.id })).status, 404)
  assert.equal((await post(`/api/tasks/${far.id}/blocked-by`, s.token, { task_id: page.id })).status, 404)
})

test('the assignees hear once, when the last blocker is done, if they may read both', async () => {
  const s = await scene()
  const page = await task(s.web, s.token, 'Landing page', {
    list_id: s.webTodo,
    assignee_ids: [s.both.actorId, s.onlyWeb.actorId],
  })
  const first = await task(s.mob, s.token, 'Approve the copy', { list_id: s.mobTodo })
  const second = await task(s.mob, s.token, 'Pick the photos', { list_id: s.mobTodo })
  await post(`/api/tasks/${page.id}/blocked-by`, s.token, { task_id: first.id })
  await post(`/api/tasks/${page.id}/blocked-by`, s.token, { task_id: second.id })

  // One of two done: it still waits, so nobody is told it can start.
  assert.equal((await patch(`/api/tasks/${first.id}`, s.token, { completed: true })).status, 200)
  assert.equal((await unblockedNotes(s.both.token, page.id)).length, 0)
  assert.deepEqual((await rowOf(s.web, s.token, page.id)).waiting_on, [second.handle])

  // The last, by a move into a finishing list.
  assert.equal((await patch(`/api/tasks/${second.id}`, s.token, { list_id: s.mobDone })).status, 200)
  const told = await unblockedNotes(s.both.token, page.id)
  assert.equal(told.length, 1)
  assert.equal(told[0]!.what, `${second.handle} is done — you can start ${page.handle}`)
  assert.equal(told[0]!.kind, 'unblocked')
  // Not somebody who cannot read the blocker: the line would name it.
  assert.equal((await unblockedNotes(s.onlyWeb.token, page.id)).length, 0)

  // Saving it finished again tells nobody again.
  await patch(`/api/tasks/${second.id}`, s.token, { completed: true })
  await patch(`/api/tasks/${second.id}`, s.token, { list_id: s.mobDone })
  assert.equal((await unblockedNotes(s.both.token, page.id)).length, 1)
  assert.equal((await get('/api/inbox', s.both.token)).body.unread.unblocked, '1')

  // Not the person who finished it.
  const theirs = await task(s.web, s.token, 'Their page', { assignee_ids: [s.both.actorId] })
  const own = await task(s.mob, s.both.token, 'Their own blocker', { list_id: s.mobTodo })
  await post(`/api/tasks/${theirs.id}/blocked-by`, s.token, { task_id: own.id })
  await patch(`/api/tasks/${own.id}`, s.both.token, { completed: true })
  assert.equal((await unblockedNotes(s.both.token, theirs.id)).length, 0)
})

test('a deleted blocker holds nothing up and comes back with its task; copies carry no relations', async () => {
  const s = await scene()
  const page = await task(s.web, s.token, 'Landing page', { list_id: s.webTodo })
  const copy = await task(s.mob, s.token, 'Approve the copy', { list_id: s.mobTodo })
  const after = await task(s.web, s.token, 'Launch post', { list_id: s.webTodo })
  await post(`/api/tasks/${page.id}/blocked-by`, s.token, { task_id: copy.id })
  await post(`/api/tasks/${after.id}/blocked-by`, s.token, { task_id: page.id })

  // Copying or duplicating a task in the middle of a chain carries neither end.
  const dup = await post(`/api/tasks/${page.id}/duplicate`, s.token)
  assert.equal(dup.status, 201, JSON.stringify(dup.body))
  const dupRead = (await get(`/api/tasks/${dup.body.id}`, s.token)).body.task
  assert.deepEqual(dupRead.blocked_by, [])
  assert.deepEqual(dupRead.blocks, [])
  const copied = await post(`/api/tasks/${page.id}/copy`, s.token, { project_id: s.mob })
  assert.ok(copied.status === 200 || copied.status === 201, JSON.stringify(copied.body))
  const copiedRead = (await get(`/api/tasks/${copied.body.id}`, s.token)).body.task
  assert.deepEqual(copiedRead.blocked_by, [])
  assert.deepEqual(copiedRead.blocks, [])
  assert.equal((await get(`/api/tasks/${page.id}`, s.token)).body.task.blocked_by.length, 1, 'the original keeps its own')

  // Deleted, the blocker marks nothing and is not listed; restored, it is back.
  assert.equal((await del(`/api/tasks/${copy.id}`, s.token)).status, 200)
  assert.deepEqual((await rowOf(s.web, s.token, page.id)).waiting_on, [])
  assert.deepEqual((await get(`/api/tasks/${page.id}`, s.token)).body.task.blocked_by, [])
  assert.equal((await post(`/api/tasks/${copy.id}/restore`, s.token)).status, 200)
  assert.deepEqual((await rowOf(s.web, s.token, page.id)).waiting_on, [copy.handle])

  // A deleted task that waited is not listed under what it waited on.
  assert.equal((await del(`/api/tasks/${after.id}`, s.token)).status, 200)
  assert.deepEqual((await get(`/api/tasks/${page.id}`, s.token)).body.task.blocks, [])
})

test('an agent adds and removes a blocker through update_task, by handle', async () => {
  const s = await scene()
  const page = await task(s.web, s.token, 'Landing page')
  const copy = await task(s.mob, s.token, 'Approve the copy')
  const token = (await post('/api/tokens', s.token, { name: 'Claude Code' })).body.token as string
  assert.ok(token)
  let n = 0
  const tool = async (name: string, args: J) => {
    const r = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name, arguments: args } }),
    })
    const out = (await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }
    return { text: out.result.content[0]!.text, error: out.result.isError === true }
  }

  const added = await tool('update_task', { task_id: page.id, blocked_by_add: [copy.handle] })
  assert.equal(added.error, false, added.text)
  assert.deepEqual(
    (await get(`/api/tasks/${page.id}`, s.token)).body.task.blocked_by.map((b: J) => b.id),
    [copy.id],
  )
  const read = await tool('read_task', { task: page.handle })
  assert.ok(read.text.includes('"blocked_by"') && read.text.includes(copy.id), read.text)

  const loop = await tool('update_task', { task_id: copy.id, blocked_by_add: [page.id] })
  assert.equal(loop.error, true, 'a loop is refused through the agent too')

  const removed = await tool('update_task', { task_id: page.id, blocked_by_remove: [copy.id] })
  assert.equal(removed.error, false, removed.text)
  assert.deepEqual((await get(`/api/tasks/${page.id}`, s.token)).body.task.blocked_by, [])
})

test('finishing or reopening a blocker answers the tasks it blocks with what they wait on now', async () => {
  const s = await scene()
  const page = await task(s.web, s.token, 'Landing page', { list_id: s.webTodo })
  const copy = await task(s.mob, s.token, 'Approve the copy', { list_id: s.mobTodo })
  await post(`/api/tasks/${page.id}/blocked-by`, s.token, { task_id: copy.id })

  const done = await patch(`/api/tasks/${copy.id}`, s.token, { list_id: s.mobDone })
  assert.deepEqual(done.body.rewaits, [{ id: page.id, waiting_on: [] }])
  const reopened = await patch(`/api/tasks/${copy.id}`, s.token, { list_id: s.mobTodo })
  assert.deepEqual(reopened.body.rewaits, [{ id: page.id, waiting_on: [copy.handle] }])
  // Nothing about whether it is finished changed: nothing to say.
  const renamed = await patch(`/api/tasks/${copy.id}`, s.token, { title: 'Approve the words' })
  assert.deepEqual(renamed.body.rewaits, [])
  // Somebody who cannot see the waiting task hears nothing of it.
  const mobOnly = await addPerson(s.ctx, s.workspaceId, 'member', [s.mob])
  const own = await task(s.mob, await bearerFor(mobOnly.actorId, s.workspaceId), 'Their blocker', { list_id: s.mobTodo })
  await post(`/api/tasks/${page.id}/blocked-by`, s.token, { task_id: own.id })
  const quiet = await patch(`/api/tasks/${own.id}`, await bearerFor(mobOnly.actorId, s.workspaceId), { list_id: s.mobDone })
  assert.equal(quiet.status, 200)
  assert.deepEqual(quiet.body.rewaits, [])
})
