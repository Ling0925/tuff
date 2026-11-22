import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { decodeJwt } from 'jose'
import postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { outbox } from '../src/mail.js'
import { asAuthActor, bounded, withActor as inWorkspaceOf } from '../src/db.js'
import { checkedNow, issueApiToken, startSession } from '../src/auth/flows.js'
import { hashToken } from '../src/auth/crypto.js'
import { asAuth, asTableOwner, closeDb, makeOwner, makeProject, stamp as fresh, uuidv7, withActor } from './helpers.js'

/* Connections of the owner's to hold open — a refresh, a sign-in, a put-out
   in flight — beside the helpers' pool of two. */
const held = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {} })

after(async () => {
  await held.end()
  await closeDb()
})

/*
 * Whoever held the account keeps nothing, migration 317,
 *
 * 1. What was in flight: a refresh, a sign-in or a token written while the
 *    holder is put out is ended with the rest, whichever of the two holds
 *    the account's row first; the new holder's own first session lives.
 * 2. What was left running: the holder's webhooks off, room hooks stopped,
 *    agents stopped, by every path that puts a holder out — and somebody
 *    else's untouched, and each started again by its own press.
 */

const PASSWORD = 'correct-horse-battery-staple'
const owner = () => asTableOwner()
const call = (method: string, path: string, body?: unknown, token?: string) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

/** A link with no address, followed under an address nobody proved: the holder. */
async function holderIn(boss: { token: string }, tag: string) {
  const s = fresh()
  const link = (await (await call('POST', '/api/invites', { role: 'member', rights: [] }, boss.token)).json()) as { token: string }
  const email = `${tag}${s}@example.com`
  const r = await call('POST', `/auth/invite/${link.token}/accept`, { name: 'Mallory', email, password: PASSWORD })
  assert.equal(r.status, 200)
  const acc = (await r.json()) as { actor_id: string; access_token: string; refresh_token: string; workspace_id: string }
  return { ...acc, email, sid: decodeJwt(acc.access_token).sid as string }
}

const alive = async (sid: string) => (await owner()<{ ok: boolean }[]>`select auth_session_alive(${sid}::uuid) as ok`)[0]!.ok
const liveSessions = async (actor: string) =>
  (await owner()<{ n: number }[]>`select count(*)::int as n from refresh_session where actor_id = ${actor} and ended_at is null`)[0]!.n

/** Until `marker` is a statement waiting on a lock, or `p` has settled — a condition, not a clock. */
async function waitingOrDone(marker: string, p: Promise<unknown>): Promise<boolean> {
  let settled = false
  void p.then(
    () => (settled = true),
    () => (settled = true),
  )
  for (let i = 0; i < 2000; i++) {
    const [w] = await owner()<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock' and query like ${`%${marker}%`}`
    if ((w?.n ?? 0) > 0) return true
    if (settled) return false
    await new Promise((r) => setTimeout(r, 5))
  }
  return false
}

/** The holder put out the way a provider vouching does — `auth_claim_email`, marked so it can be found waiting. */
const claim = (actor: string, marker: string) => asAuth((tx) => tx.unsafe(`select auth_claim_email($1) /* ${marker} */`, [actor]))

/* --------------------------------------------------------- 1. in flight */

test('a refresh in flight while the holder is put out leaves no session behind', async () => {
  const boss = await makeOwner()
  const h = await holderIn(boss, 'inflight')
  const marker = `put-out-refresh-${fresh()}`
  const successor = uuidv7()

  // The refresh: spends the token as `refresh` does, and writes the next session, uncommitted.
  const r = await held.reserve()
  let open = false
  try {
    await r`begin`
    open = true
    const [spent] = await r<{ session_id: string }[]>`select * from auth_spend_refresh(${hashToken(h.refresh_token)})`
    assert.equal(spent?.session_id, h.sid)
    await r`
      insert into refresh_session (id, actor_id, workspace_id, token_hash, expires_at, family, traded_from)
      values (${successor}, ${h.actor_id}, ${h.workspace_id}, ${`put-out-${successor}`}, now() + interval '1 day',
              ${h.sid}, ${h.sid})`
    // The put-out, while the refresh is open.
    const out = claim(h.actor_id, marker)
    assert.ok(await waitingOrDone(marker, out), 'the put-out waits for the refresh in flight')
    await r`commit`
    open = false
    await out
  } finally {
    if (open) await r`rollback`
    r.release()
  }
  assert.equal(await alive(successor), false, 'the session the refresh wrote is ended')
  assert.equal(await liveSessions(h.actor_id), 0)
})

