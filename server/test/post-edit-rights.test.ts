import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { issueApiToken, startSession } from '../src/auth/flows.js'
import { issueAccessToken } from '../src/auth/tokens.js'
import { mayEditAgentsAnnouncement } from '../src/http/objects.js'
import { addManager, addPerson, asTableOwner, bearerFor, closeDb, makeOwner, makeProject } from './helpers.js'

after(async () => {
  await closeRealtime()
  await closeDb()
})

/*
 * Who may change an announcement.
 * The same people who may take one away: its author, the owner and whoever
 * runs the project, not every member the workspace's edit switch (on by
 * default) lets touch others' documents. Somebody else's is never changed
 * through a token. Emptying one was deleting it by another door.
 */
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const EMPTY = { type: 'doc', content: [] }

async function call(path: string, token: string, method = 'GET', body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> }
}

test('an announcement is changed by its author, the owner or whoever runs the project — not by any member, nor somebody else’s through a token', async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const writer = await addPerson(ctx, workspaceId, 'member', [p])
  const member = await addPerson(ctx, workspaceId, 'member', [p])
  const runner = await addManager(ctx, workspaceId, [p])
  const stranger = await addPerson(ctx, workspaceId, 'member', [])
  const made = await call('/api/agents', owner, 'POST', { name: 'Helper', project_ids: [p], reach: 'mcp' })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const as = {
    owner,
    writer: await bearerFor(writer.actorId, workspaceId),
    member: await bearerFor(member.actorId, workspaceId),
    runner: await bearerFor(runner.actorId, workspaceId),
    stranger: await bearerFor(stranger.actorId, workspaceId),
    agent: made.body.token as string,
    /* Whoever runs the project, through a tool of theirs. */
    runnerTool: await issueApiToken(runner.actorId, workspaceId, 'tool'),
  }
  const post = async (who: keyof typeof as) => {
    const r = await call(`/api/projects/${p}/posts`, as[who], 'POST', { title: `Week ${Date.now()}`, body: doc('Notes') })
    assert.equal(r.status, 201, `${who} posts: ${JSON.stringify(r.body)}`)
    return r.body.id as string
  }
  const edit = async (who: keyof typeof as, id: string, change: unknown = { title: `By ${who}` }) =>
    (await call(`/api/posts/${id}`, as[who], 'PATCH', change)).status

  // The writer's own announcement, the one everybody else reaches for.
  const theirs = await post('writer')

  /* A plain member, with the default switch that lets them edit others'
     documents: not this — neither its title nor emptying it. And it is
     left as it was. */
  assert.equal(await edit('member', theirs), 403)
  assert.equal(await edit('member', theirs, { body: EMPTY }), 403)
  const kept = await call(`/api/posts/${theirs}`, as.writer)
  assert.equal(kept.body.post.body.content[0].content[0].text, 'Notes')
  assert.match(kept.body.post.title, /^Week /)

  // Somebody off the project is not told it is there.
  assert.equal(await edit('stranger', theirs), 404)

  // An agent on the project, through its token: somebody else's is not its to change.
  assert.equal(await edit('agent', theirs), 403)
  assert.equal(await edit('agent', theirs, { body: EMPTY }), 403)

  // Whoever runs the project may — but not through a tool acting for them.
  assert.equal(await edit('runner', theirs), 200)
  assert.equal(await edit('runnerTool', theirs), 403)

  // The owner may.
  assert.equal(await edit('owner', theirs), 200)
  assert.equal((await call(`/api/posts/${theirs}`, as.writer)).body.post.title, 'By owner')

  // And everybody may change their own, the agent through its token included.
  assert.equal(await edit('writer', theirs), 200)
  assert.equal(await edit('member', await post('member')), 200)
  assert.equal(await edit('agent', await post('agent')), 200)
  assert.equal(await edit('runner', await post('runner')), 200)
  assert.equal(await edit('owner', await post('owner')), 200)

  // Their own announcements are still not anybody else's: the member's, edited by the agent.
  const members = await post('member')
  assert.equal(await edit('agent', members), 403)
  assert.equal(await edit('writer', members), 403)
})

