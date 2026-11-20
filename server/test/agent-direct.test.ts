import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { closeDb, makeOwner, makeProject } from './helpers.js'

/*
 * A message to an agent in a direct conversation reaches it,
 * "Hi" in a DM with an agent was a
 * `messaged` note: left out of the inbox and of `my_mentions`, and never a
 * webhook — nor was "@Agent" there, since a DM has no project.
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
const naming = (id: string) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'mention', attrs: { id, label: 'x' } },
        { type: 'text', text: ' go' },
      ],
    },
  ],
})
const deliveries = (agent: string) =>
  owner<{ event: string; chain: number; object_id: string }[]>`
    select d.event, (d.payload->>'chain')::int as chain, d.payload->>'object_id' as object_id
    from webhook_delivery d join webhook w on w.id = d.webhook_id
    where w.agent_id = ${agent} order by d.created_at`.then((rows) => rows.map((r) => ({ ...r })))
type Note = { reason: string; object_type: string; object_id: string; said: string | null; said_by: string | null }
const unread = async (token: string) => ((await send('GET', '/api/inbox?unread=1&limit=100', token)).body.notifications as Note[]) ?? []

async function setup(name: string) {
  const boss = await makeOwner()
  const p = await makeProject(boss.ctx, boss.workspaceId, name)
  const a = await send('POST', '/api/agents', boss.token, { name: 'A', project_ids: [p], reach: 'webhook', url: HOOK })
  const b = await send('POST', '/api/agents', boss.token, { name: 'B', project_ids: [p], reach: 'webhook', url: HOOK })
  assert.equal(a.status, 201, JSON.stringify(a.body))
  return { boss, p, aId: a.body.agent_id as string, bId: b.body.agent_id as string, aT: a.body.token as string, bT: b.body.token as string }
}
async function room(ws: string, members: string[], project: string | null = null, channel = false) {
  const id = crypto.randomUUID()
  await owner`insert into conversation (id, workspace_id, project_id, name, channel) values (${id}, ${ws}, ${project}, null, ${channel})`
  for (const m of members) {
    await owner`insert into conversation_member (id, workspace_id, conversation_id, actor_id, joined_at)
                values (${crypto.randomUUID()}, ${ws}, ${id}, ${m}, now())`
  }
  return id
}

test('a plain message to an agent in a direct conversation is in its inbox and on its webhook', async () => {
  const { boss, aId, aT } = await setup('DirectPlain')
  const dm = await send('POST', '/api/conversations/direct', boss.token, { actor_ids: [aId] })
  assert.equal(dm.status, 201, JSON.stringify(dm.body))
  const c = dm.body.id as string
  assert.equal((await send('POST', `/api/conversations/${c}/messages`, boss.token, { body: doc('Hi, are you there?') })).status, 201)

  const notes = (await unread(aT)).filter((n) => n.object_id === c)
  assert.equal(notes.length, 1, JSON.stringify(notes))
  assert.equal(notes[0]!.reason, 'mentioned')
  assert.equal(notes[0]!.said, 'Hi, are you there?')
  assert.deepEqual(await deliveries(aId), [{ event: 'agent.mentioned', chain: 0, object_id: c }])
})

test('an @mention of an agent in a direct conversation reaches its webhook', async () => {
  const { boss, aId, aT } = await setup('DirectNamed')
  const c = (await send('POST', '/api/conversations/direct', boss.token, { actor_ids: [aId] })).body.id as string
  assert.equal((await send('POST', `/api/conversations/${c}/messages`, boss.token, { body: naming(aId) })).status, 201)
  assert.equal((await unread(aT)).filter((n) => n.object_id === c && n.reason === 'mentioned').length, 1)
  assert.deepEqual(await deliveries(aId), [{ event: 'agent.mentioned', chain: 0, object_id: c }])
})

test('an agent writing to another agent in a direct conversation is a hand-off, counted', async () => {
  const { boss, aId, bId, aT, bT } = await setup('DirectAgents')
  const c = await room(boss.workspaceId, [aId, bId])
  for (let i = 0; i < 4; i++) {
    const tok = i % 2 === 0 ? aT : bT
    assert.equal((await send('POST', `/api/conversations/${c}/messages`, tok, { body: doc(`hop ${i}`) })).status, 201)
  }
  // B was woken at one hop, A at two; the third hop and on were stopped.
  assert.deepEqual(await deliveries(bId), [{ event: 'agent.mentioned', chain: 1, object_id: c }])
  const toA = await deliveries(aId)
  assert.ok(toA.length >= 1 && toA.every((d) => d.chain === 2), JSON.stringify(toA))
  // A person writing to the agent starts it again.
  const mine = await send('POST', '/api/conversations/direct', boss.token, { actor_ids: [bId] })
  await send('POST', `/api/conversations/${mine.body.id}/messages`, boss.token, { body: doc('your turn') })
  assert.equal((await deliveries(bId)).at(-1)!.chain, 0)
})

test('in a conversation of three, an agent hears only its name', async () => {
  const { boss, aId, bId, aT } = await setup('DirectGroup')
  const group = await room(boss.workspaceId, [boss.ctx.actorId, aId, bId])
  assert.equal((await send('POST', `/api/conversations/${group}/messages`, boss.token, { body: doc('chatting') })).status, 201)
  assert.deepEqual(await deliveries(aId), [])
  assert.equal((await unread(aT)).filter((n) => n.object_id === group).length, 0)
  assert.equal((await send('POST', `/api/conversations/${group}/messages`, boss.token, { body: naming(aId) })).status, 201)
  assert.deepEqual(await deliveries(aId), [{ event: 'agent.mentioned', chain: 0, object_id: group }])
  assert.deepEqual(await deliveries(bId), [])
})

test('an @mention of an agent in a project channel still reaches it', async () => {
  const { boss, p, aId, aT } = await setup('ChannelNamed')
  const c = await room(boss.workspaceId, [], p, true)
  assert.equal((await send('POST', `/api/conversations/${c}/messages`, boss.token, { body: naming(aId) })).status, 201)
  assert.equal((await send('POST', `/api/conversations/${c}/messages`, boss.token, { body: doc('no name') })).status, 201)
  assert.equal((await unread(aT)).filter((n) => n.object_id === c && n.reason === 'mentioned').length, 1)
  assert.deepEqual(await deliveries(aId), [{ event: 'agent.mentioned', chain: 0, object_id: c }])
})

/* The author's rule, 18 November 2026: in a direct conversation with an
   agent every message wakes it, a reply in a thread there too; in a room
   shared with others it takes its name. */