test('a sign-in written while the holder is put out is ended, whichever holds the account first', async () => {
  const boss = await makeOwner()

  // The sign-in first: its session written and uncommitted as the put-out starts.
  const a = await holderIn(boss, 'signfirst')
  const first = uuidv7()
  const r = await held.reserve()
  const marker = `put-out-signin-${fresh()}`
  let open = false
  try {
    await r`begin`
    open = true
    await r`
      insert into refresh_session (id, actor_id, workspace_id, token_hash, expires_at, family)
      values (${first}, ${a.actor_id}, ${a.workspace_id}, ${`put-out-${first}`}, now() + interval '1 day', ${first})`
    const out = claim(a.actor_id, marker)
    await waitingOrDone(marker, out)
    await r`commit`
    open = false
    await out
  } finally {
    if (open) await r`rollback`
    r.release()
  }
  assert.equal(await alive(first), false, 'written first, ended by the put-out')

  // The put-out first, held open; a sign-in begun before it writes after it.
  const b = await holderIn(boss, 'outfirst')
  const second = uuidv7()
  const signIn = await held.reserve()
  const putOut = await held.reserve()
  let opened = 0
  try {
    await signIn`begin`
    await signIn`select now()`
    opened |= 1
    await putOut`begin`
    opened |= 2
    await putOut`select auth_claim_email(${b.actor_id})`
    const writing = signIn`
      insert into refresh_session (id, actor_id, workspace_id, token_hash, expires_at, family)
      values (${second}, ${b.actor_id}, ${b.workspace_id}, ${`put-out-${second}`}, now() + interval '1 day', ${second})`.execute()
    await putOut`commit`
    opened &= ~2
    await writing
    await signIn`commit`
    opened &= ~1
  } finally {
    if (opened & 2) await putOut`rollback`
    if (opened & 1) await signIn`rollback`
    putOut.release()
    signIn.release()
  }
  assert.equal(await alive(second), false, 'written after, begun before: written ended')

  // And the new holder's own first session, made after the put-out, lives.
  const [w] = await owner()<{ id: string }[]>`select workspace_id as id from membership where actor_id = ${b.actor_id} limit 1`
  const own = await startSession(b.actor_id, w!.id, {}, null)
  assert.equal(await alive(decodeJwt(own.access_token).sid as string), true)
})

test('a session or a token dated from a check made before the put-out is ended; one made after lives', async () => {
  const boss = await makeOwner()
  const h = await holderIn(boss, 'since')
  const before = await checkedNow()
  await claim(h.actor_id, 'put-out-since')
  const late = await startSession(h.actor_id, h.workspace_id, { since: before }, null)
  assert.equal(await alive(decodeJwt(late.access_token).sid as string), false, 'dated from before: ended')
  const now = await startSession(h.actor_id, h.workspace_id, { since: await checkedNow() }, null)
  assert.equal(await alive(decodeJwt(now.access_token).sid as string), true, 'checked after: lives')
})

test('a token written while the holder is put out is revoked, and so is one for an agent they connected', async () => {
  const boss = await makeOwner()
  const h = await holderIn(boss, 'tokens')
  const agent = uuidv7()
  await owner()`insert into actor (id, name) values (${agent}, 'Probe agent')`
  await owner()`insert into agent (actor_id, workspace_id, created_by, reach) values (${agent}, ${h.workspace_id}, ${h.actor_id}, 'mcp')`
  await owner()`insert into membership (id, workspace_id, actor_id, role, joined_at)
                values (${uuidv7()}, ${h.workspace_id}, ${agent}, 'member', now())`
  const own = uuidv7()
  const its = uuidv7()
  const r = await held.reserve()
  const marker = `put-out-token-${fresh()}`
  let open = false
  try {
    await r`begin`
    open = true
    await r`
      insert into api_token (id, workspace_id, actor_id, name, token_hash, expires_at)
      values (${own}, ${h.workspace_id}, ${h.actor_id}, 'mine', ${`tok-${own}`}, now() + interval '1 day'),
             (${its}, ${h.workspace_id}, ${agent}, 'its', ${`tok-${its}`}, now() + interval '1 day')`
    const out = claim(h.actor_id, marker)
    await waitingOrDone(marker, out)
    await r`commit`
    open = false
    await out
  } finally {
    if (open) await r`rollback`
    r.release()
  }
  const rows = await owner()<{ id: string; revoked: boolean }[]>`
    select id, revoked_at is not null as revoked from api_token where id in (${own}, ${its})`
  assert.deepEqual(Object.fromEntries(rows.map((t) => [t.id, t.revoked])), { [own]: true, [its]: true })
  for (const id of [own, its]) {
    assert.equal((await owner()<{ ok: boolean }[]>`select auth_token_alive(${id}::uuid) as ok`)[0]!.ok, false)
  }
})

