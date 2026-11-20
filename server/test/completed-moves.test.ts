import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { closeDb, makeOwner } from './helpers.js'

/**
 * `completed` on a task in a list moves it.
 * It wrote the stamp and left the task where it
 * was, so an agent finishing a task through MCP left it ticked in Backlog
 * and drawn open on the board.
 */
after(async () => {
  await closeDb()
})

const call = async (method: string, path: string, token: string, body?: unknown) => {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json()) as Record<string, unknown> }
}

type List = { id: string; name: string; finishes: boolean; icon: string }
type Task = { id: string; list_id: string | null; completed_at: string | null }

test('completing a task takes it to Done, and opening it again to Todo; a part keeps its tick', async () => {
  const me = await makeOwner()
  /* Through the endpoint, so it starts with the six lists a project has. */
  const created = await call('POST', '/api/projects', me.token, { name: `Completed moves ${Date.now()}` })
  assert.equal(created.status, 201)
  const project = ((created.body.project as { id?: string } | undefined)?.id ?? created.body.id) as string
  const lists = ((await call('GET', `/api/projects/${project}/lists`, me.token)).body.lists ?? []) as List[]
  const done = lists.find((l) => l.finishes && l.icon === 'done')
  const todo = lists.find((l) => !l.finishes && l.icon === 'open')
  assert.ok(done && todo, 'a project starts with Done and Todo')

  const made = await call('POST', `/api/projects/${project}/tasks`, me.token, { title: 'Ship it' })
  assert.equal(made.status, 201)
  const id = made.body.id as string
  const read = async () => (await call('GET', `/api/tasks/${id}`, me.token)).body.task as Task

  assert.equal((await call('PATCH', `/api/tasks/${id}`, me.token, { completed: true })).status, 200)
  let t = await read()
  assert.equal(t.list_id, done.id, 'in Done')
  assert.ok(t.completed_at, 'and stamped')

  assert.equal((await call('PATCH', `/api/tasks/${id}`, me.token, { completed: false })).status, 200)
  t = await read()
  assert.equal(t.list_id, todo.id, 'back in Todo')
  assert.equal(t.completed_at, null)

  /* A list named alongside wins: the caller said where. */
  const review = lists.find((l) => !l.finishes && l.id !== todo.id)!
  assert.equal((await call('PATCH', `/api/tasks/${id}`, me.token, { completed: true, list_id: review.id })).status, 200)
  t = await read()
  assert.equal(t.list_id, review.id)

  /* A part has no list of its own and keeps the tick. */
  const part = await call('POST', `/api/projects/${project}/tasks`, me.token, { title: 'A part', parent_id: id })
  assert.equal(part.status, 201)
  const partId = part.body.id as string
  const before = ((await call('GET', `/api/tasks/${partId}`, me.token)).body.task as Task).list_id
  assert.equal((await call('PATCH', `/api/tasks/${partId}`, me.token, { completed: true })).status, 200)
  const p = (await call('GET', `/api/tasks/${partId}`, me.token)).body.task as Task
  assert.ok(p.completed_at, 'the part is ticked')
  assert.equal(p.list_id, before, 'and stays where its parent put it')
})
