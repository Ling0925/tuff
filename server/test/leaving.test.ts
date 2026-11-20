import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { issueApiToken, newWorkspace, startSession } from '../src/auth/flows.js'
import { hashPassword } from '../src/auth/crypto.js'
import { addPerson, closeDb, inWorkspace, makeOwner, makeProject, stamp } from './helpers.js'

/*
 * Three ways to leave: a workspace, a channel,
 * and following an announcement or a document. Each tested as an attack:
 * what it ends ends at once, nobody but the person in a session presses it,
 * and the owner is told why not.
 */

/* As the tables' owner, for what only a fixture writes or reads. */
const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

after(async () => {
  await owner.end()
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
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const code = (r: { body: Record<string, unknown> }) => (r.body.error as { code?: string } | undefined)?.code

test('the owner cannot leave, and is told to hand it over', async () => {
  const boss = await makeOwner()
  const r = await send('POST', '/api/me/leave', boss.token, {})
  assert.equal(r.status, 409)
  assert.equal(code(r), 'owner')
  assert.match((r.body.error as { message: string }).message, /Hand it over/)
  // Still in, with nothing ended.
  assert.equal((await send('GET', '/api/projects', boss.token)).status, 200)
  // What `/api/me` tells the screen: no Leave for the owner.
  const me = await send('GET', '/api/me', boss.token)
  assert.ok(!(me.body.can as string[]).includes('workspace.leave'))
})

test('a member who leaves loses everything at once, their tools and agents with them, and can be invited back', async () => {
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, 'Bridge')
  const s = stamp()
  const email = `leaver${s}@example.com`
  const first = await send('POST', '/api/invites', boss.token, { role: 'member', project_ids: [project] })
  const joined = await send('POST', `/auth/invite/${first.body.token as string}/accept`, null, { name: 'Lee', email, password: PASSWORD })
  assert.equal(joined.status, 200, JSON.stringify(joined.body))
  const lee = joined.body.actor_id as string
  const leeRefresh = joined.body.refresh_token as string
  await owner`update app_user set email_verified_at = now(), password_hash = ${await hashPassword(PASSWORD)} where actor_id = ${lee}`
  // A session of their own, opened after the address was proved.
  const leeSession = await startSession(lee, boss.workspaceId, {}, null)
  const leeToken = leeSession.access_token
  // And somewhere else to go.
  const home = await newWorkspace(lee, `Home ${s.slice(0, 4)}`)

  // What they set going: a token, an agent they connected, a channel of chosen people.
  await send('PATCH', `/api/people/${lee}`, boss.token, { may_connect_agents: true })
  const tool = await issueApiToken(lee, boss.workspaceId, 'tool')
  const agent = await send('POST', '/api/agents', leeToken, { name: 'Helper', project_ids: [project], reach: 'mcp' })
  assert.equal(agent.status, 201, JSON.stringify(agent.body))
  const agentToken = agent.body.token as string
  const room = await send('POST', `/api/projects/${project}/conversations`, boss.token, { name: `crew-${s.slice(-5)}`, member_ids: [lee] })
  assert.equal(room.status, 201)

  // Nobody but the person, in a session: not their token, not their agent.
  const byTool = await send('POST', '/api/me/leave', tool, {})
  assert.equal(byTool.status, 403)
  const byAgent = await send('POST', '/api/me/leave', agentToken, {})
  assert.equal(byAgent.status, 403)
  assert.equal((await send('GET', `/api/projects/${project}`, leeToken)).status, 200)
  // The screen is told it may.
  assert.ok(((await send('GET', '/api/me', leeToken)).body.can as string[]).includes('workspace.leave'))

  const left = await send('POST', '/api/me/leave', leeToken, {})
  assert.equal(left.status, 200, JSON.stringify(left.body))
  const session = left.body.session as { access_token: string; workspace_id: string }
  assert.equal(session.workspace_id, home.workspace_id)
  assert.equal((left.body.workspace as { slug: string }).slug, home.slug)

  // Out at once: the old session, its renewal, the token, the agent.
  assert.equal((await send('GET', `/api/projects/${project}`, leeToken)).status, 401)
  assert.equal((await send('POST', '/auth/refresh', null, { refresh_token: leeRefresh })).status, 401)
  assert.equal((await send('GET', '/api/projects', tool)).status, 401)
  assert.equal((await send('GET', '/api/projects', agentToken)).status, 401)
  // Asked from where they are now, the project is not there.
  assert.equal((await send('GET', `/api/projects/${project}`, session.access_token)).status, 404)
  // Nor is a session for the workspace left to be had.
  assert.equal((await send('POST', `/api/workspaces/${boss.workspaceId}/enter`, session.access_token)).status, 404)

  const [held] = await owner<{ sessions: number; tokens: number; agents: number; joined: number; places: number }[]>`
    select (select count(*)::int from refresh_session where actor_id = ${lee} and workspace_id = ${boss.workspaceId} and ended_at is null) as sessions,
           (select count(*)::int from api_token where workspace_id = ${boss.workspaceId} and revoked_at is null
              and (actor_id = ${lee} or actor_id = ${agent.body.agent_id as string})) as tokens,
           (select count(*)::int from agent where created_by = ${lee} and workspace_id = ${boss.workspaceId} and deleted_at is null) as agents,
           (select count(*)::int from conversation_member where actor_id = ${lee} and conversation_id = ${room.body.id as string} and joined_at is not null) as joined,
           (select count(*)::int from project_member where actor_id = ${lee} and project_id = ${project} and deleted_at is null) as places`
  assert.deepEqual(held, { sessions: 0, tokens: 0, agents: 0, joined: 0, places: 0 })

  // The owner reads it in the audit log.
  const audit = await send('GET', '/api/audit?type=people', boss.token)
  const line = (audit.body.events as { kind: string; actor_id: string }[]).find((e) => e.kind === 'people.leave')
  assert.equal(line?.actor_id, lee)

  // Invited back, they come back.
  const again = await send('POST', '/api/invites', boss.token, { role: 'member', project_ids: [], rights: [] })
  const back = await send('POST', `/auth/invite/${again.body.token as string}/accept`, null, { name: 'Lee', email, password: PASSWORD })
  assert.equal(back.status, 200, JSON.stringify(back.body))
  assert.equal((back.body as { workspace_id: string }).workspace_id, boss.workspaceId)
})

test('the last workspace is left to no workspace at all', async () => {
  const boss = await makeOwner()
  const kit = await addPerson(boss.ctx, boss.workspaceId, 'member', [])
  const token = (await startSession(kit.actorId, boss.workspaceId, {}, null)).access_token
  const left = await send('POST', '/api/me/leave', token, {})
  assert.equal(left.status, 200, JSON.stringify(left.body))
  assert.equal(left.body.workspace, null)
  const s = left.body.session as { access_token: string; workspace_id: string | null; nowhere?: boolean }
  assert.deepEqual([s.workspace_id, s.nowhere], [null, true])
  assert.equal((await send('GET', '/api/projects', token)).status, 401)
  assert.notEqual((await send('GET', '/api/projects', s.access_token)).status, 200)
})

test('a channel of chosen people is left at once; an open one is put away muted; a direct one is not left; tokens leave nothing', async () => {
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, 'Rooms')
  const kit = await addPerson(boss.ctx, boss.workspaceId, 'member', [project])
  const kitToken = (await startSession(kit.actorId, boss.workspaceId, {}, null)).access_token
  const s = stamp().slice(-5)
  const chosen = await send('POST', `/api/projects/${project}/conversations`, boss.token, { name: `few-${s}`, member_ids: [kit.actorId] })
  const open = await send('POST', `/api/projects/${project}/conversations`, boss.token, { name: `all-${s}` })
  const direct = await send('POST', '/api/conversations/direct', boss.token, { actor_ids: [kit.actorId] })
  const chosenId = chosen.body.id as string
  const openId = open.body.id as string

  // Offered on a channel, not on a direct conversation.
  const rooms = (await send('GET', '/api/conversations', kitToken)).body.conversations as { id: string; can: string[]; chosen?: boolean }[]
  assert.ok(rooms.find((r) => r.id === chosenId)?.can.includes('leave'))
  assert.equal(rooms.find((r) => r.id === chosenId)?.chosen, true)
  assert.ok(!rooms.find((r) => r.id === direct.body.id)?.can.includes('leave'))

  // Not through a token.
  const tool = await issueApiToken(kit.actorId, boss.workspaceId, 'tool')
  assert.equal((await send('POST', `/api/conversations/${chosenId}/leave`, tool)).status, 403)
  await send('POST', `/api/conversations/${chosenId}/messages`, boss.token, { body: doc('Just us') })
  const said = async () => ((await send('GET', `/api/conversations/${chosenId}/messages`, kitToken)).body.messages as unknown[]).length
  assert.equal(await said(), 1)

  const out = await send('POST', `/api/conversations/${chosenId}/leave`, kitToken)
  assert.deepEqual([out.status, out.body.left], [200, 'out'])
  assert.equal(await said(), 0)
  assert.equal((await send('POST', `/api/conversations/${chosenId}/messages`, kitToken, { body: doc('Back?') })).status, 404)
  // Gone from their list, and from its people.
  const after1 = (await send('GET', '/api/conversations', kitToken)).body.conversations as { id: string }[]
  assert.ok(!after1.some((r) => r.id === chosenId))
  // Somebody in it can put them back.
  assert.equal(
    (await send('PUT', `/api/conversations/${chosenId}/members`, boss.token, { member_ids: [boss.ctx.actorId, kit.actorId] })).status,
    200,
  )
  assert.equal(await said(), 1)

  // An open one: still readable, put away, muted, and it stays away.
  const muted = await send('POST', `/api/conversations/${openId}/leave`, kitToken)
  assert.deepEqual([muted.status, muted.body.left], [200, 'muted'])
  await send('POST', `/api/conversations/${openId}/messages`, boss.token, { body: doc('Anyone?') })
  const after2 = (await send('GET', '/api/conversations', kitToken)).body.conversations as {
    id: string
    hidden: boolean
    left: boolean
    notify: string
  }[]
  const row = after2.find((r) => r.id === openId)!
  assert.deepEqual([row.hidden, row.left, row.notify], [true, true, 'mentions'])
  // Shown again, it is theirs again as a room starts.
  await send('PUT', `/api/conversations/${openId}/hidden`, kitToken, { hidden: false })
  const again = ((await send('GET', '/api/conversations', kitToken)).body.conversations as typeof after2).find((r) => r.id === openId)!
  assert.deepEqual([again.hidden, again.left, again.notify], [false, false, 'all'])

  // A direct conversation is hidden, not left.
  const dm = await send('POST', `/api/conversations/${direct.body.id as string}/leave`, kitToken)
  assert.equal(dm.status, 400)
  // A room they cannot see is not there.
  const other = await makeOwner()
  const theirs = await send('POST', '/api/conversations/channels', other.token, { name: `x-${s}` })
  assert.equal((await send('POST', `/api/conversations/${theirs.body.id as string}/leave`, kitToken)).status, 404)
  // The last one in a channel outside every project deletes it instead.
  const alone = await send('POST', '/api/conversations/channels', kitToken, { name: `solo-${s}`, member_ids: [kit.actorId] })
  assert.ok(alone.status < 300, JSON.stringify(alone.body))
  const last = await send('POST', `/api/conversations/${alone.body.id as string}/leave`, kitToken)
  assert.deepEqual([last.status, code(last)], [409, 'last'])
})

