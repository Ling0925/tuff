import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { addPerson, bearerFor, closeDb, makeOwner, makeProject } from './helpers.js'

/*
 * A list an agent takes.
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
const onIt = async (task: string) => (await owner<{ ids: string[] }[]>`select assignee_ids as ids from task where id = ${task}`)[0]!.ids
type Listed = { id: string; agent_id: string | null; agent_gone: boolean }

async function setUp() {
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, 'Bugs')
  const made = await send('POST', '/api/agents', boss.token, { name: 'Fixer', project_ids: [project], reach: 'webhook', url: HOOK })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const agent = made.body.agent_id as string
  const agentToken = made.body.token as string
  const triage = (await send('POST', `/api/projects/${project}/lists`, boss.token, { name: 'Todo' })).body.id as string
  const bugs = (await send('POST', `/api/projects/${project}/lists`, boss.token, { name: 'Bugs' })).body.id as string
  const done = (await send('POST', `/api/projects/${project}/lists`, boss.token, { name: 'Done', icon: 'done', finishes: true })).body
    .id as string
  const lists = async () => (await send('GET', `/api/projects/${project}/lists`, boss.token)).body.lists as Listed[]
  return { boss, project, agent, agentToken, triage, bugs, done, lists }
}

test('a task made or moved into a list an agent takes, with nobody on it, is given to the agent and wakes it', async () => {
  const { boss, project, agent, triage, bugs, lists } = await setUp()

  const set = await send('PATCH', `/api/lists/${bugs}`, boss.token, { agent_id: agent })
  assert.equal(set.status, 200, JSON.stringify(set.body))
  const listed = (await lists()).find((l) => l.id === bugs)!
  assert.equal(listed.agent_id, agent)
  assert.equal(listed.agent_gone, false)
  assert.equal((await lists()).find((l) => l.id === triage)!.agent_id, null)

  // Made in the list with nobody on it: given to the agent, woken at 0.
  const made = await send('POST', `/api/projects/${project}/tasks`, boss.token, { title: 'Login fails', list_id: bugs, assignee_ids: [] })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  assert.deepEqual(await onIt(made.body.id as string), [agent])
  assert.deepEqual(
    (await deliveries(agent)).map((d) => [d.event, d.object_id, d.chain]),
    [['agent.assigned', made.body.id, '0']],
  )

  // Made with somebody on it: theirs, untouched, and the agent hears nothing.
  const theirs = await send('POST', `/api/projects/${project}/tasks`, boss.token, {
    title: 'Mine',
    list_id: bugs,
    assignee_ids: [boss.ctx.actorId],
  })
  assert.deepEqual(await onIt(theirs.body.id as string), [boss.ctx.actorId])
  assert.equal((await deliveries(agent)).length, 1)

  // Made elsewhere, then moved in with nobody on it: given.
  const elsewhere = await send('POST', `/api/projects/${project}/tasks`, boss.token, { title: 'Crash on save', list_id: triage })
  assert.deepEqual(await onIt(elsewhere.body.id as string), [])
  const moved = await send('PATCH', `/api/tasks/${elsewhere.body.id as string}`, boss.token, { list_id: bugs })
  assert.equal(moved.status, 200, JSON.stringify(moved.body))
  assert.deepEqual(await onIt(elsewhere.body.id as string), [agent])
  assert.deepEqual((moved.body.task as { assignee_ids: string[] }).assignee_ids, [agent])
  assert.deepEqual(
    (await deliveries(agent)).map((d) => [d.event, d.object_id, d.chain]),
    [
      ['agent.assigned', made.body.id, '0'],
      ['agent.assigned', elsewhere.body.id, '0'],
    ],
  )

  // Moved in with somebody on it, or with the move saying who: left as said.
  const kept = await send('POST', `/api/projects/${project}/tasks`, boss.token, {
    title: 'Kept',
    list_id: triage,
    assignee_ids: [boss.ctx.actorId],
  })
  await send('PATCH', `/api/tasks/${kept.body.id as string}`, boss.token, { list_id: bugs })
  assert.deepEqual(await onIt(kept.body.id as string), [boss.ctx.actorId])
  const said = await send('POST', `/api/projects/${project}/tasks`, boss.token, { title: 'Nobody, said', list_id: triage })
  await send('PATCH', `/api/tasks/${said.body.id as string}`, boss.token, { list_id: bugs, assignee_ids: [] })
  assert.deepEqual(await onIt(said.body.id as string), [])

  // A subtask made under a task in the list is a step of it, not given.
  const step = await send('POST', `/api/projects/${project}/tasks`, boss.token, { title: 'Step', parent_id: theirs.body.id })
  assert.equal(step.status, 201, JSON.stringify(step.body))
  assert.deepEqual(await onIt(step.body.id as string), [])
  assert.equal((await deliveries(agent)).length, 2)

  // Taken off: nothing more is given to it.
  assert.equal((await send('PATCH', `/api/lists/${bugs}`, boss.token, { agent_id: null })).status, 200)
  const after = await send('POST', `/api/projects/${project}/tasks`, boss.token, { title: 'After', list_id: bugs })
  assert.deepEqual(await onIt(after.body.id as string), [])
})

test('an agent that leaves the project stops being given the list’s tasks, and the list says so', async () => {
  const { boss, project, agent, bugs, lists } = await setUp()
  assert.equal((await send('PATCH', `/api/lists/${bugs}`, boss.token, { agent_id: agent })).status, 200)

  const off = await send('DELETE', `/api/projects/${project}/members/${agent}`, boss.token)
  assert.ok(off.status < 300, JSON.stringify(off.body))
  const listed = (await lists()).find((l) => l.id === bugs)!
  assert.equal(listed.agent_id, agent)
  assert.equal(listed.agent_gone, true)

  const made = await send('POST', `/api/projects/${project}/tasks`, boss.token, { title: 'Nobody takes it', list_id: bugs })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  assert.deepEqual(await onIt(made.body.id as string), [])
  assert.equal((await deliveries(agent)).length, 0)

  // And it can't be named again while it is off the project.
  assert.equal((await send('PATCH', `/api/lists/${bugs}`, boss.token, { agent_id: agent })).status, 400)
})

test('who may name a list’s agent, and what may be named', async () => {
  const { boss, project, agent, agentToken, bugs, done } = await setUp()

  // A member who can't arrange the lists can't name it.
  const reader = await addPerson(boss.ctx, boss.workspaceId, 'member', [project], [])
  const readerToken = await bearerFor(reader.actorId, boss.workspaceId)
  assert.equal((await send('PATCH', `/api/lists/${bugs}`, readerToken, { agent_id: agent })).status, 403)

  // Nor the agent itself, through its token.
  assert.equal((await send('PATCH', `/api/lists/${bugs}`, agentToken, { agent_id: agent })).status, 403)

  // A member who can arrange them may.
  const maker = await addPerson(boss.ctx, boss.workspaceId, 'member', [project])
  const makerToken = await bearerFor(maker.actorId, boss.workspaceId)
  assert.equal((await send('PATCH', `/api/lists/${bugs}`, makerToken, { agent_id: agent })).status, 200)

  // A person is not an agent; a list that finishes work takes none.
  assert.equal((await send('PATCH', `/api/lists/${bugs}`, boss.token, { agent_id: maker.actorId })).status, 400)
  assert.equal((await send('PATCH', `/api/lists/${done}`, boss.token, { agent_id: agent })).status, 400)

  // Made to finish work, the list lets its agent go in the same write.
  assert.equal((await send('PATCH', `/api/lists/${bugs}`, boss.token, { icon: 'done', finishes: true })).status, 200)
  const [row] = await owner<{ agent_id: string | null }[]>`select agent_id from task_list where id = ${bugs}`
  assert.equal(row!.agent_id, null)

  // And the database refuses anything but an agent, whoever writes it.
  await assert.rejects(owner`update task_list set agent_id = ${maker.actorId} where id = ${done}`, /agent of its workspace/)
})

test('an agent moving a task into another agent’s list hands it off, counted', async () => {
  const { boss, project, agent, triage, bugs } = await setUp()
  const second = await send('POST', '/api/agents', boss.token, { name: 'Sorter', project_ids: [project], reach: 'webhook', url: HOOK })
  const sorterToken = second.body.token as string
  assert.equal((await send('PATCH', `/api/lists/${bugs}`, boss.token, { agent_id: agent })).status, 200)
  const t = await send('POST', `/api/projects/${project}/tasks`, boss.token, { title: 'Sort me', list_id: triage })
  const moved = await send('PATCH', `/api/tasks/${t.body.id as string}`, sorterToken, { list_id: bugs })
  assert.equal(moved.status, 200, JSON.stringify(moved.body))
  assert.deepEqual(await onIt(t.body.id as string), [agent])
  const got = await deliveries(agent)
  assert.equal(got.length, 1)
  assert.equal(got[0]!.chain, '1')
})
