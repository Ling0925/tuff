import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { v7 as uuidv7 } from 'uuid'
import { app } from '../src/http/routes.js'
import { whoIs } from '../src/http/access.js'
import { outbox } from '../src/mail.js'
import { firstWorkspace, newWorkspace, startSession } from '../src/auth/flows.js'
import { generateToken, hashToken } from '../src/auth/crypto.js'
import { asAuth, closeDb, makeOwner, stamp } from './helpers.js'

/*
 * An address nobody has proved builds nothing that outlives the proof,
 * from a review.
 */

/* As the tables' owner, for what only a fixture writes or reads. */
const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
after(async () => {
  await owner.end()
  await closeDb()
})

async function send(path: string, token: string | null, body?: unknown, method?: string) {
  const r = await app.request(path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      'content-type': 'application/json',
      'x-api-version': '1',
      'x-forwarded-for': `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> }
}
const unverified = (r: { status: number; body: Record<string, any> }, what: string) => {
  assert.equal(r.status, 403, `${what}: ${JSON.stringify(r.body)}`)
  assert.equal(r.body.error?.code, 'email_unverified', what)
}
const chooseLink = (email: string) => {
  const m = outbox.filter((x) => x.to === email).at(-1)
  const found = m && /\/reset\/(chs_[^\s"<]+)/.exec(m.text)
  return found ? decodeURIComponent(found[1]!) : null
}
const accountOf = async (email: string) =>
  (await asAuth((tx) => tx<{ actor_id: string }[]>`select actor_id from auth_lookup_user(${email})`))[0]?.actor_id ?? null

test('an invitation asked to make an account never joins one that appeared since', async () => {
  const boss = await makeOwner()
  const victim = `raced-${stamp()}@example.com`
  const link = await send('/api/invites', boss.token, { role: 'member', rights: [] })
  // The sign-up lands first; the invitation, which looked a moment before, goes on.
  assert.equal((await send('/auth/register', null, { name: 'Victim', email: victim })).status, 202)
  await assert.rejects(
    asAuth(
      (tx) => tx`select * from accept_invite(${hashToken(link.body.token as string)}::text, ${uuidv7()}::uuid,
      'V'::text, ${victim}::citext, ${'x'}::text, true)`,
    ),
    /account_exists/,
  )
  // Given back unspent.
  assert.equal((await send(`/auth/invite/${link.body.token as string}`, null)).body.state, 'open')
})

test('a sign-up racing an invitation never gets a session from it', async () => {
  // The reviewer's race, through the routes: whatever order they land in,
  // no session comes back for an account whose password nobody checked.
  const boss = await makeOwner()
  /* Room for every round. `makeOwner`'s `team` holds ten, and each round the
     invitation wins puts somebody in: after nine such rounds the tenth
     invitation was refused as full, its missing token made the accept a 404,
     and the test failed whenever the sign-ups lost often enough. */
  await owner`update workspace set plan = 'company' where id = ${boss.workspaceId}`
  for (let i = 0; i < 12; i++) {
    const victim = `race-${stamp()}-${i}@example.com`
    const link = await send('/api/invites', boss.token, { role: 'member', rights: [] })
    assert.ok(link.status < 300, `round ${i}: no invitation to race: ${JSON.stringify(link.body)}`)
    const [acc] = await Promise.all([
      send(`/auth/invite/${link.body.token as string}/accept`, null, { name: 'V', email: victim, password: 'attackers-password-123' }),
      (async () => {
        await new Promise((r) => setTimeout(r, i % 4))
        return send('/auth/register', null, { name: 'Victim', email: victim })
      })(),
    ])
    if (acc.status === 200) assert.equal(acc.body.created_account, true, `round ${i}: a session for an account it did not make`)
    else assert.equal(acc.status, 401, `round ${i}: ${JSON.stringify(acc.body)}`)
  }
})

test('a link with no address, followed with somebody’s, builds nothing that outlives their proof', async () => {
  const attacker = await makeOwner()
  const sidekick = await makeOwner()
  const victim = `nr-${stamp()}@example.com`
  const link = await send('/api/invites', attacker.token, { role: 'member', rights: [] })
  const acc = await send(`/auth/invite/${link.body.token as string}/accept`, null, {
    name: 'Victim',
    email: victim,
    password: 'attackers-password-123',
  })
  assert.equal(acc.status, 200)
  const theirs = acc.body.access_token as string
  // No workspace of their own, no way into another.
  unverified(await send('/api/workspaces', theirs, { name: 'Victim HQ' }), 'a new workspace')
  unverified(await send(`/api/workspaces/${sidekick.workspaceId}/enter`, theirs, {}), 'entering another workspace')
  // Their own is fine to stay in.
  assert.equal((await send(`/api/workspaces/${attacker.workspaceId}/enter`, theirs, {})).status, 200)
  // Nothing an owner or an admin does, even where the switch lets members invite.
  await owner`update workspace set settings = settings || '{"who_invites_people":"members"}'::jsonb where id = ${attacker.workspaceId}`
  unverified(await send('/api/invites', theirs, { role: 'member', rights: [] }), 'an invitation')
  unverified(await send('/api/webhooks', theirs, { url: 'https://example.com/hook', events: [] }), 'a webhook')
  unverified(await send('/api/tokens', theirs, { name: 'x' }), 'a token')
  // A member's work is still theirs to do: the people in the workspace.
  assert.equal((await send('/api/people', theirs)).status, 200)

  // The owner of the address proves it: nothing of the stranger's is left in their account.
  const chose = await send('/auth/password/reset', null, { token: chooseLink(victim), password: 'victims-own-password' })
  assert.equal(chose.status, 200)
  assert.equal((await send('/api/me', theirs)).status, 401)
  const id = (await accountOf(victim))!
  const [owned] = await owner<{ n: number }[]>`select count(*)::int as n from membership where actor_id = ${id} and role = 'owner'`
  assert.equal(owned!.n, 0)
})

test('an owner’s role held by an unproved address counts as a member’s', async () => {
  // Nobody has a session for a sign-up's workspace before the proof; made
  // here by hand, to see that `can()` holds even if something gave one.
  const email = `ownerless-${stamp()}@example.com`
  assert.equal((await send('/auth/register', null, { name: 'Oona', email })).status, 202)
  const id = (await accountOf(email))!
  const ws = (await firstWorkspace(id))!
  const s = await startSession(id, ws, {}, null)
  const t = s.access_token
  unverified(await send('/api/invites', t, { role: 'member', rights: [] }), 'an invitation')
  unverified(await send('/api/webhooks', t, { url: 'https://example.com/hook', events: [] }), 'a webhook')
  unverified(await send('/api/workspaces', t, { name: 'Another' }), 'a new workspace')
  unverified(await send('/api/workspace/delete', t, { dry: true }), 'deleting the workspace')
  const me = await send('/api/me', t)
  assert.equal(me.status, 200)
  for (const a of ['people.invite', 'workspace.billing', 'audit.read', 'workspace.create', 'token.issue.own']) {
    assert.ok(!(me.body.can as string[]).includes(a), `${a} offered to an unproved owner`)
  }
})

test('after the proof, the person lands in a workspace of their own, not the oldest one they were put in', async () => {
  const boss = await makeOwner()
  const email = `lands-${stamp()}@example.com`
  // Invited first, by address — a member somewhere older.
  const inv = await send('/api/invites', boss.token, { role: 'member', email, rights: [] })
  assert.ok(inv.status < 300, JSON.stringify(inv.body))
  const m = outbox.filter((x) => x.to === email).at(-1)!
  const token = decodeURIComponent(/\/invite\/([^\s"<?]+)/.exec(m.text)![1]!)
  const joined = await send(`/auth/invite/${token}/accept`, null, { name: 'Lan', email, password: 'correct-horse-battery-staple' })
  assert.equal(joined.status, 200)
  // A workspace of their own, made later.
  const mine = await newWorkspace(joined.body.actor_id as string, `Lan's own ${stamp()}`)
  assert.equal(await firstWorkspace(joined.body.actor_id as string), mine.workspace_id)
})

