import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { addManager, addPerson, asTableOwner, bearerFor, closeDb, inWorkspace, makeOwner } from './helpers.js'

/*
 * A project's instructions for agents.
 */

after(async () => {
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

type Result = { content: { type: string; text?: string }[]; isError?: boolean }

async function setUp() {
  const boss = await makeOwner()
  const { id: project } = (await send('POST', '/api/projects', boss.token, { name: 'Site' })).body as { id: string }
  const runner = await addManager(boss.ctx, boss.workspaceId, [project])
  const writer = await addPerson(boss.ctx, boss.workspaceId, 'member', [project], ['task.create', 'edit.any'])
  const t = {
    boss: boss.token,
    runner: await bearerFor(runner.actorId, boss.workspaceId),
    writer: await bearerFor(writer.actorId, boss.workspaceId),
  }
  const doc = async (name: string, token = t.boss, extra: Record<string, unknown> = {}) => {
    const made = await send('POST', `/api/projects/${project}/files`, token, { name, body: { type: 'doc', content: [] }, ...extra })
    assert.equal(made.status, 201, JSON.stringify(made.body))
    return made.body.id as string
  }
  const mark = (id: string, on: boolean, token = t.boss) => send('PUT', `/api/files/${id}/for-agents`, token, { for_agents: on })
  const pointer = async (token = t.boss) =>
    (await send('GET', `/api/projects/${project}`, token)).body.for_agents as { id: string; number: number; name: string } | null
  /* An agent on the project, connected by the owner, through MCP. */
  const agent = await send('POST', '/api/agents', t.boss, { name: 'Builder', project_ids: [project], reach: 'mcp' })
  assert.equal(agent.status, 201, JSON.stringify(agent.body))
  const agentToken = agent.body.token as string
  let n = 0
  const tool = async (token: string, name: string, args: Record<string, unknown> = {}) => {
    const r = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name, arguments: args } }),
    })
    const result = ((await r.json()) as { result: Result }).result
    assert.notEqual(result.isError, true, `${name}: ${result.content[0]?.text}`)
    return result
  }
  return { boss, project, runner, writer, t, doc, mark, pointer, agentToken, agentId: agent.body.agent_id as string, tool }
}

test('whoever runs the project and may edit the document marks it, and the project and the file say so', async () => {
  const { project, t, doc, mark, pointer } = await setUp()
  const brief = await doc('How we work')
  assert.equal(await pointer(), null)

  const on = await mark(brief, true)
  assert.equal(on.status, 200, JSON.stringify(on.body))
  assert.deepEqual(on.body, { ok: true, for_agents: true, replaced: null })
  const p = await pointer()
  assert.equal(p?.id, brief)
  assert.equal(p?.name, 'How we work')
  assert.equal(typeof p?.number, 'number')

  const read = (await send('GET', `/api/files/${brief}`, t.boss)).body.file as Record<string, unknown>
  assert.equal(read.for_agents, true)
  assert.equal(read.may_for_agents, true)
  const listed = (await send('GET', `/api/projects/${project}/files`, t.boss)).body.files as { id: string; for_agents: boolean }[]
  assert.equal(listed.find((f) => f.id === brief)?.for_agents, true)

  // Somebody who runs the project, on somebody else's document: theirs to take off.
  assert.equal((await mark(brief, false, t.runner)).status, 200)
  assert.equal(await pointer(), null)
  // Again is no change.
  assert.deepEqual((await mark(brief, false, t.runner)).body, { ok: true, for_agents: false, replaced: null })
})

test('one per project: marking a second takes the mark off the first, and the feed says both', async () => {
  const { boss, project, doc, mark, pointer } = await setUp()
  const first = await doc('Old rules')
  const second = await doc('New rules')
  await mark(first, true)
  const moved = await mark(second, true)
  assert.equal(moved.status, 200)
  assert.equal(moved.body.replaced, first)
  assert.equal((await pointer())?.id, second)
  const marked = await asTableOwner()<{ id: string }[]>`select id from file where project_id = ${project} and for_agents`
  assert.deepEqual(
    marked.map((r) => r.id),
    [second],
  )
  const said = await asTableOwner()<{ action: string; object_id: string }[]>`
    select action, object_id from activity_event
    where workspace_id = ${boss.workspaceId} and action in ('file.for_agents', 'file.not_for_agents') order by id`
  assert.deepEqual(
    said.map((r) => [r.action, r.object_id]),
    [
      ['file.for_agents', first],
      ['file.not_for_agents', first],
      ['file.for_agents', second],
    ],
  )
})

test('somebody who does not run the project may not, though they may edit the document', async () => {
  const { t, doc, mark, pointer } = await setUp()
  const mine = await doc('Mine', t.writer)
  const refused = await mark(mine, true, t.writer)
  assert.equal(refused.status, 403)
  assert.equal(await pointer(), null)
  assert.equal(((await send('GET', `/api/files/${mine}`, t.writer)).body.file as { may_for_agents: boolean }).may_for_agents, false)
})