test('a reply in a thread of a direct conversation wakes the agent; one in a channel thread without its name does not', async () => {
  const { boss, p, aId } = await setup('DirectThread')
  const dm = await send('POST', '/api/conversations/direct', boss.token, { actor_ids: [aId] })
  const c = dm.body.id as string
  const head = await send('POST', `/api/conversations/${c}/messages`, boss.token, { body: doc('Start') })
  assert.equal(head.status, 201, JSON.stringify(head.body))
  const before = (await deliveries(aId)).length
  const reply = await send('POST', `/api/conversations/${c}/messages`, boss.token, {
    body: doc('And this, in the thread'),
    parent_id: head.body.id,
  })
  assert.equal(reply.status, 201, JSON.stringify(reply.body))
  assert.equal((await deliveries(aId)).length, before + 1, 'the thread reply in the DM woke it')

  const channel = await room(boss.workspaceId, [boss.ctx.actorId, aId], p, true)
  const top = await send('POST', `/api/conversations/${channel}/messages`, boss.token, { body: doc('A topic') })
  assert.equal(top.status, 201, JSON.stringify(top.body))
  const was = (await deliveries(aId)).length
  await send('POST', `/api/conversations/${channel}/messages`, boss.token, { body: doc('no name here'), parent_id: top.body.id })
  assert.equal((await deliveries(aId)).length, was, 'a channel thread without its name wakes nobody')
})
