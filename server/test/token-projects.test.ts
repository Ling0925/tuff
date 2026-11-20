import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import { issueApiToken } from '../src/auth/flows.js'
import { authenticate } from '../src/auth/context.js'
import { mayListen, mayWatch, tokenHears } from '../src/listening.js'
import { addPerson, bearerFor, closeDb, makeOwner, uuidv7, withActor } from './helpers.js'

after(async () => {
  await closeDb()
})

/*
 * A token made for some projects reaches those and nothing else,
 * migration 191. Its list was stored and read by
 * nothing: a token "for project A" read and wrote in B as well.
 */
type J = Record<string, unknown>
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

function client(token: string) {
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: r.status, body: (await r.json().catch(() => ({}))) as J }
  }
  return {
    get: (p: string) => call('GET', p),
    post: (p: string, b: unknown = {}) => call('POST', p, b),
    patch: (p: string, b: unknown) => call('PATCH', p, b),
    put: (p: string, b: unknown = {}) => call('PUT', p, b),
  }
}

let n = 0
const mcp = async (token: string, name: string, args: J) => {
  const r = await app.request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name, arguments: args } }),
  })
  const out = (await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }
  return { text: out.result.content[0]!.text, error: out.result.isError === true }
}

/** A workspace with two projects, A and B, each with a task, an
    announcement, a doc, a file, a message and a comment that share a word. */
