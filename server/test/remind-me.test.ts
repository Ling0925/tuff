import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { closeDb, withActor, withoutActor, uuidv7, makeOwner, addPerson, makeProject, bearerFor } from './helpers.js'
import { remindChosenDue } from '../src/digest.js'
import { about } from '../src/push.js'

/*
 * Remind me. A moment one person chose on one
 * task, seen by nobody else, sent once when it comes.
 */

after(closeDb)

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
  await withActor(
    ownerId,
    (tx) => tx`
    insert into task (id, workspace_id, project_id, author_id, title, sort_key)
    values (${id}, ${ws}, ${project}, ${ownerId}, ${title}, 'a0')`,
  )
  return id
}

const zone = (actorId: string, tz: string) =>
  withActor(actorId, (tx) => tx`update app_user set timezone = ${tz} where actor_id = ${actorId}`)

/** The moment as a clock in a zone reads it — asked of the database, which knows the zones. */
async function local(at: string, tz: string) {
  const [r] = await withoutActor(
    (tx) =>
      tx<{ day: string; time: string; dow: number; today: string }[]>`
      select (${at}::timestamptz at time zone ${tz})::date::text as day,
             to_char(${at}::timestamptz at time zone ${tz}, 'HH24:MI') as time,
             extract(isodow from ${at}::timestamptz at time zone ${tz})::int as dow,
             (now() at time zone ${tz})::date::text as today`,
  )
  return r!
}

const reminderOf = async (id: string, token: string) =>
  ((await call(`/api/tasks/${id}`, token)).body.task as { my_reminder: { at: string } | null }).my_reminder

/* The person's notes about a task, waiting or not. */
const notesAbout = async (actorId: string, taskId: string) => [
  ...(await withActor(
    actorId,
    (tx) =>
      tx<{ reason: string; what: string | null; kind: string | null; held: boolean }[]>`
      select reason::text, what, kind, deliver_after > now() as held from notification
      where actor_id = ${actorId} and object_id = ${taskId} and deleted_at is null order by created_at`,
  )),
]

const rowCount = (actorId: string, taskId: string) =>
  withActor(actorId, async (tx) =>
    Number((await tx<{ n: number }[]>`select count(*)::int as n from task_reminder where task_id = ${taskId}`)[0]!.n),
  )

/* Brought to now, as the worker's clock would find it — the API refuses a past moment. */
const due = (actorId: string, taskId: string) =>
  withActor(
    actorId,
    (tx) => tx`update task_reminder set at = now() - interval '1 second' where task_id = ${taskId} and actor_id = ${actorId}`,
  )

test('set, moved and cleared — one per person per task', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  await zone(ctx.actorId, 'Europe/Paris')
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const id = await task(ctx.actorId, workspaceId, p, 'Call the printer')

  assert.equal(await reminderOf(id, token), null)
  const set = await call(`/api/tasks/${id}/reminder`, token, { method: 'PUT', body: { preset: 'tomorrow' } })
  assert.equal(set.status, 200)
  const at = (set.body.reminder as { at: string }).at
  assert.equal(await reminderOf(id, token).then((r) => r?.at), at)

  // Moved, not added: a time on the clock where they are.
  const moved = await call(`/api/tasks/${id}/reminder`, token, { method: 'PUT', body: { at: '2030-06-01T15:00' } })
  assert.equal(moved.status, 200)
  assert.equal((moved.body.reminder as { at: string }).at, '2030-06-01T13:00:00.000Z', 'Paris is two hours ahead in June')
  assert.equal(await rowCount(ctx.actorId, id), 1)
  // An instant is kept as it is.
  const exact = await call(`/api/tasks/${id}/reminder`, token, { method: 'PUT', body: { at: '2030-06-01T08:30:00+02:00' } })
  assert.equal((exact.body.reminder as { at: string }).at, '2030-06-01T06:30:00.000Z')

  assert.equal((await call(`/api/tasks/${id}/reminder`, token, { method: 'DELETE' })).status, 200)
  assert.equal(await reminderOf(id, token), null)
  // Clearing what is not there is a state asked for, not an error.
  assert.equal((await call(`/api/tasks/${id}/reminder`, token, { method: 'DELETE' })).status, 200)
})

