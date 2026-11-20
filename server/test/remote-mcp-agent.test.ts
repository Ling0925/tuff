import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { startSession } from '../src/auth/flows.js'
import { hashToken } from '../src/auth/crypto.js'
import { addPerson, closeDb, makeOwner, makeProject } from './helpers.js'

/* As the tables' owner, for the audit rows only a fixture reads. */
const db = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

after(async () => {
  await db.end()
  await closeRealtime()
  await closeDb()
})

/*
 * Tuff's connector signs in as an agent.
 * The person who presses Allow picks whom the
 * token is for; picked as an agent they manage, the tokens are the agent's,
 * and end with the agent's.
 */
const json = async (r: Response) => (await r.json()) as Record<string, unknown>
const back = 'https://routine.example/callback'
const signedIn = async (actor: string, ws: string) => (await startSession(actor, ws, {}, null)).access_token

function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

async function send(method: string, path: string, token: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}

async function register(name = 'Claude') {
  const r = await app.request('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: name, redirect_uris: [back] }),
  })
  assert.equal(r.status, 201)
  return (await json(r)).client_id as string
}

/** The page's Allow, with whatever else the body carries. */
function authorize(token: string, clientId: string, challenge: string, extra: Record<string, unknown> = {}) {
  return send('POST', '/api/oauth/authorize', token, {
    client_id: clientId,
    redirect_uri: back,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...extra,
  })
}

const trade = (form: Record<string, string>) =>
  app.request('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  })

/** Allowed and traded: the pair the client holds. */
async function connect(token: string, clientId: string, extra: Record<string, unknown> = {}) {
  const { verifier, challenge } = pkce()
  const allowed = await authorize(token, clientId, challenge, extra)
  assert.equal(allowed.status, 200, JSON.stringify(allowed.body))
  const code = new URL(allowed.body.redirect as string).searchParams.get('code')!
  const got = await trade({ grant_type: 'authorization_code', code, redirect_uri: back, client_id: clientId, code_verifier: verifier })
  assert.equal(got.status, 200)
  const pair = await json(got)
  return { access: pair.access_token as string, refresh: pair.refresh_token as string }
}

const whoIs = async (token: string) => {
  const r = await app.request('/api/me', { headers: { authorization: `Bearer ${token}` } })
  return r.status === 200 ? ((await json(r)).actor as { id: string }).id : r.status
}

async function anAgent(token: string, project: string, name = 'Routine') {
  const made = await send('POST', '/api/agents', token, { name, project_ids: [project], reach: 'mcp' })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  return made.body.agent_id as string
}

test('signed in as an agent, the token is the agent’s: its places, its name, through a refresh', async () => {
  const boss = await makeOwner()
  const theirs = await makeProject(boss.ctx, boss.workspaceId, 'Theirs')
  const elsewhere = await makeProject(boss.ctx, boss.workspaceId, 'Elsewhere')
  const agent = await anAgent(boss.token, theirs)
  const clientId = await register()

  // The page lists the agents the person manages beside themselves.
  const who = await send('GET', `/api/oauth/client?client_id=${clientId}&redirect_uri=${encodeURIComponent(back)}`, boss.token)
  assert.deepEqual(
    (who.body.agents as { id: string }[]).map((a) => a.id),
    [agent],
  )

  const pair = await connect(boss.token, clientId, { agent_id: agent })
  assert.equal(await whoIs(pair.access), agent)
  // The agent's places, not the person's.
  assert.equal((await send('GET', `/api/projects/${theirs}`, pair.access)).status, 200)
  assert.equal((await send('GET', `/api/projects/${elsewhere}`, pair.access)).status, 404)
  // What it makes is under its name.
  const task = await send('POST', `/api/projects/${theirs}/tasks`, pair.access, { title: 'From the routine' })
  assert.equal(task.status, 201, JSON.stringify(task.body))
  const [made] = await db<{ created_by: string }[]>`select author_id as created_by from task where id = ${task.body.id as string}`
  assert.equal(made?.created_by, agent)

  // Renewed, it stays the agent.
  const renewed = await trade({ grant_type: 'refresh_token', refresh_token: pair.refresh, client_id: clientId })
  assert.equal(renewed.status, 200)
  const two = await json(renewed)
  assert.equal(await whoIs(two.access_token as string), agent)

  // Its page lists the connection; the person's own tokens do not.
  const listed = (await send('GET', '/api/agents', boss.token)).body.agents as {
    actor_id: string
    connections?: { id: string; client: string; linked_by_name: string }[]
  }[]
  const row = listed.find((a) => a.actor_id === agent)!
  assert.deepEqual(
    row.connections?.map((o) => o.client),
    ['Claude'],
  )
  const mine = (await send('GET', '/api/tokens', boss.token)).body.tokens as { name: string }[]
  assert.ok(!mine.some((t) => t.name === 'Claude'))

  // Audited: who linked which client to which agent, and no secret.
  const [line] = await db<{ actor_id: string; meta: Record<string, unknown> }[]>`
    select actor_id, meta from security_event where workspace_id = ${boss.workspaceId} and kind = 'agent_linked'`
  assert.equal(line?.actor_id, boss.ctx.actorId)
  assert.deepEqual(Object.keys(line!.meta).sort(), ['actor_id', 'agent_id', 'client', 'client_id'])
  assert.equal(line!.meta.agent_id, agent)
})

test('somebody who does not manage an agent cannot sign in as it', async () => {
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, 'Shared')
  const agent = await anAgent(boss.token, project)
  const member = await addPerson(boss.ctx, boss.workspaceId, 'member', [project])
  const token = await signedIn(member.actorId, boss.workspaceId)
  const clientId = await register()

  const who = await send('GET', `/api/oauth/client?client_id=${clientId}&redirect_uri=${encodeURIComponent(back)}`, token)
  assert.equal(who.status, 200, JSON.stringify(who.body))
  assert.deepEqual(who.body.agents, [])
  const refused = await authorize(token, clientId, pkce().challenge, { agent_id: agent })
  assert.equal(refused.status, 403)
  // Nor an agent of another workspace, even for its owner there.
  const other = await makeOwner()
  const theirs = await anAgent(other.token, await makeProject(other.ctx, other.workspaceId, 'Other'))
  assert.equal((await authorize(boss.token, clientId, pkce().challenge, { agent_id: theirs })).status, 403)
  // And the member's own consent still works, as themselves.
  const own = await connect(token, clientId)
  assert.equal(await whoIs(own.access), member.actorId)
})