async function world() {
  const owner = await makeOwner()
  const me = client(owner.token)
  const word = `quartz${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const one = async (name: string) => {
    const project = (await me.post('/api/projects', { name: `${name} ${word}` })).body.id as string
    const task = (await me.post(`/api/projects/${project}/tasks`, { title: `${name} task ${word}`, assignee_id: owner.ctx.actorId })).body
      .id as string
    const post = (await me.post(`/api/projects/${project}/posts`, { title: `${name} post ${word}`, body: doc(word) })).body.id as string
    const docId = (await me.post(`/api/projects/${project}/files`, { name: `${name} doc ${word}`, body: doc(word) })).body.id as string
    const rooms = (await me.get('/api/conversations')).body as unknown as { conversations?: { id: string; project_id: string | null }[] }
    const list = rooms.conversations ?? (rooms as unknown as { id: string; project_id: string | null }[])
    const room = list.find((r) => r.project_id === project)!.id
    const message = (await me.post(`/api/conversations/${room}/messages`, { body: doc(`${name} said ${word}`) })).body.id as string
    const comment = (await me.post(`/api/tasks/${task}/comments`, { body: doc(`${name} comment ${word}`) })).body.id as string
    return { project, task, post, doc: docId, room, message, comment }
  }
  const a = await one('Alpha')
  const b = await one('Bravo')
  const limited = await issueApiToken(owner.ctx.actorId, owner.workspaceId, 'For A', [a.project], 30)
  const wide = await issueApiToken(owner.ctx.actorId, owner.workspaceId, 'Everything', [], 30)
  return { owner, me, word, a, b, limited, wide }
}

test('a token for project A reads nothing of project B', async () => {
  const w = await world()
  const t = client(w.limited)

  // A is there, all of it.
  assert.equal((await t.get(`/api/tasks/${w.a.task}`)).status, 200)
  assert.equal((await t.get(`/api/posts/${w.a.post}`)).status, 200)
  assert.equal((await t.get(`/api/files/${w.a.doc}`)).status, 200)
  assert.equal((await t.get(`/api/conversations/${w.a.room}/messages`)).status, 200)
  assert.equal((await t.get(`/api/projects/${w.a.project}`)).status, 200)

  // B is not: as not there, never as forbidden.
  assert.equal((await t.get(`/api/projects/${w.b.project}`)).status, 404)
  assert.equal((await t.get(`/api/tasks/${w.b.task}`)).status, 404)
  assert.equal((await t.get(`/api/posts/${w.b.post}`)).status, 404)
  assert.equal((await t.get(`/api/files/${w.b.doc}`)).status, 404)
  assert.equal(
    (await t.get(`/api/projects/${w.b.project}/tasks`)).status === 200
      ? (((await t.get(`/api/projects/${w.b.project}/tasks`)).body.tasks as unknown[] | undefined)?.length ?? 0)
      : 0,
    0,
  )
  // A room nobody may read answers with nothing in it, for anybody.
  const msgs = await t.get(`/api/conversations/${w.b.room}/messages`)
  assert.deepEqual(msgs.body.messages ?? [], [])
  assert.ok(!JSON.stringify((await t.get(`/api/conversations/${w.b.room}/messages?q=${w.word}`)).body).includes('Bravo said'))

  // Lists name only A.
  const projects = JSON.stringify((await t.get('/api/projects')).body)
  assert.ok(projects.includes(w.a.project) && !projects.includes(w.b.project), projects)
  const rooms = JSON.stringify((await t.get('/api/conversations')).body)
  assert.ok(rooms.includes(w.a.room) && !rooms.includes(w.b.room))
  const mine = JSON.stringify((await t.get('/api/my/tasks')).body)
  assert.ok(mine.includes(w.a.task) && !mine.includes(w.b.task), mine)

  // Search, by the word both share.
  const found = JSON.stringify((await t.get(`/api/search?q=${w.word}`)).body)
  assert.ok(found.includes('Alpha'), found)
  assert.ok(!found.includes('Bravo'), found)

  // The feed: the project's, and the workspace's.
  assert.equal(
    (await t.get(`/api/projects/${w.b.project}/activity`)).status === 200
      ? JSON.stringify((await t.get(`/api/projects/${w.b.project}/activity`)).body).includes(w.b.task)
      : false,
    false,
  )
  const feed = JSON.stringify((await t.get('/api/activity')).body)
  assert.ok(!feed.includes(w.b.project) && !feed.includes(w.b.task), feed)

  // A person reached by the wide token sees both, as before.
  const all = client(w.wide)
  assert.equal((await all.get(`/api/tasks/${w.b.task}`)).status, 200)
  const both = JSON.stringify((await all.get(`/api/search?q=${w.word}`)).body)
  assert.ok(both.includes('Alpha') && both.includes('Bravo'))
  // And the session.
  assert.equal((await w.me.get(`/api/tasks/${w.b.task}`)).status, 200)
})

test('a token for project A writes nothing in project B', async () => {
  const w = await world()
  const t = client(w.limited)

  assert.equal((await t.post(`/api/projects/${w.a.project}/tasks`, { title: 'In A' })).status, 201)
  assert.equal((await t.patch(`/api/tasks/${w.a.task}`, { title: 'Alpha renamed' })).status, 200)

  /* Refused as for somebody who is not on B — 403 where the right is
     asked first, 404 where the row is. */
  const no = (r: { status: number }) => assert.ok([403, 404].includes(r.status), String(r.status))
  no(await t.post(`/api/projects/${w.b.project}/tasks`, { title: 'Into B' }))
  no(await t.patch(`/api/tasks/${w.b.task}`, { title: 'B renamed' }))
  no(await t.post(`/api/tasks/${w.b.task}/comments`, { body: doc('no') }))
  no(await t.post(`/api/projects/${w.b.project}/posts`, { title: 'No', body: doc('no') }))
  no(await t.patch(`/api/posts/${w.b.post}`, { title: 'No' }))
  no(await t.post(`/api/projects/${w.b.project}/files`, { name: 'No', body: doc('no') }))
  no(await t.patch(`/api/files/${w.b.doc}`, { name: 'No' }))
  no(await t.post(`/api/conversations/${w.b.room}/messages`, { body: doc('no') }))
  assert.notEqual((await t.patch(`/api/comments/${w.b.comment}`, { body: doc('no') })).status, 200)
  assert.notEqual((await t.patch(`/api/messages/${w.b.message}`, { body: doc('no') })).status, 200)

  // Nothing about the workspace as a whole: a project it could not see,
  // a channel or a conversation outside every project.
  assert.equal((await t.post('/api/projects', { name: 'Elsewhere' })).status, 403)
  assert.equal((await t.post('/api/conversations/channels', { name: 'loose' })).status, 403)
  assert.equal((await t.post('/api/conversations/direct', { actor_ids: [w.owner.ctx.actorId] })).status, 403)

  // B is as it was.
  const b = await w.me.get(`/api/tasks/${w.b.task}`)
  assert.ok(JSON.stringify(b.body).includes('Bravo task'), 'B’s task kept its title')
})

test('the inbox and the bell keep to the token’s projects', async () => {
  const w = await world()
  // Notes to the owner about both projects — a mention in each.
  const other = await import('./helpers.js')
  const helper = await other.addPerson(w.owner.ctx, w.owner.workspaceId, 'member', [w.a.project, w.b.project])
  const them = client(await other.bearerFor(helper.actorId, w.owner.workspaceId))
  const mention = (text: string) => ({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'mention', attrs: { id: w.owner.ctx.actorId, label: 'Owner' } },
          { type: 'text', text: ` ${text}` },
        ],
      },
    ],
  })
  await them.post(`/api/tasks/${w.a.task}/comments`, { body: mention('look at A') })
  await them.post(`/api/tasks/${w.b.task}/comments`, { body: mention('look at B') })

  const everything = JSON.stringify((await w.me.get('/api/inbox')).body)
  assert.ok(everything.includes(w.b.task), 'the person’s own inbox has B')

  const t = client(w.limited)
  const inbox = JSON.stringify((await t.get('/api/inbox')).body)
  assert.ok(inbox.includes(w.a.task), inbox)
  assert.ok(!inbox.includes(w.b.task), inbox)

  const mentions = await mcp(w.limited, 'my_mentions', {})
  assert.ok(!mentions.text.includes('look at B'), mentions.text)
})

test('the MCP tools keep to the token’s projects', async () => {
  const w = await world()
  const mine = await mcp(w.limited, 'my_tasks', {})
  assert.ok(mine.text.includes('Alpha task') && !mine.text.includes('Bravo task'), mine.text)

  const found = await mcp(w.limited, 'search', { q: w.word })
  assert.ok(found.text.includes('Alpha') && !found.text.includes('Bravo'), found.text)

  const projects = await mcp(w.limited, 'list_projects', {})
  assert.ok(projects.text.includes('Alpha') && !projects.text.includes('Bravo'), projects.text)

  assert.equal((await mcp(w.limited, 'read_task', { task: w.b.task })).error, true)
  assert.equal((await mcp(w.limited, 'read_post', { post_id: w.b.post })).error, true)
  assert.equal((await mcp(w.limited, 'read_doc', { doc_id: w.b.doc })).error, true)
  const room = await mcp(w.limited, 'read_messages', { conversation_id: w.b.room })
  assert.ok(room.error || !room.text.includes('Bravo said'), room.text)
  assert.equal((await mcp(w.limited, 'read_project', { project_id: w.b.project })).error, true)
  const feed = await mcp(w.limited, 'read_activity', { project_id: w.b.project })
  assert.ok(feed.error || !feed.text.includes('Bravo'), feed.text)

  assert.equal((await mcp(w.limited, 'create_task', { project_id: w.b.project, title: 'Into B' })).error, true)
  assert.equal((await mcp(w.limited, 'update_task', { task_id: w.b.task, title: 'B renamed' })).error, true)
  assert.equal((await mcp(w.limited, 'comment', { object_type: 'task', object_id: w.b.task, body: 'no' })).error, true)
  assert.equal((await mcp(w.limited, 'send_message', { conversation_id: w.b.room, body: 'no' })).error, true)

  assert.equal((await mcp(w.limited, 'read_task', { task: w.a.task })).error, false)
  assert.equal((await mcp(w.limited, 'comment', { object_type: 'task', object_id: w.a.task, body: 'yes' })).error, false)
})

test('a token is made for some projects only from projects its person can open', async () => {
  const w = await world()
  const made = await w.me.post('/api/tokens', { name: 'For B', project_ids: [w.b.project] })
  assert.equal(made.status, 201)
  const t = client(made.body.token as string)
  assert.equal((await t.get(`/api/tasks/${w.b.task}`)).status, 200)
  assert.equal((await t.get(`/api/tasks/${w.a.task}`)).status, 404)

  // Somebody else's project, or one that is not there: not found.
  const elsewhere = await makeOwner()
  const theirs = (await client(elsewhere.token).post('/api/projects', { name: 'Theirs' })).body.id as string
  assert.equal((await w.me.post('/api/tokens', { name: 'No', project_ids: [theirs] })).status, 404)

  // A limited token says so in what it may do.
  const me = (await t.get('/api/me')).body as { actions?: string[] }
  assert.ok(!(me.actions ?? []).includes('project.create'))
})

test('uploads, labels, sprints, time and webhooks keep to the token’s projects', async () => {
  const w = await world()
  const t = client(w.limited)
  const upload = (token: string, project: string) => {
    const form = new FormData()
    form.append('file', new File([new Uint8Array([1, 2, 3, 4])], 'notes.bin', { type: 'application/octet-stream' }))
    return app.request(`/api/projects/${project}/uploads`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form })
  }
  // The person's upload to B: not the token's to read or link to.
  const inB = (await (await upload(w.owner.token, w.b.project)).json()) as J
  assert.ok(inB.id, JSON.stringify(inB))
  assert.equal((await t.get(`/api/files/${inB.id as string}`)).status, 404)
  assert.equal((await t.get(`/api/files/${inB.id as string}/url`)).status, 404)
  // Nor its to upload into B; A is fine.
  assert.equal((await upload(w.limited, w.b.project)).status, 404)
  assert.equal((await upload(w.limited, w.a.project)).status, 201)
  const docs = JSON.stringify((await t.get(`/api/projects/${w.b.project}/files`)).body)
  assert.ok(!docs.includes(w.b.doc) && !docs.includes(inB.id as string), docs)

  // Labels and sprints.
  assert.equal((await w.me.post(`/api/projects/${w.b.project}/labels`, { name: 'Bravo label' })).status, 201)
  assert.ok(!JSON.stringify((await t.get('/api/labels')).body).includes('Bravo label'))
  assert.ok([403, 404].includes((await t.post(`/api/projects/${w.b.project}/labels`, { name: 'No' })).status))
  assert.ok(
    [403, 404].includes(
      (await t.post(`/api/projects/${w.b.project}/cycles`, { name: 'No', starts_on: '2026-11-01', ends_on: '2026-11-14' })).status,
    ),
  )
  const cycles = await t.get(`/api/projects/${w.b.project}/cycles`)
  assert.ok(cycles.status === 404 || ((cycles.body.cycles as unknown[] | undefined) ?? []).length === 0)

  // Time logged on B, by the token: refused.
  const spent = await t.post('/api/time', { project_id: w.b.project, minutes: 30, spent_on: '2026-11-10' })
  assert.ok([403, 404].includes(spent.status), String(spent.status))

  // A webhook hears the whole workspace: never made through a token.
  assert.equal((await t.post('/api/webhooks', { url: 'https://example.com/hook', events: ['task.created'] })).status, 403)
})

test('an agent’s token follows its places, not the projects it was connected with', async () => {
  const w = await world()
  const made = await w.me.post('/api/agents', { name: 'Helper', project_ids: [w.a.project], reach: 'mcp' })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const agent = made.body.agent_id as string
  const t = client(made.body.token as string)
  assert.equal((await t.get(`/api/tasks/${w.b.task}`)).status, 404)
  assert.equal((await w.me.post(`/api/projects/${w.b.project}/members`, { actor_id: agent })).status, 200)
  assert.equal((await t.get(`/api/tasks/${w.b.task}`)).status, 200)
})

test('a limited token’s sockets: B’s project and room, and a direct conversation, are not there', async () => {
  const w = await world()
  const other = await addPerson(w.owner.ctx, w.owner.workspaceId, 'member', [w.a.project, w.b.project])
  const dm = (await w.me.post('/api/conversations/direct', { actor_ids: [other.actorId] })).body.id as string
  assert.ok(dm)
  const ctx = (await authenticate(`Bearer ${w.limited}`))!
  assert.deepEqual(ctx.tokenProjectIds, [w.a.project])

  // What /ws/projects/:id and /ws/conversations/:id ask before 4404.
  assert.equal(await mayWatch(ctx, w.a.project), true)
  assert.equal(await mayWatch(ctx, w.b.project), false)
  assert.equal(await mayListen(ctx, w.a.room), true)
  assert.equal(await mayListen(ctx, w.b.room), false)
  assert.equal(await mayListen(ctx, dm), false)
  // The session still listens to all three.
  assert.equal(await mayListen(w.owner.ctx, w.b.room), true)
  assert.equal(await mayListen(w.owner.ctx, dm), true)

  // What /ws/me passes on to it.
  /* Every word says the workspace it was said in — this one. */
  const hears = (kind: string, payload: object) => tokenHears(ctx, { kind, payload: { ...payload, workspace_id: w.owner.workspaceId } })
  assert.equal(await hears('message', { conversation_id: w.a.room }), true)
  assert.equal(await hears('message', { conversation_id: w.b.room }), false)
  assert.equal(await hears('message', { conversation_id: dm }), false)
  assert.equal(await hears('notification', { reason: 'mentioned', object_type: 'task', object_id: w.a.task }), true)
  assert.equal(await hears('notification', { reason: 'mentioned', object_type: 'task', object_id: w.b.task }), false)
  assert.equal(await hears('notification', { reason: 'joined', object_type: 'actor', object_id: other.actorId }), false)
  assert.equal(await hears('notification', { reason: 'mentioned' }), false)
})

test('direct conversations and channels outside every project are not read by a limited token', async () => {
  const w = await world()
  const other = await addPerson(w.owner.ctx, w.owner.workspaceId, 'member', [w.a.project])
  const dm = (await w.me.post('/api/conversations/direct', { actor_ids: [other.actorId] })).body.id as string
  const channel = (await w.me.post('/api/conversations/channels', { name: `loose-${w.word.slice(-6)}` })).body.id as string
  assert.ok(dm && channel)
  await w.me.post(`/api/conversations/${dm}/messages`, { body: doc(`private ${w.word}`) })
  await w.me.post(`/api/conversations/${channel}/messages`, { body: doc(`loose ${w.word}`) })

  const t = client(w.limited)
  for (const room of [dm, channel]) {
    const said = await t.get(`/api/conversations/${room}/messages`)
    assert.deepEqual(said.body.messages ?? [], [], JSON.stringify(said.body))
    assert.notEqual((await t.post(`/api/conversations/${room}/messages`, { body: doc('no') })).status, 201)
    assert.notEqual(
      (await t.get(`/api/conversations/${room}/members`)).status === 200 &&
        JSON.stringify((await t.get(`/api/conversations/${room}/members`)).body).includes(other.actorId),
      true,
    )
  }
  const rooms = JSON.stringify((await t.get('/api/conversations')).body)
  assert.ok(!rooms.includes(dm) && !rooms.includes(channel), rooms)
  const found = JSON.stringify((await t.get(`/api/search?q=${w.word}`)).body)
  assert.ok(!found.includes('private') && !found.includes('loose'), found)
  // The session reads both.
  assert.ok(JSON.stringify((await w.me.get(`/api/conversations/${dm}/messages`)).body).includes('private'))
})

test('a mention written by a limited token reaches somebody who may read it, and nobody who may not', async () => {
  const w = await world()
  const onA = await addPerson(w.owner.ctx, w.owner.workspaceId, 'member', [w.a.project])
  const onB = await addPerson(w.owner.ctx, w.owner.workspaceId, 'member', [w.b.project])
  const mention = (id: string) => ({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'mention', attrs: { id, label: 'X' } },
          { type: 'text', text: ' see this' },
        ],
      },
    ],
  })
  const t = client(w.limited)
  assert.equal((await t.post(`/api/tasks/${w.a.task}/comments`, { body: mention(onA.actorId) })).status, 201)
  assert.equal((await t.post(`/api/tasks/${w.a.task}/comments`, { body: mention(onB.actorId) })).status, 201)
  const inboxOf = async (actorId: string) =>
    JSON.stringify((await client(await bearerFor(actorId, w.owner.workspaceId)).get('/api/inbox')).body)
  assert.ok((await inboxOf(onA.actorId)).includes(w.a.task), 'the one on A is told')
  assert.ok(!(await inboxOf(onB.actorId)).includes(w.a.task), 'the one who cannot read A is not')
})

test('an agent’s token made before 191 with a list comes out of it empty', async () => {
  const w = await world()
  const made = await w.me.post('/api/agents', { name: 'Old helper', project_ids: [w.a.project], reach: 'mcp' })
  const agent = made.body.agent_id as string
  // As it was issued before: with the projects it was connected to.
  await issueApiToken(agent, w.owner.workspaceId, 'Old helper', [w.a.project], 30)
  const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
  try {
    const listOf = async () =>
      (await owner<{ n: number }[]>`select coalesce(max(cardinality(project_ids)), 0) as n from api_token where actor_id = ${agent}`)[0]!.n
    assert.equal(await listOf(), 1)
    const migration = readFileSync(new URL('../migrations/191_a_token_keeps_to_its_projects.sql', import.meta.url), 'utf8')
    const emptying = /update api_token t set project_ids = '\{\}'[\s\S]*?;/.exec(migration)?.[0]
    assert.ok(emptying, 'the migration empties agents’ lists')
    await owner.unsafe(emptying)
    assert.equal(await listOf(), 0)
  } finally {
    await owner.end()
  }
})

test('a session right after a limited token, on the same connections, sees everything', async () => {
  const w = await world()
  const t = client(w.limited)
  for (let i = 0; i < 3; i++) {
    const answers = await Promise.all(
      Array.from({ length: 24 }, (_, k) => (k % 2 ? w.me : t).get(`/api/tasks/${w.b.task}`).then((r) => [k % 2, r.status])),
    )
    for (const [session, status] of answers) assert.equal(status, session ? 200 : 404)
  }
  const wide = client(w.wide)
  assert.equal((await t.get(`/api/tasks/${w.b.task}`)).status, 404)
  assert.equal((await wide.get(`/api/tasks/${w.b.task}`)).status, 200)
})

test('B’s numbers, links and people are not the limited token’s', async () => {
  const w = await world()
  const t = client(w.limited)
  const number = ((await w.me.get(`/api/tasks/${w.b.task}`)).body.task as { number: number }).number
  assert.equal((await w.me.get(`/api/projects/${w.b.project}/at/${number}`)).status, 200)
  assert.equal((await t.get(`/api/projects/${w.b.project}/at/${number}`)).status, 404)

  await withActor(
    w.owner.ctx.actorId,
    (tx) => tx`
    insert into object_link (id, workspace_id, from_type, from_id, to_type, to_id, created_by)
    values (${uuidv7()}, ${w.owner.workspaceId}, 'task', ${w.b.task}, 'post', ${w.b.post}, ${w.owner.ctx.actorId})`,
  )
  assert.equal(((await w.me.get(`/api/links/task/${w.b.task}`)).body.links as unknown[]).length, 1)
  assert.deepEqual((await t.get(`/api/links/task/${w.b.task}`)).body.links, [])

  const people = await t.get(`/api/projects/${w.b.project}/members`)
  assert.ok(people.status === 404 || ((people.body.members as unknown[] | undefined) ?? []).length === 0, JSON.stringify(people.body))

  // And it is told of its own workspace only, though its person is in two.
  const elsewhere = await makeOwner()
  await withActor(
    elsewhere.ctx.actorId,
    (tx) => tx`
    insert into membership (id, workspace_id, actor_id, role, invited_by, joined_at)
    values (${uuidv7()}, ${elsewhere.workspaceId}, ${w.owner.ctx.actorId}, 'member', ${elsewhere.ctx.actorId}, now())`,
  )
  assert.equal(((await w.me.get('/api/workspaces')).body.workspaces as unknown[]).length, 2)
  const spaces = (await t.get('/api/workspaces')).body.workspaces as { id: string }[]
  assert.deepEqual(
    spaces.map((s) => s.id),
    [w.owner.workspaceId],
  )
})
