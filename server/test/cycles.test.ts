import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { closeDb, withActor, uuidv7, makeOwner, makeProject } from './helpers.js'

after(closeDb)

async function call(path: string, token: string, init: { method?: string; body?: unknown } = {}) {
  const r = await app.request(path, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}

/** A sprint can be renamed, moved in time, and taken away — and taking it
    away leaves its tasks, out of any sprint. */
test('a sprint is renamed, re-dated and removed, and its tasks stay', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Sprinting')
  const made = await call(`/api/projects/${project}/cycles`, token, {
    method: 'POST',
    body: { name: 'Sprint 1', starts_on: '2026-10-01', ends_on: '2026-10-14' },
  })
  assert.equal(made.status, 201)
  const id = made.body.id as string

  assert.equal((await call(`/api/cycles/${id}`, token, { method: 'PATCH', body: { name: 'Sprint 2', ends_on: '2026-10-20' } })).status, 200)
  const listed = await call(`/api/projects/${project}/cycles`, token)
  const y = (listed.body.cycles as { id: string; name: string; ends_on: string }[]).find((c) => c.id === id)!
  assert.equal(y.name, 'Sprint 2')
  assert.equal(y.ends_on, '2026-10-20')

  // The one rule the dates have.
  assert.equal((await call(`/api/cycles/${id}`, token, { method: 'PATCH', body: { ends_on: '2026-09-01' } })).status, 400)

  const taskId = uuidv7()
  await withActor(ctx.actorId, async (tx) => {
    await tx`insert into task (id, workspace_id, project_id, author_id, title, sort_key, cycle_id)
             values (${taskId}, ${workspaceId}, ${project}, ${ctx.actorId}, 'In it', 'a0', ${id})`
  })
  assert.equal((await call(`/api/cycles/${id}`, token, { method: 'DELETE' })).status, 200)
  const after = await call(`/api/projects/${project}/cycles`, token)
  assert.equal(
    (after.body.cycles as { id: string }[]).some((c) => c.id === id),
    false,
  )
  const t = await call(`/api/tasks/${taskId}`, token)
  assert.equal(t.status, 200)
  assert.equal((t.body.task as { cycle_id: string | null }).cycle_id, null)
})

/** Put into a sprint as it is made — `cycle_id` was in the body's schema and
    never written to the row. A sprint of another project is refused, the way
    its labels are. */
test('a task is made into a sprint of its own project, and not of another', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Sprinting')
  const elsewhere = await makeProject(ctx, workspaceId, 'Elsewhere')
  const sprint = async (p: string) =>
    (
      await call(`/api/projects/${p}/cycles`, token, {
        method: 'POST',
        body: { name: 'Sprint 1', starts_on: '2026-10-01', ends_on: '2026-10-14' },
      })
    ).body.id as string
  const ours = await sprint(project)
  const theirs = await sprint(elsewhere)

  const made = await call(`/api/projects/${project}/tasks`, token, {
    method: 'POST',
    body: { title: 'In the sprint', cycle_id: ours, priority: 'high' },
  })
  assert.equal(made.status, 201)
  const read = await call(`/api/tasks/${made.body.id as string}`, token)
  const task = (read.body.task ?? read.body) as { cycle_id: string; priority: string }
  assert.equal(task.cycle_id, ours)
  assert.equal(task.priority, 'high')

  const refused = await call(`/api/projects/${project}/tasks`, token, {
    method: 'POST',
    body: { title: 'In somebody else’s', cycle_id: theirs },
  })
  assert.equal(refused.status, 400)
})
