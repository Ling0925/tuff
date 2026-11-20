import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { issueApiToken } from '../src/auth/flows.js'
import { addPerson, bearerFor, closeDb, makeOwner, makeProject, withActor } from './helpers.js'

const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
after(async () => {
  await owner.end()
  await closeDb()
})

const bring = (project: string, token: string, tasks: unknown[]) =>
  app.request(`/api/projects/${project}/import/tasks`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ tasks }),
  })

test('rows from a spreadsheet become tasks: lists, people, labels, dates, and where they came from', async () => {
  const me = await makeOwner()
  const p = await makeProject(me.ctx, me.workspaceId, 'From Jira')
  const [todo, done] = [crypto.randomUUID(), crypto.randomUUID()]
  await withActor(
    me.ctx.actorId,
    (tx) => tx`
    insert into task_list (id, workspace_id, project_id, author_id, name, sort_key, finishes, icon)
    values (${todo}, ${me.workspaceId}, ${p}, ${me.ctx.actorId}, 'Todo', 'a1', false, 'open'),
           (${done}, ${me.workspaceId}, ${p}, ${me.ctx.actorId}, 'Done', 'a2', true, 'done')`,
  )
  const email = (await owner<{ email: string }[]>`select email::text from app_user where actor_id = ${me.ctx.actorId}`)[0]!.email
  const r = await bring(p, me.token, [
    {
      title: 'Login breaks',
      body: 'On **Safari**.',
      list_id: todo,
      assignee: email,
      due_on: '2026-12-01',
      priority: 'high',
      labels: ['Bug', 'web'],
      key: 'ENG-12',
    },
    { title: 'Ship it', list_id: done, assignee: 'Somebody Elsewhere' },
  ])
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { written: 2 })
  const rows = await owner<
    {
      title: string
      list_id: string
      assignee_ids: string[]
      due_on: string
      priority: string | null
      body: unknown
      completed_at: Date | null
      number: number
    }[]
  >`
    select title, list_id, assignee_ids, due_on::text, priority::text, body, completed_at, number from task where project_id = ${p} order by number`
  const [a, b] = rows
  assert.equal(a!.list_id, todo)
  assert.deepEqual(a!.assignee_ids, [me.ctx.actorId])
  assert.equal(a!.due_on, '2026-12-01')
  assert.equal(a!.priority, 'high')
  assert.match(JSON.stringify(a!.body), /Imported from ENG-12/)
  assert.match(JSON.stringify(a!.body), /"bold"/)
  assert.ok(b!.completed_at)
  assert.deepEqual(b!.assignee_ids, [])
  assert.match(JSON.stringify(b!.body), /Assigned to Somebody Elsewhere/)
  // Days that do not exist, and the European way round, are refused rather than a 500.
  assert.equal((await bring(p, me.token, [{ title: 'x', due_on: '2026-13-45' }])).status, 400)
  const labels = await owner<
    { name: string }[]
  >`select name::text from label where project_id = ${p} and name in ('Bug', 'web') order by name`
  assert.deepEqual(
    labels.map((l) => l.name),
    ['Bug', 'web'],
  )
})

/* By hand, by somebody who may make tasks there, into this project only. */
test('only somebody who may make tasks in the project imports, by hand, into it', async () => {
  const me = await makeOwner()
  const p = await makeProject(me.ctx, me.workspaceId, 'Guarded')
  const elsewhere = await makeProject(me.ctx, me.workspaceId, 'Elsewhere')
  const reader = await addPerson(me.ctx, me.workspaceId, 'member', [p], [])
  assert.equal((await bring(p, await bearerFor(reader.actorId, me.workspaceId), [{ title: 'x' }])).status, 403)
  const agent = await issueApiToken(me.ctx.actorId, me.workspaceId, 'agent')
  assert.equal((await bring(p, agent, [{ title: 'x' }])).status, 403)
  const other = await makeOwner()
  assert.equal((await bring(p, other.token, [{ title: 'x' }])).status, 404)
  // A list of another project is not a list of this one.
  const [theirs] = await withActor(
    me.ctx.actorId,
    (tx) => tx<{ id: string }[]>`
    insert into task_list (id, workspace_id, project_id, author_id, name, sort_key)
    values (gen_random_uuid(), ${me.workspaceId}, ${elsewhere}, ${me.ctx.actorId}, 'Theirs', 'a0') returning id`,
  )
  const r = await bring(p, me.token, [{ title: 'Sideways', list_id: theirs!.id }])
  assert.equal(r.status, 200)
  const [row] = await owner<{ list_id: string | null }[]>`select list_id from task where project_id = ${p} and title = 'Sideways'`
  assert.notEqual(row!.list_id, theirs!.id)
  // Nothing outside the shape: too many rows, a title too long.
  assert.equal(
    (
      await bring(
        p,
        me.token,
        Array.from({ length: 201 }, () => ({ title: 'x' })),
      )
    ).status,
    400,
  )
  assert.equal((await bring(p, me.token, [{ title: 'x'.repeat(301) }])).status, 400)
})

