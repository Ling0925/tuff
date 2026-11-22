import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { decodeJwt } from 'jose'
import postgres from 'postgres'
import { app } from '../src/http/routes.js'
import { outbox } from '../src/mail.js'
import { asAuthActor } from '../src/db.js'
import { checkedNow, startSession } from '../src/auth/flows.js'
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
  theirs: { webhook: string; hook: string; agent: string; token: string }
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

test('each is started again by its own press: a webhook turned on, a hook given a new URL, an agent a new token', async () => {
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

  // An admin turns the webhook on.
  assert.equal((await call('PATCH', `/api/webhooks/${w.mine.webhook}`, { enabled: true }, w.boss.token)).status, 200)
  // The owner gives the hook a new URL: started, theirs, the old secret still refused.
  const turned = await call('POST', `/api/hooks/${w.mine.hook}/turn`, undefined, w.boss.token)
  assert.equal(turned.status, 200)
  const url = ((await turned.json()) as { url: string }).url
  assert.equal(await takes(w.mine.hook, url.split('/').at(-1)!), 1)
  assert.equal(await takes(w.mine.hook, `s-${w.mine.hook}`), 0)
  const [hk] = await owner()<{ by: string }[]>`select created_by as by from room_hook where id = ${w.mine.hook}`
  assert.equal(hk!.by, w.boss.ctx.actorId)
  // Its connector — the account, now its new holder's — gives the agent a new token.
  const [ended] = await asAuthActor(
    w.h.actor_id,
    w.boss.workspaceId,
    (tx) => tx<{ ok: boolean }[]>`select agent_end_tokens(${w.mine.agent}) as ok`,
  )
  assert.equal(ended!.ok, true)

  const s = await state(owner(), w)
  assert.deepEqual(s.mine, { webhook: true, hook: true, agent: true, token: false, agent_hook: true })
  assert.deepEqual(s.theirs, ON)
})

test('an agent list says which agent is stopped', async () => {
  const w = await world('listed')
  await asAuth((tx) => tx`select auth_claim_email(${w.h.actor_id})`)
  const r = await call('GET', '/api/agents', undefined, w.boss.token)
  assert.equal(r.status, 200)
  const { agents } = (await r.json()) as { agents: { actor_id: string; stopped?: boolean }[] }
  assert.equal(agents.find((a) => a.actor_id === w.mine.agent)?.stopped, true)
  assert.equal(agents.find((a) => a.actor_id === w.theirs.agent)?.stopped, false)
})

test('a webhook, a hook or an agent the holder made in flight is written off or stopped', async () => {
  const boss = await makeOwner()
  const h = await holderIn(boss, 'madeinflight')
  const signIn = await held.reserve()
  const putOut = await held.reserve()
  const ids = { webhook: uuidv7(), agent: uuidv7() }
  await owner()`insert into actor (id, name) values (${ids.agent}, 'Late agent')`
  let opened = 0
  try {
    await signIn`begin`
    await signIn`select now()`
    opened |= 1
    await putOut`begin`
    opened |= 2
    await putOut`select auth_claim_email(${h.actor_id})`
    const writing = (async () => {
      await signIn`insert into webhook (id, workspace_id, url, events, secret_enc, created_by)
                   values (${ids.webhook}, ${boss.workspaceId}, 'https://hooks.example.com/late', '{}', 'whs_x', ${h.actor_id})`
      await signIn`insert into agent (actor_id, workspace_id, created_by, reach) values (${ids.agent}, ${boss.workspaceId}, ${h.actor_id}, 'mcp')`
      await signIn`insert into membership (id, workspace_id, actor_id, role, joined_at)
                   values (${uuidv7()}, ${boss.workspaceId}, ${ids.agent}, 'member', now())`
    })()
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
  const [r] = await owner()<{ webhook: boolean; agent: boolean }[]>`
    select (select enabled from webhook where id = ${ids.webhook}) as webhook,
           (select stopped_at is not null from agent where actor_id = ${ids.agent}) as agent`
  assert.deepEqual({ ...r }, { webhook: false, agent: true })
})
