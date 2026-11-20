import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { closeRealtime, subscribe } from '../src/realtime.js'
import { cleanDoing } from '../src/doing.js'
import { addPerson, bearerFor, closeDb, inWorkspace, makeOwner, makeProject } from './helpers.js'

/* As the tables' owner, to age a status without waiting three minutes. */
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

type Status = {
  agent_id: string
  task_id: string | null
  project_id: string | null
  task_number: number | null
  doing: string
  since: string
  at: string
  until: string
}
type Person = { actor_id: string; status?: Status | null }

/** A workspace with a project, Ada on it, a stranger off it, an agent on it and a task. */
async function setUp(name: string) {
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, name)
  const elsewhere = await makeProject(boss.ctx, boss.workspaceId, `${name} elsewhere`)
  const ada = await addPerson(boss.ctx, boss.workspaceId, 'member', [project])
  const adaToken = await bearerFor(ada.actorId, boss.workspaceId)
  const stranger = await addPerson(boss.ctx, boss.workspaceId, 'member', [])
  const strangerToken = await bearerFor(stranger.actorId, boss.workspaceId)
  const made = await send('POST', '/api/agents', boss.token, { name: 'Claude Code', project_ids: [project], reach: 'mcp' })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const task = await send('POST', `/api/projects/${project}/tasks`, boss.token, { title: 'Read the handler' })
  const hidden = await send('POST', `/api/projects/${elsewhere}/tasks`, boss.token, { title: 'Not the agent’s' })
  return {
    boss,
    project,
    ada,
    adaToken,
    stranger,
    strangerToken,
    agent: made.body.agent_id as string,
    agentToken: made.body.token as string,
    taskId: task.body.id as string,
    hiddenId: hidden.body.id as string,
  }
}

const working = async (token: string) => ((await send('GET', '/api/working', token)).body.working ?? []) as Status[]
const personStatus = async (token: string, agent: string) =>
  (((await send('GET', '/api/people', token)).body.people ?? []) as Person[]).find((p) => p.actor_id === agent)?.status ?? null

test('an agent says what it is doing, and whoever can see the task sees it', async () => {
  const w = await setUp('Status')
  const said = await send('PUT', '/api/me/status', w.agentToken, { task_id: w.taskId, doing: 'reading server/src/http/tasks.ts' })
  assert.equal(said.status, 200, JSON.stringify(said.body))
  const status = said.body.status as Status
  assert.equal(status.doing, 'reading server/src/http/tasks.ts')
  assert.equal(status.task_id, w.taskId)
  assert.equal(status.project_id, w.project)
  assert.equal(typeof status.task_number, 'number')
  // Shown for three minutes after it was said.
  assert.equal(Date.parse(status.until) - Date.parse(status.at), 3 * 60_000)

  // Ada, on the project: in the people, the short read, the members, the task and the agents.
  assert.equal((await personStatus(w.adaToken, w.agent))?.doing, 'reading server/src/http/tasks.ts')
  assert.deepEqual(
    (await working(w.adaToken)).map((s) => s.agent_id),
    [w.agent],
  )
  const members = (await send('GET', `/api/projects/${w.project}/members`, w.adaToken)).body.members as Person[]
  assert.equal(members.find((m) => m.actor_id === w.agent)?.status?.task_id, w.taskId)
  const read = (await send('GET', `/api/tasks/${w.taskId}`, w.adaToken)).body as { working: Status[] }
  assert.deepEqual(
    read.working.map((s) => s.doing),
    ['reading server/src/http/tasks.ts'],
  )
  const agents = (await send('GET', '/api/agents', w.boss.token)).body.agents as Person[]
  assert.equal(agents.find((a) => a.actor_id === w.agent)?.status?.doing, 'reading server/src/http/tasks.ts')

  // The stranger, who cannot open the task, reads neither that it is at it nor what it says.
  assert.equal(await personStatus(w.strangerToken, w.agent), null)
  assert.deepEqual(await working(w.strangerToken), [])

  // A status that names no task is seen by anybody in the workspace.
  await send('PUT', '/api/me/status', w.agentToken, { doing: 'between tasks' })
  assert.equal((await personStatus(w.strangerToken, w.agent))?.doing, 'between tasks')
  assert.equal((await personStatus(w.strangerToken, w.agent))?.task_id, null)
})