test('a time that has passed, or is not a time, is refused', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const id = await task(ctx.actorId, workspaceId, p, 'Old')
  for (const body of [
    { at: new Date(Date.now() - 60_000).toISOString() },
    { at: '2020-01-01T09:00' },
    { at: '2030-02-30T09:00' },
    { at: 'tomorrow' },
    { at: '2030-06-01' },
    { preset: 'someday' },
    {},
    { at: '2030-06-01T09:00Z', preset: 'tomorrow' },
  ]) {
    const r = await call(`/api/tasks/${id}/reminder`, token, { method: 'PUT', body })
    assert.equal(r.status, 400, JSON.stringify(body))
  }
  assert.equal(await rowCount(ctx.actorId, id), 0)
})

test('nobody else sees it, clears it or sets one on a task they cannot see', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const elsewhere = await makeProject(ctx, workspaceId, 'Private')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const samToken = await bearerFor(sam.actorId, workspaceId)
  const id = await task(ctx.actorId, workspaceId, p, 'Shared')
  const hidden = await task(ctx.actorId, workspaceId, elsewhere, 'Not Sam’s')

  /* A moment of its own, not a preset: on a Sunday "next week" is Monday
     9:00, which is Sam's "tomorrow" below, and the two reminders the last
     check tells apart were the same instant. */
  const ownerAt = new Date(Date.now() + 3 * 86_400_000).toISOString()
  assert.equal((await call(`/api/tasks/${id}/reminder`, token, { method: 'PUT', body: { at: ownerAt } })).status, 200)
  // Sam reads the task and not the owner's reminder on it.
  assert.equal(await reminderOf(id, samToken), null)
  const theirs = await withActor(sam.actorId, (tx) => tx`select * from task_reminder`)
  assert.equal(theirs.length, 0, 'the table shows Sam nothing of anybody else')
  // Sam clearing theirs leaves the owner's.
  assert.equal((await call(`/api/tasks/${id}/reminder`, samToken, { method: 'DELETE' })).status, 200)
  assert.ok(await reminderOf(id, token))
  // Sam's own is Sam's, beside it.
  assert.equal((await call(`/api/tasks/${id}/reminder`, samToken, { method: 'PUT', body: { preset: 'tomorrow' } })).status, 200)
  assert.equal(await rowCount(sam.actorId, id), 1)
  assert.equal(await rowCount(ctx.actorId, id), 1)

  // A task Sam cannot see is not there, to set or to clear.
  assert.equal((await call(`/api/tasks/${hidden}/reminder`, samToken, { method: 'PUT', body: { preset: 'tomorrow' } })).status, 404)
  assert.equal((await call(`/api/tasks/${hidden}/reminder`, samToken, { method: 'DELETE' })).status, 404)
  // Nor written round the endpoint.
  await assert.rejects(
    withActor(
      sam.actorId,
      (tx) => tx`
      insert into task_reminder (workspace_id, task_id, actor_id, at)
      values (${workspaceId}, ${hidden}, ${sam.actorId}, now() + interval '1 day')`,
    ),
  )
  await assert.rejects(
    withActor(
      sam.actorId,
      (tx) => tx`
      insert into task_reminder (workspace_id, task_id, actor_id, at)
      values (${workspaceId}, ${id}, ${ctx.actorId}, now() + interval '1 day')`,
    ),
    'nobody sets one for somebody else',
  )

  // My tasks says yours, and not the owner's.
  await withActor(ctx.actorId, (tx) => tx`update task set assignee_ids = array[${sam.actorId}, ${ctx.actorId}]::uuid[] where id = ${id}`)
  const mine = (await call('/api/my/tasks', samToken)).body.tasks as { id: string; reminder_at: string | null }[]
  const ownerRead = (await call('/api/my/tasks', token)).body.tasks as { id: string; reminder_at: string | null }[]
  const samAt = (await reminderOf(id, samToken))!.at
  assert.equal(new Date(mine.find((t) => t.id === id)!.reminder_at!).toISOString(), samAt)
  assert.notEqual(new Date(ownerRead.find((t) => t.id === id)!.reminder_at!).toISOString(), samAt)
})

