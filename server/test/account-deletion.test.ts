import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { issueApiToken, newWorkspace, startSession } from '../src/auth/flows.js'
import { hashPassword } from '../src/auth/crypto.js'
import { asTableOwner, closeDb, makeOwner, makeProject, stamp, uuidv7 } from './helpers.js'

/*
 * A deleted account ends, in every workspace it stays out of, what leaving
 * ends. It once ended only
 * the person's own rows, and an agent they had connected went on reading
 * their chats on its year-long token after the account was gone.
 */

const owner = () => asTableOwner()
const webhooks: string[] = []

after(async () => {
  // Nothing left for anybody's worker to deliver, whatever a failure left.
  if (webhooks.length) await owner()`update webhook set enabled = false where id in ${owner()(webhooks)}`
  await closeRealtime()
  await closeDb()
})

const PASSWORD = 'correct-horse-battery-staple'
async function send(method: string, path: string, token: string | null, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}

/* A member of somebody else's workspace, with a workspace of their own, an
   agent they connected (its token, its webhook, a direct conversation with
   the owner), a token of their own, a Slack channel they linked and an
   invitation nobody used. */
async function aMemberWithThings(tag: string) {
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, `Bridge ${tag}`)
  const s = stamp()
  const inv = await send('POST', '/api/invites', boss.token, { role: 'member', project_ids: [project] })
  const joined = await send('POST', `/auth/invite/${inv.body.token as string}/accept`, null, {
    name: 'Mo',
    email: `${tag}${s}@example.com`,
    password: PASSWORD,
  })
  assert.equal(joined.status, 200, JSON.stringify(joined.body))
  const me = joined.body.actor_id as string
  await owner()`update app_user set email_verified_at = now(), password_hash = ${await hashPassword(PASSWORD)} where actor_id = ${me}`
  const myToken = (await startSession(me, boss.workspaceId, {}, null)).access_token
  const home = await newWorkspace(me, `Home ${s.slice(0, 4)}`)
  const tool = await issueApiToken(me, boss.workspaceId, 'tool')

  assert.equal((await send('PATCH', `/api/people/${me}`, boss.token, { may_connect_agents: true })).status, 200)
  const agent = await send('POST', '/api/agents', myToken, { name: 'Bot', project_ids: [project], reach: 'mcp' })
  assert.equal(agent.status, 201, JSON.stringify(agent.body))
  const agentId = agent.body.agent_id as string
  const agentToken = agent.body.token as string
  const dm = await send('POST', '/api/conversations/direct', boss.token, { actor_ids: [agentId] })
  assert.ok(dm.status === 200 || dm.status === 201, JSON.stringify(dm.body))

  const hook = uuidv7()
  webhooks.push(hook)
  await owner()`insert into webhook (id, workspace_id, url, events, secret_enc, created_by, agent_id)
                values (${hook}, ${boss.workspaceId}, 'https://hooks.example.com/m', '{}', 'whs_x', ${me}, ${agentId})`
  const conn = uuidv7()
  await owner()`insert into slack_connection (id, workspace_id, team_id, team_name, token_enc, connected_by)
                values (${conn}, ${boss.workspaceId}, ${`T${s.slice(-8).toUpperCase()}`}, 'Acme', 'sealed', ${boss.ctx.actorId})`
  await owner()`insert into slack_link (id, workspace_id, project_id, connection_id, channel_id, channel_name, private, linked_by)
                values (${uuidv7()}, ${boss.workspaceId}, ${project}, ${conn}, 'C0PROBE1', 'general', false, ${me})`
  await owner()`insert into invite (id, workspace_id, role, token_hash, created_by, expires_at)
                values (${uuidv7()}, ${boss.workspaceId}, 'member', ${randomBytes(16).toString('hex')}, ${me}, now() + interval '7 days')`

  // All of it works before.
  assert.equal((await send('GET', '/api/me', agentToken)).status, 200)
  assert.equal((await send('GET', '/api/projects', tool)).status, 200)
  return { boss, project, me, myToken, home, tool, agentId, agentToken, dmId: dm.body.id as string }
}

async function whatIsLeft(w: { boss: { workspaceId: string }; me: string; agentId: string }) {
  const [r] = await owner()<Record<string, number | boolean>[]>`
    select (select deleted_at is not null from agent where actor_id = ${w.agentId}) as agent_ended,
           (select count(*)::int from api_token where actor_id = ${w.agentId} and revoked_at is null) as agent_tokens,
           (select count(*)::int from membership where actor_id = ${w.agentId} and deleted_at is null) as agent_memberships,
           (select count(*)::int from project_member where actor_id = ${w.agentId} and deleted_at is null) as agent_places,
           (select count(*)::int from webhook where agent_id = ${w.agentId} and (enabled or deleted_at is null)) as agent_webhooks,
           (select count(*)::int from api_token where actor_id = ${w.me} and revoked_at is null) as my_tokens,
           (select count(*)::int from slack_link where linked_by = ${w.me} and stopped_at is null and deleted_at is null) as slack_links,
           (select count(*)::int from invite where created_by = ${w.me} and used_at is null and deleted_at is null) as invites,
           (select count(*)::int from membership where actor_id = ${w.me} and workspace_id = ${w.boss.workspaceId} and deleted_at is null) as my_membership`
  return r
}