/* ------------------------------------------------------ 2. left running */

type World = {
  boss: Awaited<ReturnType<typeof makeOwner>>
  h: Awaited<ReturnType<typeof holderIn>>
  room: string
  mine: { webhook: string; hook: string; agent: string; agentHook: string; token: string }
  theirs: { webhook: string; hook: string; agent: string; agentHook: string; token: string }
}

/** The holder's webhook, room hook and agent (with a token and a webhook of its own), and the same of the owner's. */
async function world(tag: string): Promise<World> {
  const boss = await makeOwner()
  const h = await holderIn(boss, tag)
  const p = await makeProject(boss.ctx, boss.workspaceId, 'Acme')
  const room = uuidv7()
  await withActor(
    boss.ctx.actorId,
    (tx) =>
      tx`insert into conversation (id, workspace_id, project_id, name, channel) values (${room}, ${boss.workspaceId}, ${p}, 'deploys', true)`,
  )
  const make = async (by: string) => {
    const ids = { webhook: uuidv7(), hook: uuidv7(), agent: uuidv7(), agentHook: uuidv7(), token: uuidv7() }
    await owner()`insert into webhook (id, workspace_id, url, events, secret_enc, created_by)
                  values (${ids.webhook}, ${boss.workspaceId}, 'https://hooks.example.com/w', '{}', 'whs_x', ${by})`
    await owner()`insert into room_hook (id, workspace_id, conversation_id, name, secret_hash, created_by)
                  values (${ids.hook}, ${boss.workspaceId}, ${room}, 'Deploys', ${sha(`s-${ids.hook}`)}, ${by})`
    await owner()`insert into actor (id, name) values (${ids.agent}, 'Probe agent')`
    await owner()`insert into agent (actor_id, workspace_id, created_by, reach) values (${ids.agent}, ${boss.workspaceId}, ${by}, 'webhook')`
    await owner()`insert into membership (id, workspace_id, actor_id, role, joined_at)
                  values (${uuidv7()}, ${boss.workspaceId}, ${ids.agent}, 'member', now())`
    await owner()`insert into webhook (id, workspace_id, url, events, secret_enc, created_by, agent_id)
                  values (${ids.agentHook}, ${boss.workspaceId}, 'https://hooks.example.com/a', '{}', 'whs_x', ${by}, ${ids.agent})`
    await owner()`insert into api_token (id, workspace_id, actor_id, name, token_hash, expires_at)
                  values (${ids.token}, ${boss.workspaceId}, ${ids.agent}, 'Probe agent', ${`tok-${ids.token}`}, now() + interval '1 day')`
    return ids
  }
  return { boss, h, room, mine: await make(h.actor_id), theirs: await make(boss.ctx.actorId) }
}

async function state(sql: postgres.Sql | postgres.TransactionSql, w: World) {
  const one = async (ids: { webhook: string; hook: string; agent: string; token: string; agentHook?: string }) => {
    const [r] = await sql<{ webhook: boolean; hook: boolean; agent: boolean; token: boolean; agent_hook: boolean | null }[]>`
      select (select enabled from webhook where id = ${ids.webhook}) as webhook,
             (select stopped_at is null from room_hook where id = ${ids.hook}) as hook,
             (select stopped_at is null from agent where actor_id = ${ids.agent}) as agent,
             (select revoked_at is null from api_token where id = ${ids.token}) as token,
             (select enabled from webhook where agent_id = ${ids.agent} and deleted_at is null) as agent_hook`
    return { ...r }
  }
  const [u] = await sql<{ factor: boolean; after: boolean }[]>`
    select totp_enabled_at is null and not totp_enabled as factor, sessions_after is not null as after
    from app_user where actor_id = ${w.h.actor_id}`
  return { mine: await one(w.mine), theirs: await one(w.theirs), account: { ...u } }
}