test('a login_hint without the press picks nobody: the token is the person’s', async () => {
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, 'Hinted')
  const agent = await anAgent(boss.token, project)
  const clientId = await register()
  const pair = await connect(boss.token, clientId, { login_hint: agent })
  assert.equal(await whoIs(pair.access), boss.ctx.actorId)
  assert.equal(await whoIs((await connect(boss.token, clientId, { agent_id: null })).access), boss.ctx.actorId)
})

test('the agent’s OAuth tokens end with it: one connection, a new token, disconnecting — the person’s stay', async () => {
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, 'Ending')
  const agent = await anAgent(boss.token, project)
  const clientId = await register()
  const own = await connect(boss.token, clientId)

  // One connection, ended from its page; the other stays.
  const one = await connect(boss.token, clientId, { agent_id: agent })
  const two = await connect(boss.token, clientId, { agent_id: agent })
  const listed = (await send('GET', '/api/agents', boss.token)).body.agents as { actor_id: string; connections: { id: string }[] }[]
  const conns = listed.find((a) => a.actor_id === agent)!.connections
  assert.equal(conns.length, 2)
  const [line] = await db<{ oauth_grant: string }[]>`
    select oauth_grant from api_token where actor_id = ${agent} and revoked_at is null and oauth_grant is not null
    and token_hash = ${hashToken(one.access)}`
  const grant = line!.oauth_grant
  assert.ok(conns.some((c) => c.id === grant))
  const ended = await send('DELETE', `/api/agents/${agent}/connections/${grant}`, boss.token)
  assert.equal(ended.status, 200, JSON.stringify(ended.body))
  assert.equal(await whoIs(one.access), 401)
  assert.equal(await whoIs(two.access), agent)
  const unlinked = await db`select 1 from security_event where workspace_id = ${boss.workspaceId} and kind = 'agent_unlinked'`
  assert.equal(unlinked.length, 1)

  // A new token ends every token it held, and a code not yet traded.
  const three = await connect(boss.token, clientId, { agent_id: agent })
  const { verifier, challenge } = pkce()
  const waiting = await authorize(boss.token, clientId, challenge, { agent_id: agent })
  const code = new URL(waiting.body.redirect as string).searchParams.get('code')!
  assert.equal((await send('POST', `/api/agents/${agent}/token`, boss.token)).status, 201)
  assert.equal(await whoIs(three.access), 401)
  assert.equal((await trade({ grant_type: 'refresh_token', refresh_token: three.refresh, client_id: clientId })).status, 400)
  const late = await trade({ grant_type: 'authorization_code', code, redirect_uri: back, client_id: clientId, code_verifier: verifier })
  assert.equal(late.status, 400)

  // Disconnected, nothing of it is left.
  const four = await connect(boss.token, clientId, { agent_id: agent })
  assert.equal((await send('DELETE', `/api/agents/${agent}`, boss.token)).status, 200)
  assert.equal(await whoIs(four.access), 401)
  assert.equal((await trade({ grant_type: 'refresh_token', refresh_token: four.refresh, client_id: clientId })).status, 400)

  // The person's own connection is untouched by all of it.
  assert.equal(await whoIs(own.access), boss.ctx.actorId)
})