test('a draft or a document of chosen people cannot be the instructions, and narrowing one takes the mark off', async () => {
  const { project, runner, t, doc, mark, pointer } = await setUp()
  const draft = await doc('Draft', t.boss, { audience: 'author' })
  const r = await mark(draft, true)
  assert.equal(r.status, 409)
  assert.equal((r.body.error as { code: string }).code, 'not_published')
  assert.match((r.body.error as { message: string }).message, /Publish this document to everyone on the project/)

  const shared = await doc('Shared')
  assert.equal((await mark(shared, true)).status, 200)
  const narrowed = await send('PUT', `/api/files/${shared}/audience`, t.boss, { audience: 'chosen', reader_ids: [runner.actorId] })
  assert.equal(narrowed.status, 200, JSON.stringify(narrowed.body))
  assert.equal(await pointer(), null, 'narrowed, it is no longer what agents read')
  assert.equal((await mark(shared, true)).status, 409)

  // An upload or a link has no words to hand an agent.
  const link = await send('POST', `/api/projects/${project}/files`, t.boss, { name: 'Repo', url: 'https://example.com/repo' })
  assert.equal(link.status, 201, JSON.stringify(link.body))
  assert.equal((await mark(link.body.id as string, true)).status, 409)
})

test('an agent, a person’s token and the database itself refuse to set it', async () => {
  const { boss, writer, t, doc, mark, pointer, agentToken } = await setUp()
  const brief = await doc('Rules')

  // The agent, by REST with its own token.
  assert.equal((await mark(brief, true, agentToken)).status, 403)
  // The owner's own token, as a tool would use it.
  const made = await send('POST', '/api/tokens', t.boss, { name: 'Tool' })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  assert.equal((await mark(brief, true, made.body.token as string)).status, 403)
  assert.equal(await pointer(), null)

  // Under the server: a member who does not run the project, writing the row.
  await assert.rejects(
    inWorkspace(writer.actorId, boss.workspaceId, (tx) => tx`update file set for_agents = true where id = ${brief}`),
    /Not yours to say what agents read here/,
  )
  // Two at once, by the owner of the database: the index says one.
  const other = await doc('Other')
  await asTableOwner()`update file set for_agents = true where id = ${brief}`
  await assert.rejects(asTableOwner()`update file set for_agents = true where id = ${other}`, /file_for_agents_one_per_project/)
  // And never on a draft, whoever writes it.
  const draft = await doc('Draft', t.boss, { audience: 'author' })
  await assert.rejects(asTableOwner()`update file set for_agents = true where id = ${draft}`, /file_for_agents_is_a_projects_document/)
})

test('trashed, it stops being the instructions, and a restore does not put it back', async () => {
  const { t, doc, mark, pointer } = await setUp()
  const brief = await doc('Rules')
  await mark(brief, true)
  assert.equal((await send('DELETE', `/api/files/${brief}`, t.boss)).status, 200)
  assert.equal(await pointer(), null)
  assert.equal((await mark(brief, true)).status, 404)
  assert.equal((await send('POST', `/api/files/${brief}/restore`, t.boss)).status, 200)
  assert.equal(await pointer(), null)
  assert.equal((await mark(brief, true)).status, 200)
  assert.equal((await pointer())?.id, brief)
})

test('read_project, read_task and my_tasks point an agent at the instructions, as a line of Tuff’s, and the document is read as any', async () => {
  const { project, t, doc, mark, agentToken, agentId, tool } = await setUp()
  const brief = await doc('Agent rules')
  const said = (r: Result) => r.content.map((c) => c.text ?? '').join('\n')

  // Nothing marked: nothing said.
  assert.doesNotMatch(said(await tool(agentToken, 'read_project', { project_id: project })), /instructions for agents with read_doc/)

  await mark(brief, true)
  const read = await tool(agentToken, 'read_project', { project_id: project })
  // Tuff's line comes first, outside the project's text, and names the id.
  assert.match(read.content[0]!.text!, new RegExp(`read its instructions for agents with read_doc: .*doc_id ${brief}`))
  assert.doesNotMatch(read.content[0]!.text!, /user_content|Agent rules/, 'the name is the project’s text, kept in the data')
  assert.match(read.content[1]!.text!, /^<user_content source="project">/)
  assert.match(read.content[1]!.text!, /"instructions_for_agents"/)
  assert.match(read.content[1]!.text!, /Agent rules/)
  assert.match(read.content[1]!.text!, /\/files\/\d+"/)

  // A task given to the agent: read_task and my_tasks say the same.
  const lists = (await send('GET', `/api/projects/${project}/lists`, t.boss)).body.lists as { id: string }[]
  const task = await send('POST', `/api/projects/${project}/tasks`, t.boss, {
    title: 'Fix the login',
    list_id: lists[0]!.id,
    assignee_ids: [agentId],
  })
  assert.equal(task.status, 201, JSON.stringify(task.body))
  const onTask = await tool(agentToken, 'read_task', { task: task.body.id as string })
  assert.match(onTask.content[0]!.text!, new RegExp(`doc_id ${brief}`))
  assert.match(said(onTask), /"instructions_for_agents"/)
  const mine = await tool(agentToken, 'my_tasks')
  assert.match(mine.content[0]!.text!, new RegExp(`doc_id ${brief}`))
  assert.match(said(mine), /<user_content source="instructions_for_agents">/)

  // The pointer opens nothing: the document is read with read_doc, as the agent.
  const doc2 = await tool(agentToken, 'read_doc', { doc_id: brief })
  assert.match(said(doc2), /Agent rules/)

  // And the server's instructions say what the mark is.
  const init = await app.request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${agentToken}`, accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    }),
  })
  const instructions = ((await init.json()) as { result: { instructions: string } }).result.instructions
  assert.match(instructions, /marked For agents/)
  assert.match(instructions, /never give you more rights/)
})