/* Each body is bounded on its own, and two hundred bounded bodies were
   not: twenty rows of links over italics in 0.4 MB were 54 MB of task
   bodies, and two hundred a `RangeError` with the server at 2 GB. */
test('a page whose bodies come to too much is refused, writes nothing, and costs the server little', async () => {
  const me = await makeOwner()
  const p = await makeProject(me.ctx, me.workspaceId, 'Heavy')
  const amplifier = '[' + '*a*b'.repeat(75) + '](https://e.co/' + 'x'.repeat(1987) + ')\n\n'
  const body = amplifier.repeat(Math.floor(20_000 / amplifier.length))
  const sent = JSON.stringify({ tasks: Array.from({ length: 200 }, (_, k) => ({ title: `Row ${k}`, body })) })
  const before = process.memoryUsage().rss
  let peak = before
  const watch = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 1)
  const r = await app.request(`/api/projects/${p}/import/tasks`, {
    method: 'POST',
    headers: { authorization: `Bearer ${me.token}`, 'content-type': 'application/json' },
    body: sent,
  })
  clearInterval(watch)
  const grew = Math.max(peak, process.memoryUsage().rss) - before
  assert.equal(r.status, 413)
  assert.equal(((await r.json()) as { error: { code: string } }).error.code, 'too_large')
  /* Before the budget: 381 MB for twenty of these rows, 1.1 GB for sixty. */
  assert.ok(grew < 100 * 1024 * 1024, `RSS grew ${Math.round(grew / 1024 / 1024)} MB`)
  const [{ n } = { n: -1 }] = await owner<{ n: number }[]>`select count(*)::int as n from task where project_id = ${p}`
  assert.equal(n, 0)
})

test('a full page of long ordinary rows goes in whole', async () => {
  const me = await makeOwner()
  const p = await makeProject(me.ctx, me.workspaceId, 'Long rows')
  const body = 'A line of **plain** words with [a link](https://example.com/page) in it.\n\n'.repeat(70).slice(0, 5_000)
  const r = await bring(
    p,
    me.token,
    Array.from({ length: 200 }, (_, k) => ({ title: `Row ${k}`, body })),
  )
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { written: 200 })
})

/* A name in a file is not an invitation: a colleague not on the project is
   not put on it by being written into the Assignee column. */
test('an import adds nobody to the project', async () => {
  const me = await makeOwner()
  const p = await makeProject(me.ctx, me.workspaceId, 'Closed')
  const outsider = await makeOwner()
  await owner`insert into membership (id, workspace_id, actor_id, role, joined_at) values (gen_random_uuid(), ${me.workspaceId}, ${outsider.ctx.actorId}, 'member', now())`
  const email = (await owner<{ email: string }[]>`select email::text from app_user where actor_id = ${outsider.ctx.actorId}`)[0]!.email
  assert.equal((await bring(p, me.token, [{ title: 'Given to an outsider', assignee: email }])).status, 200)
  const [t] = await owner<
    { assignee_ids: string[]; body: unknown }[]
  >`select assignee_ids, body from task where project_id = ${p} and title = 'Given to an outsider'`
  assert.deepEqual(t!.assignee_ids, [])
  assert.match(JSON.stringify(t!.body), /Assigned to/)
  const [on] = await owner<
    { n: number }[]
  >`select count(*)::int as n from project_member where project_id = ${p} and actor_id = ${outsider.ctx.actorId}`
  assert.equal(on!.n, 0)
})