test('whoever linked an agent and no longer manages it renews nothing', async () => {
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, 'Handed')
  const member = await addPerson(boss.ctx, boss.workspaceId, 'member', [project])
  await db`update membership set may_connect_agents = true where actor_id = ${member.actorId} and workspace_id = ${boss.workspaceId}`
  const token = await signedIn(member.actorId, boss.workspaceId)
  const agent = await anAgent(token, project)
  const clientId = await register()
  const pair = await connect(token, clientId, { agent_id: agent })
  assert.equal(await whoIs(pair.access), agent)
  // The agent is handed to the owner: the member connected it no longer.
  await db`update agent set created_by = ${boss.ctx.actorId} where actor_id = ${agent}`
  assert.equal((await trade({ grant_type: 'refresh_token', refresh_token: pair.refresh, client_id: clientId })).status, 400)
})

test('removing whoever linked an agent ends that connection at once; other agents’ tokens stay', async () => {
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, 'Removed linker')
  const member = await addPerson(boss.ctx, boss.workspaceId, 'member', [project])
  await db`update membership set may_connect_agents = true where actor_id = ${member.actorId} and workspace_id = ${boss.workspaceId}`
  const theirs = await signedIn(member.actorId, boss.workspaceId)
  const clientId = await register()
  const mine = await anAgent(theirs, project, 'Theirs')
  const byMember = await connect(theirs, clientId, { agent_id: mine })
  const other = await anAgent(boss.token, project, 'The owner’s')
  const otherOwn = (await send('POST', `/api/agents/${other}/token`, boss.token)).body.token as string
  const byOwner = await connect(boss.token, clientId, { agent_id: other })

  assert.equal((await send('DELETE', `/api/people/${member.actorId}`, boss.token)).status, 200)
  assert.equal(await whoIs(byMember.access), 401)
  assert.equal((await trade({ grant_type: 'refresh_token', refresh_token: byMember.refresh, client_id: clientId })).status, 400)
  assert.equal(await whoIs(byOwner.access), other)
  assert.equal(await whoIs(otherOwn), other)
})

test('the owner signs nothing in as somebody else’s agent, and may still end what its connector linked', async () => {
  // Signing in as it is its connector's alone.
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, 'Theirs')
  const member = await addPerson(boss.ctx, boss.workspaceId, 'member', [project])
  await db`update membership set may_connect_agents = true where actor_id = ${member.actorId} and workspace_id = ${boss.workspaceId}`
  const theirs = await signedIn(member.actorId, boss.workspaceId)
  const agent = await anAgent(theirs, project)
  const clientId = await register()

  // Not offered on the page, and refused by the press and by the rows.
  const page = await send('GET', `/api/oauth/client?client_id=${clientId}&redirect_uri=${encodeURIComponent(back)}`, boss.token)
  assert.equal(page.status, 200, JSON.stringify(page.body))
  assert.ok(!(page.body.agents as { id: string }[]).some((a) => a.id === agent))
  assert.equal((await authorize(boss.token, clientId, pkce().challenge, { agent_id: agent })).status, 403)
  const [rows] = await db<{ ok: boolean }[]>`select oauth_agent_managed(${agent}, ${boss.workspaceId}, ${boss.ctx.actorId}) as ok`
  assert.equal(rows!.ok, false)

  // Its connector may; the owner sees that connection and may end it.
  const linked = await connect(theirs, clientId, { agent_id: agent })
  assert.equal(await whoIs(linked.access), agent)
  const listed = (await send('GET', '/api/agents', boss.token)).body.agents as {
    actor_id: string
    can_manage: boolean
    can_disconnect: boolean
    connections?: { id: string }[]
  }[]
  const row = listed.find((a) => a.actor_id === agent)!
  assert.equal(row.can_manage, false)
  assert.equal(row.can_disconnect, true)
  assert.equal(row.connections?.length, 1)
  const ended = await send('DELETE', `/api/agents/${agent}/connections/${row.connections![0]!.id}`, boss.token)
  assert.equal(ended.status, 200, JSON.stringify(ended.body))
  assert.equal(await whoIs(linked.access), 401)
})

test('an agent handed to somebody else ends at once what its old connector linked', async () => {
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, 'Handed agent')
  const member = await addPerson(boss.ctx, boss.workspaceId, 'member', [project])
  await db`update membership set may_connect_agents = true where actor_id = ${member.actorId} and workspace_id = ${boss.workspaceId}`
  const theirs = await signedIn(member.actorId, boss.workspaceId)
  const agent = await anAgent(theirs, project)
  const own = (await send('POST', `/api/agents/${agent}/token`, theirs)).body.token as string
  const clientId = await register()
  const linked = await connect(theirs, clientId, { agent_id: agent })
  await db`update agent set created_by = ${boss.ctx.actorId} where actor_id = ${agent}`
  assert.equal(await whoIs(linked.access), 401)
  assert.equal(await whoIs(own), agent)
})