test('said again it replaces; the clock runs on the same task and starts again on another; null clears', async () => {
  const w = await setUp('Again')
  const first = (await send('PUT', '/api/me/status', w.agentToken, { task_id: w.taskId, doing: 'reading' })).body.status as Status
  await owner`update agent_doing set since = now() - interval '14 minutes' where agent_id = ${w.agent}`
  const second = (await send('PUT', '/api/me/status', w.agentToken, { task_id: w.taskId, doing: 'running the tests' })).body
    .status as Status
  assert.equal(second.doing, 'running the tests')
  assert.ok(Date.now() - Date.parse(second.since) >= 13 * 60_000, 'the same task keeps its clock')
  assert.ok(Date.parse(second.at) >= Date.parse(first.at))
  const other = await send('POST', `/api/projects/${w.project}/tasks`, w.boss.token, { title: 'Next one' })
  const third = (await send('PUT', '/api/me/status', w.agentToken, { task_id: other.body.id, doing: 'starting' })).body.status as Status
  assert.ok(Date.now() - Date.parse(third.since) < 60_000, 'another task starts the clock again')
  // One row an agent, never two.
  assert.equal((await working(w.adaToken)).length, 1)

  const cleared = await send('PUT', '/api/me/status', w.agentToken, { doing: null })
  assert.equal(cleared.status, 200)
  assert.equal(cleared.body.status, null)
  assert.deepEqual(await working(w.adaToken), [])
  assert.equal(await personStatus(w.adaToken, w.agent), null)
})

test('a status goes stale by itself after three minutes', async () => {
  const w = await setUp('Stale')
  await send('PUT', '/api/me/status', w.agentToken, { task_id: w.taskId, doing: 'reading' })
  await owner`update agent_doing set at = now() - interval '2 minutes 50 seconds' where agent_id = ${w.agent}`
  assert.equal((await working(w.adaToken)).length, 1, 'still fresh just under three minutes')
  await owner`update agent_doing set at = now() - interval '3 minutes 10 seconds' where agent_id = ${w.agent}`
  assert.deepEqual(await working(w.adaToken), [])
  assert.equal(await personStatus(w.adaToken, w.agent), null)
  assert.deepEqual(((await send('GET', `/api/tasks/${w.taskId}`, w.adaToken)).body as { working: Status[] }).working, [])
  // Said again after going stale, its clock starts again.
  await owner`update agent_doing set since = now() - interval '1 hour' where agent_id = ${w.agent}`
  const again = (await send('PUT', '/api/me/status', w.agentToken, { task_id: w.taskId, doing: 'back' })).body.status as Status
  assert.ok(Date.now() - Date.parse(again.since) < 60_000)
})

test('only an agent says it, about itself, on a task it can see', async () => {
  const w = await setUp('Who says')
  // A task in a project the agent is not on: as missing as any read of it.
  const hidden = await send('PUT', '/api/me/status', w.agentToken, { task_id: w.hiddenId, doing: 'peeking' })
  assert.equal(hidden.status, 404)
  assert.equal(
    (await send('PUT', '/api/me/status', w.agentToken, { task_id: '00000000-0000-7000-8000-000000000000', doing: 'x' })).status,
    404,
  )

  // A person, signed in or through their own token, says nothing.
  assert.equal((await send('PUT', '/api/me/status', w.adaToken, { task_id: w.taskId, doing: 'me' })).status, 403)
  const personal = (await send('POST', '/api/tokens', w.boss.token, { name: 'Script' })).body.token as string
  assert.ok(personal)
  assert.equal((await send('PUT', '/api/me/status', personal, { task_id: w.taskId, doing: 'as the agent' })).status, 403)

  // Not past the endpoint either: the row is the agent's own, by policy.
  await send('PUT', '/api/me/status', w.agentToken, { task_id: w.taskId, doing: 'its own words' })
  await assert.rejects(
    inWorkspace(
      w.ada.actorId,
      w.boss.workspaceId,
      (tx) =>
        tx`insert into agent_doing (agent_id, workspace_id, task_id, doing) values (${w.ada.actorId}, ${w.boss.workspaceId}, ${w.taskId}, 'a person')`,
    ),
  )
  const changed = await inWorkspace(
    w.ada.actorId,
    w.boss.workspaceId,
    (tx) => tx`update agent_doing set doing = 'put in its mouth' where agent_id = ${w.agent} returning 1`,
  )
  assert.equal(changed.length, 0)

  // A second agent changes only its own.
  const other = await send('POST', '/api/agents', w.boss.token, { name: 'Codex', project_ids: [w.project], reach: 'mcp' })
  await send('PUT', '/api/me/status', other.body.token as string, { task_id: w.taskId, doing: 'reviewing' })
  await send('PUT', '/api/me/status', other.body.token as string, { doing: null })
  assert.equal((await personStatus(w.adaToken, w.agent))?.doing, 'its own words')
})

