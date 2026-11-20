import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { addPerson, bearerFor, closeDb, makeOwner, makeProject, uuidv7, withActor } from './helpers.js'

/*
 * The hop chain, attacked — from the independent review of.
 * Each of these was a loop that ran for ever under migration 255, when the
 * count was kept per thing and a person's activity on it started it again.
 * Each now asserts that it stops.
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
  owner<{ event: string; chain: number }[]>`
    select d.event, (d.payload->>'chain')::int as chain
    from webhook_delivery d join webhook w on w.id = d.webhook_id
    where w.agent_id = ${agent} order by d.created_at`.then((rows) => rows.map((r) => ({ event: r.event, chain: r.chain })))
const chainQuestions = (ws: string) =>
  owner<{ n: number }[]>`select count(*)::int as n from comment where workspace_id = ${ws} and stops_chain`.then((r) => r[0]!.n)

async function pair(name: string) {
  const boss = await makeOwner()
  const p = await makeProject(boss.ctx, boss.workspaceId, name)
  const a = await send('POST', '/api/agents', boss.token, { name: 'A', project_ids: [p], reach: 'webhook', url: HOOK })
  const b = await send('POST', '/api/agents', boss.token, { name: 'B', project_ids: [p], reach: 'webhook', url: HOOK })
  return { boss, p, aId: a.body.agent_id as string, bId: b.body.agent_id as string, aT: a.body.token as string, bT: b.body.token as string }
}

test('two agents waking each other on two different tasks stop at the third hop', async () => {
  const { boss, p, aId, bId, aT, bT } = await pair('Loop2')
  const x = (await send('POST', `/api/projects/${p}/tasks`, boss.token, { title: 'X' })).body.id as string
  const y = (await send('POST', `/api/projects/${p}/tasks`, boss.token, { title: 'Y' })).body.id as string
  for (let i = 0; i < 5; i++) {
    // A wakes B only on Y; B wakes A only on X.
    assert.equal((await send('POST', `/api/tasks/${y}/comments`, aT, { body: naming(bId) })).status, 201)
    assert.equal((await send('POST', `/api/tasks/${x}/comments`, bT, { body: naming(aId) })).status, 201)
    // Each agent reads what it was woken by, as mark_read does: reading starts nothing again.
    await owner`update notification set read_at = now() where actor_id in (${aId}, ${bId}) and read_at is null`
  }
  // B was woken once; A's third hop and every one after were stopped, so B is never woken again.
  assert.deepEqual(await deliveries(bId), [{ event: 'agent.mentioned', chain: 1 }])
  const toA = await deliveries(aId)
  assert.ok(
    toA.every((d) => d.chain === 2),
    JSON.stringify(toA),
  )
  // And the people were asked, once.
  assert.equal(await chainQuestions(boss.workspaceId), 1)
})

test('agents handing off by making a fresh task for each other stop at the third hop', async () => {
  const { boss, p, aId, bId, aT, bT } = await pair('LoopNew')
  let tok = aT
  let other = bId
  for (let i = 0; i < 6; i++) {
    const r = await send('POST', `/api/projects/${p}/tasks`, tok, { title: `hop ${i}`, assignee_ids: [other] })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    ;[tok, other] = tok === aT ? [bT, aId] : [aT, bId]
  }
  assert.deepEqual(await deliveries(bId), [{ event: 'agent.assigned', chain: 1 }])
  assert.ok((await deliveries(aId)).every((d) => d.chain === 2))
  // One question, not one per new task: the chain's own question from A is still open.
  assert.equal(await chainQuestions(boss.workspaceId), 1)
})

test('a room hook posting between hand-offs does not start the chain again', async () => {
  const { boss, p, aId, bId, aT, bT } = await pair('HookReset')
  const room = crypto.randomUUID()
  await owner`insert into conversation (id, workspace_id, project_id, name, channel) values (${room}, ${boss.workspaceId}, ${p}, 'deploys', true)`
  const hook = await send('POST', `/api/conversations/${room}/hooks`, boss.token, { name: 'CI' })
  assert.equal(hook.status, 201, JSON.stringify(hook.body))
  const hookPath = new URL(hook.body.url as string).pathname
  for (let i = 0; i < 4; i++) {
    const [tok, other] = i % 2 === 0 ? [aT, bId] : [bT, aId]
    // Before each hand-off, the agent's CI step posts through the hook — written as the hook's maker.
    const h = await app.request(hookPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'build ok' }),
    })
    assert.equal(h.status, 200)
    await new Promise((r) => setTimeout(r, 5))
    const m = await send('POST', `/api/conversations/${room}/messages`, tok, { body: naming(other) })
    assert.equal(m.status, 201, JSON.stringify(m.body))
  }
  assert.deepEqual(await deliveries(bId), [{ event: 'agent.mentioned', chain: 1 }])
  assert.ok((await deliveries(aId)).every((d) => d.chain === 2))
  // Off a task, the people who connected the agents are told instead.
  const [told] = await owner<{ n: number }[]>`
    select count(*)::int as n from notification where actor_id = ${boss.ctx.actorId} and kind = 'handoff'`
  assert.ok(told!.n >= 1)
})

test('past sixty agent-to-agent hand-offs an hour, none is sent, and the connector is told once', async () => {
  const { boss, p, bId, aT } = await pair('Backstop')
  // Sixty hand-offs already this hour, between agents of this workspace.
  await owner.begin(async (tx) => {
    /* The count as an agent's hand-off would set it — the trigger writes it. */
    await tx`select set_config('app.agent_chain', '1', true)`
    for (let i = 0; i < 60; i++) {
      await tx`
        insert into notification (id, workspace_id, actor_id, reason, object_type, object_id)
        values (${uuidv7()}, ${boss.workspaceId}, ${bId}, 'mentioned', 'project', ${p})`
    }
  })
  const t1 = await send('POST', `/api/projects/${p}/tasks`, aT, { title: 'One more', assignee_ids: [bId] })
  assert.equal(t1.status, 201, JSON.stringify(t1.body))
  const t2 = await send('POST', `/api/projects/${p}/tasks`, aT, { title: 'And another', assignee_ids: [bId] })
  assert.equal(t2.status, 201)
  assert.equal((await deliveries(bId)).length, 0)
  const [told] = await owner<{ n: number }[]>`
    select count(*)::int as n from notification where actor_id = ${boss.ctx.actorId} and kind = 'handoff_cap'`
  assert.equal(told!.n, 1)
})