const nothing = {
  agent_ended: true,
  agent_tokens: 0,
  agent_memberships: 0,
  agent_places: 0,
  agent_webhooks: 0,
  my_tokens: 0,
  slack_links: 0,
  invites: 0,
  my_membership: 0,
}

test('a deleted account takes its agents, their tokens and webhooks, its Slack links and its invitations with it', async () => {
  const w = await aMemberWithThings('del')

  // The dry run names the workspace they leave and the one that goes.
  const dry = await send('POST', '/api/me/delete', w.myToken, { dry: true })
  assert.equal(dry.status, 200, JSON.stringify(dry.body))
  assert.deepEqual(
    (dry.body.leaves as { id: string }[]).map((x) => x.id),
    [w.boss.workspaceId],
  )
  assert.deepEqual(
    (dry.body.alone as { id: string }[]).map((x) => x.id),
    [w.home.workspace_id],
  )

  const done = await send('POST', '/api/me/delete', w.myToken, { password: PASSWORD })
  assert.equal(done.status, 200, JSON.stringify(done.body))

  // The agent is refused at once, and reads nothing of its owner's.
  assert.equal((await send('GET', '/api/me', w.agentToken)).status, 401)
  const convs = await send('GET', '/api/conversations', w.agentToken)
  assert.equal(convs.status, 401)
  assert.ok(!JSON.stringify(convs.body).includes(w.dmId))
  // Nor do the person's own token or session.
  assert.equal((await send('GET', '/api/projects', w.tool)).status, 401)
  assert.equal((await send('GET', '/api/projects', w.myToken)).status, 401)

  assert.deepEqual(await whatIsLeft(w), nothing)
  const [slack] = await owner()<{ stopped: string }[]>`select stopped from slack_link where linked_by = ${w.me}`
  assert.equal(slack?.stopped, 'linker_removed')

  // The owner's workspace goes on; their own workspace went with them.
  assert.equal((await send('GET', `/api/projects/${w.project}`, w.boss.token)).status, 200)
  const [home] = await owner()<{ n: number }[]>`select count(*)::int as n from workspace where id = ${w.home.workspace_id}`
  assert.equal(home?.n, 0)
  const [actor] = await owner()<{ name: string }[]>`select name from actor where id = ${w.me}`
  assert.equal(actor?.name, 'Deleted account')
})

test('leaving ends the same things, as it did before', async () => {
  const w = await aMemberWithThings('leave')
  const left = await send('POST', '/api/me/leave', w.myToken, {})
  assert.equal(left.status, 200, JSON.stringify(left.body))
  assert.equal((await send('GET', '/api/me', w.agentToken)).status, 401)
  assert.equal((await send('GET', '/api/projects', w.tool)).status, 401)
  assert.deepEqual(await whatIsLeft(w), nothing)
  const [slack] = await owner()<{ stopped: string }[]>`select stopped from slack_link where linked_by = ${w.me}`
  assert.equal(slack?.stopped, 'linker_removed')
})

test('an owner alone with their own agents is not asked to hand the workspace over, and a temporary table cannot stand in for membership', async () => {
  const solo = await makeOwner()
  const project = await makeProject(solo.ctx, solo.workspaceId, 'Solo')
  const agent = await send('POST', '/api/agents', solo.token, { name: 'Helper', project_ids: [project], reach: 'mcp' })
  assert.equal(agent.status, 201, JSON.stringify(agent.body))

  /* Their agents are nobody to hand it to: the workspace goes with them. */
  const dry = await send('POST', '/api/me/delete', solo.token, { dry: true })
  assert.equal(dry.status, 200, JSON.stringify(dry.body))
  assert.equal(dry.body.ok, true, JSON.stringify(dry.body))
  assert.deepEqual(
    (dry.body.alone as { id: string }[]).map((x) => x.id),
    [solo.workspaceId],
  )

  /* Every way in looks in `public` before a session's own temporary tables. */
  const paths = await owner()<{ proname: string; config: string[] | null }[]>`
    select proname, proconfig as config from pg_proc
    where proname in ('account_deletion', 'delete_my_account', 'operator_delete_account', 'purge_workspace')`
  assert.equal(paths.length, 4)
  for (const p of paths) assert.ok((p.config ?? []).includes('search_path=public, pg_temp'), `${p.proname}: ${p.config}`)
})