test('what it says is cleaned and cut to 120', async () => {
  assert.equal(cleanDoing('  reading\n\tthe   file\u0000 '), 'reading the file')
  const w = await setUp('Cut')
  const long = await send('PUT', '/api/me/status', w.agentToken, { task_id: w.taskId, doing: `${'a'.repeat(300)}` })
  assert.equal(long.status, 200)
  assert.equal((long.body.status as Status).doing.length, 120)
  assert.equal((await send('PUT', '/api/me/status', w.agentToken, { task_id: w.taskId, doing: ' \n ' })).status, 400)
  assert.equal((await send('PUT', '/api/me/status', w.agentToken, { task_id: w.taskId, doing: 'x'.repeat(2001) })).status, 400)
})

test('finishing the task takes the status away', async () => {
  const w = await setUp('Finish')
  await send('PUT', '/api/me/status', w.agentToken, { task_id: w.taskId, doing: 'wrapping up' })
  assert.equal((await working(w.adaToken)).length, 1)
  assert.equal((await send('PATCH', `/api/tasks/${w.taskId}`, w.agentToken, { completed: true })).status, 200)
  assert.deepEqual(await working(w.adaToken), [])
  const [left] = await owner<{ n: number }[]>`select count(*)::int as n from agent_doing where agent_id = ${w.agent}`
  assert.equal(left!.n, 0)
})

test('the project hears that a status changed, and not when it is said the same again', async () => {
  const w = await setUp('Heard')
  const heard: { kind: string; payload: unknown }[] = []
  const stop = await subscribe(`project:${w.project}`, (e) => {
    if (e.kind === 'agent.status') heard.push({ kind: e.kind, payload: e.payload })
  })
  const settle = () => new Promise((r) => setTimeout(r, 400))
  try {
    await send('PUT', '/api/me/status', w.agentToken, { task_id: w.taskId, doing: 'reading' })
    await settle()
    assert.equal(heard.length, 1)
    assert.deepEqual(heard[0]!.payload, { agent_id: w.agent, task_id: w.taskId })
    // The heartbeat: the same words on the same task say nothing.
    await send('PUT', '/api/me/status', w.agentToken, { task_id: w.taskId, doing: 'reading' })
    await settle()
    assert.equal(heard.length, 1)
    await send('PUT', '/api/me/status', w.agentToken, { doing: null })
    await settle()
    assert.equal(heard.length, 2)
    // The words travel nowhere: the fact and the ids.
    assert.ok(!JSON.stringify(heard).includes('reading'))
  } finally {
    stop()
  }
})

test('an agent says it through MCP, by the task’s handle', async () => {
  const w = await setUp('Over MCP')
  let id = 0
  const tool = async (name: string, args: Record<string, unknown>) => {
    const r = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${w.agentToken}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }),
    })
    const said = (await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }
    assert.notEqual(said.result.isError, true, `${name}: ${said.result.content[0]!.text}`)
    return JSON.parse(said.result.content[0]!.text) as Record<string, unknown>
  }
  const read = (await send('GET', `/api/tasks/${w.taskId}`, w.adaToken)).body as { task: { number: number } }
  const { key } = (await send('GET', `/api/projects/${w.project}`, w.adaToken)).body as { key: string }
  assert.ok(key)
  const set = await tool('set_status', { task: `${key}-${read.task.number}`, doing: 'reading the spec' })
  assert.equal(set.doing, 'reading the spec')
  assert.equal(set.task_id, w.taskId)
  assert.equal((await personStatus(w.adaToken, w.agent))?.doing, 'reading the spec')
  const cleared = await tool('set_status', { doing: null })
  assert.equal(cleared.cleared, true)
  assert.equal(await personStatus(w.adaToken, w.agent), null)
})

test('a disconnected agent says nothing more', async () => {
  const w = await setUp('Gone')
  await send('PUT', '/api/me/status', w.agentToken, { task_id: w.taskId, doing: 'reading' })
  assert.equal((await working(w.adaToken)).length, 1)
  const gone = await send('DELETE', `/api/agents/${w.agent}`, w.boss.token)
  assert.ok(gone.status < 300, JSON.stringify(gone.body))
  assert.deepEqual(await working(w.adaToken), [])
})

test('a line keeps no format characters: no bidi override, isolate, zero width or BOM', () => {
  const said = cleanDoing('rea‮ding​ a ⁦file⁩﻿')
  assert.equal(said, 'reading a file')
})
