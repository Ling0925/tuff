import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { addPerson, bearerFor, closeDb, makeOwner, makeProject } from './helpers.js'

/* As the tables' owner, for what only a fixture reads. */
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
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const naming = (id: string, label: string) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'mention', attrs: { id, label } },
        { type: 'text', text: ' over to you' },
      ],
    },
  ],
})
const CHOICES = [{ label: 'Keep the old endpoint' }, { label: 'Remove it', recommended: true }]

type Q = { id: string; task_id: string; choices: { label: string; recommended: boolean }[]; excerpt: string; by_name: string }

test('an agent asks with choices, a person answers once, and the agent reads it', async () => {
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, 'Asked')
  const ada = await addPerson(boss.ctx, boss.workspaceId, 'member', [project])
  const adaToken = await bearerFor(ada.actorId, boss.workspaceId)
  const stranger = await addPerson(boss.ctx, boss.workspaceId, 'member', [])
  const made = await send('POST', '/api/agents', boss.token, { name: 'Claude Code', project_ids: [project], reach: 'mcp' })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const agent = made.body.agent_id as string
  const agentToken = made.body.token as string

  const task = await send('POST', `/api/projects/${project}/tasks`, boss.token, { title: 'Drop v1', assignee_ids: [ada.actorId, agent] })
  assert.equal(task.status, 201, JSON.stringify(task.body))
  const taskId = task.body.id as string

  // A person may not ask with choices, nor may their own token.
  const byPerson = await send('POST', `/api/tasks/${taskId}/comments`, adaToken, { body: doc('Which?'), choices: CHOICES })
  assert.equal(byPerson.status, 403)
  // A question has two to four choices, one recommended at most, and starts a thread.
  assert.equal((await send('POST', `/api/tasks/${taskId}/comments`, agentToken, { body: doc('?'), choices: [CHOICES[0]] })).status, 400)
  assert.equal(
    (
      await send('POST', `/api/tasks/${taskId}/comments`, agentToken, {
        body: doc('?'),
        choices: [
          { label: 'a', recommended: true },
          { label: 'b', recommended: true },
        ],
      })
    ).status,
    400,
  )
  // Named somebody who cannot see the task, and nobody else: refused.
  const nobody = await send('POST', `/api/tasks/${taskId}/comments`, agentToken, {
    body: doc('?'),
    choices: CHOICES,
    to: [stranger.actorId],
  })
  assert.equal(nobody.status, 409, JSON.stringify(nobody.body))
  assert.equal((nobody.body.error as { code: string }).code, 'nobody_to_ask')

  // Asked of the people it is given to: Ada, never the agent itself.
  const asked = await send('POST', `/api/tasks/${taskId}/comments`, agentToken, {
    body: doc('Shall I remove the v1 endpoint?'),
    choices: CHOICES,
  })
  assert.equal(asked.status, 201, JSON.stringify(asked.body))
  const qId = asked.body.id as string
  assert.deepEqual(asked.body.asked, [ada.actorId])

  // In Ada's inbox: a note of its own kind, and the question under Needs you.
  const inbox = (await send('GET', '/api/inbox', adaToken)).body as {
    notifications: { reason: string; kind: string; excerpt: string | null; what: string }[]
    unread: Record<string, string>
    questions: Q[]
  }
  const note = inbox.notifications.find((n) => n.reason === 'asked')
  assert.ok(note, JSON.stringify(inbox.notifications))
  assert.equal(note.kind, 'asked')
  assert.equal(note.what, 'Claude Code asked you a question')
  assert.equal(note.excerpt, 'Shall I remove the v1 endpoint?')
  assert.equal(inbox.unread.asked, '1')
  assert.equal(inbox.questions.length, 1)
  assert.equal(inbox.questions[0]!.id, qId)
  assert.equal(inbox.questions[0]!.task_id, taskId)
  assert.deepEqual(
    inbox.questions[0]!.choices.map((c) => [c.label, c.recommended]),
    [
      ['Keep the old endpoint', false],
      ['Remove it', true],
    ],
  )
  // The owner watches (they made the task) and hears it as a comment would be heard — not asked.
  const bossInbox = (await send('GET', '/api/inbox', boss.token)).body as { questions: Q[] }
  assert.equal(bossInbox.questions.length, 0)

  // The agent may not answer, nor a stranger who cannot see the task.
  assert.equal((await send('PUT', `/api/comments/${qId}/answer`, agentToken, { choice: 1 })).status, 403)
  const strangerToken = await bearerFor(stranger.actorId, boss.workspaceId)
  assert.equal((await send('PUT', `/api/comments/${qId}/answer`, strangerToken, { choice: 1 })).status, 404)
  assert.equal((await send('PUT', `/api/comments/${qId}/answer`, adaToken, { choice: 2 })).status, 400)

  // Not yet answered.
  const before = await send('GET', `/api/comments/${qId}/answer`, agentToken)
  assert.equal(before.status, 200, JSON.stringify(before.body))
  assert.equal(before.body.answer, null)

  // Ada presses Remove it.
  const answered = await send('PUT', `/api/comments/${qId}/answer`, adaToken, { choice: 1 })
  assert.equal(answered.status, 200, JSON.stringify(answered.body))
  assert.equal(answered.body.answer, 1)
  assert.equal(answered.body.answered_by, ada.actorId)

  // Once: the owner pressing after is told who was first.
  const again = await send('PUT', `/api/comments/${qId}/answer`, boss.token, { choice: 0 })
  assert.equal(again.status, 409)
  assert.equal((again.body.error as { code: string }).code, 'answered')
  assert.equal(again.body.answer, 1)

  // Gone from Needs you, and her note read.
  const after = (await send('GET', '/api/inbox', adaToken)).body as { questions: Q[]; unread: Record<string, string> }
  assert.equal(after.questions.length, 0)
  assert.equal(after.unread.asked, '0')

  // The agent reads it: from the answer, from the task's comments, and in its mentions.
  const read = await send('GET', `/api/comments/${qId}/answer`, agentToken)
  assert.equal(read.body.answer, 1)
  assert.equal(read.body.answered_by_name, 'member')
  const opened = (await send('GET', `/api/tasks/${taskId}`, agentToken)).body as {
    comments: { id: string; choices: unknown; answer: number | null; answered_by_name: string | null }[]
  }
  const q = opened.comments.find((c) => c.id === qId)!
  assert.equal(q.answer, 1)
  assert.equal(q.answered_by_name, 'member')
  const agentInbox = (await send('GET', '/api/inbox?unread=1', agentToken)).body as {
    notifications: { reason: string; kind: string }[]
  }
  assert.ok(
    agentInbox.notifications.some((n) => n.reason === 'mentioned' && n.kind === 'answered'),
    JSON.stringify(agentInbox.notifications),
  )

  // Nothing about it changed its words: an answer does not make it "edited".
  const [row] = await owner<{ edited: boolean }[]>`select updated_at > created_at as edited from comment where id = ${qId}`
  assert.equal(row!.edited, false)
  // A plain comment cannot be answered.
  const plain = await send('POST', `/api/tasks/${taskId}/comments`, adaToken, { body: doc('Thanks') })
  assert.equal((await send('PUT', `/api/comments/${plain.body.id as string}/answer`, adaToken, { choice: 0 })).status, 409)
})