test('somebody holding `edit.any` on the project may change somebody else’s announcement — signed in, not through a token', async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const writer = await addPerson(ctx, workspaceId, 'member', [p])
  const editor = await addPerson(ctx, workspaceId, 'member', [p], ['task.create', 'edit.any'])
  const editorToken = await bearerFor(editor.actorId, workspaceId)
  const writerToken = await bearerFor(writer.actorId, workspaceId)

  const r = await call(`/api/projects/${p}/posts`, writerToken, 'POST', { title: 'Week 1', body: doc('Notes') })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  const id = r.body.id as string

  assert.equal((await call(`/api/posts/${id}`, editorToken, 'PATCH', { title: 'Week one' })).status, 200)
  assert.equal((await call(`/api/posts/${id}`, editorToken, 'PATCH', { body: doc('Better notes') })).status, 200)
  const read = await call(`/api/posts/${id}`, owner)
  assert.equal(read.body.post.title, 'Week one')
  assert.equal(read.body.post.body.content[0].content[0].text, 'Better notes')

  // Through a tool of theirs, still not.
  const tool = await issueApiToken(editor.actorId, workspaceId, 'tool')
  assert.equal((await call(`/api/posts/${id}`, tool, 'PATCH', { title: 'By a tool' })).status, 403)
  assert.equal((await call(`/api/posts/${id}`, owner)).body.post.title, 'Week one')
})

/* A signed-in session, as connecting an agent asks — not a bare bearer. */
const signedIn = async (actor: string, ws: string) => (await startSession(actor, ws, {}, null)).access_token

/*
 * An agent's announcement.
 * Whoever connected the agent may change it and take it away, in person,
 * while on the project and while the agent is live; whoever runs the
 * project and the owner may, as always. Nobody else, nothing through a
 * token, and the read says each answer as `may_edit` and `may_delete`.
 */
