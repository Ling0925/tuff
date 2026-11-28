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

async function makeTask(actorId: string, ws: string, project: string, title: string, parent?: string, list?: string) {
  const id = uuidv7()
  await withActor(actorId, async (tx) => {
    await tx`
      insert into task (id, workspace_id, project_id, author_id, title, parent_id, list_id, sort_key)
      values (${id}, ${ws}, ${project}, ${actorId}, ${title}, ${parent ?? null}, ${list ?? null}, ${'a' + id.replaceAll('-', '').slice(0, 20)})`
  })
  return id
}

/** A list with the arrangement a move is asked to carry, not only a name. */
async function makeArrangedList(
  actorId: string,
  ws: string,
  project: string,
  name: string,
  meta: { icon?: string; color?: string | null; finishes?: boolean; narrow?: boolean; progress?: number | null; intake?: boolean } = {},
) {
  const id = uuidv7()
  await withActor(actorId, async (tx) => {
    await tx`
      insert into task_list (id, workspace_id, project_id, author_id, name, sort_key, icon, color, finishes, narrow, progress, intake)
      values (${id}, ${ws}, ${project}, ${actorId}, ${name}, ${'z' + id.replaceAll('-', '').slice(0, 20)},
              ${meta.icon ?? 'open'}, ${meta.color ?? null}, ${meta.finishes ?? false}, ${meta.narrow ?? false},
              ${meta.progress ?? null}, ${meta.intake ?? false})`
  })
  return id
}

async function makeLabel(actorId: string, ws: string, project: string, name: string, color?: string) {
  const id = uuidv7()
  await withActor(actorId, async (tx) => {
    await tx`insert into label (id, workspace_id, project_id, name, color) values (${id}, ${ws}, ${project}, ${name}, ${color ?? null})`
  })
  return id
}

async function tag(actorId: string, ws: string, task: string, label: string) {
  await withActor(actorId, async (tx) => {
    await tx`insert into task_label (id, workspace_id, task_id, label_id) values (${uuidv7()}, ${ws}, ${task}, ${label})`
  })
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
  assert.deepEqual(dry.body.labels_created, ['Source only'])
  assert.deepEqual(dry.body.labels_dropped, [])
  assert.equal(dry.body.list_created, false)

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

test('a dry run only reports the missing status and labels, and the move copies them', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const source = await makeProject(ctx, workspaceId, 'Source')
  const target = await makeProject(ctx, workspaceId, 'Target')
  const sourceList = await makeArrangedList(ctx.actorId, workspaceId, source, 'Design QA', {
    icon: 'review',
    color: 'pink',
    narrow: true,
    progress: 0.42,
  })
  await makeList(target, token, 'Target lane')
  const custom = await makeLabel(ctx.actorId, workspaceId, source, 'Client Need', 'orange')
  const [sourceBug] = await withActor(ctx.actorId, async (tx) => {
    return await tx<{ id: string }[]>`select id from label where project_id = ${source} and name = 'Bug' and deleted_at is null`
  })
  if (!sourceBug) throw new Error('starting label missing')
  const taskId = await makeTask(ctx.actorId, workspaceId, source, 'Carry the arrangement', undefined, sourceList)
  const partId = await makeTask(ctx.actorId, workspaceId, source, 'Carry the arrangement’s part', taskId, sourceList)
  await tag(ctx.actorId, workspaceId, taskId, custom)
  await tag(ctx.actorId, workspaceId, partId, custom)
  await tag(ctx.actorId, workspaceId, taskId, sourceBug.id)

  const dry = await post(`/api/tasks/${taskId}/move`, token, { project_id: target, dry: true })
  assert.equal(dry.status, 200, JSON.stringify(dry.body))
  assert.equal(dry.body.list_created, true)
  assert.equal(dry.body.list_id, null)
  assert.equal(dry.body.list_name, 'Design QA')
  assert.deepEqual(dry.body.labels_created, ['Client Need'])
  assert.deepEqual(dry.body.labels_kept, ['Bug'])
  assert.deepEqual(dry.body.labels_dropped, [])

  await withActor(ctx.actorId, async (tx) => {
    const [lists] = await tx<{ n: number }[]>`
      select count(*)::int as n from task_list where project_id = ${target} and name = 'Design QA' and deleted_at is null`
    const [words] = await tx<{ n: number }[]>`
      select count(*)::int as n from label where project_id = ${target} and name = 'Client Need' and deleted_at is null`
    assert.equal(lists?.n, 0)
    assert.equal(words?.n, 0)
  })

  const moved = await post(`/api/tasks/${taskId}/move`, token, { project_id: target })
  assert.equal(moved.status, 201, JSON.stringify(moved.body))
  assert.equal(moved.body.list_created, true)
  assert.equal(moved.body.list_name, 'Design QA')
  assert.equal(typeof moved.body.list_id, 'string')
  assert.deepEqual(moved.body.labels_created, ['Client Need'])
  assert.deepEqual(moved.body.labels_dropped, [])

  await withActor(ctx.actorId, async (tx) => {
    const [list] = await tx<
      {
        id: string
        icon: string
        color: string | null
        finishes: boolean
        narrow: boolean
        progress: number | null
        intake: boolean
        agent_id: string | null
      }[]
    >`
      select id, icon, color, finishes, narrow, progress, intake, agent_id from task_list
      where project_id = ${target} and name = 'Design QA' and deleted_at is null`
    assert.ok(list)
    assert.equal(list.id, moved.body.list_id)
    assert.equal(list.icon, 'review')
    assert.equal(list.color, 'pink')
    assert.equal(list.finishes, false)
    assert.equal(list.narrow, true)
    assert.equal(list.progress, 0.42)
    assert.equal(list.intake, false)
    assert.equal(list.agent_id, null)

    const rows = await tx<{ id: string; list_id: string | null }[]>`
      select id, list_id from task where id = any(${[taskId, partId]}::uuid[]) order by parent_id nulls first`
    assert.deepEqual(
      rows.map((r) => [r.id, r.list_id]),
      [
        [taskId, list.id],
        [partId, list.id],
      ],
    )

    const words = await tx<{ id: string; name: string; color: string | null }[]>`
      select id, name::text as name, color from label
      where project_id = ${target} and name = 'Client Need' and deleted_at is null`
    assert.equal(words.length, 1)
    assert.equal(words[0]?.name, 'Client Need')
    assert.equal(words[0]?.color, 'orange')
    const [carried] = await tx<{ n: number }[]>`
      select count(*)::int as n from task_label
      where task_id = any(${[taskId, partId]}::uuid[]) and label_id = ${words[0]!.id}`
    assert.equal(carried?.n, 2)
  })
})