test('an answer is a person’s own press: not through a comment edit, never as an agent', async () => {
  const { boss, p, aId, aT } = await pair('Answerers')
  const ada = await addPerson(boss.ctx, boss.workspaceId, 'member', [p])
  const bo = await addPerson(boss.ctx, boss.workspaceId, 'member', [p])
  const t = (await send('POST', `/api/projects/${p}/tasks`, boss.token, { title: 'Q', assignee_ids: [ada.actorId] })).body.id as string
  const q = await send('POST', `/api/tasks/${t}/comments`, aT, { body: naming(ada.actorId), choices: [{ label: 'a' }, { label: 'b' }] })
  assert.equal(q.status, 201, JSON.stringify(q.body))
  const qId = q.body.id as string
  // A PATCH on the comment with answer fields changes its words and nothing else.
  await send('PATCH', `/api/comments/${qId}`, aT, { body: naming(ada.actorId), answer: 0, choices: [{ label: 'z' }, { label: 'y' }] })
  const [row] = await owner<
    { answer: number | null; choices: { label: string }[] }[]
  >`select answer, choices from comment where id = ${qId}`
  assert.equal(row!.answer, null)
  assert.deepEqual(
    row!.choices.map((c) => c.label),
    ['a', 'b'],
  )
  // The function refuses an agent, whatever the endpoint said.
  const [asAgent] = await withActor(aId, (tx) => tx<{ said: string }[]>`select answer_question(${qId}, 0) as said`)
  assert.equal(asAgent!.said, 'missing')
  // And nobody writes an answer in somebody else's name.
  await assert.rejects(
    owner.begin(async (tx) => {
      /* Past every row policy, as the tables' owner, so only the trigger can refuse it. */
      await tx`select set_config('app.actor_id', ${boss.ctx.actorId}, true)`
      await tx`update comment set answer = 0, answered_by = ${ada.actorId}, answered_at = now() where id = ${qId}`
    }),
  )
  // A member who was not asked may answer — anybody who can see the task.
  const boT = await bearerFor(bo.actorId, boss.workspaceId)
  const r = await send('PUT', `/api/comments/${qId}/answer`, boT, { choice: 0 })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.answered_by, bo.actorId)
})