const ON = { webhook: true, hook: true, agent: true, token: true, agent_hook: true }
const OFF = { webhook: false, hook: false, agent: false, token: false, agent_hook: false }

/** As the factor would be, on with a time, before the put-out. */
const factorOn = (actor: string) =>
  owner()`update app_user set totp_enabled = true, totp_secret_enc = 'sealed', totp_enabled_at = now() where actor_id = ${actor}`

const PATHS: Record<string, (w: World) => Promise<void>> = {
  /* An old confirmation link: the address confirmed with the password left as it was. */
  app_user_proved: async (w) => {
    await factorOn(w.h.actor_id)
    await owner()`update app_user set email_verified_at = now() where actor_id = ${w.h.actor_id}`
  },
  auth_claim_email: async (w) => {
    await factorOn(w.h.actor_id)
    await asAuth((tx) => tx`select auth_claim_email(${w.h.actor_id})`)
  },
  auth_set_password: async (w) => {
    await factorOn(w.h.actor_id)
    await asAuth((tx) => tx`select auth_set_password(${w.h.actor_id}, 'scrypt$chosen-from-the-letter')`)
  },
  /* A new address confirmed for an unproved account, by the press alone (316). */
  auth_email_confirm: async (w) => {
    const to = `confirmed${fresh()}@example.com`
    assert.equal((await call('POST', '/api/me/email', { email: to, password: PASSWORD }, w.h.access_token)).status, 202)
    await factorOn(w.h.actor_id)
    const mail = outbox.filter((m) => m.to === to).at(-1)
    const token = decodeURIComponent(/\/verify\/([^\s"<]+)/.exec(mail!.text)![1]!)
    assert.equal((await call('POST', '/auth/verify', { token, pressed: true })).status, 200)
  },
}

for (const [path, putOut] of Object.entries(PATHS)) {
  test(`${path}: what the holder made is turned off or stopped, and nobody else's`, async () => {
    const w = await world(path.replace(/_/g, ''))
    assert.deepEqual((await state(owner(), w)).mine, ON)
    await putOut(w)
    assert.deepEqual(await state(owner(), w), { mine: OFF, theirs: ON, account: { factor: true, after: true } })
  })
}

/* The machine naming an owner of a server of one's own, for an account
   unproved: inside a transaction rolled back, the server's switch flipped
   for the length of it only. */
test('instance_name_owner: what the holder made is turned off or stopped, and nobody else’s', async () => {
  const w = await world('instanceowner')
  await factorOn(w.h.actor_id)
  await owner()
    .begin(async (tx) => {
      await tx`update instance_setting set community = true, claimed_at = null, owner_email = ${w.h.email}`
      await tx`select instance_name_owner(${w.h.email}::citext, ${'r'.repeat(32)})`
      assert.deepEqual(await state(tx, w), { mine: OFF, theirs: ON, account: { factor: true, after: true } })
      throw new Error('rolled back')
    })
    .catch((e: Error) => assert.equal(e.message, 'rolled back'))
})

test('each is started again by its own press, and nothing sends to the previous holder until somebody says where', async () => {
  const w = await world('again')
  await asAuth((tx) => tx`select auth_claim_email(${w.h.actor_id})`)

  // The room's hooks say which is stopped; a stopped one takes nothing.
  const listed = (await (await call('GET', `/api/conversations/${w.room}/hooks`, undefined, w.boss.token)).json()) as {
    hooks: { id: string; stopped_at: string | null }[]
  }
  assert.ok(listed.hooks.find((x) => x.id === w.mine.hook)?.stopped_at)
  assert.equal(listed.hooks.find((x) => x.id === w.theirs.hook)?.stopped_at, null)
  const takes = async (id: string, secret: string) =>
    (await owner()<{ n: number }[]>`select count(*)::int as n from room_hook_take(${id}, ${sha(secret)})`)[0]!.n
  assert.equal(await takes(w.mine.hook, `s-${w.mine.hook}`), 0)

  // The webhooks list says which was turned off for this, and turning it on gives it a new secret, said once.
  const hooks = (await (await call('GET', '/api/webhooks', undefined, w.boss.token)).json()) as {
    webhooks: { id: string; stopped_at: string | null }[]
  }
  assert.ok(hooks.webhooks.find((x) => x.id === w.mine.webhook)?.stopped_at)
  assert.equal(hooks.webhooks.find((x) => x.id === w.theirs.webhook)?.stopped_at, null)
  const on = await call('PATCH', `/api/webhooks/${w.mine.webhook}`, { enabled: true }, w.boss.token)
  assert.equal(on.status, 200)
  const said = (await on.json()) as { ok: boolean; secret?: string }
  assert.match(said.secret ?? '', /^whs_/)
  const [wh] = await owner()<{ secret: string; stopped: boolean }[]>`
    select secret_enc as secret, stopped_at is not null as stopped from webhook where id = ${w.mine.webhook}`
  assert.deepEqual({ ...wh }, { secret: said.secret, stopped: false })
  // Off and on again after that is the same webhook: no new secret.
  await call('PATCH', `/api/webhooks/${w.mine.webhook}`, { enabled: false }, w.boss.token)
  const again = await call('PATCH', `/api/webhooks/${w.mine.webhook}`, { enabled: true }, w.boss.token)
  assert.equal(((await again.json()) as { secret?: string }).secret, undefined)

  // The owner gives the hook a new URL: started, theirs, the old secret still refused.
  const turned = await call('POST', `/api/hooks/${w.mine.hook}/turn`, undefined, w.boss.token)
  assert.equal(turned.status, 200)
  const url = ((await turned.json()) as { url: string }).url
  assert.equal(await takes(w.mine.hook, url.split('/').at(-1)!), 1)
  assert.equal(await takes(w.mine.hook, `s-${w.mine.hook}`), 0)

  // The agent's webhook lost its secret and key at the put-out, and a new token sends nothing.
  const agentHook = async () =>
    (
      await owner()<{ on: boolean; secret: string; stopped: boolean }[]>`
        select enabled as on, secret_enc as secret, stopped_at is not null as stopped from webhook where id = ${w.mine.agentHook}`
    )[0]!
  assert.deepEqual({ ...(await agentHook()) }, { on: false, secret: '', stopped: true })
  const [ended] = await asAuthActor(
    w.h.actor_id,
    w.boss.workspaceId,
    (tx) => tx<{ ok: boolean }[]>`select agent_end_tokens(${w.mine.agent}) as ok`,
  )
  assert.equal(ended!.ok, true)
  const s = await state(owner(), w)
  assert.deepEqual(s.mine, { webhook: true, hook: true, agent: true, token: false, agent_hook: false })
  assert.deepEqual(s.theirs, ON)
  // Only its reach set again — the address given, a new secret — sends to it.
  const [reached] = await inWorkspaceOf(
    w.h.actor_id,
    w.boss.workspaceId,
    (tx) =>
      tx<
        { new_secret: boolean }[]
      >`select * from agent_reach(${w.mine.agent}, 'webhook', 'https://hooks.example.com/a', 'tuff', 'whs_given_again')`,
  )
  assert.equal(reached!.new_secret, true)
  assert.deepEqual({ ...(await agentHook()) }, { on: true, secret: 'whs_given_again', stopped: false })
})

test('a new token never turns on an agent’s webhook that was off for another reason', async () => {
  const w = await world('offbefore')
  await owner()`update webhook set enabled = false where id = ${w.theirs.agentHook}`
  await asAuthActor(w.boss.ctx.actorId, w.boss.workspaceId, (tx) => tx`select agent_end_tokens(${w.theirs.agent})`)
  const [r] = await owner()<{ on: boolean }[]>`select enabled as on from webhook where id = ${w.theirs.agentHook}`
  assert.equal(r!.on, false)
})

test('the agent list says which agent is stopped, and to its manager that its webhook is, without the address', async () => {
  const w = await world('listed')
  await asAuth((tx) => tx`select auth_claim_email(${w.h.actor_id})`)
  const r = await call('GET', '/api/agents', undefined, w.boss.token)
  assert.equal(r.status, 200)
  const { agents } = (await r.json()) as { agents: { actor_id: string; stopped?: boolean }[] }
  assert.equal(agents.find((a) => a.actor_id === w.mine.agent)?.stopped, true)
  assert.equal(agents.find((a) => a.actor_id === w.theirs.agent)?.stopped, false)
  // Its manager — the account, joined again by its new holder — reads it.
  await owner()`update membership set joined_at = now(), unconfirmed_at = null
                where actor_id = ${w.h.actor_id} and workspace_id = ${w.boss.workspaceId}`
  const mine = await startSession(w.h.actor_id, w.boss.workspaceId, {}, null)
  const seen = (await (await call('GET', '/api/agents', undefined, mine.access_token)).json()) as {
    agents: { actor_id: string; webhook_stopped?: boolean; webhook_url?: string }[]
  }
  const a = seen.agents.find((x) => x.actor_id === w.mine.agent)
  assert.equal(a?.webhook_stopped, true)
  assert.equal(a?.webhook_url, undefined)
})

test('a repository link the holder made stops, and a document they shared to the web in a workspace now waiting is unshared', async () => {
  const w = await world('linked')
  const p = await makeProject(w.boss.ctx, w.boss.workspaceId, 'Linked')
  const install = uuidv7()
  const link = uuidv7()
  await owner()`insert into github_install (id, workspace_id, installation_id, account_login, account_type, installed_by)
                values (${install}, ${w.boss.workspaceId}, ${Math.floor(Math.random() * 1e12)}, 'acme', 'Organization', ${w.boss.ctx.actorId})`
  await owner()`insert into github_link (id, workspace_id, project_id, install_id, repo_id, repo_name, private, linked_by)
                values (${link}, ${w.boss.workspaceId}, ${p}, ${install}, ${Math.floor(Math.random() * 1e12)}, 'acme/web', true, ${w.h.actor_id})`
  const docs = { mine: uuidv7(), theirs: uuidv7() }
  for (const [id, by] of [
    [docs.mine, w.h.actor_id],
    [docs.theirs, w.boss.ctx.actorId],
  ] as const) {
    await owner()`insert into file (id, workspace_id, project_id, author_id, name, body, public_token)
                  values (${id}, ${w.boss.workspaceId}, ${p}, ${by}, 'Shared', '{"type":"doc","content":[]}'::jsonb, ${`pub-${id}`})`
  }
  await asAuth((tx) => tx`select auth_claim_email(${w.h.actor_id})`)
  const [l] = await owner()<{ why: string | null }[]>`select stopped_why as why from github_link where id = ${link}`
  assert.equal(l!.why, 'linker_unproved')
  const shared = await owner()<{ id: string; shared: boolean }[]>`
    select id, public_token is not null as shared from file where id in (${docs.mine}, ${docs.theirs})`
  assert.deepEqual(Object.fromEntries(shared.map((f) => [f.id, f.shared])), { [docs.mine]: false, [docs.theirs]: true })
})

/* ------------------------------------- 3. a request let in before the put-out */

/** A body that arrives only when `go` is called: the request is let in first, then waits. */
function slowBody(json: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(json))
  let go!: () => void
  const gate = new Promise<void>((r) => (go = r))
  const stream = new ReadableStream({
    async pull(ctrl) {
      await gate
      ctrl.enqueue(bytes)
      ctrl.close()
    },
  })
  return { stream, go, length: String(bytes.length) }
}

/** A by-hand account owning a workspace of its own: signs in anywhere, makes webhooks. */
async function byHandOwner() {
  const o = await makeOwner()
  await owner()`update app_user set email_by_hand = true where actor_id = ${o.ctx.actorId}`
  return o
}

/** Sent with its body held back; the account put out while it waits; then the body. */
async function heldBack(token: string, method: string, path: string, json: unknown, actor: string) {
  const { stream, go, length } = slowBody(json)
  const req = app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'content-length': length, authorization: `Bearer ${token}` },
    body: stream,
    duplex: 'half',
  } as RequestInit)
  // Let in: the request is past who is asking before its body is read.
  await new Promise((r) => setTimeout(r, 200))
  await asAuth((tx) => tx`select auth_claim_email(${actor})`)
  go()
  return req
}

