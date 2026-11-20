import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { filled, nextDue, type Repeat } from '@tracker/shared-schema'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { addManager, addPerson, bearerFor, closeDb, makeOwner, makeProject, uuidv7, withActor } from './helpers.js'

/*
 * Recurring tasks.
 *
 * The arithmetic first, on its own, because that is where month ends, leap
 * years and clock changes live; then the endpoint, which is where done,
 * undone, deleting, rights and many-at-once live.
 */

/* As the tables' owner, for what only a fixture reads. */
const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

after(async () => {
  await owner.end()
  await closeRealtime()
  await closeDb()
})

/* ------------------------------------------------------------ arithmetic */

/* Far enough ahead that "never in the past" says nothing. */
const T = '2026-01-01'
const next = (rule: Repeat, due: string | null, today = T) => nextDue(rule, due, today)

test('every day, and every few days', () => {
  assert.equal(next({ every: 'day' }, '2030-01-31'), '2030-02-01')
  assert.equal(next({ every: 'day' }, '2030-12-31'), '2031-01-01')
  assert.equal(next({ every: 'day', interval: 3 }, '2030-02-27'), '2030-03-02')
})

test('every week on the chosen weekdays', () => {
  /* 4 January 2030 is a Friday. */
  assert.equal(next({ every: 'week', weekdays: [5] }, '2030-01-04'), '2030-01-11')
  assert.equal(next({ every: 'week', weekdays: [1, 3, 5] }, '2030-01-07'), '2030-01-09')
  assert.equal(next({ every: 'week', weekdays: [1, 3, 5] }, '2030-01-11'), '2030-01-14')
  /* Every weekday: Friday to Monday. */
  assert.equal(next({ every: 'week', weekdays: [1, 2, 3, 4, 5] }, '2030-01-04'), '2030-01-07')
  /* A due date off the rule goes to the rule's next day. */
  assert.equal(next({ every: 'week', weekdays: [5] }, '2030-01-07'), '2030-01-11')
})

test('every few weeks', () => {
  assert.equal(next({ every: 'week', interval: 2, weekdays: [5] }, '2030-01-04'), '2030-01-18')
  /* Monday and Thursday every other week: Thursday of the same week, then
     Monday a fortnight on. */
  assert.equal(next({ every: 'week', interval: 2, weekdays: [1, 4] }, '2030-01-07'), '2030-01-10')
  assert.equal(next({ every: 'week', interval: 2, weekdays: [1, 4] }, '2030-01-10'), '2030-01-21')
  /* Across a year's end. */
  assert.equal(next({ every: 'week', interval: 3, weekdays: [2] }, '2030-12-24'), '2031-01-14')
})

test('every month on a day, the 31st kept through short months', () => {
  assert.equal(next({ every: 'month', day: 1 }, '2030-01-01'), '2030-02-01')
  assert.equal(next({ every: 'month', day: 14 }, '2030-01-05'), '2030-01-14')
  assert.equal(next({ every: 'month', day: 31 }, '2030-01-31'), '2030-02-28')
  /* The rule keeps the 31st, not the 28th it last landed on. */
  assert.equal(next({ every: 'month', day: 31 }, '2030-02-28'), '2030-03-31')
  assert.equal(next({ every: 'month', day: 31 }, '2030-03-31'), '2030-04-30')
  assert.equal(next({ every: 'month', day: 30 }, '2030-01-30'), '2030-02-28')
  assert.equal(next({ every: 'month', day: 15, interval: 3 }, '2030-11-15'), '2031-02-15')
})

test('every month on the last day, leap years included', () => {
  const last: Repeat = { every: 'month', day: -1 }
  assert.equal(next(last, '2030-01-31'), '2030-02-28')
  assert.equal(next(last, '2030-02-28'), '2030-03-31')
  assert.equal(next(last, '2030-04-30'), '2030-05-31')
  assert.equal(next(last, '2028-01-31'), '2028-02-29')
  assert.equal(next(last, '2030-12-31'), '2031-01-31')
  /* A due date early in the month goes to that month's last day. */
  assert.equal(next(last, '2030-06-03'), '2030-06-30')
})