/* From the second review: a room, with two agents and a person in it. */
const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
async function inARoom(name: string) {
  const all = await pair(name)
  const room = crypto.randomUUID()
  await owner`insert into conversation (id, workspace_id, project_id, name, channel) values (${room}, ${all.boss.workspaceId}, ${all.p}, 'team', true)`
  return { ...all, room }
}

test('a person’s reply kept fresh by merging does not start an agent’s chain again', async () => {
  const { boss, room, aId, bId, aT, bT } = await inARoom('MergeReset')
  const say = (tok: string, body: unknown, parent?: string) =>
    send('POST', `/api/conversations/${room}/messages`, tok, { body, ...(parent ? { parent_id: parent } : {}) })
  const root = (await say(aT, doc('thread'))).body.id as string
  await say(boss.token, doc('person reply 1'), root)
  await say(bT, doc('b joins'), root)
  await say(boss.token, doc('person reply 2'), root)
  for (let i = 0; i < 6; i++) {
    const [tok, other] = i % 2 === 0 ? [aT, bId] : [bT, aId]
    assert.equal((await say(tok, naming(other), root)).status, 201)
    // A plain reply right after, which used to merge into the other's chain-0 note.
    assert.equal((await say(tok, doc('and also'), root)).status, 201)
  }
  const toA = await deliveries(aId)
  const toB = await deliveries(bId)
  // The loop is broken: one of the two is never woken, and nothing woke anybody at a fresh count.
  assert.equal(Math.min(toA.length, toB.length), 0, JSON.stringify({ toA, toB }))
  assert.ok(
    [...toA, ...toB].every((d) => d.chain >= 2),
    JSON.stringify({ toA, toB }),
  )
  // Notes to agents are never merged.
  const [merged] = await owner<{ n: number }[]>`
    select count(*)::int as n from notification
    where object_id = ${room} and actor_id in (${aId}, ${bId}) and updated_at > created_at`
  assert.equal(merged!.n, 0)
})

test('an agent stopped in a room tells its connector once, not on every message', async () => {
  const { boss, room, aId, bId, aT, bT } = await inARoom('Spam')
  const say = (tok: string, body: unknown) => send('POST', `/api/conversations/${room}/messages`, tok, { body })
  await say(boss.token, naming(aId))
  await say(aT, naming(bId))
  await say(bT, naming(aId))
  for (let i = 0; i < 8; i++) await say(aT, naming(bId))
  const [n] = await owner<{ n: number }[]>`
    select count(*)::int as n from notification where actor_id = ${boss.ctx.actorId} and kind = 'handoff'`
  assert.equal(n!.n, 1)
})

test('a person’s own token handing work to agents is counted by the backstop; replies are not', async () => {
  const { boss, p, bId } = await pair('TokenLoop')
  const personal = (await send('POST', '/api/tokens', boss.token, { name: 'Script' })).body.token as string
  // Sixty thread replies to agents this hour: they wake nothing and spend nothing.
  await owner.begin(async (tx) => {
    await tx`select set_config('app.agent_chain', '1', true)`
    for (let i = 0; i < 60; i++) {
      await tx`
        insert into notification (id, workspace_id, actor_id, reason, object_type, object_id)
        values (${uuidv7()}, ${boss.workspaceId}, ${bId}, 'replied', 'project', ${p})`
    }
  })
  const first = await send('POST', `/api/projects/${p}/tasks`, personal, { title: 'From a script', assignee_ids: [bId] })
  assert.equal(first.status, 201, JSON.stringify(first.body))
  assert.deepEqual(await deliveries(bId), [{ event: 'agent.assigned', chain: 0 }])
  const [counted] = await owner<{ n: number }[]>`
    select count(*)::int as n from notification where actor_id = ${bId} and handed_by_token`
  assert.equal(counted!.n, 1)
  // Sixty from the token this hour: the next is not sent, and the connector is told.
  await owner.begin(async (tx) => {
    await tx`select set_config('app.agent_chain', '0t', true)`
    for (let i = 0; i < 59; i++) {
      await tx`
        insert into notification (id, workspace_id, actor_id, reason, object_type, object_id)
        values (${uuidv7()}, ${boss.workspaceId}, ${bId}, 'assigned', 'project', ${p})`
    }
  })
  await send('POST', `/api/projects/${p}/tasks`, personal, { title: 'One too many', assignee_ids: [bId] })
  assert.equal((await deliveries(bId)).length, 1)
  const [told] = await owner<{ n: number }[]>`
    select count(*)::int as n from notification where actor_id = ${boss.ctx.actorId} and kind = 'handoff_cap'`
  assert.equal(told!.n, 1)
})

