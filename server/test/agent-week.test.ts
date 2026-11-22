import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { addPerson, bearerFor, closeDb, makeOwner, makeProject, uuidv7 } from './helpers.js'

/* What an agent did this week. */

/* As the tables' owner, for the rows that belong to another week. */
const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

after(async () => {
  await owner.end()
  await closeRealtime()
  await closeDb()
})

async function send(method: string, path: string, token: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const CHOICES = [{ label: 'Keep it' }, { label: 'Remove it', recommended: true }]

type Work = {
  period: string
  since: string
  took: number
  finished: number
  open: number
  asked: number
  answered: number
  tokens: number
  cost_usd: number | null
  spent_on: number
  events: { project_id: string | null; actor_id: string; object_title: string | null }[]
}
type Listed = {
  tasks: { id: string; title: string; project_id: string; tokens?: number; cost_usd?: number | null; questions?: number }[]
  next_cursor: string | null
}

/*
 * Two projects, an agent on both, and a reader on one of them. Whatever the
 * agent did in the project the reader is not on is not listed, not counted
 * and not summed — the same rows Activity shows them, and no more.
 */
async function world() {
  const boss = await makeOwner()
  const shared = await makeProject(boss.ctx, boss.workspaceId, 'Shared')
  const apart = await makeProject(boss.ctx, boss.workspaceId, 'Apart')
  const ada = await addPerson(boss.ctx, boss.workspaceId, 'member', [shared])
  const adaToken = await bearerFor(ada.actorId, boss.workspaceId)
  const made = await send('POST', '/api/agents', boss.token, { name: 'Claude Code', project_ids: [shared, apart], reach: 'mcp' })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const agent = made.body.agent_id as string
  const agentToken = made.body.token as string

  const task = async (project: string, title: string, given = true) => {
    const r = await send('POST', `/api/projects/${project}/tasks`, boss.token, { title, ...(given ? { assignee_ids: [agent] } : {}) })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    return r.body.id as string
  }
  /* Given when it was made; given afterwards; given and finished. */
  const one = await task(shared, 'Given at the start')
  const two = await task(shared, 'Given afterwards', false)
  assert.equal((await send('PATCH', `/api/tasks/${two}`, boss.token, { assignee_ids: [agent] })).status, 200)
  const three = await task(shared, 'Given and finished')
  assert.equal((await send('PATCH', `/api/tasks/${three}`, boss.token, { completed: true })).status, 200)
  /* And in the project the reader is not on. */
  const four = await task(apart, 'Finished apart')
  assert.equal((await send('PATCH', `/api/tasks/${four}`, boss.token, { completed: true })).status, 200)

  /* A question on each side; the one Ada can see, answered. */
  const q1 = await send('POST', `/api/tasks/${one}/comments`, agentToken, {
    body: doc('Keep the route?'),
    choices: CHOICES,
    to: [ada.actorId],
  })
  assert.equal(q1.status, 201, JSON.stringify(q1.body))
  const q4 = await send('POST', `/api/tasks/${four}/comments`, agentToken, {
    body: doc('Drop the table?'),
    choices: CHOICES,
    to: [boss.ctx.actorId],
  })
  assert.equal(q4.status, 201, JSON.stringify(q4.body))
  assert.equal((await send('PUT', `/api/comments/${q1.body.id}/answer`, adaToken, { choice: 0 })).status, 200)

  /* What its client spent on each side — a session reported twice is one line. */
  for (const [t, tokens, cost] of [
    [one, 400, 0.2],
    [one, 1000, 0.5],
    [four, 5000, 2],
  ] as const) {
    const r = await send('POST', `/api/tasks/${t}/spend`, agentToken, { client: 'Claude Code', tokens, cost_usd: cost, session: `s-${t}` })
    assert.equal(r.status, 201, JSON.stringify(r.body))
  }

  /* Something from long ago, in the project apart: given forty days back,
     still open, with spend reported then. Open counts it; the period not. */
  const old = await task(apart, 'Given long ago', false)
  await owner`update task set assignee_ids = array[${agent}]::uuid[] where id = ${old}`
  await owner`
    insert into activity_event (id, workspace_id, project_id, actor_id, action, object_type, object_id, origin, meta, at)
    values (${uuidv7()}, ${boss.workspaceId}, ${apart}, ${boss.ctx.actorId}, 'task.update', 'task', ${old}, 'web',
            ${owner.json({ given_to: 'Claude Code', given_ids: [agent] })}, now() - interval '40 days')`
  await owner`
    insert into task_spend (id, workspace_id, project_id, task_id, actor_id, client, tokens, cost_usd, created_at, updated_at)
    values (${uuidv7()}, ${boss.workspaceId}, ${apart}, ${old}, ${agent}, 'Claude Code', 9000, 9,
            now() - interval '40 days', now() - interval '40 days')`

  return { boss, ada, adaToken, agent, agentToken, shared, apart, one, two, three, four, old }
}

test('an agent’s week: what it took, finished, holds, asked and spent', async () => {
  const w = await world()
  const all = await send('GET', `/api/agents/${w.agent}/work`, w.boss.token)
  assert.equal(all.status, 200, JSON.stringify(all.body))
  const b = all.body as unknown as Work
  assert.equal(b.period, 'week')
  assert.deepEqual(
    [b.took, b.finished, b.open, b.asked, b.answered, b.tokens, b.cost_usd, b.spent_on],
    // The session's last report, not the two added; the old line not at all.
    [4, 2, 3, 2, 1, 6000, 2.5, 2],
  )
  /* Its own lines in the feed — the questions it asked. */
  assert.ok(b.events.length >= 2, JSON.stringify(b.events))
  assert.ok(b.events.every((e) => e.actor_id === w.agent))

  /* Each number leads to its tasks. */
  const list = async (of: string, token = w.boss.token, extra = '') => {
    const r = await send('GET', `/api/agents/${w.agent}/work/tasks?of=${of}${extra}`, token)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    return r.body as unknown as Listed
  }
  assert.deepEqual(new Set((await list('took')).tasks.map((t) => t.id)), new Set([w.one, w.two, w.three, w.four]))
  assert.deepEqual(new Set((await list('finished')).tasks.map((t) => t.id)), new Set([w.three, w.four]))
  assert.deepEqual(new Set((await list('open')).tasks.map((t) => t.id)), new Set([w.one, w.two, w.old]))
  assert.deepEqual(new Set((await list('asked')).tasks.map((t) => t.id)), new Set([w.one, w.four]))
  assert.deepEqual(
    (await list('answered')).tasks.map((t) => [t.id, t.questions]),
    [[w.one, 1]],
  )
  /* The most spent first, with what each took. */
  assert.deepEqual(
    (await list('spend')).tasks.map((t) => [t.id, t.tokens, t.cost_usd]),
    [
      [w.four, 5000, 2],
      [w.one, 1000, 0.5],
    ],
  )

  /* A page at a time by cursor, missing and repeating nothing. */
  const first = await list('took', w.boss.token, '&limit=3')
  assert.equal(first.tasks.length, 3)
  assert.ok(first.next_cursor)
  const second = await list('took', w.boss.token, `&limit=3&cursor=${encodeURIComponent(first.next_cursor)}`)
  assert.equal(second.tasks.length, 1)
  assert.equal(second.next_cursor, null)
  assert.equal(new Set([...first.tasks, ...second.tasks].map((t) => t.id)).size, 4)
  assert.equal((await send('GET', `/api/agents/${w.agent}/work/tasks?of=took&cursor=nonsense`, w.boss.token)).status, 400)
  assert.equal((await send('GET', `/api/agents/${w.agent}/work/tasks?of=everything`, w.boss.token)).status, 400)
  assert.equal((await send('GET', `/api/agents/${w.agent}/work?period=year`, w.boss.token)).status, 400)
})

test('a reader not on a project sees none of the agent’s work there, not even as a count', async () => {
  const w = await world()
  const r = await send('GET', `/api/agents/${w.agent}/work`, w.adaToken)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const b = r.body as unknown as Work
  assert.deepEqual([b.took, b.finished, b.open, b.asked, b.answered, b.tokens, b.cost_usd, b.spent_on], [3, 1, 2, 1, 1, 1000, 0.5, 1])
  assert.ok(
    b.events.every((e) => e.project_id === w.shared),
    JSON.stringify(b.events),
  )
  for (const of of ['took', 'finished', 'open', 'asked', 'answered', 'spend']) {
    const listed = (await send('GET', `/api/agents/${w.agent}/work/tasks?of=${of}`, w.adaToken)).body as unknown as Listed
    assert.ok(
      listed.tasks.every((t) => t.project_id === w.shared),
      `${of} listed a task from the project apart: ${JSON.stringify(listed.tasks)}`,
    )
  }
})

test('who may read an agent’s week', async () => {
  const w = await world()
  /* Not the agent itself, nor anybody through its token. */
  assert.equal((await send('GET', `/api/agents/${w.agent}/work`, w.agentToken)).status, 403)
  /* Not somebody the owner keeps the Members screen from. */
  const kept = await addPerson(w.boss.ctx, w.boss.workspaceId, 'member', [w.shared])
  await owner`update membership set may_see_members = false where actor_id = ${kept.actorId} and workspace_id = ${w.boss.workspaceId}`
  const keptToken = await bearerFor(kept.actorId, w.boss.workspaceId)
  assert.equal((await send('GET', `/api/agents/${w.agent}/work`, keptToken)).status, 403)
  assert.equal((await send('GET', `/api/agents/${w.agent}/work/tasks?of=took`, keptToken)).status, 403)
  /* A person is not an agent, and an agent of another workspace is not one here. */
  assert.equal((await send('GET', `/api/agents/${w.ada.actorId}/work`, w.boss.token)).status, 404)
  const elsewhere = await makeOwner()
  assert.equal((await send('GET', `/api/agents/${w.agent}/work`, elsewhere.token)).status, 404)
})

test('the week and the month start on the reader’s calendar', async () => {
  const w = await world()
  const week = (await send('GET', `/api/agents/${w.agent}/work?period=week`, w.boss.token)).body as unknown as Work
  const month = (await send('GET', `/api/agents/${w.agent}/work?period=month`, w.boss.token)).body as unknown as Work
  assert.equal(month.period, 'month')
  /* A line reported a second before the week began: the month counts it
     when the month began earlier, and the week never does. */
  await owner`
    insert into task_spend (id, workspace_id, project_id, task_id, actor_id, client, tokens, cost_usd, created_at, updated_at)
    values (${uuidv7()}, ${w.boss.workspaceId}, ${w.shared}, ${w.two}, ${w.agent}, 'Cursor', 700, null,
            ${week.since}::timestamptz - interval '1 second', ${week.since}::timestamptz - interval '1 second')`
  const weekAfter = (await send('GET', `/api/agents/${w.agent}/work?period=week`, w.boss.token)).body as unknown as Work
  const monthAfter = (await send('GET', `/api/agents/${w.agent}/work?period=month`, w.boss.token)).body as unknown as Work
  assert.equal(weekAfter.tokens, 6000)
  const earlier = Date.parse(month.since) < Date.parse(week.since)
  assert.equal(monthAfter.tokens, earlier ? 6700 : 6000)
  /* Monday, in the reader's zone — UTC for an account that has not said. */
  assert.equal(new Date(week.since).getUTCDay(), 1)
  assert.equal(new Date(month.since).getUTCDate(), 1)
})
