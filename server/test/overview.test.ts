import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { closeDb, withActor, uuidv7, makeOwner, addPerson, makeProject } from './helpers.js'

after(async () => {
  await closeDb()
})

async function task(
  ownerId: string,
  ws: string,
  project: string,
  title: string,
  extra: { due?: string; assignee?: string; done?: boolean } = {},
) {
  const id = uuidv7()
  await withActor(ownerId, async (tx) => {
    await tx`
      insert into task (id, workspace_id, project_id, author_id, title, sort_key,
                        due_on, assignee_ids, completed_at)
      values (${id}, ${ws}, ${project}, ${ownerId}, ${title}, ${'a' + title.length},
              ${extra.due ?? null}, ${extra.assignee ? [extra.assignee] : []}::uuid[],
              ${extra.done ? tx`now()` : null})`
  })
  return id
}

test('overdue means late and still open, not merely late', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  await task(ctx.actorId, workspaceId, p, 'Late and open', { due: '2020-01-01' })
  await task(ctx.actorId, workspaceId, p, 'Late but done', { due: '2020-01-01', done: true })
  await task(ctx.actorId, workspaceId, p, 'Not due')

  const rows = await withActor(
    ctx.actorId,
    (tx) =>
      tx<{ title: string }[]>`
      select title from task
      where deleted_at is null and completed_at is null
        and due_on is not null and due_on < current_date`,
  )
  // Something finished late is history, not a problem. Counting it as overdue
  // is how a dashboard becomes something nobody looks at.
  assert.deepEqual(
    rows.map((r) => r.title),
    ['Late and open'],
  )
})

test('unassigned is the work nobody has picked up', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  await task(ctx.actorId, workspaceId, p, 'Nobody has this')
  await task(ctx.actorId, workspaceId, p, 'Sam has this', { assignee: sam.actorId })

  const rows = await withActor(
    ctx.actorId,
    (tx) =>
      tx<{ title: string }[]>`
      select title from task
      where deleted_at is null and completed_at is null and assignee_id is null`,
  )
  assert.deepEqual(
    rows.map((r) => r.title),
    ['Nobody has this'],
  )
})

test('time is logged for yourself by default and for others by permission', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const { can, DEFAULT_SETTINGS } = await import('@tracker/shared-schema')

  const asMember = { role: sam.role, settings: DEFAULT_SETTINGS, inProject: true }
  assert.equal(can('time.own', asMember), true)
  // A member logs their own hours. Logging somebody else's is an owner thing,
  // because it is a claim about what another person did.
  assert.equal(can('time.any', asMember), false)
  assert.equal(can('time.any', { role: 'owner', settings: DEFAULT_SETTINGS, inProject: true }), true)

  await withActor(ctx.actorId, async (tx) => {
    await tx`
      insert into time_entry (id, workspace_id, project_id, actor_id, minutes, spent_on)
      values (${uuidv7()}, ${workspaceId}, ${p}, ${sam.actorId}, 90, current_date)`
  })
  const [row] = await withActor(
    ctx.actorId,
    (tx) =>
      tx<{ minutes: number }[]>`
      select sum(minutes)::int as minutes from time_entry where project_id = ${p}`,
  )
  assert.equal(row!.minutes, 90)
})

test('copying a project moves the dates, it does not bring them along', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const source = await makeProject(ctx, workspaceId, 'Template')
  await task(ctx.actorId, workspaceId, source, 'First', { due: '2020-01-01' })
  await task(ctx.actorId, workspaceId, source, 'Second', { due: '2020-01-08' })

  const copyId = uuidv7()
  await withActor(ctx.actorId, async (tx) => {
    await tx`
      insert into project (id, workspace_id, name) values (${copyId}, ${workspaceId}, 'Copy')`
    const rows = await tx<{ title: string; offset_days: number | null }[]>`
      select title, due_on - (select min(due_on) from task
                              where project_id = ${source} and due_on is not null) as offset_days
      from task where project_id = ${source} and deleted_at is null order by title`
    for (const t of rows) {
      await tx`
        insert into task (id, workspace_id, project_id, author_id, title, sort_key, due_on)
        values (${uuidv7()}, ${workspaceId}, ${copyId}, ${ctx.actorId}, ${t.title},
                ${'a' + t.title.length},
                ${t.offset_days !== null ? tx`current_date + ${t.offset_days}::int` : null})`
    }
  })

  const copied = await withActor(
    ctx.actorId,
    (tx) =>
      tx<{ title: string; late: boolean }[]>`
      select title, due_on < current_date as late from task
      where project_id = ${copyId} order by title`,
  )
  // A plan copied to start today must not arrive already overdue, which is
  // what carrying the original dates would do.
  assert.equal(copied.length, 2)
  assert.ok(copied.every((t) => !t.late))
})
