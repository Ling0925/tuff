import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { closeRealtime, subscribe } from '../src/realtime.js'
import { deliverDue } from '../src/webhooks.js'
import { addPerson, bearerFor, closeDb, makeOwner, makeProject } from './helpers.js'

/*
 * An agent called in a room is seen working there,
 * A Grok agent asked in a
 * thread worked for three minutes and the thread showed nothing.
 */
const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
after(async () => {
  await owner.end()
  await closeRealtime()
  await closeDb()
})
async function send(method: string, path: string, token: string | null, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
const HOOK = 'https://93.184.215.14/tuff'
const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const naming = (id: string, t = ' review the triage') => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'mention', attrs: { id, label: 'Grok' } },
        { type: 'text', text: t },
      ],
    },
  ],
})
type InRoom = { agent_id: string; name: string; thread_id: string | null; message_id: string | null; doing: string | null }
const working = async (room: string, token: string) => {
  const r = await send('GET', `/api/conversations/${room}/working`, token)
  return { status: r.status, working: (r.body.working as InRoom[]) ?? [] }
}
const answered = async () => ({ status: 200 })
const settle = () => new Promise((r) => setTimeout(r, 400))

async function setup(name: string) {
  const boss = await makeOwner()
  const p = await makeProject(boss.ctx, boss.workspaceId, name)
  const a = await send('POST', '/api/agents', boss.token, { name: 'Grok', project_ids: [p], reach: 'webhook', url: HOOK })
  assert.equal(a.status, 201, JSON.stringify(a.body))
  return { boss, p, agent: a.body.agent_id as string, agentToken: a.body.token as string }
}
async function heard(topic: string) {
  const got: { kind: string; payload: unknown }[] = []
  const stop = await subscribe(topic, (e) => {
    if (e.kind === 'agent.working') got.push({ kind: e.kind, payload: e.payload })
  })
  return { got, stop }
}

test('a wake for a direct conversation says "working" in that room only, and the reply takes it away', async () => {
  const { boss, agent, agentToken } = await setup('WorkingDirect')
  const dm = (await send('POST', '/api/conversations/direct', boss.token, { actor_ids: [agent] })).body.id as string
  const inDm = await heard(`conversation:${dm}`)
  try {
    assert.equal((await send('POST', `/api/conversations/${dm}/messages`, boss.token, { body: doc('Review the triage?') })).status, 201)
    // Nothing yet: the wake has not been sent.
    assert.deepEqual((await working(dm, boss.token)).working, [])
    await deliverDue(10, answered, boss.workspaceId)
    await settle()
    const now = (await working(dm, boss.token)).working
    assert.equal(now.length, 1, JSON.stringify(now))
    assert.equal(now[0]!.agent_id, agent)
    assert.equal(now[0]!.name, 'Grok')
    assert.equal(now[0]!.thread_id, null)
    assert.equal(now[0]!.doing, null)
    assert.deepEqual(inDm.got, [{ kind: 'agent.working', payload: { conversation_id: dm, agent_id: agent } }])

    // The agent's answer in the room is the end of it.
    assert.equal((await send('POST', `/api/conversations/${dm}/messages`, agentToken, { body: doc('Done: 3 to close.') })).status, 201)
    assert.deepEqual((await working(dm, boss.token)).working, [])
  } finally {
    inDm.stop()
  }
})

test('a wake that timed out still shows the agent at work; one refused does not', async () => {
  const { boss, agent } = await setup('WorkingSlow')
  const dm = (await send('POST', '/api/conversations/direct', boss.token, { actor_ids: [agent] })).body.id as string
  await send('POST', `/api/conversations/${dm}/messages`, boss.token, { body: doc('hello') })
  await deliverDue(10, async () => ({ status: 500 }), boss.workspaceId)
  assert.deepEqual((await working(dm, boss.token)).working, [])
  await owner`update webhook_delivery set deliver_after = now() where workspace_id = ${boss.workspaceId}`
  await deliverDue(
    10,
    async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    },
    boss.workspaceId,
  )
  assert.equal((await working(dm, boss.token)).working.length, 1)
})