test('a webhook made by a request let in before the put-out and written after it is not made', async () => {
  const m = await byHandOwner()
  const r = await heldBack(m.token, 'POST', '/api/webhooks', { url: 'https://93.184.216.34/collect', events: [] }, m.ctx.actorId)
  assert.equal(r.status, 401)
  const rows = await owner()`select id from webhook where workspace_id = ${m.workspaceId} and deleted_at is null`
  assert.equal(rows.length, 0)
})

test('a room hook made by a request let in before the put-out is not made, and no secret is answered', async () => {
  const m = await byHandOwner()
  const p = await makeProject(m.ctx, m.workspaceId, 'Acme')
  const room = uuidv7()
  await withActor(
    m.ctx.actorId,
    (tx) =>
      tx`insert into conversation (id, workspace_id, project_id, name, channel) values (${room}, ${m.workspaceId}, ${p}, 'deploys', true)`,
  )
  const r = await heldBack(m.token, 'POST', `/api/conversations/${room}/hooks`, { name: 'Deploys' }, m.ctx.actorId)
  assert.equal(r.status, 401)
  const rows = await owner()`select id from room_hook where conversation_id = ${room}`
  assert.equal(rows.length, 0)
})

test('a webhook turned on by a request let in before the put-out stays off', async () => {
  const m = await byHandOwner()
  const id = uuidv7()
  await owner()`insert into webhook (id, workspace_id, url, events, secret_enc, created_by, enabled)
                values (${id}, ${m.workspaceId}, 'https://hooks.example.com/w', '{}', 'whs_x', ${m.ctx.actorId}, false)`
  const r = await heldBack(m.token, 'PATCH', `/api/webhooks/${id}`, { enabled: true }, m.ctx.actorId)
  assert.equal(r.status, 401)
  const [w] = await owner()<{ on: boolean }[]>`select enabled as on from webhook where id = ${id}`
  assert.equal(w!.on, false)
})

