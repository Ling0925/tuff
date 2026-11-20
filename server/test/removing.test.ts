import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { issueApiToken } from '../src/auth/flows.js'
import { hashPassword } from '../src/auth/crypto.js'
import { closeDb, inWorkspace, makeOwner, makeProject, stamp } from './helpers.js'

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

/*
 * Removing somebody ends everything they had in that workspace, and every
 * way back but a new invitation — `docs/specs/removing-someone.md`.
 */
test('a removed person keeps nothing in the workspace, and comes back only by a new invitation', async () => {
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, 'Bridge')

  // Kit joins by an invitation, as a person does, with a project and a password.
  const s = stamp()
  const email = `kit${s}@example.com`
  const first = await send('POST', '/api/invites', boss.token, { role: 'member', project_ids: [project] })
  const joined = await send('POST', `/auth/invite/${first.body.token as string}/accept`, null, { name: 'Kit', email, password: PASSWORD })
  assert.equal(joined.status, 200)
  const kit = joined.body.actor_id as string
  const kitToken = joined.body.access_token as string
  const kitRefresh = joined.body.refresh_token as string
  assert.ok(kitRefresh)
  // Confirmed, so what stops them below is the removal and not the address —
  // with the password set in the same update, as a mailed link sets it: a
  // confirmation that does not set one takes it, and the sessions it opened
  // (migration 212).
  const chosen = await hashPassword(PASSWORD)
  await owner`update app_user set email_verified_at = now(), password_hash = ${chosen} where actor_id = ${kit}`
  // An invitation made before Kit is removed, which somebody kept.
  const kept = await send('POST', '/api/invites', boss.token, { role: 'member', project_ids: [], rights: [] })

  // What Kit has set going: an invitation of their own, a token, a phone, a
  // channel, a direct conversation, open and finished work, a Slack link.
  await send('PATCH', `/api/people/${kit}`, boss.token, { may_invite_people: true })
  const theirs = await send('POST', '/api/invites', kitToken, { role: 'member', project_ids: [], rights: [] })
  assert.equal(theirs.status, 200, JSON.stringify(theirs.body))
  const tool = await issueApiToken(kit, boss.workspaceId, 'agent')
  await owner`
    insert into push_subscription (id, workspace_id, actor_id, endpoint, p256dh, auth)
    values (gen_random_uuid(), ${boss.workspaceId}, ${kit}, ${`https://fcm.googleapis.com/fcm/send/${s}`}, 'p', 'a')`
  const channel = await send('POST', '/api/conversations/channels', boss.token, { name: `crew-${s.slice(-6)}`, actor_ids: [kit] })
  assert.ok(channel.status < 300, String(channel.status))
  const direct = await send('POST', '/api/conversations/direct', boss.token, { actor_ids: [kit] })
  // And a conversation of three, which goes on without them.
  const { addPerson } = await import('./helpers.js')
  const third = await addPerson(boss.ctx, boss.workspaceId, 'member', [])
  const group = await send('POST', '/api/conversations/direct', boss.token, { actor_ids: [kit, third.actorId] })
  assert.ok(group.status < 300, String(group.status))
  await send('POST', `/api/conversations/${direct.body.id as string}/messages`, boss.token, { body: doc('Before') })
  const open = await send('POST', `/api/projects/${project}/tasks`, boss.token, { title: 'Open', assignee_ids: [kit, boss.ctx.actorId] })
  const done = await send('POST', `/api/projects/${project}/tasks`, boss.token, { title: 'Done', assignee_ids: [kit] })
  await owner`update task set completed_at = now() where id = ${done.body.id as string}`

  // Asked first, then removed; nobody else may, and the owner not themselves.
  assert.equal((await send('DELETE', `/api/people/${kit}`, kitToken)).status, 403)

  // A device that renewed once: the token it holds now, and the one it spent.
  const turned = await send('POST', '/auth/refresh', null, { refresh_token: kitRefresh })
  assert.equal(turned.status, 200)
  const kitLive = turned.body.refresh_token as string
  assert.equal((await send('DELETE', `/api/people/${kit}`, boss.token)).status, 200)
  assert.equal((await send('DELETE', `/api/people/${kit}`, boss.token)).status, 404)

  // Their device is told why, and where from — `docs/specs/removing-someone.md`,
  // "On their devices" — and told to drop what it kept of it.
  const [ws] = await owner<{ name: string }[]>`select name from workspace where id = ${boss.workspaceId}`
  const told = await app.request('/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: kitLive }),
  })
  assert.equal(told.status, 401)
  assert.deepEqual(((await told.json()) as { error: unknown }).error, {
    code: 'removed',
    message: 'You are no longer in this workspace.',
    workspace: { id: boss.workspaceId, name: ws!.name },
  })
  assert.equal(told.headers.get('clear-site-data'), '"cache"')
  // Asked again it says the same, for a second tab; nothing is handed out.
  const twice = await send('POST', '/auth/refresh', null, { refresh_token: kitLive })
  assert.equal((twice.body.error as { code: string }).code, 'removed')
  // A copy spent before the removal learns nothing.
  const stale = await send('POST', '/auth/refresh', null, { refresh_token: kitRefresh })
  assert.deepEqual([stale.status, (stale.body.error as { code: string }).code], [401, 'unauthorized'])

  // Nothing of theirs answers.
  assert.equal((await send('GET', '/api/projects', kitToken)).status, 401)
  assert.equal((await send('GET', '/api/projects', tool)).status, 401)
  const [held] = await owner<{ tokens: number; pushes: number; invites: number; joined: number }[]>`
    select (select count(*)::int from api_token where actor_id = ${kit} and workspace_id = ${boss.workspaceId} and revoked_at is null) as tokens,
           (select count(*)::int from push_subscription where actor_id = ${kit} and workspace_id = ${boss.workspaceId}) as pushes,
           (select count(*)::int from invite where created_by = ${kit} and deleted_at is null and used_at is null) as invites,
           (select count(*)::int from conversation_member where actor_id = ${kit} and conversation_id = ${channel.body.id as string} and joined_at is not null) as joined`
  assert.deepEqual(held, { tokens: 0, pushes: 0, invites: 0, joined: 0 })
  const [gone] = await owner<{ sessions: number; inGroup: number; inPair: number }[]>`
    select (select count(*)::int from refresh_session where actor_id = ${kit} and workspace_id = ${boss.workspaceId} and ended_at is null) as sessions,
           (select count(*)::int from conversation_member where actor_id = ${kit} and conversation_id = ${group.body.id as string} and joined_at is not null) as "inGroup",
           (select count(*)::int from conversation_member where actor_id = ${kit} and conversation_id = ${direct.body.id as string} and joined_at is not null) as "inPair"`
  // Out of the group, which goes on; still named in the conversation of two, which stops.
  assert.deepEqual(gone, { sessions: 0, inGroup: 0, inPair: 1 })

  // Off open work, still on finished work.
  const [o] = await owner<{ ids: string[] }[]>`select assignee_ids as ids from task where id = ${open.body.id as string}`
  const [d] = await owner<{ ids: string[] }[]>`select assignee_ids as ids from task where id = ${done.body.id as string}`
  assert.deepEqual(o!.ids, [boss.ctx.actorId])
  assert.deepEqual(d!.ids, [kit])

  // The rooms do not let them in, whatever asks: a socket, a queued push.
  const sees = await inWorkspace(
    kit,
    boss.workspaceId,
    (tx) => tx<{ ok: boolean }[]>`select can_see_conversation(${direct.body.id as string}) as ok`,
  )
  assert.equal(sees[0]!.ok, false)

  // Their direct conversation says so, and takes nothing more.
  const rooms = (await send('GET', '/api/conversations', boss.token)).body.conversations as {
    id: string
    others_gone?: boolean
    other_presence?: string | null
  }[]
  const dm = rooms.find((r) => r.id === direct.body.id)!
  assert.equal(dm.others_gone, true)
  assert.equal(dm.other_presence ?? null, null)
  assert.equal(
    (await send('POST', `/api/conversations/${direct.body.id as string}/messages`, boss.token, { body: doc('After') })).status,
    409,
  )
  // And the channel no longer lists them.
  const people = (await send('GET', `/api/conversations/${channel.body.id as string}/members`, boss.token)).body.members as {
    actor_id: string
  }[]
  assert.ok(!people.some((p) => p.actor_id === kit))

  // Their own invitation is withdrawn, and the one kept from before is no way back.
  const own = await send('POST', `/auth/invite/${theirs.body.token as string}/accept`, null, { name: 'Kit', email, password: PASSWORD })
  assert.equal(own.status, 404, JSON.stringify(own.body))
  const old = await send('POST', `/auth/invite/${kept.body.token as string}/accept`, null, { name: 'Kit', email, password: PASSWORD })
  assert.equal(old.status, 404, JSON.stringify(old.body))
  // It was not spent on them: it is still somebody else's to use.
  const other = await send('POST', `/auth/invite/${kept.body.token as string}/accept`, null, {
    name: 'Robin',
    email: `robin${s}@example.com`,
    password: PASSWORD,
  })
  assert.equal(other.status, 200)
  // An invitation made since brings them back, with nothing of before.
  const again = await send('POST', '/api/invites', boss.token, { role: 'member', project_ids: [], rights: [] })
  const back = await send('POST', `/auth/invite/${again.body.token as string}/accept`, null, { name: 'Kit', email, password: PASSWORD })
  assert.equal(back.status, 200, JSON.stringify(back.body))
  assert.equal((await send('GET', '/api/projects', tool)).status, 401)
  // A device that slept through the removal does not wake up signed in —
  // and, back in, is not told they are out.
  assert.equal((await send('POST', '/auth/refresh', null, { refresh_token: kitRefresh })).status, 401)
  const asleep = await send('POST', '/auth/refresh', null, { refresh_token: kitLive })
  assert.deepEqual([asleep.status, (asleep.body.error as { code: string }).code], [401, 'unauthorized'])
  const [after] = await owner<{ joined: number }[]>`
    select count(*)::int as joined from conversation_member
    where actor_id = ${kit} and conversation_id = ${channel.body.id as string} and joined_at is not null`
  assert.equal(after!.joined, 0)
})