test('given to nobody but agents, a question goes to whoever connected the agent', async () => {
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, 'Solo agent')
  const made = await send('POST', '/api/agents', boss.token, { name: 'Helper', project_ids: [project], reach: 'mcp' })
  const agent = made.body.agent_id as string
  const task = await send('POST', `/api/projects/${project}/tasks`, boss.token, { title: 'Only the agent', assignee_ids: [agent] })
  const asked = await send('POST', `/api/tasks/${task.body.id as string}/comments`, made.body.token as string, {
    body: doc('Which colour?'),
    choices: [{ label: 'Blue' }, { label: 'Green' }, { label: 'Red' }],
  })
  assert.equal(asked.status, 201, JSON.stringify(asked.body))
  assert.deepEqual(asked.body.asked, [boss.ctx.actorId])
})

test('an agent asks and waits for the answer through MCP', async () => {
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, 'Over MCP')
  const made = await send('POST', '/api/agents', boss.token, { name: 'Remote', project_ids: [project], reach: 'mcp' })
  const token = made.body.token as string
  const task = await send('POST', `/api/projects/${project}/tasks`, boss.token, { title: 'Pick one' })
  let id = 0
  const tool = async (name: string, args: Record<string, unknown>) => {
    const r = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }),
    })
    const said = (await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }
    assert.notEqual(said.result.isError, true, `${name}: ${said.result.content[0]!.text}`)
    /* What is read arrives wrapped as data — `asData` in `tools.ts`. */
    const text = said.result.content[0]!.text.replace(/^<user_content source="[^"]*">\n/, '').replace(/\n<\/user_content>$/, '')
    return JSON.parse(text) as Record<string, unknown>
  }
  const asked = await tool('ask', {
    task: task.body.id as string,
    question: 'Ship **today**?',
    choices: [{ label: 'Yes', recommended: true }, { label: 'Wait a day' }],
  })
  assert.deepEqual(asked.asked, [boss.ctx.actorId])
  assert.match(asked.url as string, /\/tasks\/\d+$/)
  const waiting = await tool('get_answer', { question_id: asked.id as string })
  assert.equal(waiting.answered, false)
  // Answered while it waits: the wait comes back with it.
  setTimeout(() => void send('PUT', `/api/comments/${asked.id as string}/answer`, boss.token, { choice: 1 }), 500)
  const got = await tool('get_answer', { question_id: asked.id as string, wait_seconds: 10 })
  assert.equal(got.answered, true)
  assert.equal(got.label, 'Wait a day')
  assert.equal(got.choice, 1)
})