test('it comes once, when its minute has come, whatever the quiet hours', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const now_ = await task(ctx.actorId, workspaceId, p, 'Now')
  const soon = await task(ctx.actorId, workspaceId, p, 'In a minute')
  /* Quiet all day: a reminder is the one note whose moment was chosen. */
  await withActor(
    ctx.actorId,
    (tx) => tx`update app_user set quiet_from = '00:00', quiet_to = '23:59', timezone = 'UTC' where actor_id = ${ctx.actorId}`,
  )
  for (const id of [now_, soon]) {
    assert.equal((await call(`/api/tasks/${id}/reminder`, token, { method: 'PUT', body: { preset: 'tomorrow' } })).status, 200)
  }
  await due(ctx.actorId, now_)
  await withActor(
    ctx.actorId,
    (tx) => tx`update task_reminder set at = now() + interval '59 seconds' where task_id = ${soon} and actor_id = ${ctx.actorId}`,
  )

  // Two workers at once, and again: one note.
  await Promise.all([remindChosenDue(), remindChosenDue()])
  await remindChosenDue()
  const told = await notesAbout(ctx.actorId, now_)
  assert.deepEqual(
    told.map((n) => [n.reason, n.what, n.kind, n.held]),
    [['reminder', 'Reminder', 'reminder', false]],
  )
  assert.equal(await rowCount(ctx.actorId, now_), 0, 'sent, it is gone')
  assert.equal(await reminderOf(now_, token), null)

  // A minute not yet come waits.
  assert.deepEqual(await notesAbout(ctx.actorId, soon), [])
  assert.equal(await rowCount(ctx.actorId, soon), 1)

  // In the bell, counted under its own reason.
  const inbox = (await call('/api/inbox', token)).body as {
    notifications: { reason: string; object_id: string; task_number: number | null }[]
    unread: Record<string, string>
  }
  const note = inbox.notifications.find((n) => n.object_id === now_)
  assert.equal(note?.reason, 'reminder')
  assert.ok(note?.task_number, 'it opens the task')
  assert.equal(Number(inbox.unread.reminder), 1)

  // And the push says what and where, and never what anybody wrote.
  const [row] = await withActor(
    ctx.actorId,
    (tx) => tx<{ id: string }[]>`select id from notification where actor_id = ${ctx.actorId} and object_id = ${now_}`,
  )
  const push = await about(
    {
      id: row!.id,
      workspace_id: workspaceId,
      actor_id: ctx.actorId,
      reason: 'reminder',
      object_type: 'task',
      object_id: now_,
      what: 'Reminder',
    },
    'en',
  )
  assert.equal(push?.title, 'Now')
  assert.match(push?.body ?? '', /^Reminder · .+-\d+$/)
  assert.match(push?.url ?? '', /\/tasks\/\d+$/)
})

test('a finished task, or one no longer theirs to see, is reminded of nothing, and the reminder goes', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const samToken = await bearerFor(sam.actorId, workspaceId)
  const finished = await task(ctx.actorId, workspaceId, p, 'Finished')
  const lost = await task(ctx.actorId, workspaceId, p, 'Lost')
  const gone = await task(ctx.actorId, workspaceId, p, 'Deleted')

  assert.equal((await call(`/api/tasks/${finished}/reminder`, token, { method: 'PUT', body: { preset: 'tomorrow' } })).status, 200)
  assert.equal((await call(`/api/tasks/${gone}/reminder`, token, { method: 'PUT', body: { preset: 'tomorrow' } })).status, 200)
  assert.equal((await call(`/api/tasks/${lost}/reminder`, samToken, { method: 'PUT', body: { preset: 'tomorrow' } })).status, 200)
  await due(ctx.actorId, finished)
  await due(ctx.actorId, gone)
  await due(sam.actorId, lost)

  await withActor(ctx.actorId, async (tx) => {
    await tx`update task set completed_at = now() where id = ${finished}`
    await tx`update task set deleted_at = now() where id = ${gone}`
  })
  // Taken off the project before the moment.
  assert.equal((await call(`/api/projects/${p}/members/${sam.actorId}`, token, { method: 'DELETE' })).status, 200)

  await remindChosenDue()
  assert.deepEqual(await notesAbout(ctx.actorId, finished), [])
  assert.deepEqual(await notesAbout(ctx.actorId, gone), [])
  assert.deepEqual(await notesAbout(sam.actorId, lost), [])
  assert.equal(await rowCount(ctx.actorId, finished), 0)
  assert.equal(await rowCount(sam.actorId, lost), 0)
  assert.equal((await withActor(ctx.actorId, (tx) => tx`select 1 from task_reminder where task_id = ${gone}`)).length, 0)
})