test('a wake in a thread is that thread’s, and the agent’s status gives its words', async () => {
  const { boss, p, agent, agentToken } = await setup('WorkingThread')
  const room = crypto.randomUUID()
  await owner`insert into conversation (id, workspace_id, project_id, name, channel) values (${room}, ${boss.workspaceId}, ${p}, 'general', true)`
  const head = (await send('POST', `/api/conversations/${room}/messages`, boss.token, { body: doc('Triage is long') })).body.id as string
  assert.equal(
    (await send('POST', `/api/conversations/${room}/messages`, boss.token, { body: naming(agent), parent_id: head })).status,
    201,
  )
  await deliverDue(10, answered, boss.workspaceId)
  let now = (await working(room, boss.token)).working
  assert.equal(now.length, 1)
  assert.equal(now[0]!.thread_id, head)

  const said = await send('PUT', '/api/me/status', agentToken, { conversation_id: room, thread_id: head, doing: 'reading the triage' })
  assert.equal(said.status, 200, JSON.stringify(said.body))
  assert.equal((said.body.status as { conversation_id: string }).conversation_id, room)
  now = (await working(room, boss.token)).working
  assert.equal(now[0]!.doing, 'reading the triage')
  assert.equal(now[0]!.thread_id, head)

  // A thread that is not in the room is not found; nor a room it cannot open.
  assert.equal(
    (await send('PUT', '/api/me/status', agentToken, { conversation_id: room, thread_id: crypto.randomUUID(), doing: 'x' })).status,
    404,
  )
  assert.equal((await send('PUT', '/api/me/status', agentToken, { thread_id: head, doing: 'x' })).status, 400)

  // Its answer in the thread clears both the wake and the room on its status.
  await send('POST', `/api/conversations/${room}/messages`, agentToken, { body: doc('Closed three.'), parent_id: head })
  assert.deepEqual((await working(room, boss.token)).working, [])
  const [left] = await owner<{ conversation_id: string | null }[]>`select conversation_id from agent_doing where agent_id = ${agent}`
  assert.equal(left?.conversation_id ?? null, null)
})

test('an agent that came by itself shows from its status, and doing: null takes it away', async () => {
  const { boss, agent, agentToken } = await setup('WorkingStatus')
  const dm = (await send('POST', '/api/conversations/direct', boss.token, { actor_ids: [agent] })).body.id as string
  const inDm = await heard(`conversation:${dm}`)
  try {
    await send('PUT', '/api/me/status', agentToken, { conversation_id: dm, doing: 'looking' })
    await settle()
    assert.equal((await working(dm, boss.token)).working[0]?.doing, 'looking')
    // The heartbeat says nothing again.
    await send('PUT', '/api/me/status', agentToken, { conversation_id: dm, doing: 'looking' })
    await send('PUT', '/api/me/status', agentToken, { doing: null })
    await settle()
    assert.deepEqual((await working(dm, boss.token)).working, [])
    assert.equal(inDm.got.length, 2)
    assert.ok(!JSON.stringify(inDm.got).includes('looking'), 'the words travel nowhere')
  } finally {
    inDm.stop()
  }
})

test('a chosen room’s agent at work is its people’s, never the project’s', async () => {
  const { boss, p, agent, agentToken } = await setup('WorkingChosen')
  const colleague = await addPerson(boss.ctx, boss.workspaceId, 'member', [p])
  const colleagueToken = await bearerFor(colleague.actorId, boss.workspaceId)
  const room = crypto.randomUUID()
  await owner`insert into conversation (id, workspace_id, project_id, name, channel, chosen)
              values (${room}, ${boss.workspaceId}, ${p}, 'layoffs-q3', true, true)`
  for (const m of [boss.ctx.actorId, agent]) {
    await owner`insert into conversation_member (id, workspace_id, conversation_id, actor_id, joined_at)
                values (${crypto.randomUUID()}, ${boss.workspaceId}, ${room}, ${m}, now())`
  }
  const project = await heard(`project:${p}`)
  try {
    await send('POST', `/api/conversations/${room}/messages`, boss.token, { body: naming(agent) })
    await deliverDue(10, answered, boss.workspaceId)
    await send('PUT', '/api/me/status', agentToken, { conversation_id: room, doing: 'counting heads' })
    await settle()
    assert.equal((await working(room, boss.token)).working.length, 1)
    assert.equal((await working(room, colleagueToken)).status, 404)
    assert.deepEqual(project.got, [], 'nothing on the project’s topic')
    // Nor through the workspace's list of statuses.
    const all = await send('GET', '/api/working', colleagueToken)
    assert.ok(!JSON.stringify(all.body).includes('counting heads'), JSON.stringify(all.body))
    const people = await send('GET', '/api/people', colleagueToken)
    assert.ok(!JSON.stringify(people.body).includes('counting heads'))
  } finally {
    project.stop()
  }
})