/*
 * A session that outlived a removal — made before removing somebody ended
 * their sessions (172) — is not carried into their other workspace. It was:
 * the oldest one, under the address of the one they had lost, and nothing
 * said why everything had changed.
 */
test('a session in a workspace its person was removed from is refused with where, not moved', async () => {
  const s = stamp()
  const { registerUser, refresh, newWorkspace } = await import('../src/auth/flows.js')
  const first = await registerUser({
    email: `moved${s}@example.com`,
    password: PASSWORD,
    name: 'Moved',
    workspace_name: `Home ${s.slice(0, 4)}`,
    workspace_slug: `home-${s}`,
  })
  const second = await newWorkspace(first.actor_id, `Away ${s.slice(0, 4)}`)
  // Out of the second the way it happened before 172: the membership only.
  await owner`update membership set deleted_at = now() where actor_id = ${first.actor_id} and workspace_id = ${second.workspace_id}`
  const back = await refresh(second.refresh_token)
  assert.deepEqual(back, { removed: { id: second.workspace_id, name: `Away ${s.slice(0, 4)}` } })
  // The first is untouched.
  const home = await refresh(first.refresh_token)
  assert.ok(home && 'workspace_id' in home && home.workspace_id === first.workspace_id)
})

test('an agent connected by OAuth gets no new token once its person is removed', async () => {
  const boss = await makeOwner()
  const { addPerson } = await import('./helpers.js')
  const kit = await addPerson(boss.ctx, boss.workspaceId, 'member', [])
  const alive = async () => (await owner<{ ok: boolean }[]>`select member_alive(${kit.actorId}, ${boss.workspaceId}) as ok`)[0]!.ok
  assert.equal(await alive(), true)
  await send('DELETE', `/api/people/${kit.actorId}`, boss.token)
  // `pair` asks this before minting: a code or a refresh after removal mints nothing.
  assert.equal(await alive(), false)
})