test('any transaction of a request let in before the put-out is refused — a new token for an agent, a session — and one after goes on', async () => {
  const boss = await makeOwner()
  const m = await byHandOwner()
  const sid = decodeJwt(m.token).sid as string
  await owner()`insert into membership (id, workspace_id, actor_id, role, joined_at)
                values (${uuidv7()}, ${boss.workspaceId}, ${m.ctx.actorId}, 'member', now())`
  const agent = uuidv7()
  await owner()`insert into actor (id, name) values (${agent}, 'Mallory bot')`
  await owner()`insert into agent (actor_id, workspace_id, created_by, reach) values (${agent}, ${boss.workspaceId}, ${m.ctx.actorId}, 'mcp')`
  await owner()`insert into membership (id, workspace_id, actor_id, role, joined_at) values (${uuidv7()}, ${boss.workspaceId}, ${agent}, 'member', now())`
  await asAuth((tx) => tx`select auth_claim_email(${m.ctx.actorId})`)
  // What POST /api/agents/:id/token runs after a check made before the put-out.
  const asTheRequest = <T>(fn: () => Promise<T>) => bounded({ actorId: m.ctx.actorId, tokenProjectIds: [], sessionId: sid }, fn)
  await assert.rejects(
    asTheRequest(() => asAuthActor(m.ctx.actorId, boss.workspaceId, (tx) => tx`select agent_end_tokens(${agent})`)),
    (e: { code?: string }) => e.code === '28000',
  )
  await assert.rejects(
    asTheRequest(() => startSession(m.ctx.actorId, m.workspaceId, {}, null)),
    (e: { code?: string }) => e.code === '28000',
  )
  const [a] = await owner()<{ stopped: boolean }[]>`select stopped_at is not null as stopped from agent where actor_id = ${agent}`
  assert.equal(a!.stopped, true)
  // A session begun after the put-out goes on.
  const after = await startSession(m.ctx.actorId, m.workspaceId, {}, null)
  const later = await bounded({ actorId: m.ctx.actorId, tokenProjectIds: [], sessionId: decodeJwt(after.access_token).sid as string }, () =>
    asAuthActor(m.ctx.actorId, boss.workspaceId, (tx) => tx<{ ok: boolean }[]>`select agent_end_tokens(${agent}) as ok`),
  )
  assert.equal(later[0]!.ok, true)
})

