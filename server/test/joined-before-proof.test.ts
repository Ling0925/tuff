import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { outbox } from '../src/mail.js'
import { closeRealtime } from '../src/realtime.js'
import { startNowhereSession, startSession, takeInvite } from '../src/auth/flows.js'
import { joinByProvider, whoIs } from '../src/http/access.js'
import { hashToken } from '../src/auth/crypto.js'
import { withActor as inWs } from '../src/db.js'
import { asAuth, asTableOwner, closeDb, makeOwner, makeProject, stamp, uuidv7, withActor } from './helpers.js'

/*
 * Workspaces joined before the proof, migration 315,
 * Mallory follows a link invitation
 * of her own as Bob's address; when the real Bob proves the address —
 * Google vouching, the letter that chooses a password, a reset — her way
 * in goes, and the membership she made for him waits for his Join or
 * Leave instead of landing him in her workspace.
 */

after(async () => {
  await closeRealtime()
  await closeDb()
})

const PASSWORD = 'correct-horse-battery-staple'
const NEXT = 'a-different-long-password'

async function send(method: string, path: string, token: string | null, body?: unknown, cookie?: string) {
  const r = await app.request(path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await r.text()
  return { status: r.status, body: (text ? JSON.parse(text) : {}) as Record<string, any>, cookie: r.headers.get('set-cookie') }
}
const code = (r: { body: Record<string, any> }) => (r.body.error as { code?: string } | undefined)?.code

type Owner = Awaited<ReturnType<typeof makeOwner>>

/** Mallory's link invitation, with no address, followed as somebody else's address with her password. */
async function squat(mallory: Owner, email: string, name = 'Bob') {
  const invite = await send('POST', '/api/invites', mallory.token, { role: 'member', project_ids: [], rights: [] })
  assert.equal(invite.status, 200, JSON.stringify(invite.body))
  const joined = await send('POST', `/auth/invite/${invite.body.token as string}/accept`, null, { name, email, password: PASSWORD })
  assert.equal(joined.status, 200, JSON.stringify(joined.body))
  return { actor: joined.body.actor_id as string, refresh: joined.body.refresh_token as string }
}

async function membership(actor: string, workspaceId: string) {
  const [m] = await asTableOwner()<{ joined: boolean; waiting: boolean; gone: boolean }[]>`
    select joined_at is not null as joined, unconfirmed_at is not null as waiting, deleted_at is not null as gone
    from membership where actor_id = ${actor} and workspace_id = ${workspaceId}
    order by created_at desc limit 1`
  return m
}

/** The reset letter for an address, followed: the link's token from the outbox. */
function resetLink(email: string): string {
  const letter = outbox.filter((m) => m.to === email).at(-1)
  assert.ok(letter, `a letter went to ${email}`)
  return decodeURIComponent(/\/reset\/([^\s"<]+)/.exec(letter.text)![1]!)
}

/** Everything that decides access, asked of a waiting membership. */
async function opensNothing(actor: string, workspaceId: string, projectId: string) {
  const s = await startSession(actor, workspaceId, {}, null)
  assert.equal((await send('GET', '/api/me', s.access_token)).status, 401, 'a session forced into it is nobody there')
  assert.equal((await send('GET', '/api/projects', s.access_token)).status, 401)
  const seen = await withActor(actor, (tx) => tx`select id from project where id = ${projectId}`)
  assert.equal(seen.length, 0, 'row-level security shows none of it')
  const [alive] = await asTableOwner()<{ ok: boolean }[]>`select member_alive(${actor}, ${workspaceId}) as ok`
  assert.equal(alive?.ok, false, 'an open socket is let go')
}

test('Google proving the address: the planted membership opens nothing and Bob does not land in Mallory’s workspace', async () => {
  const mallory = await makeOwner()
  const project = await makeProject(mallory.ctx, mallory.workspaceId, 'Mallory’s')
  const email = `bob-${stamp()}@gmail.com`
  const planted = await squat(mallory, email)
  assert.deepEqual(await membership(planted.actor, mallory.workspaceId), { joined: true, waiting: false, gone: false })

  const bob = await whoIs('google', `g-${stamp()}`, email, true, 'Bob', true)
  assert.ok(bob && bob !== 'conflict')
  assert.equal(bob.actorId, planted.actor)
  assert.equal(bob.workspaceId, null, 'signed in to no workspace, not to Mallory’s')
  assert.deepEqual(await membership(planted.actor, mallory.workspaceId), { joined: false, waiting: true, gone: false })
  await opensNothing(planted.actor, mallory.workspaceId, project)

  // Mallory still sees him in her workspace's list, as somebody who has not joined.
  const people = await send('GET', '/api/people', mallory.token)
  const row = (people.body.people as { actor_id: string; joined_at: string | null }[]).find((p) => p.actor_id === planted.actor)
  assert.equal(row?.joined_at, null)

  // The question: Mallory's workspace, by name.
  const nowhere = await startNowhereSession(planted.actor, {})
  const asked = await send('GET', '/api/me/unconfirmed', nowhere.access_token)
  assert.equal(asked.status, 200, JSON.stringify(asked.body))
  assert.deepEqual(
    (asked.body.waiting as { id: string; role: string }[]).map((w) => [w.id, w.role]),
    [[mallory.workspaceId, 'member']],
  )
  // Asking changed nothing.
  assert.deepEqual(await membership(planted.actor, mallory.workspaceId), { joined: false, waiting: true, gone: false })
})

test('a reset proving the address holds the memberships the same way, and Leave takes Bob out', async () => {
  const mallory = await makeOwner()
  const project = await makeProject(mallory.ctx, mallory.workspaceId, 'Hers')
  const email = `bob-${stamp()}@corp.example`
  const planted = await squat(mallory, email)
  await withActor(
    mallory.ctx.actorId,
    (tx) =>
      tx`insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
       values (${uuidv7()}, ${mallory.workspaceId}, ${project}, ${planted.actor}, ${mallory.ctx.actorId}, '{}')`,
  )

  // The real Bob asks for a reset and follows it from his own inbox.
  assert.equal((await send('POST', '/auth/password/forgot', null, { email })).status, 200)
  const reset = await send('POST', '/auth/password/reset', null, { token: resetLink(email), password: NEXT })
  assert.equal(reset.status, 200, JSON.stringify(reset.body))
  assert.equal(reset.body.access_token, undefined, 'another browser is told to sign in')
  assert.deepEqual(await membership(planted.actor, mallory.workspaceId), { joined: false, waiting: true, gone: false })
  await opensNothing(planted.actor, mallory.workspaceId, project)
  assert.equal((await send('POST', '/auth/refresh', null, { refresh_token: planted.refresh })).status, 401, 'Mallory’s session is gone')

  // Signing in with his own password lands in no workspace.
  const signed = await send('POST', '/auth/login', null, { email, password: NEXT, nowhere: true })
  assert.equal(signed.status, 200, JSON.stringify(signed.body))
  assert.equal(signed.body.workspace_id, null)
  const t = signed.body.access_token as string

  // A press says which it is: nothing else answers.
  assert.equal((await send('POST', `/api/me/unconfirmed/${mallory.workspaceId}`, t)).status, 400)
  assert.equal((await send('POST', `/api/me/unconfirmed/${mallory.workspaceId}`, t, {})).status, 400)
  assert.equal((await send('POST', `/api/me/unconfirmed/${mallory.workspaceId}`, t, { answer: 'yes' })).status, 400)
  assert.equal((await send('POST', `/api/me/unconfirmed/${mallory.workspaceId}`, t, { answer: 'join', also: 1 })).status, 400)
  assert.equal((await send('POST', `/api/me/unconfirmed/${uuidv7()}`, t, { answer: 'join' })).status, 404)
  assert.deepEqual(await membership(planted.actor, mallory.workspaceId), { joined: false, waiting: true, gone: false })

  const left = await send('POST', `/api/me/unconfirmed/${mallory.workspaceId}`, t, { answer: 'leave' })
  assert.equal(left.status, 200, JSON.stringify(left.body))
  assert.equal(left.body.answer, 'left')
  assert.equal(left.body.access_token, undefined, 'no session for a Leave')
  assert.equal((await membership(planted.actor, mallory.workspaceId))?.gone, true)
  const [onProject] = await asTableOwner()<{ n: number }[]>`
    select count(*)::int as n from project_member where actor_id = ${planted.actor} and deleted_at is null`
  assert.equal(onProject?.n, 0, 'off her projects, as leaving takes them')
  // Nothing waits any more, and a second press finds nothing.
  assert.deepEqual((await send('GET', '/api/me/unconfirmed', t)).body.waiting, [])
  assert.equal((await send('POST', `/api/me/unconfirmed/${mallory.workspaceId}`, t, { answer: 'join' })).status, 404)
  // And her session from before is still nobody's there.
  assert.equal((await send('GET', '/api/me', t)).body.nowhere, true)
})

test('somebody who followed a link meant for them keeps their workspace by pressing Join', async () => {
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, 'Ours')
  const email = `kit-${stamp()}@example.com`
  const kit = await squat(boss, email, 'Kit')
  await withActor(
    boss.ctx.actorId,
    (tx) =>
      tx`insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
       values (${uuidv7()}, ${boss.workspaceId}, ${project}, ${kit.actor}, ${boss.ctx.actorId}, '{}')`,
  )

  // Signing in with the password typed at the link says to confirm first, names this browser, and mails the letter.
  const early = await send('POST', '/auth/login', null, { email, password: PASSWORD })
  assert.equal(early.status, 403, JSON.stringify(early.body))
  const bound = /^([^;]+)/.exec(early.cookie ?? '')?.[1]
  assert.ok(bound, 'the browser is named')
  // Following the letter in that browser: the question is the next screen, in no workspace.
  const chosen = await send('POST', '/auth/password/reset', null, { token: resetLink(email), password: NEXT }, bound)
  assert.equal(chosen.status, 200, JSON.stringify(chosen.body))
  assert.deepEqual([chosen.body.workspace_id, chosen.body.nowhere], [null, true])
  const t = chosen.body.access_token as string
  assert.equal((await send('GET', '/api/me/unconfirmed', t)).body.waiting[0].id, boss.workspaceId)

  const joined = await send('POST', `/api/me/unconfirmed/${boss.workspaceId}`, t, { answer: 'join' })
  assert.equal(joined.status, 200, JSON.stringify(joined.body))
  assert.equal(joined.body.answer, 'joined')
  assert.equal(joined.body.workspace_id, boss.workspaceId, 'a session for the workspace joined')
  assert.deepEqual(await membership(kit.actor, boss.workspaceId), { joined: true, waiting: false, gone: false })
  // In, as before: the workspace and its project.
  const me = await send('GET', '/api/me', joined.body.access_token)
  assert.equal(me.status, 200)
  assert.equal(me.body.workspace.id, boss.workspaceId)
  const seen = await withActor(kit.actor, (tx) => tx`select id from project where id = ${project}`)
  assert.equal(seen.length, 1)
  // The session in no workspace ended with the Join.
  assert.equal((await send('GET', '/api/me/unconfirmed', t)).status, 401)
  // And signing in again lands there.
  const again = await send('POST', '/auth/login', null, { email, password: NEXT })
  assert.equal(again.body.workspace_id, boss.workspaceId)
})

test('a workspace with nobody else in it is not asked about: signing up and choosing a password lands in it', async () => {
  const email = `solo-${stamp()}@example.com`
  const signed = await send('POST', '/auth/register', null, { name: 'Solo', email })
  assert.equal(signed.status, 202, JSON.stringify(signed.body))
  const [u] = await asTableOwner()<{ actor_id: string }[]>`select actor_id from app_user where email = ${email}`
  const chosen = await send(
    'POST',
    '/auth/password/reset',
    null,
    { token: resetLink(email), password: NEXT },
    /^([^;]+)/.exec(signed.cookie ?? '')?.[1],
  )
  assert.equal(chosen.status, 200, JSON.stringify(chosen.body))
  assert.ok(chosen.body.workspace_id, 'into the workspace made with the account')
  assert.deepEqual(await membership(u!.actor_id, chosen.body.workspace_id as string), { joined: true, waiting: false, gone: false })
  assert.deepEqual((await send('GET', '/api/me/unconfirmed', chosen.body.access_token as string)).body.waiting, [])
})

test('what the previous holder chose goes at the proof: open invitations, Slack channels', async () => {
  const mallory = await makeOwner()
  const project = await makeProject(mallory.ctx, mallory.workspaceId, 'Posted')
  const email = `sly-${stamp()}@gmail.com`
  const planted = await squat(mallory, email)
  const connection = uuidv7()
  const link = uuidv7()
  const invite = uuidv7()
  await asTableOwner()`
    insert into slack_connection (id, workspace_id, team_id, team_name, token_enc, connected_by)
    values (${connection}, ${mallory.workspaceId}, ${`T${stamp().slice(0, 10).toUpperCase()}`}, 'Hers', 'sealed', ${mallory.ctx.actorId})`
  await asTableOwner()`
    insert into slack_link (id, workspace_id, project_id, connection_id, channel_id, channel_name, private, linked_by)
    values (${link}, ${mallory.workspaceId}, ${project}, ${connection}, 'C0123ABC', 'general', false, ${planted.actor})`
  /* Written as the table's owner: an unproved account may not invite, but a by-hand one may, and goes the same way. */
  await asTableOwner()`
    insert into invite (id, workspace_id, role, project_ids, email, rights, token_hash, created_by, expires_at)
    values (${invite}, ${mallory.workspaceId}, 'member', '{}', null, '{}', ${`h-${stamp()}`}, ${planted.actor}, now() + interval '1 day')`

  const bob = await whoIs('google', `g-${stamp()}`, email, true, 'Sly', true)
  assert.ok(bob && bob !== 'conflict')
  const [l] = await asTableOwner()<{ stopped: string | null }[]>`select stopped from slack_link where id = ${link}`
  assert.equal(l?.stopped, 'linker_unproved')
  const [i] = await asTableOwner()<{ gone: boolean }[]>`select deleted_at is not null as gone from invite where id = ${invite}`
  assert.equal(i?.gone, true)
})

test('only the person, in a session of their own: never a token, never an address still unproved', async () => {
  const mallory = await makeOwner()
  const trudy = await makeOwner()
  const email = `two-${stamp()}@gmail.com`
  const planted = await squat(mallory, email)
  /* And in Trudy's before the proof. An unconfirmed account takes no second
     invitation as itself (`email_unverified`), so the row is put down as
     an older path, or a by-hand account, would have left it. */
  await asTableOwner()`
    insert into membership (id, workspace_id, actor_id, role, joined_at)
    values (${uuidv7()}, ${trudy.workspaceId}, ${planted.actor}, 'member', now())`

  // Before the proof there is nothing to answer, and an unproved address may not.
  const early = await startNowhereSession(planted.actor, {})
  assert.equal((await send('GET', '/api/me/unconfirmed', early.access_token)).status, 403)
  const [said] = await asAuth(
    (tx) => tx<{ s: string }[]>`select auth_membership_answer(${planted.actor}, ${mallory.workspaceId}, true) as s`,
  )
  assert.equal(said?.s, 'none')
  assert.deepEqual(await membership(planted.actor, mallory.workspaceId), { joined: true, waiting: false, gone: false })

  await whoIs('google', `g-${stamp()}`, email, true, 'Bob', true)
  assert.equal((await membership(planted.actor, trudy.workspaceId))?.waiting, true)

  // Joined into Mallory's from no workspace, then asked from inside it about Trudy's.
  const nowhere = await startNowhereSession(planted.actor, {})
  const joined = await send('POST', `/api/me/unconfirmed/${mallory.workspaceId}`, nowhere.access_token, { answer: 'join' })
  assert.equal(joined.status, 200, JSON.stringify(joined.body))
  const inside = joined.body.access_token as string
  assert.deepEqual(
    (await send('GET', '/api/me/unconfirmed', inside)).body.waiting.map((w: { id: string }) => w.id),
    [trudy.workspaceId],
  )

  // A token of his, made where he is now, is not him at the screen.
  const made = await send('POST', '/api/tokens', inside, { name: 'Script' })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const token = made.body.token as string
  assert.equal((await send('GET', '/api/me/unconfirmed', token)).status, 403)
  assert.equal((await send('POST', `/api/me/unconfirmed/${trudy.workspaceId}`, token, { answer: 'join' })).status, 403)
  assert.equal((await membership(planted.actor, trudy.workspaceId))?.waiting, true)
  // Nor the application role, which may not run the answer at all.
  await assert.rejects(
    withActor(planted.actor, (tx) => tx`select auth_membership_answer(${planted.actor}, ${trudy.workspaceId}, true)`),
    (e: unknown) => (e as { code?: string }).code === '42501',
  )

  // From a session in a workspace, a Join keeps that session.
  const second2 = await send('POST', `/api/me/unconfirmed/${trudy.workspaceId}`, inside, { answer: 'join' })
  assert.equal(second2.status, 200, JSON.stringify(second2.body))
  assert.equal(second2.body.access_token, undefined, 'the session asked from is kept')
  assert.deepEqual(await membership(planted.actor, trudy.workspaceId), { joined: true, waiting: false, gone: false })
})

test('an owner’s role waiting is joined, never left', async () => {
  /* A by-hand account may own a workspace with somebody else in it; put the rows down directly. */
  const mallory = await makeOwner()
  const email = `own-${stamp()}@gmail.com`
  const planted = await squat(mallory, email)
  const ws = uuidv7()
  await asTableOwner()`insert into workspace (id, name, slug) values (${ws}, 'Planted', ${`planted-${stamp()}`})`
  await asTableOwner()`
    insert into membership (id, workspace_id, actor_id, role, joined_at) values
      (${uuidv7()}, ${ws}, ${planted.actor}, 'owner', now()),
      (${uuidv7()}, ${ws}, ${mallory.ctx.actorId}, 'member', now())`
  await whoIs('google', `g-${stamp()}`, email, true, 'Own', true)
  assert.equal((await membership(planted.actor, ws))?.waiting, true)

  const t = (await startNowhereSession(planted.actor, {})).access_token
  const listed = (await send('GET', '/api/me/unconfirmed', t)).body.waiting as { id: string; role: string }[]
  assert.equal(listed.find((w) => w.id === ws)?.role, 'owner')
  const left = await send('POST', `/api/me/unconfirmed/${ws}`, t, { answer: 'leave' })
  assert.equal(left.status, 409)
  assert.equal(code(left), 'owner')
  assert.equal((await membership(planted.actor, ws))?.waiting, true)
  assert.equal((await send('POST', `/api/me/unconfirmed/${ws}`, t, { answer: 'join' })).status, 200)
  assert.deepEqual(await membership(planted.actor, ws), { joined: true, waiting: false, gone: false })
})

test('following an invitation to a workspace that waits is its Join', async () => {
  const mallory = await makeOwner()
  const email = `back-${stamp()}@gmail.com`
  const planted = await squat(mallory, email)
  await whoIs('google', `g-${stamp()}`, email, true, 'Back', true)
  assert.equal((await membership(planted.actor, mallory.workspaceId))?.waiting, true)

  // Mallory asks him in, by name and address, and he presses Join on the link's own page.
  const invite = await send('POST', '/api/invites', mallory.token, { role: 'member', project_ids: [], rights: [], email })
  assert.equal(invite.status, 200, JSON.stringify(invite.body))
  const t = (await startNowhereSession(planted.actor, {})).access_token
  const letter = outbox.filter((m) => m.to === email).at(-1)!
  const token = decodeURIComponent(/\/invite\/([^\s"<]+)/.exec(letter.text)![1]!)
  const joined = await send('POST', `/api/invite/${token}/join`, t)
  assert.equal(joined.status, 200, JSON.stringify(joined.body))
  assert.deepEqual(await membership(planted.actor, mallory.workspaceId), { joined: true, waiting: false, gone: false })
})

/*
 * The review's H1. `/auth/oauth/google/start?invite=` is a GET anybody can
 * link to; on the way back the callback took the invitation for an account
 * that already existed, and `accept_invite` confirmed the waiting row.
 */
test('a provider’s sign-in carrying a link joins nobody who already had an account, and confirms nothing that waits', async () => {
  const mallory = await makeOwner()
  const email = `bob-${stamp()}@gmail.com`
  const planted = await squat(mallory, email)
  const sub = `g-${stamp()}`
  const first = await whoIs('google', sub, email, true, 'Bob', true)
  assert.ok(first && first !== 'conflict')
  assert.deepEqual(await membership(planted.actor, mallory.workspaceId), { joined: false, waiting: true, gone: false })

  // Mallory's fresh link, opened by Bob through Google: the callback runs this.
  const invite = await send('POST', '/api/invites', mallory.token, { role: 'member', project_ids: [], rights: [] })
  const token = invite.body.token as string
  const back = await joinByProvider('google', token, sub, email, true, 'Bob', true)
  assert.ok(back && typeof back === 'object')
  assert.deepEqual([back.actorId, back.workspaceId, back.press], [planted.actor, null, true], 'signed in, to no workspace, sent to press')
  assert.deepEqual(await membership(planted.actor, mallory.workspaceId), { joined: false, waiting: true, gone: false })
  assert.equal((await send('GET', `/auth/invite/${token}`, null)).body.state, 'open', 'the link is left for a press')

  // Taken without a press — anything but the invitation's own page — it is given back unspent.
  assert.equal(await takeInvite(hashToken(token), planted.actor), 'gone')
  assert.deepEqual(await membership(planted.actor, mallory.workspaceId), { joined: false, waiting: true, gone: false })
  assert.equal((await send('GET', `/auth/invite/${token}`, null)).body.state, 'open')

  // Pressed on the invitation's own page, it is his Join.
  const t = (await startNowhereSession(planted.actor, {})).access_token
  const pressed = await send('POST', `/api/invite/${token}/join`, t)
  assert.equal(pressed.status, 200, JSON.stringify(pressed.body))
  assert.deepEqual(await membership(planted.actor, mallory.workspaceId), { joined: true, waiting: false, gone: false })
})

test('an existing Google account is not put into a workspace by following its link through Google', async () => {
  const mallory = await makeOwner()
  const email = `carol-${stamp()}@gmail.com`
  const sub = `g-${stamp()}`
  const carol = await whoIs('google', sub, email, true, 'Carol', true)
  assert.ok(carol && carol !== 'conflict' && carol.workspaceId)
  const invite = await send('POST', '/api/invites', mallory.token, { role: 'member', project_ids: [], rights: [] })
  const back = await joinByProvider('google', invite.body.token as string, sub, email, true, 'Carol', true)
  assert.ok(back && typeof back === 'object')
  assert.deepEqual([back.workspaceId, back.press], [carol.workspaceId, true], 'into her own workspace, asked to press')
  assert.equal(await membership(carol.actorId, mallory.workspaceId), undefined, 'not in Mallory’s')
  const fresh = await send('POST', '/api/invites', mallory.token, { role: 'member', project_ids: [], rights: [] })
  // Somebody new, by the same kind of link, still signs up into it.
  const dan = await joinByProvider('google', fresh.body.token as string, `g-${stamp()}`, `dan-${stamp()}@gmail.com`, true, 'Dan', true)
  assert.ok(dan && typeof dan === 'object')
  assert.equal(dan.workspaceId, mallory.workspaceId)
  assert.equal(dan.press, undefined)
})

/* The review's M1: the planter, as owner, read a waiting member's presence, title, time zone and address live. */
test('the workspace sees a waiting member’s name and face, and nothing they keep for the workspaces they are in', async () => {
  const mallory = await makeOwner()
  const email = `bob-${stamp()}@gmail.com`
  const planted = await squat(mallory, email)
  const r = await whoIs('google', `g-${stamp()}`, email, true, 'Bob', true)
  assert.ok(r && r !== 'conflict')
  // Bob uses Tuff elsewhere: here now, a title of his own, his own zone.
  await asTableOwner()`update actor set seen_at = now(), name = 'Robert', title = 'CFO at Acme' where id = ${planted.actor}`
  await asTableOwner()`update app_user set timezone = 'Europe/Paris' where actor_id = ${planted.actor}`

  const list = await send('GET', '/api/people', mallory.token)
  const row = (list.body.people as Record<string, unknown>[]).find((p) => p.actor_id === planted.actor)!
  assert.equal(row.name, 'Robert')
  assert.deepEqual([row.presence, row.title, row.joined_at], [null, null, null])
  const card = await send('GET', `/api/people/${planted.actor}`, mallory.token)
  assert.equal(card.status, 200, JSON.stringify(card.body))
  const person = card.body.person as Record<string, unknown>
  assert.deepEqual([person.presence, person.title, person.email, person.timezone], [null, null, null, null])
  const [c] = await inWs(
    mallory.ctx.actorId,
    mallory.workspaceId,
    (tx) => tx<{ n: number }[]>`select count(*)::int as n from colleague_card(${planted.actor})`,
  )
  assert.equal(c?.n, 0, 'no address or zone, whoever asks')

  // Joined, he is a colleague like any other.
  const t = (await startNowhereSession(planted.actor, {})).access_token
  assert.equal((await send('POST', `/api/me/unconfirmed/${mallory.workspaceId}`, t, { answer: 'join' })).status, 200)
  const after = (await send('GET', `/api/people/${planted.actor}`, mallory.token)).body.person as Record<string, unknown>
  assert.deepEqual([after.title, after.email, after.timezone], ['CFO at Acme', email, 'Europe/Paris'])
  assert.notEqual(after.presence, null)
})

/*
 * The review's M2: on a server with no mail, Mallory follows a by-hand link
 * for Bob's address herself, hands that account her workspace, webhook and
 * all, and leaves. "Nobody else in it" found it alone at Bob's proof.
 */
test('a workspace is handed over only to an address proved for real, and one the account was handed waits anyway', async () => {
  const mallory = await makeOwner()
  const email = `bob-${stamp()}@gmail.com`
  const invite = await send('POST', '/api/invites', mallory.token, { role: 'member', project_ids: [], rights: [] })
  await asTableOwner()`update invite set email = ${email}, by_hand = true, mailed_to = null where token_hash = ${hashToken(invite.body.token as string)}`
  const joined = await send('POST', `/auth/invite/${invite.body.token as string}/accept`, null, { name: 'Bob', email, password: PASSWORD })
  assert.equal(joined.status, 200, JSON.stringify(joined.body))
  const planted = joined.body.actor_id as string
  const [u] = await asTableOwner()<{ by_hand: boolean }[]>`select email_by_hand as by_hand from app_user where actor_id = ${planted}`
  assert.equal(u?.by_hand, true)

  const handed = await send('POST', '/api/workspace/transfer', mallory.token, { to: planted, password: PASSWORD })
  assert.equal(handed.status, 409, JSON.stringify(handed.body))
  assert.equal(code(handed), 'unconfirmed')
  const [direct] = await inWs(
    mallory.ctx.actorId,
    mallory.workspaceId,
    (tx) => tx<{ ok: boolean }[]>`select transfer_workspace(${mallory.workspaceId}, ${planted}) as ok`,
  )
  assert.equal(direct?.ok, false, 'the database refuses it whatever called it')
  // And a by-hand owner hands nothing over: `can()` says so.
  await asTableOwner()`update membership set role = 'member' where workspace_id = ${mallory.workspaceId} and actor_id = ${mallory.ctx.actorId}`
  await asTableOwner()`update membership set role = 'owner' where workspace_id = ${mallory.workspaceId} and actor_id = ${planted}`
  const bySession = await startSession(planted, mallory.workspaceId, {}, null)
  const me = await send('GET', '/api/me', bySession.access_token)
  assert.equal(me.status, 200, JSON.stringify(me.body))
  assert.equal((me.body.can as string[]).includes('workspace.transfer'), false)
  assert.equal((me.body.can as string[]).includes('workspace.delete'), true, 'an owner still, for everything else')

  // Arranged anyway — as the table's owner — and Mallory gone: the proof still asks, since this is not the workspace sign-up made.
  await asTableOwner()`update membership set deleted_at = now() where workspace_id = ${mallory.workspaceId} and actor_id = ${mallory.ctx.actorId}`
  const bob = await whoIs('google', `g-${stamp()}`, email, true, 'Bob', true)
  assert.ok(bob && bob !== 'conflict')
  assert.equal(bob.workspaceId, null, 'not landed in it')
  assert.deepEqual(await membership(planted, mallory.workspaceId), { joined: false, waiting: true, gone: false })
})