test('a provider sign-in on an unproved account is no way in unless the provider vouches for its address', async () => {
  const s = stamp()
  const email = `linked-${s}@example.com`
  assert.equal((await send('/auth/register', null, { name: 'Lin', email })).status, 202)
  const id = (await accountOf(email))!
  // Linked before the password came after the proof by whoever held a session for the address.
  await asAuth((tx) => tx`select auth_identity_link(${id}, 'google', ${`pre-${s}`}, ${`stranger-${s}@gmail.com`})`)
  // Signing in as that Google account, under another address: refused.
  assert.equal(await whoIs('google', `pre-${s}`, `stranger-${s}@gmail.com`, true, 'Stranger'), 'conflict')
  // Under the account's own address, vouched: that is a proof, and claims it.
  const claimed = await whoIs('google', `pre-${s}`, email, true, 'Lin')
  assert.ok(claimed && claimed !== 'conflict')
  assert.equal(claimed.actorId, id)
  const [u] = await owner<{ at: Date | null }[]>`select email_verified_at as at from app_user where actor_id = ${id}`
  assert.ok(u?.at)
})

test('a workspace address asked for and taken says nothing about whether the email has an account', async () => {
  const boss = await makeOwner()
  const [ws] = await owner<{ slug: string }[]>`select slug::text from workspace where id = ${boss.workspaceId}`
  const fresh = await send('/auth/register', null, { name: 'Sly', email: `slug-${stamp()}@example.com`, workspace_slug: ws!.slug })
  assert.equal(fresh.status, 202, JSON.stringify(fresh.body))
})