/*
 * The open links somebody else made, which removal leaves standing, are
 * revoked with it only when the owner ticked that in the same dialog —
 * `docs/specs/removing-someone.md`, *Coming back*.
 */
test('removing somebody revokes the open links only when the press asks it', async () => {
  const { addPerson } = await import('./helpers.js')
  const { startSession } = await import('../src/auth/flows.js')
  const boss = await makeOwner()
  const elsewhere = await makeOwner()
  const link = () => send('POST', '/api/invites', boss.token, { role: 'member', project_ids: [], rights: [] })
  await link()
  await link()
  const mailed = await send('POST', '/api/invites', boss.token, {
    role: 'member',
    project_ids: [],
    rights: [],
    email: `ann${stamp()}@example.com`,
  })
  assert.equal(mailed.status, 200, JSON.stringify(mailed.body))
  await send('POST', '/api/invites', elsewhere.token, { role: 'member', project_ids: [], rights: [] })
  const standing = async (ws: string) => {
    const [r] = await owner<{ open: number; mailed: number }[]>`
      select count(*) filter (where email is null)::int as open, count(*) filter (where email is not null)::int as mailed
      from invite where workspace_id = ${ws} and deleted_at is null and used_at is null`
    return r!
  }
  assert.deepEqual(await standing(boss.workspaceId), { open: 2, mailed: 1 })

  // Removed without asking: the links stand, as they did.
  const a = await addPerson(boss.ctx, boss.workspaceId, 'member', [])
  const plain = await send('DELETE', `/api/people/${a.actorId}`, boss.token)
  assert.deepEqual([plain.status, plain.body.links_withdrawn], [200, 0])
  assert.deepEqual(await standing(boss.workspaceId), { open: 2, mailed: 1 })

  // Not from the address, nor from anything that only looks like the press.
  const b = await addPerson(boss.ctx, boss.workspaceId, 'member', [])
  const sly = await send('DELETE', `/api/people/${b.actorId}?withdraw_links=true`, boss.token, { withdraw_links: 'true' })
  assert.deepEqual([sly.status, sly.body.links_withdrawn], [200, 0])
  assert.deepEqual(await standing(boss.workspaceId), { open: 2, mailed: 1 })

  // Nobody but the owner, flag or not, and never through a token for tools.
  const c = await addPerson(boss.ctx, boss.workspaceId, 'member', [])
  const member = await addPerson(boss.ctx, boss.workspaceId, 'member', [])
  const theirs = await startSession(member.actorId, boss.workspaceId, {}, null)
  assert.equal((await send('DELETE', `/api/people/${c.actorId}`, theirs.access_token, { withdraw_links: true })).status, 403)
  const tool = await issueApiToken(boss.ctx.actorId, boss.workspaceId, 'agent')
  assert.equal((await send('DELETE', `/api/people/${c.actorId}`, tool, { withdraw_links: true })).status, 403)
  // Nor by what the server signs as the owner for a change GitHub caused or
  // for an import — tokens that speak as the owner without the owner's press.
  const { issueAccessToken } = await import('../src/auth/tokens.js')
  const github = await issueAccessToken({ sub: boss.ctx.actorId, workspace_id: boss.workspaceId, via: 'github' })
  const importer = await issueAccessToken({
    sub: boss.ctx.actorId,
    workspace_id: boss.workspaceId,
    via: 'import',
    imp: '01900000-0000-7000-8000-0000000000aa',
  })
  assert.equal((await send('DELETE', `/api/people/${c.actorId}`, github, { withdraw_links: true })).status, 403)
  assert.equal((await send('DELETE', `/api/people/${c.actorId}`, importer, { withdraw_links: true })).status, 403)
  assert.equal((await send('DELETE', `/api/people/${c.actorId}`, github)).status, 403)
  assert.deepEqual(await standing(boss.workspaceId), { open: 2, mailed: 1 })

  // The press: every open link here goes; an invitation to an address, and
  // another workspace's links, do not.
  const asked = await send('DELETE', `/api/people/${c.actorId}`, boss.token, { withdraw_links: true })
  assert.deepEqual([asked.status, asked.body.links_withdrawn], [200, 2])
  assert.deepEqual(await standing(boss.workspaceId), { open: 0, mailed: 1 })
  assert.deepEqual(await standing(elsewhere.workspaceId), { open: 1, mailed: 0 })
})