test('every year, and the 29th of February', () => {
  const leap: Repeat = { every: 'year', month: 2, day: 29 }
  assert.equal(next(leap, '2028-02-29'), '2029-02-28')
  assert.equal(next(leap, '2029-02-28'), '2030-02-28')
  assert.equal(next(leap, '2031-02-28'), '2032-02-29')
  assert.equal(next({ every: 'year', month: 11, day: 14 }, '2030-11-14'), '2031-11-14')
  assert.equal(next({ every: 'year', month: 11, day: 14, interval: 2 }, '2030-11-14'), '2032-11-14')
  /* Before the day in its year, the same year. */
  assert.equal(next({ every: 'year', month: 11, day: 14 }, '2030-03-01'), '2030-11-14')
})

test('a clock change moves no day, whatever zone the server is in', () => {
  const was = process.env.TZ
  try {
    for (const zone of ['Europe/Paris', 'America/New_York', 'Australia/Sydney', 'Pacific/Chatham']) {
      process.env.TZ = zone
      /* Europe springs forward on 31 March 2030, America falls back on
         3 November 2030, Australia on 7 April 2030. */
      assert.equal(next({ every: 'day' }, '2030-03-30'), '2030-03-31', zone)
      assert.equal(next({ every: 'day' }, '2030-03-31'), '2030-04-01', zone)
      assert.equal(next({ every: 'day' }, '2030-11-02'), '2030-11-03', zone)
      assert.equal(next({ every: 'day' }, '2030-11-03'), '2030-11-04', zone)
      assert.equal(next({ every: 'day' }, '2030-04-06'), '2030-04-07', zone)
      assert.equal(next({ every: 'week', weekdays: [5] }, '2030-03-29'), '2030-04-05', zone)
      assert.equal(next({ every: 'week', weekdays: [7] }, '2030-10-27'), '2030-11-03', zone)
      assert.equal(next({ every: 'month', day: -1 }, '2030-03-31'), '2030-04-30', zone)
      assert.equal(next({ every: 'day', from: 'done' }, null, '2030-03-30'), '2030-03-31', zone)
    }
  } finally {
    process.env.TZ = was
  }
})

test('from the old due date, and never into the past', () => {
  const fridays: Repeat = { every: 'week', weekdays: [5] }
  /* Done on Saturday 14 November 2026, three weeks late: the next Friday to come. */
  assert.equal(next(fridays, '2026-10-23', '2026-11-14'), '2026-11-20')
  /* Done the Friday after it was due: this week's is due today. */
  assert.equal(next(fridays, '2026-11-06', '2026-11-13'), '2026-11-13')
  /* A day late: next Friday, a week on from the old date and not from today. */
  assert.equal(next(fridays, '2026-11-13', '2026-11-14'), '2026-11-20')
  /* A daily task ten years gone lands today. */
  assert.equal(next({ every: 'day' }, '2016-11-14', '2026-11-14'), '2026-11-14')
  /* No due date: from today. */
  assert.equal(next(fridays, null, '2026-11-14'), '2026-11-20')
})

test('counting from when it is done', () => {
  assert.equal(next({ every: 'day', interval: 3, from: 'done' }, '2020-01-01', '2026-11-14'), '2026-11-17')
  assert.equal(next({ every: 'week', from: 'done' }, null, '2026-11-14'), '2026-11-21')
  assert.equal(next({ every: 'month', from: 'done' }, null, '2030-01-31'), '2030-02-28')
  assert.equal(next({ every: 'year', from: 'done' }, null, '2028-02-29'), '2029-02-28')
})