test('changing the address while unproved sends the new address the letter that chooses a password', async () => {
  const boss = await makeOwner()
  const typed = `typed-${stamp()}@example.com`
  const link = await send('/api/invites', boss.token, { role: 'member', rights: [] })
  const acc = await send(`/auth/invite/${link.body.token as string}/accept`, null, {
    name: 'Moe',
    email: typed,
    password: 'correct-horse-battery-staple',
  })
  assert.equal(acc.status, 200)
  const id = acc.body.actor_id as string
  const moved = `moved-${stamp()}@example.com`
  const t = generateToken('eml')
  await asAuth((tx) => tx`select auth_email_ticket(${hashToken(t)}, 'email', ${id}, ${moved}, interval '1 day')`)
  const r = await send('/auth/verify', null, { token: t })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.changed, true)
  // The confirmation took the password typed before; the new address chooses one.
  const chs = chooseLink(moved)
  assert.ok(chs, 'a letter to the new address')
  assert.equal((await send('/auth/password/reset', null, { token: chs, password: 'chosen-at-the-new-one' })).status, 200)
  /* Into no workspace: the one the link put the account in waits for its
     Join (`password-after-proof.md`, "Workspaces joined before the proof"). */
  assert.equal((await send('/auth/login', null, { email: moved, password: 'chosen-at-the-new-one', nowhere: true })).status, 200)
})

test('a GitHub account linked while the address was unproved is not linked after its proof', async () => {
  const boss = await makeOwner()
  const victim = `gh-${stamp()}@example.com`
  const link = await send('/api/invites', boss.token, { role: 'member', rights: [] })
  const acc = await send(`/auth/invite/${link.body.token as string}/accept`, null, {
    name: 'Gil',
    email: victim,
    password: 'attackers-password-123',
  })
  assert.equal(acc.status, 200)
  const theirs = acc.body.access_token as string
  // Refused where it starts and where it finishes.
  unverified(await send('/api/github/me/start', theirs, {}), 'starting to link GitHub')
  unverified(await send('/api/github/me', theirs, { code: 'x', state: 'y' }), 'finishing a GitHub link')
  // One linked before this deploy goes with the proof — by the letter.
  const id = acc.body.actor_id as string
  const ghId = Math.floor(Math.random() * 1e12)
  await owner`insert into github_person (actor_id, github_id, login) values (${id}, ${ghId}, 'stranger')`
  assert.equal((await send('/auth/password/reset', null, { token: chooseLink(victim), password: 'victims-own-password' })).status, 200)
  assert.equal((await owner`select 1 from github_person where actor_id = ${id}`).length, 0)

  // And by a provider vouching for the address.
  const other = `gh2-${stamp()}@example.com`
  assert.equal((await send('/auth/register', null, { name: 'Gia', email: other })).status, 202)
  const id2 = (await accountOf(other))!
  await owner`insert into github_person (actor_id, github_id, login) values (${id2}, ${ghId + 1}, 'stranger2')`
  const claimed = await whoIs('google', `gh2-${stamp()}`, other, true, 'Gia')
  assert.ok(claimed && claimed !== 'conflict')
  assert.equal((await owner`select 1 from github_person where actor_id = ${id2}`).length, 0)
})

test('a workspace is not handed to somebody whose address nobody proved', async () => {
  const boss = await makeOwner()
  const typed = `heir-${stamp()}@example.com`
  const link = await send('/api/invites', boss.token, { role: 'member', rights: [] })
  const acc = await send(`/auth/invite/${link.body.token as string}/accept`, null, {
    name: 'Hal',
    email: typed,
    password: 'correct-horse-battery-staple',
  })
  assert.equal(acc.status, 200)
  const r = await send('/api/workspace/transfer', boss.token, { to: acc.body.actor_id, password: 'correct-horse-battery-staple' })
  assert.equal(r.status, 409, JSON.stringify(r.body))
  assert.equal(r.body.error.code, 'unconfirmed')
})
