import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { addManager, addPerson, bearerFor, closeDb, makeOwner, makeProject, uuidv7, withActor } from './helpers.js'

after(async () => {
  await closeDb()
})

async function post(path: string, token: string, body: unknown) {
  const r = await app.request(path, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: r.status, body: (await r.json()) as Record<string, unknown> }
}

async function makeList(project: string, token: string, name = 'Now') {
  const r = await post(`/api/projects/${project}/lists`, token, { name })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  return r.body.id as string
}

async function makeTask(actorId: string, ws: string, project: string, title: string, parent?: string) {
  const id = uuidv7()
  await withActor(actorId, async (tx) => {
    await tx`
      insert into task (id, workspace_id, project_id, author_id, title, parent_id, sort_key)
      values (${id}, ${ws}, ${project}, ${actorId}, ${title}, ${parent ?? null}, ${'a' + id.replaceAll('-', '').slice(0, 20)})`
  })
  return id
}

test('a task, its parts, comments and matching labels move to another project', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const source = await makeProject(ctx, workspaceId, 'Source')
  const target = await makeProject(ctx, workspaceId, 'Target')
  const member = await addPerson(ctx, workspaceId, 'member', [source, target], ['task.create', 'task.delete'])
  await makeList(source, token)
  await makeList(target, token)

  const droppedLabel = uuidv7()
  const [label, targetLabel] = await withActor(ctx.actorId, async (tx) => {
    await tx`insert into label (id, workspace_id, project_id, name) values (${droppedLabel}, ${workspaceId}, ${source}, 'Source only')`
    const [a] = await tx<{ id: string }[]>`select id from label where project_id = ${source} and name = 'Bug' and deleted_at is null`
    const [b] = await tx<{ id: string }[]>`select id from label where project_id = ${target} and name = 'Bug' and deleted_at is null`
    if (!a || !b) throw new Error('starting labels missing')
    return [a.id, b.id]
  })
  const taskId = await makeTask(member.actorId, workspaceId, source, 'Move me')
  const partId = await makeTask(member.actorId, workspaceId, source, 'Move my part', taskId)
  const other = await makeTask(member.actorId, workspaceId, source, 'Move me too')
  const commentId = uuidv7()
  const partCommentId = uuidv7()
  await withActor(member.actorId, async (tx) => {
    await tx`update task set assignee_ids = ${[member.actorId]}::uuid[] where id = any(${[taskId, partId]}::uuid[])`
    await tx`insert into task_label (id, workspace_id, task_id, label_id)
             values (${uuidv7()}, ${workspaceId}, ${taskId}, ${label}),
                    (${uuidv7()}, ${workspaceId}, ${partId}, ${label}),
                    (${uuidv7()}, ${workspaceId}, ${taskId}, ${droppedLabel})`
    await tx`insert into comment (id, workspace_id, project_id, author_id, object_type, object_id, body)
             values (${commentId}, ${workspaceId}, ${source}, ${member.actorId}, 'task', ${taskId},
                     ${tx.json({ type: 'doc', content: [{ type: 'text', text: 'carry these words' }] } as never)}),
                    (${partCommentId}, ${workspaceId}, ${source}, ${member.actorId}, 'task', ${partId},
                     ${tx.json({ type: 'doc', content: [{ type: 'text', text: 'part words' }] } as never)})`
  })

  const dry = await post(`/api/tasks/${taskId}/move`, token, { project_id: target, dry: true })
  assert.equal(dry.status, 200)
  assert.equal(dry.body.subtasks, 1)
  assert.equal(dry.body.comments, 2)
  assert.deepEqual(dry.body.labels_kept, ['Bug'])
  assert.deepEqual(dry.body.labels_dropped, ['Source only'])

  const memberToken = await bearerFor(member.actorId, workspaceId)
  const moved = await post(`/api/tasks/${taskId}/move`, memberToken, { project_id: target })
  assert.equal(moved.status, 201, JSON.stringify(moved.body))
  assert.equal(moved.body.id, taskId)
  assert.equal(typeof moved.body.number, 'number')
  assert.equal(moved.body.comments, 2)
  assert.equal((moved.body.assignees_dropped as unknown[]).length, 0)

  const second = await post(`/api/tasks/${other}/move`, memberToken, { project_id: target })
  assert.equal(second.status, 201, JSON.stringify(second.body))
  assert.notEqual(second.body.number, moved.body.number)

  await withActor(ctx.actorId, async (tx) => {
    const rows = await tx<{ id: string; project_id: string; parent_id: string | null; number: number }[]>`
      select id, project_id, parent_id, number from task where id = any(${[taskId, partId]}::uuid[]) order by parent_id nulls first`
    assert.deepEqual(
      rows.map((r) => [r.id, r.project_id]),
      [
        [taskId, target],
        [partId, target],
      ],
    )
    assert.equal(rows[1]?.parent_id, taskId)
    const comments = await tx<{ id: string; project_id: string }[]>`
      select id, project_id from comment where id = any(${[commentId, partCommentId]}::uuid[]) order by id`
    assert.deepEqual(
      comments.map((c) => c.project_id),
      [target, target],
    )
    const mapped = await tx<
      { n: number }[]
    >`select count(*)::int as n from task_label where task_id = any(${[taskId, partId]}::uuid[]) and label_id = ${targetLabel}`
    assert.equal(mapped[0]?.n, 2)
  })
})

test('moving is refused without both projects and a bad target list is invalid', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const source = await makeProject(ctx, workspaceId, 'Source')
  const target = await makeProject(ctx, workspaceId, 'Target')
  await makeList(source, token)
  await makeList(target, token)
  const ownerTask = await makeTask(ctx.actorId, workspaceId, source, 'Not yours')

  const neither = await addPerson(ctx, workspaceId, 'member', [], [])
  const neitherToken = await bearerFor(neither.actorId, workspaceId)
  assert.equal((await post(`/api/tasks/${ownerTask}/move`, neitherToken, { project_id: target })).status, 404)

  const creatorOnly = await addPerson(ctx, workspaceId, 'member', [source, target], ['task.create'])
  const creatorToken = await bearerFor(creatorOnly.actorId, workspaceId)
  const refused = await post(`/api/tasks/${ownerTask}/move`, creatorToken, { project_id: target })
  assert.equal(refused.status, 403)

  const manager = await addManager(ctx, workspaceId, [source, target])
  const managerToken = await bearerFor(manager.actorId, workspaceId)
  const badList = await post(`/api/tasks/${ownerTask}/move`, managerToken, { project_id: target, list_id: uuidv7() })
  assert.equal(badList.status, 400)
  const same = await post(`/api/tasks/${ownerTask}/move`, managerToken, { project_id: source })
  assert.equal(same.status, 400)

  const moved = await post(`/api/tasks/${ownerTask}/move`, managerToken, { project_id: target })
  assert.equal(moved.status, 201, JSON.stringify(moved.body))

  const stranger = await addPerson(ctx, workspaceId, 'member', [source], ['task.create', 'task.delete'])
  const strangerToken = await bearerFor(stranger.actorId, workspaceId)
  assert.equal((await post(`/api/tasks/${ownerTask}/move`, strangerToken, { project_id: target })).status, 404)
})