test('agents wake each other, the third hand-off in a row goes to the people, and a person starts it again', async () => {
  const boss = await makeOwner()
  const p = await makeProject(boss.ctx, boss.workspaceId, 'Relay')
  const a = await send('POST', '/api/agents', boss.token, { name: 'A', project_ids: [p], reach: 'webhook', url: HOOK })
  const b = await send('POST', '/api/agents', boss.token, { name: 'B', project_ids: [p], reach: 'webhook', url: HOOK })
  const aId = a.body.agent_id as string
  const bId = b.body.agent_id as string
  const aToken = a.body.token as string
  const bToken = b.body.token as string
  const deliveries = (agent: string) =>
    owner<{ event: string; chain: number }[]>`
      select d.event, (d.payload->>'chain')::int as chain
      from webhook_delivery d join webhook w on w.id = d.webhook_id
      where w.agent_id = ${agent} order by d.created_at`.then((rows) => rows.map((r) => ({ event: r.event, chain: r.chain })))

  // A gives B a task: sent, one hop.
  const given = await send('POST', `/api/projects/${p}/tasks`, aToken, { title: 'Relay', assignee_ids: [bId] })
  assert.equal(given.status, 201, JSON.stringify(given.body))
  const taskId = given.body.id as string
  assert.deepEqual(await deliveries(bId), [{ event: 'agent.assigned', chain: 1 }])

  // B hands it back: two.
  await send('POST', `/api/tasks/${taskId}/comments`, bToken, { body: naming(aId, 'A') })
  assert.deepEqual(await deliveries(aId), [{ event: 'agent.mentioned', chain: 2 }])

  // A hands it on again: the third in a row is not sent, and the people are asked.
  await send('POST', `/api/tasks/${taskId}/comments`, aToken, { body: naming(bId, 'B') })
  assert.equal((await deliveries(bId)).length, 1)
  const needs = (await send('GET', '/api/inbox', boss.token)).body as { questions: Q[] }
  assert.equal(needs.questions.length, 1, JSON.stringify(needs))
  assert.equal(needs.questions[0]!.task_id, taskId)
  assert.match(needs.questions[0]!.excerpt, /3 times/)
  // B's own inbox was not written to either: an agent through MCP would have come for it.
  const bNotes = await owner<{ n: number }[]>`
    select count(*)::int as n from notification where actor_id = ${bId} and object_id = ${taskId} and reason = 'mentioned'`
  assert.equal(bNotes[0]!.n, 0)
  // Trying again does not ask twice.
  await send('POST', `/api/tasks/${taskId}/comments`, aToken, { body: naming(bId, 'B') })
  assert.equal(((await send('GET', '/api/inbox', boss.token)).body as { questions: Q[] }).questions.length, 1)

  // A person answers: that is a person's act on the task, and the chain starts again.
  const answered = await send('PUT', `/api/comments/${needs.questions[0]!.id}/answer`, boss.token, { choice: 0 })
  assert.equal(answered.status, 200, JSON.stringify(answered.body))
  await send('POST', `/api/tasks/${taskId}/comments`, aToken, { body: naming(bId, 'B') })
  assert.deepEqual((await deliveries(bId)).at(-1), { event: 'agent.mentioned', chain: 1 })

  // A person's own hand-off is 0.
  await send('POST', `/api/tasks/${taskId}/comments`, boss.token, { body: naming(aId, 'A') })
  assert.deepEqual((await deliveries(aId)).at(-1), { event: 'agent.mentioned', chain: 0 })
})