test('unfollowing an announcement or a document stops the next comment’s notification', async () => {
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, 'Notes')
  const kit = await addPerson(boss.ctx, boss.workspaceId, 'member', [project])
  const kitToken = (await startSession(kit.actorId, boss.workspaceId, {}, null)).access_token
  const post = await send('POST', `/api/projects/${project}/posts`, boss.token, { title: `Week ${stamp()}`, body: doc('Notes') })
  assert.equal(post.status, 201, JSON.stringify(post.body))
  const file = await send('POST', `/api/projects/${project}/files`, boss.token, { name: `Plan ${stamp()}`, body: doc('Plan') })
  assert.equal(file.status, 201, JSON.stringify(file.body))
  const heard = async (id: string) =>
    (await owner<{ n: number }[]>`select count(*)::int as n from notification where actor_id = ${kit.actorId} and object_id = ${id}`)[0]!.n

  for (const [kind, id] of [
    ['posts', post.body.id as string],
    ['files', file.body.id as string],
  ] as const) {
    const read = async () => {
      const r = await send('GET', `/api/${kind}/${id}`, kitToken)
      return (r.body[kind === 'posts' ? 'post' : 'file'] as { subscribed: boolean }).subscribed
    }
    assert.equal(await read(), false)
    assert.equal((await send('POST', `/api/${kind}/${id}/subscription`, kitToken)).status, 200)
    assert.equal(await read(), true)
    const before = await heard(id)
    await send('POST', `/api/${kind}/${id}/comments`, boss.token, { body: doc('One') })
    assert.equal(await heard(id), before + 1, `${kind}: followed, a comment is heard`)

    assert.equal((await send('DELETE', `/api/${kind}/${id}/subscription`, kitToken)).status, 200)
    assert.equal(await read(), false)
    await send('POST', `/api/${kind}/${id}/comments`, boss.token, { body: doc('Two') })
    assert.equal(await heard(id), before + 1, `${kind}: unfollowed, a comment is not`)
    // Twice is once.
    assert.equal((await send('DELETE', `/api/${kind}/${id}/subscription`, kitToken)).status, 200)
  }

  // Somebody who cannot see it cannot follow it.
  const other = await makeOwner()
  assert.equal((await send('POST', `/api/posts/${post.body.id as string}/subscription`, other.token)).status, 404)
  assert.equal((await send('POST', `/api/files/${file.body.id as string}/subscription`, other.token)).status, 404)
})