test('the presets are read in the person’s own zone', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const id = await task(ctx.actorId, workspaceId, p, 'Around the world')
  /* A day apart at the same instant, and one with summer time. */
  for (const tz of ['Pacific/Kiritimati', 'Etc/GMT+12', 'America/New_York']) {
    await zone(ctx.actorId, tz)
    const put = async (preset: string) => {
      const r = await call(`/api/tasks/${id}/reminder`, token, { method: 'PUT', body: { preset } })
      assert.equal(r.status, 200, `${tz} ${preset}`)
      return (r.body.reminder as { at: string }).at
    }

    const tomorrow = await local(await put('tomorrow'), tz)
    assert.equal(tomorrow.time, '09:00', tz)
    const [y, m, d] = tomorrow.today.split('-').map(Number) as [number, number, number]
    assert.equal(tomorrow.day, new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10), tz)

    const week = await local(await put('next_week'), tz)
    assert.equal(week.time, '09:00', tz)
    assert.equal(week.dow, 1, `${tz}: a Monday`)
    assert.ok(week.day > week.today, tz)

    const later = await put('later_today')
    const ahead = (Date.parse(later) - Date.now()) / 3_600_000
    assert.ok(ahead > 2.4 && ahead < 3.6, `${tz}: ${ahead} hours`)
    assert.match((await local(later, tz)).time, /:00$/, 'on the hour')

    // A time with no offset is on their clock.
    const wall = await local(
      await (async () => {
        const r = await call(`/api/tasks/${id}/reminder`, token, { method: 'PUT', body: { at: '2031-01-15T16:45' } })
        return (r.body.reminder as { at: string }).at
      })(),
      tz,
    )
    assert.deepEqual([wall.day, wall.time], ['2031-01-15', '16:45'], tz)
  }
  await zone(ctx.actorId, 'UTC')
  const utc = await call(`/api/tasks/${id}/reminder`, token, { method: 'PUT', body: { at: '2031-01-15T16:45' } })
  assert.equal((utc.body.reminder as { at: string }).at, '2031-01-15T16:45:00.000Z')
})

test('what the review found: a bad clock is 400, a ceiling on what waits, and leaving takes them', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const sam = await addPerson(ctx, workspaceId, 'member', [p])
  const samToken = await bearerFor(sam.actorId, workspaceId)
  const id = await task(ctx.actorId, workspaceId, p, 'Shared')

  // Times the database cannot read are refused before it is asked.
  for (const at of ['2030-11-20T15:00:99', '+100000-01-01T00:00:00Z', '-000001-01-01T00:00:00Z', '1960-01-01T00:00:00Z']) {
    assert.equal((await call(`/api/tasks/${id}/reminder`, token, { method: 'PUT', body: { at } })).status, 400, at)
  }

  // A ceiling on what one person has waiting; moving one already set is never refused.
  const many: string[] = []
  for (let i = 0; i < 500; i++) many.push(uuidv7())
  await withActor(
    ctx.actorId,
    (tx) => tx`
    insert into task (id, workspace_id, project_id, author_id, title, sort_key)
    select x, ${workspaceId}, ${p}, ${ctx.actorId}, 'Many', 'a0' from unnest(${many}::uuid[]) x`,
  )
  await withActor(
    ctx.actorId,
    (tx) => tx`
    insert into task_reminder (workspace_id, task_id, actor_id, at)
    select ${workspaceId}, x, ${ctx.actorId}, now() + interval '1 day' from unnest(${many}::uuid[]) x`,
  )
  assert.equal((await call(`/api/tasks/${id}/reminder`, token, { method: 'PUT', body: { preset: 'tomorrow' } })).status, 400)
  assert.equal((await call(`/api/tasks/${many[0]}/reminder`, token, { method: 'PUT', body: { preset: 'next_week' } })).status, 200)

  // Leaving the workspace takes the reminders kept there: let back in before
  // the moment, Sam is not reminded of what they set before they left.
  assert.equal((await call(`/api/tasks/${id}/reminder`, samToken, { method: 'PUT', body: { preset: 'tomorrow' } })).status, 200)
  assert.ok(await reminderOf(id, samToken))
  const ended = await withActor(
    ctx.actorId,
    (tx) => tx`
    update membership set deleted_at = now() where actor_id = ${sam.actorId} and workspace_id = ${workspaceId} and deleted_at is null returning id`,
  )
  assert.equal(ended.length, 1)
  await withActor(ctx.actorId, (tx) => tx`update membership set deleted_at = null where id = ${ended[0]!.id}`)
  assert.equal(await reminderOf(id, samToken), null)
})