test('a rule is stored whole, its missing parts read off the date', () => {
  /* 20 November 2026 is a Friday. */
  assert.deepEqual(filled({ every: 'week' }, '2026-11-20'), { every: 'week', weekdays: [5] })
  assert.deepEqual(filled({ every: 'week', weekdays: [4, 1, 1] }, '2026-11-20'), { every: 'week', weekdays: [1, 4] })
  assert.deepEqual(filled({ every: 'month' }, '2026-11-20'), { every: 'month', day: 20 })
  assert.deepEqual(filled({ every: 'year', interval: 1 }, '2026-11-20'), { every: 'year', month: 11, day: 20 })
  assert.deepEqual(filled({ every: 'day', interval: 3, weekdays: [1], from: 'done' }, '2026-11-20'), {
    every: 'day',
    interval: 3,
    from: 'done',
  })
})

/* ------------------------------------------------------------- endpoint */

type Row = Record<string, unknown> & { id: string; due_on: string | null; list_id: string | null; sort_key: string }

async function send(method: string, path: string, token: string, body?: unknown) {
  const r = await app.request(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> }
}

/** A project with Todo, Doing and Done, as the owner. */
async function setUp() {
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, 'Reports')
  const list = async (name: string, finishes = false) =>
    (await send('POST', `/projects/${project}/lists`, boss.token, { name, finishes })).body.id as string
  const todo = await list('Todo')
  const doing = await list('Doing')
  const done = await list('Done', true)
  /* The day where the owner is, which the server reads too. */
  await withActor(boss.ctx.actorId, (tx) => tx`update app_user set timezone = 'UTC' where actor_id = ${boss.ctx.actorId}`)
  return { ...boss, project, todo, doing, done }
}

