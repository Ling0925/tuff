import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { closeDb, withActor, uuidv7, makeOwner, makeProject } from './helpers.js'

after(async () => {
  await closeDb()
})

async function post(path: string, token: string, body: unknown) {
  const r = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  return { status: r.status, body: (await r.json()) as Record<string, unknown> }
}

/**
 * The rules that live in the database rather than in the endpoint.
 *
 * A rule written only in a controller is a rule the next way in does not
 * have, and this product has three ways in by design — the web, MCP and the
 * native clients all use the same REST endpoints, but the import path and
 * the seed write rows directly. So these are triggers, and this asks the
 * triggers.
 */
test('a subtask cannot have subtasks, however it is asked for', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Rebrand')

  const parent = await post(`/api/projects/${project}/tasks`, token, { title: 'Redo the entry' })
  assert.equal(parent.status, 201)
  const child = await post(`/api/projects/${project}/tasks`, token, {
    title: 'The password screen',
    parent_id: parent.body.id,
  })
  assert.equal(child.status, 201)

  // Through the endpoint.
  const grand = await post(`/api/projects/${project}/tasks`, token, {
    title: 'One deeper',
    parent_id: child.body.id,
  })
  assert.notEqual(grand.status, 201)

  // And straight at the table, which is the one that matters: two levels is
  // a limit on purpose, and a limit that only the endpoint knows is a limit
  // the seed and the importer walk straight past.
  await assert.rejects(
    withActor(
      ctx.actorId,
      (tx) =>
        tx`insert into task (id, workspace_id, project_id, author_id, parent_id, title, sort_key)
         values (${uuidv7()}, ${workspaceId}, ${project}, ${ctx.actorId},
                 ${child.body.id as string}, 'Deeper still', 'a9')`,
    ),
    /subtask cannot have subtasks/,
  )
})

test('a parent from another project is refused', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const here = await makeProject(ctx, workspaceId, 'Rebrand')
  const there = await makeProject(ctx, workspaceId, 'Wiki')

  const parent = await post(`/api/projects/${there}/tasks`, token, { title: 'Elsewhere' })
  await assert.rejects(
    withActor(
      ctx.actorId,
      (tx) =>
        tx`insert into task (id, workspace_id, project_id, author_id, parent_id, title, sort_key)
         values (${uuidv7()}, ${workspaceId}, ${here}, ${ctx.actorId},
                 ${parent.body.id as string}, 'Across', 'a1')`,
    ),
    /another project/,
  )
})