test('an explicit target list still overrides the source status', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const source = await makeProject(ctx, workspaceId, 'Source')
  const target = await makeProject(ctx, workspaceId, 'Target')
  const sourceList = await makeArrangedList(ctx.actorId, workspaceId, source, 'Source-only review', { icon: 'review', color: 'teal' })
  const chosen = await makeArrangedList(ctx.actorId, workspaceId, target, 'Chosen landing', { icon: 'doing' })
  const taskId = await makeTask(ctx.actorId, workspaceId, source, 'Override where it lands', undefined, sourceList)

  const moved = await post(`/api/tasks/${taskId}/move`, token, { project_id: target, list_id: chosen })
  assert.equal(moved.status, 201, JSON.stringify(moved.body))
  assert.equal(moved.body.list_created, false)
  assert.equal(moved.body.list_id, chosen)
  assert.equal(moved.body.list_name, 'Chosen landing')
  await withActor(ctx.actorId, async (tx) => {
    const [copied] = await tx<{ n: number }[]>`
      select count(*)::int as n from task_list where project_id = ${target} and name = 'Source-only review' and deleted_at is null`
    const [task] = await tx<{ list_id: string | null }[]>`select list_id from task where id = ${taskId}`
    assert.equal(copied?.n, 0)
    assert.equal(task?.list_id, chosen)
  })
})

test('matching labels and statuses are matched case-insensitively rather than duplicated', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const source = await makeProject(ctx, workspaceId, 'Source')
  const target = await makeProject(ctx, workspaceId, 'Target')
  const sourceList = await makeArrangedList(ctx.actorId, workspaceId, source, 'qa', { color: 'red' })
  const targetList = await makeArrangedList(ctx.actorId, workspaceId, target, 'QA', { color: 'blue' })
  const sourceLabel = await makeLabel(ctx.actorId, workspaceId, source, 'urgent', 'red')
  const targetLabel = await makeLabel(ctx.actorId, workspaceId, target, 'Urgent', 'blue')
  assert.ok(sourceLabel !== targetLabel)
  const taskId = await makeTask(ctx.actorId, workspaceId, source, 'Match what is already there', undefined, sourceList)
  await tag(ctx.actorId, workspaceId, taskId, sourceLabel)

  const moved = await post(`/api/tasks/${taskId}/move`, token, { project_id: target })
  assert.equal(moved.status, 201, JSON.stringify(moved.body))
  assert.equal(moved.body.list_created, false)
  assert.equal(moved.body.list_id, targetList)
  assert.deepEqual(moved.body.labels_created, [])
  assert.deepEqual(moved.body.labels_kept, ['urgent'])
  assert.deepEqual(moved.body.labels_dropped, [])

  await withActor(ctx.actorId, async (tx) => {
    const lists = await tx<{ id: string }[]>`
      select id from task_list where project_id = ${target} and lower(name) = 'qa' and deleted_at is null`
    assert.deepEqual(
      lists.map((l) => l.id),
      [targetList],
    )
    const words = await tx<{ id: string; color: string | null }[]>`
      select id, color from label where project_id = ${target} and name = 'urgent' and deleted_at is null`
    assert.equal(words.length, 1)
    assert.equal(words[0]?.id, targetLabel)
    assert.equal(words[0]?.color, 'blue')
    const [carried] = await tx<{ n: number }[]>`
      select count(*)::int as n from task_label where task_id = ${taskId} and label_id = ${targetLabel}`
    assert.equal(carried?.n, 1)
  })
})