test('an agent’s announcement is changed and taken away by whoever connected it, on the project, in person — and the read says so', async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const kit = await addPerson(ctx, workspaceId, 'member', [p])
  const member = await addPerson(ctx, workspaceId, 'member', [p])
  const runner = await addManager(ctx, workspaceId, [p])
  assert.equal((await call(`/api/people/${kit.actorId}`, owner, 'PATCH', { may_connect_agents: true })).status, 200)
  assert.equal((await call(`/api/people/${member.actorId}`, owner, 'PATCH', { may_connect_agents: true })).status, 200)
  const kitT = await signedIn(kit.actorId, workspaceId)
  const memberT = await signedIn(member.actorId, workspaceId)
  const runnerT = await bearerFor(runner.actorId, workspaceId)
  const made = await call('/api/agents', kitT, 'POST', { name: 'Helper', project_ids: [p], reach: 'mcp' })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const agentT = made.body.token as string
  /* Somebody else's agent, on the same project. */
  const other = await call('/api/agents', memberT, 'POST', { name: 'Other', project_ids: [p], reach: 'mcp' })
  assert.equal(other.status, 201, JSON.stringify(other.body))
  const otherT = other.body.token as string

  const post = async (token: string) => {
    const r = await call(`/api/projects/${p}/posts`, token, 'POST', { title: `Week ${Date.now()}`, body: doc('Notes') })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    return r.body.id as string
  }
  const edit = async (token: string, id: string, change: unknown = { title: 'Changed' }) =>
    (await call(`/api/posts/${id}`, token, 'PATCH', change)).status
  const flags = async (token: string, id: string) => {
    const r = await call(`/api/posts/${id}`, token)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const { author_agent, may_edit, may_delete } = r.body.post
    return { author_agent, may_edit, may_delete }
  }
  const yes = { author_agent: true, may_edit: true, may_delete: true }
  const no = { author_agent: true, may_edit: false, may_delete: false }

  const said = await post(agentT)

  // Kit connected it: Kit may, and the read says so.
  assert.deepEqual(await flags(kitT, said), yes)
  assert.equal(await edit(kitT, said, { title: 'Fixed by Kit', body: doc('Better notes') }), 200)
  const read = await call(`/api/posts/${said}`, owner)
  assert.equal(read.body.post.title, 'Fixed by Kit')
  assert.equal(read.body.post.body.content[0].content[0].text, 'Better notes')

  // A plain member may not — one who connected another agent here included.
  assert.deepEqual(await flags(memberT, said), no)
  assert.equal(await edit(memberT, said), 403)
  assert.equal(await edit(memberT, said, { body: EMPTY }), 403)
  assert.equal((await call(`/api/posts/${said}`, memberT, 'DELETE')).status, 403)

  // Whoever runs the project and the owner may, as always — and are told.
  assert.deepEqual(await flags(runnerT, said), yes)
  assert.deepEqual(await flags(owner, said), yes)
  assert.equal(await edit(runnerT, said, { title: 'By the runner' }), 200)

  // Never through a token: Kit's own tool, nor another agent.
  const kitTool = await issueApiToken(kit.actorId, workspaceId, 'tool')
  assert.deepEqual(await flags(kitTool, said), no)
  assert.equal(await edit(kitTool, said), 403)
  assert.equal(await edit(kitTool, said, { body: EMPTY }), 403)
  assert.equal((await call(`/api/posts/${said}`, kitTool, 'DELETE')).status, 403)
  assert.equal(await edit(otherT, said), 403)
  /* Nor GitHub, nor an import, writing as Kit: a tool of any kind is not
     Kit's press. */
  for (const tool of [
    await issueAccessToken({ sub: kit.actorId, workspace_id: workspaceId, via: 'github' }),
    await issueAccessToken({ sub: kit.actorId, workspace_id: workspaceId, via: 'import', imp: crypto.randomUUID() }),
  ]) {
    assert.deepEqual(await flags(tool, said), no)
    assert.equal(await edit(tool, said), 403)
    assert.equal(await edit(tool, said, { body: EMPTY }), 403)
    assert.equal((await call(`/api/posts/${said}`, tool, 'DELETE')).status, 403)
  }
  // The agent itself still changes its own through its token, and is told it may — not take it away.
  assert.deepEqual(await flags(agentT, said), { author_agent: true, may_edit: true, may_delete: false })
  assert.equal(await edit(agentT, said, { title: 'By the agent' }), 200)

  // Kit is not given another agent's, nor a person's.
  const others = await post(otherT)
  assert.deepEqual(await flags(kitT, others), no)
  assert.equal(await edit(kitT, others), 403)
  assert.equal((await call(`/api/posts/${others}`, kitT, 'DELETE')).status, 403)
  const members = await post(memberT)
  assert.deepEqual(await flags(kitT, members), { author_agent: false, may_edit: false, may_delete: false })
  assert.equal(await edit(kitT, members), 403)
  // The other agent's is its own connector's.
  assert.equal(await edit(memberT, others), 200)

  // Nor what the agent said in a reply: the ask was announcements.
  const reply = await call(`/api/posts/${said}/comments`, agentT, 'POST', { body: doc('A reply') })
  assert.equal(reply.status, 201, JSON.stringify(reply.body))
  assert.equal((await call(`/api/comments/${reply.body.id}`, kitT, 'PATCH', { body: doc('Kit’s words') })).status, 403)

  // Kit takes it away, and may put it back.
  assert.equal((await call(`/api/posts/${said}`, kitT, 'DELETE')).status, 200)
  assert.equal((await call(`/api/posts/${said}/restore`, kitT, 'POST')).status, 200)
  assert.equal((await call(`/api/posts/${said}`, kitT)).status, 200)
})