test('deleting a task takes its parts with it, and putting it back brings them', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Rebrand')
  const parent = await post(`/api/projects/${project}/tasks`, token, { title: 'Redo the entry' })
  const a = await post(`/api/tasks/${parent.body.id}/steps`, token, { title: 'Password screen' })
  const b = await post(`/api/tasks/${parent.body.id}/steps`, token, { title: 'Recovery' })
  assert.equal(a.status, 201)
  assert.equal(b.status, 201)

  const alive = async () =>
    (
      await withActor(
        ctx.actorId,
        (tx) =>
          tx<{ n: number }[]>`select count(*)::int as n from task
                            where parent_id = ${parent.body.id as string} and deleted_at is null`,
      )
    )[0]!.n

  assert.equal(await alive(), 2)

  const gone = await app.request(`/api/tasks/${parent.body.id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(gone.status, 200)
  assert.equal(await alive(), 0, 'parts left behind are orphans in the list')

  /* And back. The clear-out is what finally takes them, so until then the
     whole task has to be recoverable as the thing it was. */
  await withActor(ctx.actorId, (tx) => tx`update task set deleted_at = null where id = ${parent.body.id as string}`)
  assert.equal(await alive(), 2)
})

test('a part is made where its parent lives, and does not move the parent', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Rebrand')
  const listed = await post(`/api/projects/${project}/lists`, token, { name: 'Round one' })
  const parent = await post(`/api/projects/${project}/tasks`, token, {
    title: 'Redo the entry',
    list_id: listed.body.id,
  })
  const child = await post(`/api/tasks/${parent.body.id}/steps`, token, { title: 'Password' })

  const [row] = await withActor(
    ctx.actorId,
    (tx) =>
      tx<{ list_id: string; parent_id: string }[]>`
      select list_id, parent_id from task where id = ${child.body.id as string}`,
  )
  /* A part in another list from its parent cannot be drawn under it — and
     the list is the board's column too, so it could not be drawn there
     either. */
  assert.equal(row?.list_id, listed.body.id)
  assert.equal(row?.parent_id, parent.body.id)
})

test('a task is put under another and out again, one level deep, and told when it cannot be', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Rebrand')
  const a = await post(`/api/projects/${project}/tasks`, token, { title: 'One' })
  const b = await post(`/api/projects/${project}/tasks`, token, { title: 'Two' })
  const c = await post(`/api/projects/${project}/tasks`, token, { title: 'Three' })
  const patch = (id: unknown, body: unknown) =>
    app.request(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  const parentOf = async (id: unknown) =>
    (await withActor(ctx.actorId, (tx) => tx<{ parent_id: string | null }[]>`select parent_id from task where id = ${id as string}`))[0]
      ?.parent_id ?? null

  // Under A; written, not accepted and dropped as it once was.
  assert.equal((await patch(b.body.id, { parent_id: a.body.id })).status, 200)
  assert.equal(await parentOf(b.body.id), a.body.id)
  // One level, from both ends: not under B, which is a subtask; A, which has one, under nobody.
  assert.equal((await patch(c.body.id, { parent_id: b.body.id })).status, 400)
  assert.equal((await patch(a.body.id, { parent_id: c.body.id })).status, 400)
  // Not under itself, and alone in its request.
  assert.equal((await patch(c.body.id, { parent_id: c.body.id })).status, 400)
  assert.equal((await patch(c.body.id, { parent_id: a.body.id, after: null })).status, 400)
  // Out again: a task of its own.
  assert.equal((await patch(b.body.id, { parent_id: null })).status, 200)
  assert.equal(await parentOf(b.body.id), null)
  assert.equal(await parentOf(c.body.id), null)
})

test('moving a task takes its parts to the same list', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Rebrand')
  const from = await post(`/api/projects/${project}/lists`, token, { name: 'Backlog' })
  const to = await post(`/api/projects/${project}/lists`, token, { name: 'Doing' })
  const parent = await post(`/api/projects/${project}/tasks`, token, {
    title: 'Redo the entry',
    list_id: from.body.id,
  })
  const child = await post(`/api/tasks/${parent.body.id}/steps`, token, { title: 'Password' })

  const moved = await app.request(`/api/tasks/${parent.body.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ list_id: to.body.id }),
  })
  assert.equal(moved.status, 200)

  const [row] = await withActor(
    ctx.actorId,
    (tx) =>
      tx<{ list_id: string }[]>`
      select list_id from task where id = ${child.body.id as string}`,
  )
  // A part somewhere else cannot be drawn under its parent, in either view.
  assert.equal(row?.list_id, to.body.id)
})

test('finishing every part does not finish the task', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Rebrand')
  const parent = await post(`/api/projects/${project}/tasks`, token, { title: 'Redo the entry' })
  const only = await post(`/api/tasks/${parent.body.id}/steps`, token, { title: 'Password' })

  const r = await app.request(`/api/steps/${only.body.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ done: true }),
  })
  assert.equal(r.status, 200)

  const [row] = await withActor(
    ctx.actorId,
    (tx) =>
      tx<{ completed_at: string | null }[]>`
      select completed_at from task where id = ${parent.body.id as string}`,
  )
  /* A task with every part done and the task itself not ticked is a real
     state worth seeing. A product that ticks it for you is a product that is
     wrong about whether the work is finished. */
  assert.equal(row?.completed_at, null)
})