test('a request’s write that holds the account first is seen and stopped by the put-out, which waits for it', async () => {
  const m = await byHandOwner()
  const sid = decodeJwt(m.token).sid as string
  const id = uuidv7()
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  let written!: () => void
  const inserted = new Promise<void>((r) => (written = r))
  const writing = bounded({ actorId: m.ctx.actorId, tokenProjectIds: [], sessionId: sid }, () =>
    inWorkspaceOf(m.ctx.actorId, m.workspaceId, async (tx) => {
      await tx`insert into webhook (id, workspace_id, url, events, secret_enc, created_by)
               values (${id}, ${m.workspaceId}, 'https://hooks.example.com/first', '{}', 'whs_x', ${m.ctx.actorId})`
      written()
      await gate
    }),
  )
  await inserted
  const marker = `put-out-first-${fresh()}`
  const out = claim(m.ctx.actorId, marker)
  assert.ok(await waitingOrDone(marker, out), 'the put-out waits for the request holding the account')
  release()
  await writing
  await out
  const [w] = await owner()<{ on: boolean; stopped: boolean }[]>`
    select enabled as on, stopped_at is not null as stopped from webhook where id = ${id}`
  assert.deepEqual({ ...w }, { on: false, stopped: true })
})

/* --------------------------------------------- 4. tickets, codes, OAuth */