/* From the third review. */
test('a third agent replying at one hop does not lower the count of two agents handing work round', async () => {
  const { boss, room, aId, bId, aT, bT, p } = await inARoom('Lower')
  const c = await send('POST', '/api/agents', boss.token, { name: 'C', project_ids: [p], reach: 'mcp' })
  const cT = c.body.token as string
  const say = (tok: string, body: unknown, parent?: string) =>
    send('POST', `/api/conversations/${room}/messages`, tok, { body, ...(parent ? { parent_id: parent } : {}) })
  const root = (await say(aT, doc('t'))).body.id as string
  await say(bT, doc('b'), root)
  const x = (await send('POST', `/api/projects/${p}/tasks`, boss.token, { title: 'X' })).body.id as string
  const y = (await send('POST', `/api/projects/${p}/tasks`, boss.token, { title: 'Y' })).body.id as string
  for (let i = 0; i < 6; i++) {
    // C's scheduled run says something in the thread, at one hop, every time.
    assert.equal((await say(cT, doc(`tick ${i}`), root)).status, 201)
    const [tok, other, task] = i % 2 === 0 ? [aT, bId, y] : [bT, aId, x]
    assert.equal((await send('POST', `/api/tasks/${task}/comments`, tok, { body: naming(other) })).status, 201)
    await owner`update notification set read_at = now() where actor_id in (${aId}, ${bId}) and read_at is null`
  }
  const toA = await deliveries(aId)
  const toB = await deliveries(bId)
  assert.equal(Math.min(toA.length, toB.length), 0, JSON.stringify({ toA, toB }))
  assert.ok([...toA, ...toB].every((d) => d.chain >= 2))
})

test('what nobody did — a note with no count — wakes no agent', async () => {
  const { boss, p, aId } = await pair('Nobody')
  await owner.begin(async (tx) => {
    await tx`select set_config('app.agent_chain', 'none', true)`
    await tx`
      insert into notification (id, workspace_id, actor_id, reason, object_type, object_id)
      values (${uuidv7()}, ${boss.workspaceId}, ${aId}, 'mentioned', 'project', ${p})`
  })
  assert.equal((await deliveries(aId)).length, 0)
})

test('hand-off alarms are five an hour a person, across things', async () => {
  const { boss, p, room, aId, bId, aT, bT } = await inARoom('Alarms')
  const say = (where: string, tok: string, body: unknown) => send('POST', `/api/conversations/${where}/messages`, tok, { body })
  await say(room, boss.token, naming(aId))
  await say(room, aT, naming(bId))
  await say(room, bT, naming(aId))
  // A, stopped now, names B in seven rooms: seven things, each told once — but five a person.
  for (let i = 0; i < 7; i++) {
    const other = crypto.randomUUID()
    await owner`insert into conversation (id, workspace_id, project_id, name, channel) values (${other}, ${boss.workspaceId}, ${p}, ${`r${i}`}, true)`
    assert.equal((await say(other, aT, naming(bId))).status, 201)
  }
  const [n] = await owner<{ n: number }[]>`
    select count(*)::int as n from notification where actor_id = ${boss.ctx.actorId} and kind in ('handoff', 'handoff_cap')`
  assert.equal(n!.n, 5)
})