/*
 * Which direct conversations are with people who left — removed from the
 * workspace, or their account deleted — and so kept out of the list and at
 * the foot of the Chats page: `docs/specs/sidebar.md`, "The Chats page".
 * `others_gone` is that fact, worked out in the query from the workspace's
 * own memberships, so somebody back in the workspace is in the list again.
 */
test('a direct conversation is with people who left only when nobody else in it is still here', async () => {
  const boss = await makeOwner()
  const { addPerson } = await import('./helpers.js')
  const live = await addPerson(boss.ctx, boss.workspaceId, 'member', [])
  const removed = await addPerson(boss.ctx, boss.workspaceId, 'member', [])
  const deleted = await addPerson(boss.ctx, boss.workspaceId, 'member', [])
  const dm = async (ids: string[]) => {
    const r = await send('POST', '/api/conversations/direct', boss.token, { actor_ids: ids })
    assert.ok(r.status < 300, JSON.stringify(r.body))
    return r.body.id as string
  }
  const withLive = await dm([live.actorId])
  const withRemoved = await dm([removed.actorId])
  const withDeleted = await dm([deleted.actorId])
  const groupOneLive = await dm([removed.actorId, live.actorId])
  const groupAllGone = await dm([removed.actorId, deleted.actorId])

  assert.equal((await send('DELETE', `/api/people/${removed.actorId}`, boss.token)).status, 200)
  // Their account deleted, as `operator_delete_account` and "Delete my
  // account" both do it: out of every workspace, named "Deleted account".
  await owner`
    insert into app_user (actor_id, email, password_hash, timezone)
    values (${deleted.actorId}, ${`gone-${deleted.actorId}@example.com`}, 'x', 'UTC')`
  const [d] = await owner<{ r: { ok: boolean } }[]>`select account_deletion(${deleted.actorId}, false) as r`
  assert.equal(d!.r.ok, true, JSON.stringify(d!.r))

  const gone = async () => {
    const rooms = (await send('GET', '/api/conversations', boss.token)).body.conversations as {
      id: string
      others?: string | null
      others_gone?: boolean | null
    }[]
    return Object.fromEntries(rooms.map((r) => [r.id, r]))
  }
  let now = await gone()
  assert.equal(now[withLive]!.others_gone, false)
  assert.equal(now[withRemoved]!.others_gone, true)
  assert.equal(now[withDeleted]!.others_gone, true)
  assert.equal(now[withDeleted]!.others, 'Deleted account')
  assert.equal(now[groupOneLive]!.others_gone, false)
  assert.equal(now[groupAllGone]!.others_gone, true)
  // Nothing was deleted: the conversations are all still there to read.
  assert.equal((await send('GET', `/api/conversations/${withDeleted}/messages`, boss.token)).status, 200)

  // Back in the workspace, the conversation is with somebody who is here.
  await owner`update membership set deleted_at = null where actor_id = ${removed.actorId} and workspace_id = ${boss.workspaceId}`
  now = await gone()
  assert.equal(now[withRemoved]!.others_gone, false)
  assert.equal(now[groupAllGone]!.others_gone, false)
})