test('a ticket or an OAuth code written in a transaction begun before the put-out is spent; a token dated before it revoked', async () => {
  const boss = await makeOwner()
  const h = await holderIn(boss, 'tickets')
  const before = await checkedNow()
  const writer = await held.reserve()
  const ticket = `tk-${uuidv7()}`
  const code = `cd-${uuidv7()}`
  const client = uuidv7()
  await owner()`insert into oauth_client (id, name, redirect_uris) values (${client}, 'Probe', ${['https://x.example/cb']})`
  try {
    await writer`begin`
    await writer`select now()`
    await claim(h.actor_id, 'put-out-tickets')
    await writer`insert into auth_ticket (token_hash, kind, actor_id, expires_at)
                 values (${ticket}, 'handoff', ${h.actor_id}, now() + interval '2 minutes')`
    await writer`insert into oauth_code (code_hash, workspace_id, client_id, actor_id, redirect_uri, challenge, expires_at)
                 values (${code}, ${h.workspace_id}, ${client}, ${h.actor_id}, 'https://x.example/cb', 'ch', now() + interval '10 minutes')`
    await writer`commit`
  } finally {
    writer.release()
  }
  const [t] = await owner()<{ used: boolean }[]>`select used_at is not null as used from auth_ticket where token_hash = ${ticket}`
  assert.equal(t!.used, true)
  const [c] = await owner()<{ used: boolean }[]>`select used_at is not null as used from oauth_code where code_hash = ${code}`
  assert.equal(c!.used, true)
  // What an OAuth exchange mints, dated from when it took its code: revoked.
  await issueApiToken(h.actor_id, h.workspace_id, 'oauth', [], 30, before)
  const [tok] = await owner()<{ live: boolean }[]>`
    select revoked_at is null as live from api_token where actor_id = ${h.actor_id} and name = 'oauth'`
  assert.equal(tok!.live, false)
})

test('the new owner’s reset ticket, written right after the put-out in the same transaction, is good', async () => {
  const w = await world('instanceticket')
  await owner()
    .begin(async (tx) => {
      await tx`update instance_setting set community = true, claimed_at = null, owner_email = ${w.h.email}`
      const hash = `rs-${uuidv7()}-${'r'.repeat(20)}`
      await tx`select instance_name_owner(${w.h.email}::citext, ${hash})`
      const [t] = await tx<{ used: boolean }[]>`select used_at is not null as used from auth_ticket where token_hash = ${hash}`
      assert.equal(t!.used, false)
      throw new Error('rolled back')
    })
    .catch((e: Error) => assert.equal(e.message, 'rolled back'))
})

/* ------------------------------------------------- 5. an account deleted */

test('an account deleted while a refresh holds its row waits for the refresh instead of deadlocking', async () => {
  const m = await makeOwner()
  const r = await held.reserve()
  const d = await held.reserve()
  let open = 0
  try {
    await r`begin`
    open |= 1
    await r`select 1 from app_user where actor_id = ${m.ctx.actorId} for key share`
    await d`begin`
    open |= 2
    const marker = `deletion-${fresh()}`
    const deleting = d.unsafe(`select account_deletion($1, false) as answer /* ${marker} */`, [m.ctx.actorId]).execute()
    assert.ok(await waitingOrDone(marker, deleting), 'the deletion waits for the row')
    // The refresh goes on to its session, which the deletion has not touched.
    await r`update refresh_session set revoked_at = now() where actor_id = ${m.ctx.actorId} and revoked_at is null`
    await r`commit`
    open &= ~1
    const [answer] = (await deleting) as unknown as { answer: { ok: boolean } }[]
    assert.equal(answer!.answer.ok, true)
    await d`rollback`
    open &= ~2
  } finally {
    if (open & 1) await r`rollback`
    if (open & 2) await d`rollback`
    r.release()
    d.release()
  }
})
