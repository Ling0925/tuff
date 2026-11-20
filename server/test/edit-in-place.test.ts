import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { TaskChanged, TaskDuplicated, StepMade, StepChanged, TaskDeleted, TaskCopied } from '@tracker/shared-schema'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { closeDb, makeOwner, makeProject } from './helpers.js'

/*
 * A write answers the rows it changed, as the project's list draws them, so
 * the screen that made it puts them in place rather than reading the
 * project again.
 */

after(async () => {
  await closeRealtime()
  await closeDb()
})

type Row = Record<string, unknown> & { id: string; list_id: string | null; parent_id: string | null; completed_at: string | null }

async function send(method: string, path: string, token: string, body?: unknown) {
  const r = await app.request(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> }
}

async function setUp() {
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, 'In place')
  const list = async (name: string, finishes = false) =>
    (await send('POST', `/projects/${project}/lists`, boss.token, { name, finishes })).body.id as string
  const todo = await list('Todo')
  const doing = await list('Doing')
  const done = await list('Done', true)
  return { ...boss, project, todo, doing, done }
}

/* The project's own read of one row — what the answer has to match. */
async function rowOf(token: string, project: string, id: string): Promise<Row> {
  const page = (await send('GET', `/projects/${project}/tasks?pictures=1`, token)).body.tasks as Row[]
  const row = page.find((t) => t.id === id)
  assert.ok(row, 'the row is in the list')
  return row
}

test('an edit answers the task as the list draws it, the same row the list reads', async () => {
  const s = await setUp()
  const label = (await send('POST', `/projects/${s.project}/labels`, s.token, { name: 'client' })).body.id as string
  const id = (await send('POST', `/projects/${s.project}/tasks`, s.token, { title: 'Draft', list_id: s.todo })).body.id as string

  const r = await send('PATCH', `/tasks/${id}`, s.token, {
    title: 'Final draft',
    priority: 'high',
    due_on: '2030-01-04',
    labels: [label],
    assignee_ids: [s.ctx.actorId],
  })
  assert.equal(r.status, 200)
  assert.ok(TaskChanged.safeParse(r.body).success, 'the answer is the schema’s')
  const row = r.body.task as Row
  assert.equal(row.title, 'Final draft')
  assert.equal(row.priority, 'high')
  assert.equal(row.due_on, '2030-01-04')
  assert.deepEqual(row.assignee_ids, [s.ctx.actorId])
  assert.equal(row.assignee_id, s.ctx.actorId)
  assert.deepEqual(
    (row.labels as { id: string }[]).map((l) => l.id),
    [label],
  )
  assert.equal(r.body.parts, undefined, 'no parts when it did not move')
  assert.deepEqual(row, await rowOf(s.token, s.project, id))
})

test('a move answers the task and its parts, finished with it in a finishing list', async () => {
  const s = await setUp()
  const id = (await send('POST', `/projects/${s.project}/tasks`, s.token, { title: 'Ship', list_id: s.todo })).body.id as string
  const part = await send('POST', `/tasks/${id}/steps`, s.token, { title: 'Pack' })
  assert.equal(part.status, 201)

  const moved = await send('PATCH', `/tasks/${id}`, s.token, { list_id: s.doing })
  assert.equal(moved.status, 200)
  assert.equal((moved.body.task as Row).list_id, s.doing)
  assert.equal(moved.body.task.sort_key, moved.body.sort_key, 'the row carries the key the move gave it')
  const parts = moved.body.parts as Row[]
  assert.deepEqual(
    parts.map((p) => [p.id, p.list_id]),
    [[part.body.id, s.doing]],
  )

  const finished = await send('PATCH', `/tasks/${id}`, s.token, { list_id: s.done })
  assert.ok((finished.body.task as Row).completed_at, 'finished by its list')
  assert.ok((finished.body.parts as Row[])[0]!.completed_at, 'and its part with it')
  assert.deepEqual(finished.body.task, await rowOf(s.token, s.project, id))
})

