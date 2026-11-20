import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { addPerson, bearerFor, closeDb, withActor, uuidv7, makeOwner, makeProject } from './helpers.js'

after(async () => {
  await closeDb()
})

async function call(path: string, token: string, init: { method?: string; body?: unknown } = {}) {
  const r = await app.request(path, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}

async function task(ownerId: string, ws: string, project: string, title: string) {
  const id = uuidv7()
  await withActor(ownerId, async (tx) => {
    await tx`
      insert into task (id, workspace_id, project_id, author_id, title, sort_key)
      values (${id}, ${ws}, ${project}, ${ownerId}, ${title}, 'a0')`
  })
  return id
}

/*
 * The whole of this feature was the reading half. `POST /api/time` has taken
 * `object_type: 'task'` since the first schema and nothing ever read it back,
 * so hours went into columns nobody could see — a feature that reads as done
 * from the endpoint list and does nothing.
 */
test('hours logged on a task come back with the task', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const one = await task(ctx.actorId, workspaceId, project, 'The work')
  const other = await task(ctx.actorId, workspaceId, project, 'Something else')

  const logged = await call('/api/time', token, {
    method: 'POST',
    body: {
      project_id: project,
      object_type: 'task',
      object_id: one,
      minutes: 90,
      spent_on: '2026-01-05',
      note: 'the first half',
    },
  })
  assert.equal(logged.status, 201)
  await call('/api/time', token, {
    method: 'POST',
    body: { project_id: project, object_type: 'task', object_id: one, minutes: 30, spent_on: '2026-01-06' },
  })
  // On the project and on nothing smaller: this one must not land on the task.
  await call('/api/time', token, {
    method: 'POST',
    body: { project_id: project, minutes: 240, spent_on: '2026-01-06' },
  })

  const read = await call(`/api/tasks/${one}`, token)
  const time = read.body.time as { minutes: number; note: string | null; actor_name: string }[]
  assert.equal(read.status, 200)
  assert.deepEqual(
    time.map((e) => e.minutes),
    [90, 30],
  )
  assert.equal(time[0]?.note, 'the first half')

  // Its own, not the project's and not another task's.
  const elsewhere = await call(`/api/tasks/${other}`, token)
  assert.deepEqual(elsewhere.body.time, [])

  // And the project's report still has all of it, because every entry
  // carries its project whatever else it carries.
  const report = await call(`/api/time?project=${project}`, token)
  const rows = report.body.time as { minutes: number }[]
  assert.equal(
    rows.reduce((n, r) => n + r.minutes, 0),
    360,
  )
})

test('a parent does not show its parts hours', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const parent = await task(ctx.actorId, workspaceId, project, 'The work')
  const part = await call(`/api/tasks/${parent}/steps`, token, {
    method: 'POST',
    body: { title: 'Half of it' },
  })

  await call('/api/time', token, {
    method: 'POST',
    body: {
      project_id: project,
      object_type: 'task',
      object_id: part.body.id as string,
      minutes: 60,
      spent_on: '2026-01-05',
    },
  })

  // A number nobody wrote is worse than no number: somebody who logged an
  // hour on a part and reads it on the parent has to find the difference.
  const read = await call(`/api/tasks/${parent}`, token)
  assert.deepEqual(read.body.time, [])
})

test('an entry is taken back by whoever wrote it, and not by anybody else', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const t = await task(ctx.actorId, workspaceId, project, 'The work')

  const made = await call('/api/time', token, {
    method: 'POST',
    body: { project_id: project, object_type: 'task', object_id: t, minutes: 45, spent_on: '2026-01-05' },
  })
  const id = made.body.id as string

  const gone = await call(`/api/time/${id}`, token, { method: 'DELETE' })
  assert.equal(gone.status, 200)
  const read = await call(`/api/tasks/${t}`, token)
  assert.deepEqual(read.body.time, [])

  // Soft, like everything else: the row is still there for the clear-out.
  const left = await withActor(ctx.actorId, (tx) => tx<{ n: number }[]>`select count(*)::int as n from time_entry where id = ${id}`)
  assert.equal(left[0]?.n, 1)

  // And gone is gone: a second delete finds nothing rather than saying ok.
  const again = await call(`/api/time/${id}`, token, { method: 'DELETE' })
  assert.equal(again.status, 404)
})