/*
 * A leave and a hand-over to the same person cannot leave the workspace
 * with nobody owning it. Raced, they queue on
 * the leaver's row; here, the two orders one after the other.
 */
test('a leave and a hand-over to the same person never end with no owner', async () => {
  const owners = async (ws: string) =>
    (
      await owner<
        { n: number }[]
      >`select count(*)::int as n from membership where workspace_id = ${ws} and role = 'owner' and deleted_at is null`
    )[0]!.n

  // Handed over first: the new owner's leave is refused, by the server and by the row.
  const a = await makeOwner()
  const kit = await addPerson(a.ctx, a.workspaceId, 'member', [])
  await newWorkspace(kit.actorId, `Kit ${stamp().slice(0, 4)}`)
  const kitToken = (await startSession(kit.actorId, a.workspaceId, {}, null)).access_token
  const [handed] = await inWorkspace(
    a.ctx.actorId,
    a.workspaceId,
    (tx) => tx<{ ok: boolean }[]>`select transfer_workspace(${a.workspaceId}, ${kit.actorId}) as ok`,
  )
  assert.equal(handed!.ok, true)
  const refused = await send('POST', '/api/me/leave', kitToken, {})
  assert.deepEqual([refused.status, code(refused)], [409, 'owner'])
  const [asRow] = await inWorkspace(kit.actorId, a.workspaceId, (tx) => tx<{ ok: boolean }[]>`select leave_workspace() as ok`)
  assert.equal(asRow!.ok, false)
  assert.equal(await owners(a.workspaceId), 1)

  // Left first: the hand-over to them finds nobody and changes nothing.
  const b = await makeOwner()
  const lee = await addPerson(b.ctx, b.workspaceId, 'member', [])
  await newWorkspace(lee.actorId, `Lee ${stamp().slice(0, 4)}`)
  const leeToken = (await startSession(lee.actorId, b.workspaceId, {}, null)).access_token
  assert.equal((await send('POST', '/api/me/leave', leeToken, {})).status, 200)
  const [late] = await inWorkspace(
    b.ctx.actorId,
    b.workspaceId,
    (tx) => tx<{ ok: boolean }[]>`select transfer_workspace(${b.workspaceId}, ${lee.actorId}) as ok`,
  )
  assert.equal(late!.ok, false)
  assert.equal(await owners(b.workspaceId), 1)
  const [still] = await owner<
    { role: string }[]
  >`select role from membership where workspace_id = ${b.workspaceId} and actor_id = ${b.ctx.actorId}`
  assert.equal(still!.role, 'owner')
})