test('a moved intake task uses the target intake when there is one, and copies intake when there is none', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const source = await makeProject(ctx, workspaceId, 'Source')
  const target = await makeProject(ctx, workspaceId, 'Target')
  const withoutIntake = await makeProject(ctx, workspaceId, 'Without intake')
  const sourceIntake = await makeArrangedList(ctx.actorId, workspaceId, source, 'Requests in', { intake: true, icon: 'backlog' })
  const targetIntake = await makeArrangedList(ctx.actorId, workspaceId, target, 'Target triage', { intake: true, icon: 'backlog' })
  const first = await makeTask(ctx.actorId, workspaceId, source, 'First intake task', undefined, sourceIntake)
  const second = await makeTask(ctx.actorId, workspaceId, source, 'Second intake task', undefined, sourceIntake)

  const moved = await post(`/api/tasks/${first}/move`, token, { project_id: target })
  assert.equal(moved.status, 201, JSON.stringify(moved.body))
  assert.equal(moved.body.list_created, false)
  assert.equal(moved.body.list_id, targetIntake)
  assert.equal(moved.body.list_name, 'Target triage')

  const copied = await post(`/api/tasks/${second}/move`, token, { project_id: withoutIntake })
  assert.equal(copied.status, 201, JSON.stringify(copied.body))
  assert.equal(copied.body.list_created, true)
  assert.equal(copied.body.list_name, 'Requests in')

  await withActor(ctx.actorId, async (tx) => {
    const [one] = await tx<{ n: number }[]>`
      select count(*)::int as n from task_list where project_id = ${target} and intake and deleted_at is null`
    assert.equal(one?.n, 1)
    const intakes = await tx<{ id: string; intake: boolean; icon: string }[]>`
      select id, intake, icon from task_list where project_id = ${withoutIntake} and intake and deleted_at is null`
    assert.equal(intakes.length, 1)
    assert.equal(intakes[0]?.id, copied.body.list_id)
    assert.equal(intakes[0]?.icon, 'backlog')
    const [task] = await tx<{ list_id: string | null }[]>`select list_id from task where id = ${second}`
    assert.equal(task?.list_id, copied.body.list_id)
  })
})

test('a status made by one move is reused by the next move instead of duplicated', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const source = await makeProject(ctx, workspaceId, 'Source')
  const target = await makeProject(ctx, workspaceId, 'Target')
  const sourceList = await makeArrangedList(ctx.actorId, workspaceId, source, 'Shared review', { icon: 'review' })
  const first = await makeTask(ctx.actorId, workspaceId, source, 'First in the selection', undefined, sourceList)
  const second = await makeTask(ctx.actorId, workspaceId, source, 'Second in the selection', undefined, sourceList)

  const one = await post(`/api/tasks/${first}/move`, token, { project_id: target })
  assert.equal(one.status, 201, JSON.stringify(one.body))
  assert.equal(one.body.list_created, true)
  const two = await post(`/api/tasks/${second}/move`, token, { project_id: target })
  assert.equal(two.status, 201, JSON.stringify(two.body))
  assert.equal(two.body.list_created, false)
  assert.equal(two.body.list_id, one.body.list_id)

  await withActor(ctx.actorId, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      select id from task_list where project_id = ${target} and name = 'Shared review' and deleted_at is null`
    assert.deepEqual(
      rows.map((r) => r.id),
      [one.body.list_id],
    )
  })
})

test('two moves pressed together make their missing status once', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const source = await makeProject(ctx, workspaceId, 'Source')
  const target = await makeProject(ctx, workspaceId, 'Target')
  const sourceList = await makeArrangedList(ctx.actorId, workspaceId, source, 'Concurrent review', { icon: 'review' })
  const first = await makeTask(ctx.actorId, workspaceId, source, 'First pressed together', undefined, sourceList)
  const second = await makeTask(ctx.actorId, workspaceId, source, 'Second pressed together', undefined, sourceList)

  const [one, two] = await Promise.all([
    post(`/api/tasks/${first}/move`, token, { project_id: target }),
    post(`/api/tasks/${second}/move`, token, { project_id: target }),
  ])
  assert.equal(one.status, 201, JSON.stringify(one.body))
  assert.equal(two.status, 201, JSON.stringify(two.body))
  assert.equal(one.body.list_id, two.body.list_id)
  assert.deepEqual([one.body.list_created, two.body.list_created].sort(), [false, true])
  await withActor(ctx.actorId, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      select id from task_list where project_id = ${target} and name = 'Concurrent review' and deleted_at is null`
    assert.equal(rows.length, 1)
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
