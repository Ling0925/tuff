import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { addPerson, closeDb, makeOwner, makeProject } from './helpers.js'

/*
 * A repeating task given to an agent is an agent on a schedule: each next
 * one wakes it as a person's assignment does.
 */

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
const HOOK = 'https://93.184.215.14/tuff'
const deliveries = (agent: string) =>
  owner<{ event: string; object_id: string; chain: string | null }[]>`
    select d.event, d.payload->>'object_id' as object_id, d.payload->>'chain' as chain
    from webhook_delivery d join webhook w on w.id = d.webhook_id
    where w.agent_id = ${agent} order by d.created_at`

test('the next one of a repeating task wakes the agent it is given to, as a person’s assignment', async () => {
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, 'Weekly')
  const made = await send('POST', '/api/agents', boss.token, { name: 'Reporter', project_ids: [project], reach: 'webhook', url: HOOK })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const agent = made.body.agent_id as string
  const agentToken = made.body.token as string

  const first = await send('POST', `/api/projects/${project}/tasks`, boss.token, {
    title: 'Write the week’s status',
    assignee_ids: [agent],
    due_on: '2026-11-27',
    repeat: { every: 'week', weekdays: [5] },
  })
  assert.equal(first.status, 201, JSON.stringify(first.body))
  assert.deepEqual(
    (await deliveries(agent)).map((d) => [d.event, d.object_id, d.chain]),
    [['agent.assigned', first.body.id, '0']],
  )

  // The person finishes it: the next one is made, given to the agent, and wakes it at 0.
  const done = await send('PATCH', `/api/tasks/${first.body.id as string}`, boss.token, { completed: true })
  assert.equal(done.status, 200, JSON.stringify(done.body))
  const next = done.body.next as { id: string; assignee_ids: string[]; due_on: string } | null
  assert.ok(next, 'the next one is made')
  assert.deepEqual(next.assignee_ids, [agent])
  assert.equal(next.due_on, '2026-12-04')
  assert.deepEqual(
    (await deliveries(agent)).map((d) => [d.event, d.object_id, d.chain]),
    [
      ['agent.assigned', first.body.id, '0'],
      ['agent.assigned', next.id, '0'],
    ],
  )

  // And it is among the agent's tasks, which is how an agent through MCP finds it.
  const mine = await send('GET', '/api/my/tasks?tab=assigned', agentToken)
  assert.equal(mine.status, 200, JSON.stringify(mine.body))
  assert.ok((mine.body.tasks as { id: string }[]).some((t) => t.id === next.id))

  // The agent finishing its own is not woken by the one it makes: nobody is
  // told of their own act, and a daily series would otherwise run itself out.
  const own = await send('PATCH', `/api/tasks/${next.id}`, agentToken, { completed: true })
  assert.equal(own.status, 200, JSON.stringify(own.body))
  const third = own.body.next as { id: string; assignee_ids: string[] } | null
  assert.ok(third, 'the third one is made')
  assert.deepEqual(third.assignee_ids, [agent])
  assert.equal((await deliveries(agent)).length, 2)
})

test('the people on a repeating task are not told of the next one', async () => {
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, 'Quiet')
  const made = await send('POST', '/api/agents', boss.token, { name: 'Helper', project_ids: [project], reach: 'webhook', url: HOOK })
  const agent = made.body.agent_id as string
  const sam = await addPerson(boss.ctx, boss.workspaceId, 'member', [project])
  const first = await send('POST', `/api/projects/${project}/tasks`, boss.token, {
    title: 'Invoices',
    assignee_ids: [sam.actorId, agent],
    due_on: '2026-12-01',
    repeat: { every: 'month', day: 1 },
  })
  assert.equal(first.status, 201)
  const done = await send('PATCH', `/api/tasks/${first.body.id as string}`, boss.token, { completed: true })
  const next = done.body.next as { id: string }
  const notes = await owner<{ actor_id: string; reason: string }[]>`
    select actor_id, reason::text from notification where object_id = ${next.id}`
  assert.deepEqual(
    notes.map((n) => [n.actor_id, n.reason]),
    [[agent, 'assigned']],
  )
})