const read = async (token: string, id: string) => (await send('GET', `/tasks/${id}`, token)).body as { task: Row; steps: Row[] }
const all = async (token: string, project: string) => (await send('GET', `/projects/${project}/tasks`, token)).body.tasks as Row[]
const todayIn = (zone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

test('done makes the next one: the plan copied, the date moved, the rule handed on', async () => {
  const s = await setUp()
  const labelId = (await send('POST', `/projects/${s.project}/labels`, s.token, { name: 'client' })).body.id as string
  const made = await send('POST', `/projects/${s.project}/tasks`, s.token, {
    title: 'Weekly report',
    list_id: s.doing,
    due_on: '2030-01-04',
    priority: 'high',
    labels: [labelId],
    assignee_ids: [s.ctx.actorId],
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Numbers for the client' }] }] },
    /* No weekday: read off the Friday it is due. */
    repeat: { every: 'week' },
  })
  assert.equal(made.status, 201)
  const id = made.body.id as string
  const step = await send('POST', `/projects/${s.project}/tasks`, s.token, { title: 'Pull the numbers', parent_id: id })
  await send('PATCH', `/tasks/${step.body.id}`, s.token, { completed: true })

  assert.deepEqual((await read(s.token, id)).task.repeat, { every: 'week', weekdays: [5] })

  const r = await send('PATCH', `/tasks/${id}`, s.token, { completed: true })
  assert.equal(r.status, 200)
  const n = r.body.next as Row
  assert.ok(n, 'the answer carries the next one')
  assert.equal(n.due_on, '2030-01-11')
  assert.equal(n.title, 'Weekly report')
  assert.equal(n.list_id, s.doing)
  assert.equal(n.priority, 'high')
  assert.deepEqual(n.assignee_ids, [s.ctx.actorId])
  assert.deepEqual(n.repeat, { every: 'week', weekdays: [5] })
  assert.deepEqual(
    (n.labels as { id: string }[]).map((l) => l.id),
    [labelId],
  )
  assert.equal(n.completed_at, null)
  /* Its parts and the rule this one carries now, in the same answer, so
     the screen puts them in place without reading the project again. */
  assert.deepEqual(
    (r.body.next_parts as Row[]).map((p) => [p.title, p.parent_id, p.completed_at]),
    [['Pull the numbers', n.id, null]],
  )
  assert.equal(r.body.repeat, null)

  const full = await read(s.token, n.id)
  assert.equal((full.task.body as any).content[0].content[0].text, 'Numbers for the client')
  assert.equal(full.steps.length, 1)
  assert.equal(full.steps[0]!.title, 'Pull the numbers')
  assert.equal(full.steps[0]!.done_at, null, 'its steps none of them done')

  const old = (await read(s.token, id)).task
  assert.equal(old.repeat, null, 'the finished one keeps no rule')
  assert.equal(old.repeat_next_id, n.id)
  assert.notEqual(old.completed_at, null)

  /* The feed and the webhooks: task.repeat on the next one. */
  const [line] = await owner<{ meta: Record<string, unknown> }[]>`
    select meta from activity_event where action = 'task.repeat' and object_id = ${n.id}`
  assert.equal(line?.meta.from_task_id, id)
  assert.equal(line?.meta.due_on, '2030-01-11')
})

test('a webhook hears task.repeat', async () => {
  const s = await setUp()
  await owner`
    insert into webhook (id, workspace_id, url, events, secret_enc, created_by)
    values (${uuidv7()}, ${s.workspaceId}, 'https://93.184.215.14/hook', ${['task.repeat']}, 'whs_x', ${s.ctx.actorId})`
  const made = await send('POST', `/projects/${s.project}/tasks`, s.token, {
    title: 'Invoice',
    due_on: '2030-01-01',
    repeat: { every: 'month', day: 1 },
  })
  const r = await send('PATCH', `/tasks/${made.body.id}`, s.token, { completed: true })
  const sent = await owner<{ event: string; payload: Record<string, unknown> }[]>`
    select event, payload from webhook_delivery where workspace_id = ${s.workspaceId}`
  assert.equal(sent.length, 1)
  assert.equal(sent[0]!.event, 'task.repeat')
  assert.equal(sent[0]!.payload.object_id, r.body.next.id)
  assert.equal(sent[0]!.payload.from_task_id, made.body.id)
  assert.equal(sent[0]!.payload.due_on, '2030-02-01')
})

test('moved into a list that finishes, the next one takes the slot the card left', async () => {
  const s = await setUp()
  const a = await send('POST', `/projects/${s.project}/tasks`, s.token, { title: 'Below', list_id: s.doing })
  const b = await send('POST', `/projects/${s.project}/tasks`, s.token, {
    title: 'Blog post',
    list_id: s.doing,
    due_on: '2030-01-01',
    repeat: { every: 'week', weekdays: [2] },
  })
  const c = await send('POST', `/projects/${s.project}/tasks`, s.token, { title: 'Above', list_id: s.doing })
  const before = (await all(s.token, s.project)).find((t) => t.id === b.body.id)!
  const r = await send('PATCH', `/tasks/${b.body.id}`, s.token, { list_id: s.done })
  const n = r.body.next as Row
  assert.equal(n.list_id, s.doing)
  assert.equal(n.sort_key, before.sort_key)
  assert.equal(n.due_on, '2030-01-08')
  const column = (await all(s.token, s.project))
    .filter((t) => t.list_id === s.doing)
    .sort((x, y) => (x.sort_key < y.sort_key ? -1 : 1))
    .map((t) => t.id)
  assert.deepEqual(column, [c.body.id, n.id, a.body.id])
})

test('a month on the 31st, finished three times', async () => {
  const s = await setUp()
  let id = (
    await send('POST', `/projects/${s.project}/tasks`, s.token, {
      title: 'Close the books',
      due_on: '2031-01-31',
      repeat: { every: 'month' },
    })
  ).body.id as string
  const seen: string[] = []
  for (let i = 0; i < 3; i++) {
    const r = await send('PATCH', `/tasks/${id}`, s.token, { completed: true })
    seen.push(r.body.next.due_on)
    id = r.body.next.id
  }
  assert.deepEqual(seen, ['2031-02-28', '2031-03-31', '2031-04-30'])
})

test('a yearly rule on the 29th of February, through a common year and back', async () => {
  const s = await setUp()
  let id = (
    await send('POST', `/projects/${s.project}/tasks`, s.token, { title: 'Renew', due_on: '2028-02-29', repeat: { every: 'year' } })
  ).body.id as string
  const seen: string[] = []
  for (let i = 0; i < 4; i++) {
    const r = await send('PATCH', `/tasks/${id}`, s.token, { completed: true })
    seen.push(r.body.next.due_on)
    id = r.body.next.id
  }
  assert.deepEqual(seen, ['2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29'])
})

test('late, it lands on the next date of the rule still to come', async () => {
  const s = await setUp()
  /* 3 January 2020 was a Friday. */
  const made = await send('POST', `/projects/${s.project}/tasks`, s.token, {
    title: 'Weekly',
    due_on: '2020-01-03',
    repeat: { every: 'week' },
  })
  const r = await send('PATCH', `/tasks/${made.body.id}`, s.token, { completed: true })
  const due = r.body.next.due_on as string
  assert.ok(due >= todayIn('UTC'), `${due} is not in the past`)
  assert.equal(new Date(`${due}T12:00:00Z`).getUTCDay(), 5, 'still a Friday')
})

test('counting from done reads the day where the finisher is', async () => {
  const s = await setUp()
  for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
    await withActor(s.ctx.actorId, (tx) => tx`update app_user set timezone = ${zone} where actor_id = ${s.ctx.actorId}`)
    const made = await send('POST', `/projects/${s.project}/tasks`, s.token, {
      title: 'Water the plants',
      repeat: { every: 'day', interval: 2, from: 'done' },
    })
    const r = await send('PATCH', `/tasks/${made.body.id}`, s.token, { completed: true })
    const today = todayIn(zone)
    const want = new Date(Date.parse(`${today}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10)
    assert.equal(r.body.next.due_on, want, zone)
  }
})

test('undone, it takes the next one back: never two open copies', async () => {
  const s = await setUp()
  const id = (
    await send('POST', `/projects/${s.project}/tasks`, s.token, { title: 'Standup notes', due_on: '2030-01-07', repeat: { every: 'day' } })
  ).body.id as string
  const first = await send('PATCH', `/tasks/${id}`, s.token, { completed: true })
  const nextId = first.body.next.id as string

  /* The next one edited meanwhile: its rule, as it is now, comes back. */
  await send('PATCH', `/tasks/${nextId}`, s.token, { repeat: { every: 'week', weekdays: [1] } })
  const back = await send('PATCH', `/tasks/${id}`, s.token, { completed: false })
  assert.equal(back.body.withdrawn, nextId)
  assert.deepEqual(back.body.repeat, { every: 'week', weekdays: [1] }, 'the rule it has back, in the answer')
  assert.equal((await send('GET', `/tasks/${nextId}`, s.token)).status, 404, 'the next one is gone')
  const reopened = (await read(s.token, id)).task
  assert.deepEqual(reopened.repeat, { every: 'week', weekdays: [1] })
  assert.equal(reopened.repeat_next_id, null)
  const open = () => all(s.token, s.project).then((ts) => ts.filter((t) => t.title === 'Standup notes' && !t.completed_at))
  assert.equal((await open()).length, 1)

  /* Done again, one next one again. */
  const again = await send('PATCH', `/tasks/${id}`, s.token, { completed: true })
  assert.notEqual(again.body.next.id, nextId)
  assert.equal(again.body.next.due_on, '2030-01-14')
  assert.equal((await open()).length, 1)
  const [gone] = await owner<{ meta: Record<string, unknown> }[]>`
    select meta from activity_event where action = 'task.delete' and object_id = ${nextId}`
  assert.equal(gone?.meta.withdrawn, true)
})

test('the board taking a move back out of Done takes the next one back too', async () => {
  const s = await setUp()
  const id = (
    await send('POST', `/projects/${s.project}/tasks`, s.token, {
      title: 'Ship notes',
      list_id: s.doing,
      due_on: '2030-01-04',
      repeat: { every: 'week' },
    })
  ).body.id as string
  const moved = await send('PATCH', `/tasks/${id}`, s.token, { list_id: s.done, after: null })
  const nextId = moved.body.next.id as string
  /* ⌘Z: another move, to where the card was. */
  const undo = await send('PATCH', `/tasks/${id}`, s.token, { list_id: s.doing, after: null })
  assert.equal(undo.body.withdrawn, nextId)
  const left = (await all(s.token, s.project)).filter((t) => t.title === 'Ship notes')
  assert.deepEqual(
    left.map((t) => t.id),
    [id],
  )
  assert.equal(left[0]!.completed_at, null)
})

test('a next one already finished is left alone when the one before is reopened', async () => {
  const s = await setUp()
  const id = (
    await send('POST', `/projects/${s.project}/tasks`, s.token, {
      title: 'Payroll',
      due_on: '2030-01-31',
      repeat: { every: 'month', day: -1 },
    })
  ).body.id as string
  const n = (await send('PATCH', `/tasks/${id}`, s.token, { completed: true })).body.next.id as string
  const n2 = (await send('PATCH', `/tasks/${n}`, s.token, { completed: true })).body.next.id as string
  const back = await send('PATCH', `/tasks/${id}`, s.token, { completed: false })
  assert.equal(back.body.withdrawn, null)
  assert.equal((await read(s.token, n)).task.title, 'Payroll')
  assert.equal((await read(s.token, id)).task.repeat, null, 'ordinary work again')
  assert.deepEqual((await read(s.token, n2)).task.repeat, { every: 'month', day: -1 })
})

test('deleting one skips it; putting it back takes the skip back; clearing the rule stops it', async () => {
  const s = await setUp()
  const id = (
    await send('POST', `/projects/${s.project}/tasks`, s.token, { title: 'Newsletter', due_on: '2030-01-01', repeat: { every: 'week' } })
  ).body.id as string
  assert.equal((await send('DELETE', `/tasks/${id}`, s.token)).status, 200)
  const series = () => all(s.token, s.project).then((ts) => ts.filter((t) => t.title === 'Newsletter'))
  const after = await series()
  assert.equal(after.length, 1)
  assert.equal(after[0]!.due_on, '2030-01-08')

  assert.equal((await send('POST', `/tasks/${id}/restore`, s.token)).status, 200)
  const restored = await series()
  assert.deepEqual(
    restored.map((t) => t.id),
    [id],
  )
  assert.deepEqual((await read(s.token, id)).task.repeat, { every: 'week', weekdays: [2] })

  await send('PATCH', `/tasks/${id}`, s.token, { repeat: null })
  const r = await send('PATCH', `/tasks/${id}`, s.token, { completed: true })
  assert.equal(r.body.next, null, 'a rule cleared makes nothing')
})

test('rights: the rule is editing, a part has none, and the series keeps its author', async () => {
  const s = await setUp()
  const id = (await send('POST', `/projects/${s.project}/tasks`, s.token, { title: 'Owner’s', due_on: '2030-01-01' })).body.id as string

  /* A member who may not edit what others wrote may not set its rule. */
  assert.equal((await send('PATCH', '/workspace', s.token, { edit_others_content: 'own_only' })).status, 200)
  const member = await addPerson(s.ctx, s.workspaceId, 'member', [s.project])
  const memberToken = await bearerFor(member.actorId, s.workspaceId)
  assert.equal((await send('PATCH', `/tasks/${id}`, memberToken, { repeat: { every: 'day' } })).status, 403)

  /* A part repeats with its task. */
  const part = await send('POST', `/projects/${s.project}/tasks`, s.token, { title: 'Step', parent_id: id })
  assert.equal((await send('PATCH', `/tasks/${part.body.id}`, s.token, { repeat: { every: 'day' } })).status, 400)
  assert.equal(
    (await send('POST', `/projects/${s.project}/tasks`, s.token, { title: 'Step', parent_id: id, repeat: { every: 'day' } })).status,
    400,
  )

  /* A rule that is not one. */
  assert.equal((await send('PATCH', `/tasks/${id}`, s.token, { repeat: { every: 'fortnight' } })).status, 400)
  assert.equal((await send('PATCH', `/tasks/${id}`, s.token, { repeat: { every: 'week', weekdays: [8] } })).status, 400)
  assert.equal((await send('PATCH', `/tasks/${id}`, s.token, { repeat: { every: 'month', day: 0 } })).status, 400)

  /* Somebody who runs the project finishes the owner's task: the next one is
     still the owner's. */
  await send('PATCH', `/tasks/${id}`, s.token, { repeat: { every: 'day' } })
  const manager = await addManager(s.ctx, s.workspaceId, [s.project])
  const managerToken = await bearerFor(manager.actorId, s.workspaceId)
  const r = await send('PATCH', `/tasks/${id}`, managerToken, { completed: true })
  assert.equal(r.status, 200)
  assert.equal(r.body.next.author_id, s.ctx.actorId)

  /* Somebody outside the project sees nothing to finish. */
  const stranger = await addPerson(s.ctx, s.workspaceId, 'member', [])
  const strangerToken = await bearerFor(stranger.actorId, s.workspaceId)
  assert.equal((await send('PATCH', `/tasks/${r.body.next.id}`, strangerToken, { completed: true })).status, 404)
})

test('many at once: each makes its own, and two presses on one make one', async () => {
  const s = await setUp()
  const make = async (title: string, list: string) =>
    (await send('POST', `/projects/${s.project}/tasks`, s.token, { title, list_id: list, due_on: '2030-01-04', repeat: { every: 'week' } }))
      .body.id as string
  const a = await make('Alpha', s.todo)
  const b = await make('Beta', s.doing)
  const c = await make('Gamma', s.doing)
  /* A stack dragged into Done: one request per card, at once. */
  const answers = await Promise.all([a, b, c].map((id) => send('PATCH', `/tasks/${id}`, s.token, { list_id: s.done })))
  assert.deepEqual(
    answers.map((r) => r.status),
    [200, 200, 200],
  )
  assert.deepEqual(
    answers.map((r) => r.body.next.list_id),
    [s.todo, s.doing, s.doing],
    'each lands in the column it came from',
  )

  /* The same task finished twice at once. */
  const d = await make('Delta', s.todo)
  const twice = await Promise.all([1, 2].map(() => send('PATCH', `/tasks/${d}`, s.token, { completed: true })))
  assert.equal(twice.filter((r) => r.body.next).length, 1)
  const open = (await all(s.token, s.project)).filter((t) => t.title === 'Delta' && !t.completed_at)
  assert.equal(open.length, 1)
})

test('watchers carry over, and the next one is in My tasks of whoever has it', async () => {
  const s = await setUp()
  const manager = await addManager(s.ctx, s.workspaceId, [s.project])
  const managerToken = await bearerFor(manager.actorId, s.workspaceId)
  const id = (
    await send('POST', `/projects/${s.project}/tasks`, s.token, {
      title: 'Report for Acme',
      due_on: '2030-01-04',
      repeat: { every: 'week' },
      assignee_ids: [manager.actorId],
    })
  ).body.id as string
  await send('POST', `/tasks/${id}/subscription`, managerToken)
  const n = (await send('PATCH', `/tasks/${id}`, s.token, { completed: true })).body.next as Row
  const watching = await owner<{ actor_id: string }[]>`
    select actor_id from subscription where object_id = ${n.id} and deleted_at is null`
  assert.ok(watching.some((w) => w.actor_id === manager.actorId))
  const mine = (await send('GET', `/my/tasks`, managerToken)).body.tasks as Row[]
  const row = mine.find((t) => t.id === n.id)
  assert.equal(row?.due_on, '2030-01-11')
  assert.deepEqual(row?.repeat, { every: 'week', weekdays: [5] })
})