test('a stopped or disconnected agent, or one of another workspace, gives its connector nothing — nor does a connector off the project', async () => {
  const { ctx, workspaceId, token: owner } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const kit = await addPerson(ctx, workspaceId, 'member', [p])
  assert.equal((await call(`/api/people/${kit.actorId}`, owner, 'PATCH', { may_connect_agents: true })).status, 200)
  const kitT = await signedIn(kit.actorId, workspaceId)
  const made = await call('/api/agents', kitT, 'POST', { name: 'Helper', project_ids: [p], reach: 'mcp' })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const agent = made.body.agent_id as string
  const post = async (token: string) => {
    const r = await call(`/api/projects/${p}/posts`, token, 'POST', { title: `Week ${Date.now()}`, body: doc('Notes') })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    return r.body.id as string
  }
  const said = await post(made.body.token as string)
  const db = asTableOwner()

  /* Stopped: Kit's account changed hands. Until a new token is
     made for it, nobody holds it — and nobody changes what it said by it. */
  await db`update agent set stopped_at = now() where actor_id = ${agent}`
  const stopped = await call(`/api/posts/${said}`, kitT)
  assert.equal(stopped.body.post.author_agent, true)
  assert.equal(stopped.body.post.may_edit, false)
  assert.equal(stopped.body.post.may_delete, false)
  assert.equal((await call(`/api/posts/${said}`, kitT, 'PATCH', { title: 'Stopped' })).status, 403)
  assert.equal((await call(`/api/posts/${said}`, kitT, 'DELETE')).status, 403)
  // A new token, made by whoever holds the account now, starts it — and the right with it.
  const fresh = await call(`/api/agents/${agent}/token`, kitT, 'POST')
  assert.equal(fresh.status, 201, JSON.stringify(fresh.body))
  assert.equal((await call(`/api/posts/${said}`, kitT, 'PATCH', { title: 'Started again' })).status, 200)

  /* Of another workspace: an agent row naming a person here, kept in some
     other workspace with Kit as its connector, gives Kit nothing over that
     person's announcement here. */
  const { workspaceId: elsewhere } = await makeOwner()
  const lee = await addPerson(ctx, workspaceId, 'member', [p])
  const lees = await post(await bearerFor(lee.actorId, workspaceId))
  await db`insert into agent (actor_id, workspace_id, created_by, reach) values (${lee.actorId}, ${elsewhere}, ${kit.actorId}, 'mcp')`
  const there = await call(`/api/posts/${lees}`, kitT)
  assert.equal(there.body.post.author_agent, false)
  assert.equal(there.body.post.may_edit, false)
  assert.equal((await call(`/api/posts/${lees}`, kitT, 'PATCH', { title: 'Not Kit’s' })).status, 403)
  assert.equal((await call(`/api/posts/${lees}`, kitT, 'DELETE')).status, 403)

  /* Kit off the project: the announcement is not there for Kit at all,
     and Kit's agent comes off with Kit. Back on, Kit's agent is not, but
     what it said is still Kit's to change. */
  assert.equal((await call(`/api/projects/${p}/members/${kit.actorId}`, owner, 'DELETE')).status, 200)
  assert.equal((await call(`/api/posts/${said}`, kitT)).status, 404)
  assert.equal((await call(`/api/posts/${said}`, kitT, 'PATCH', { title: 'Off' })).status, 404)
  assert.equal((await call(`/api/posts/${said}`, kitT, 'DELETE')).status, 404)
  const back = await call(`/api/projects/${p}/members`, owner, 'POST', { actor_id: kit.actorId })
  assert.ok(back.status === 200 || back.status === 201, JSON.stringify(back.body))
  assert.equal((await call(`/api/posts/${said}`, kitT, 'PATCH', { title: 'Back on' })).status, 200)

  /* Disconnected: nobody connects it now, and nobody holds its words by it. */
  assert.equal((await call(`/api/agents/${agent}`, kitT, 'DELETE')).status, 200)
  const gone = await call(`/api/posts/${said}`, kitT)
  assert.equal(gone.body.post.author_agent, true)
  assert.equal(gone.body.post.may_edit, false)
  assert.equal((await call(`/api/posts/${said}`, kitT, 'PATCH', { title: 'Disconnected' })).status, 403)
  // The owner still may, as anybody's.
  assert.equal((await call(`/api/posts/${said}`, owner, 'PATCH', { title: 'By the owner' })).status, 200)
})

/*
 * And `can()` itself says no to a connector off the project — not only the
 * row's policy, which hides the announcement from them first (L4) — and to the connector through a tool of any kind. Asked of
 * the function the endpoints ask.
 */
test('a connector off the project, or through any tool, is refused by the rule itself', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const p = await makeProject(ctx, workspaceId, 'Acme')
  const elsewhere = await makeProject(ctx, workspaceId, 'Elsewhere')
  const kit = await addPerson(ctx, workspaceId, 'member', [p])
  assert.equal(mayEditAgentsAnnouncement(kit, kit.actorId, p), true)
  assert.equal(mayEditAgentsAnnouncement(kit, kit.actorId, elsewhere), false)
  // Somebody else connected it, or nobody does.
  assert.equal(mayEditAgentsAnnouncement(kit, ctx.actorId, p), false)
  assert.equal(mayEditAgentsAnnouncement(kit, null, p), false)
  // Through any kind of tool, not: `can()` reads `viaTool`, which the server sets.
  assert.equal(mayEditAgentsAnnouncement({ ...kit, viaMcp: true }, kit.actorId, p), false)
  assert.equal(mayEditAgentsAnnouncement({ ...kit, viaGithub: true }, kit.actorId, p), false)
  assert.equal(mayEditAgentsAnnouncement({ ...kit, viaImport: crypto.randomUUID() }, kit.actorId, p), false)
})