test('a part made and ticked answers its row, and what waited on it', async () => {
  const s = await setUp()
  const id = (await send('POST', `/projects/${s.project}/tasks`, s.token, { title: 'Launch', list_id: s.todo })).body.id as string
  const made = await send('POST', `/tasks/${id}/steps`, s.token, { title: 'Write the notes', priority: 'low' })
  assert.equal(made.status, 201)
  assert.ok(StepMade.safeParse(made.body).success)
  const part = made.body.task as Row
  assert.equal(part.id, made.body.id)
  assert.equal(part.parent_id, id)
  assert.equal(part.list_id, s.todo, 'in its parent’s list')
  assert.equal(part.priority, 'low')

  /* Something waits on the part. */
  const other = (await send('POST', `/projects/${s.project}/tasks`, s.token, { title: 'Announce', list_id: s.todo })).body.id as string
  assert.equal((await send('POST', `/tasks/${other}/blocked-by`, s.token, { task_id: part.id })).status, 201)

  const ticked = await send('PATCH', `/steps/${part.id}`, s.token, { done: true })
  assert.equal(ticked.status, 200)
  assert.ok(StepChanged.safeParse(ticked.body).success)
  assert.ok((ticked.body.task as Row).completed_at, 'the row is finished')
  assert.deepEqual(ticked.body.rewaits, [{ id: other, waiting_on: [] }])

  /* Ticked again to the same state: nothing changed state, nothing waits anew. */
  const again = await send('PATCH', `/steps/${part.id}`, s.token, { done: true })
  assert.deepEqual(again.body.rewaits, [])
})

test('a duplicate and a copy answer their rows; a skipped one of a series its next', async () => {
  const s = await setUp()
  const id = (await send('POST', `/projects/${s.project}/tasks`, s.token, { title: 'Plan', list_id: s.doing })).body.id as string
  await send('POST', `/tasks/${id}/steps`, s.token, { title: 'Outline' })

  const dup = await send('POST', `/tasks/${id}/duplicate`, s.token)
  assert.equal(dup.status, 201)
  assert.ok(TaskDuplicated.safeParse(dup.body).success)
  const rows = dup.body.tasks as Row[]
  assert.equal(rows[0]!.id, dup.body.id, 'the copy first')
  assert.equal(rows.length, 2, 'then its part')
  assert.equal(rows[1]!.parent_id, dup.body.id)

  const copy = await send('POST', `/tasks/${id}/copy`, s.token, { project_id: s.project })
  assert.equal(copy.status, 201)
  assert.ok(TaskCopied.safeParse(copy.body).success)
  assert.equal((copy.body.tasks as Row[])[0]!.id, copy.body.id)
  const dry = await send('POST', `/tasks/${id}/copy`, s.token, { project_id: s.project, dry: true })
  assert.equal(dry.body.tasks, undefined, 'a dry run makes no rows')

  const series = (
    await send('POST', `/projects/${s.project}/tasks`, s.token, {
      title: 'Weekly',
      list_id: s.todo,
      due_on: '2030-01-04',
      repeat: { every: 'week' },
    })
  ).body.id as string
  const gone = await send('DELETE', `/tasks/${series}`, s.token)
  assert.equal(gone.status, 200)
  assert.ok(TaskDeleted.safeParse(gone.body).success)
  assert.equal((gone.body.next as Row).title, 'Weekly')
  assert.equal(gone.body.next.due_on, '2030-01-11')
  assert.deepEqual(gone.body.next_parts, [])
  const plain = await send('DELETE', `/tasks/${id}`, s.token)
  assert.deepEqual(plain.body, { ok: true }, 'nothing more for a task that does not repeat')
})

test('a refused edit changes nothing and answers no row', async () => {
  const s = await setUp()
  const id = (await send('POST', `/projects/${s.project}/tasks`, s.token, { title: 'Keep', list_id: s.todo })).body.id as string
  const elsewhere = await makeProject(s.ctx, s.workspaceId, 'Elsewhere')
  const foreign = (await send('POST', `/projects/${elsewhere}/labels`, s.token, { name: 'theirs' })).body.id as string
  const r = await send('PATCH', `/tasks/${id}`, s.token, { title: 'Changed', labels: [foreign] })
  assert.equal(r.status, 400)
  assert.equal(r.body.task, undefined)
  assert.equal((await rowOf(s.token, s.project, id)).title, 'Keep')
})