test("somebody else's hours need the permission that says so", async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const t = await task(ctx.actorId, workspaceId, project, 'The work')

  // On the project, so the row is visible to them — which is the point. What
  // they must not have is the right to take back a claim about the owner's
  // day, and a 404 here would be the wrong answer: they can see the entry.
  const sam = await addPerson(ctx, workspaceId, 'member', [project])
  const samToken = await bearerFor(sam.actorId, workspaceId)

  const made = await call('/api/time', token, {
    method: 'POST',
    body: { project_id: project, object_type: 'task', object_id: t, minutes: 45, spent_on: '2026-01-05' },
  })
  const id = made.body.id as string

  const theirs = await call(`/api/tasks/${t}`, samToken)
  assert.equal((theirs.body.time as unknown[]).length, 1)

  const tried = await call(`/api/time/${id}`, samToken, { method: 'DELETE' })
  assert.equal(tried.status, 403)

  // Writing their own is fine: that is a claim about their own day.
  const own = await call('/api/time', samToken, {
    method: 'POST',
    body: { project_id: project, object_type: 'task', object_id: t, minutes: 15, spent_on: '2026-01-05' },
  })
  assert.equal(own.status, 201)
  const back = await call(`/api/time/${own.body.id as string}`, samToken, { method: 'DELETE' })
  assert.equal(back.status, 200)
})

test("another project's entry is not there to delete", async () => {
  const mine = await makeOwner()
  const theirs = await makeOwner()
  const project = await makeProject(theirs.ctx, theirs.workspaceId, 'Theirs')
  const t = await task(theirs.ctx.actorId, theirs.workspaceId, project, 'Their work')
  const made = await call('/api/time', theirs.token, {
    method: 'POST',
    body: { project_id: project, object_type: 'task', object_id: t, minutes: 45, spent_on: '2026-01-05' },
  })

  // 404 and not 403: that the row exists is information about somebody else.
  const tried = await call(`/api/time/${made.body.id as string}`, mine.token, { method: 'DELETE' })
  assert.equal(tried.status, 404)
})

test('an entry is changed by whoever may remove it, and the feed says what it was', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const t = await task(ctx.actorId, workspaceId, project, 'The work')
  const sam = await addPerson(ctx, workspaceId, 'member', [project])
  const samToken = await bearerFor(sam.actorId, workspaceId)
  const entry = async (as: string) =>
    (
      await call('/api/time', as, {
        method: 'POST',
        body: { project_id: project, object_type: 'task', object_id: t, minutes: 15, spent_on: '2026-01-05' },
      })
    ).body.id as string
  const read = async (id: string) =>
    ((await call(`/api/tasks/${t}`, token)).body.time as { id: string; minutes: number; spent_on: string; note: string | null }[]).find(
      (e) => e.id === id,
    )!

  // Your own: how long, which day, the note.
  const mine = await entry(samToken)
  const changed = await call(`/api/time/${mine}`, samToken, {
    method: 'PATCH',
    body: { minutes: 90, spent_on: '2026-01-07', note: '  the review  ' },
  })
  assert.equal(changed.status, 200, JSON.stringify(changed.body))
  const now = await read(mine)
  assert.deepEqual([now.minutes, now.spent_on.slice(0, 10), now.note], [90, '2026-01-07', 'the review'])
  // The note taken off, the rest kept.
  assert.equal((await call(`/api/time/${mine}`, samToken, { method: 'PATCH', body: { note: '' } })).status, 200)
  assert.deepEqual([(await read(mine)).minutes, (await read(mine)).note], [90, null])

  // The feed says what it was and what it is now.
  const feed = (await call(`/api/activity?object=${t}`, token)).body.events as { action: string; meta: Record<string, unknown> }[]
  const line = feed.find((e) => e.action === 'time.edit' && e.meta.was_minutes === 15)
  assert.ok(line, JSON.stringify(feed))
  assert.deepEqual([line.meta.minutes, line.meta.spent_on, line.meta.was_spent_on], [90, '2026-01-07', '2026-01-05'])

  // Not what a menu could never say, nor nothing at all of the right shape.
  assert.equal((await call(`/api/time/${mine}`, samToken, { method: 'PATCH', body: { minutes: 0 } })).status, 400)
  assert.equal((await call(`/api/time/${mine}`, samToken, { method: 'PATCH', body: { spent_on: 'Tuesday' } })).status, 400)

  // Somebody else's: not without `time.any`; the owner holds it.
  const theirs = await entry(token)
  assert.equal((await call(`/api/time/${theirs}`, samToken, { method: 'PATCH', body: { minutes: 480 } })).status, 403)
  assert.equal((await read(theirs)).minutes, 15)
  assert.equal((await call(`/api/time/${mine}`, token, { method: 'PATCH', body: { minutes: 60 } })).status, 200)
  assert.equal((await read(mine)).minutes, 60)

  // Another workspace's is not there; a removed one is not either.
  const stranger = await makeOwner()
  assert.equal((await call(`/api/time/${mine}`, stranger.token, { method: 'PATCH', body: { minutes: 30 } })).status, 404)
  await call(`/api/time/${mine}`, samToken, { method: 'DELETE' })
  assert.equal((await call(`/api/time/${mine}`, samToken, { method: 'PATCH', body: { minutes: 30 } })).status, 404)
})
