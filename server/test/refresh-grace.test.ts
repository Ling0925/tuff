import { test, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { decodeJwt } from 'jose'
import { app } from '../src/http/routes.js'
import { refreshGrace, registerUser } from '../src/auth/flows.js'
import { hashToken } from '../src/auth/crypto.js'
import { asAuth, asTableOwner, asWorker, closeDb, stamp, uuidv7, withoutActor } from './helpers.js'

/*
 * A refresh asked again — migrations 312 and 312b.
 *
 * A token spent a moment ago, presented again by the same browser, is
 * answered with the session it was spent for while that session is live;
 * after the window, from another browser, or after a sign-out, it is
 * refused as a spent token always was. The window is shortened through
 * `refreshGrace` and spendings are aged as the tables' owner: nothing here
 * waits on a clock.
 */

after(closeDb)
const GRACE = refreshGrace.seconds
afterEach(() => {
  refreshGrace.seconds = GRACE
})

const PASSWORD = 'correct-horse-battery-staple'
const owner = asTableOwner()
type Pair = { access_token: string; refresh_token: string }

const post = (path: string, body: unknown, device?: string) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(device ? { 'x-device': device } : {}) },
    body: JSON.stringify(body),
  })
const me = (token: string) => app.request('/api/me', { headers: { authorization: `Bearer ${token}` } })
const renew = (refresh_token: string, device?: string) => post('/auth/refresh', { refresh_token }, device)
const sidOf = (access: string) => decodeJwt(access).sid as string

async function signedIn(tag: string, device?: string): Promise<Pair & { actorId: string }> {
  const email = `${tag}${stamp()}@example.com`
  const made = await registerUser({ email, password: PASSWORD, name: 'Sam', workspace_name: `${tag} ws` })
  const r = await post('/auth/login', { email, password: PASSWORD }, device)
  assert.equal(r.status, 200, await r.clone().text())
  return { ...((await r.json()) as Pair), actorId: made.actor_id }
}

async function renewed(refresh_token: string, device?: string): Promise<Pair> {
  const r = await renew(refresh_token, device)
  assert.equal(r.status, 200, await r.clone().text())
  return (await r.json()) as Pair
}

const refused = (e: unknown) => (e as { code?: string }).code === '42501'

test('asked again within the window, the same session comes back; after it, refused', async () => {
  const device = `grace-${stamp()}`
  const first = await signedIn('again', device)
  const next = await renewed(first.refresh_token, device)

  const again = await renewed(first.refresh_token, device)
  assert.equal(again.refresh_token, next.refresh_token, 'the same refresh token, not a second session')
  assert.equal(sidOf(again.access_token), sidOf(next.access_token), 'for the same session')
  assert.equal((await me(again.access_token)).status, 200)
  const [n] = await owner<{ n: number }[]>`
    select count(*)::int as n from refresh_session where actor_id = ${first.actorId} and traded_from is not null`
  assert.equal(n!.n, 1, 'one successor, nothing more')

  // The window shortened to nothing: refused.
  refreshGrace.seconds = 0
  assert.equal((await renew(first.refresh_token, device)).status, 401)
  refreshGrace.seconds = GRACE

  // Spent eleven seconds ago: refused — and the database takes no longer
  // window than ten seconds whatever the sign-in code asks for.
  await owner`update refresh_session set revoked_at = now() - interval '11 seconds' where token_hash = ${hashToken(first.refresh_token)}`
  assert.equal((await renew(first.refresh_token, device)).status, 401)
  const wide = await asAuth((tx) => tx`select * from auth_refresh_again(${hashToken(first.refresh_token)}, ${device}, interval '1 hour')`)
  assert.equal(wide.length, 0)

  // The successor is untouched by any of it.
  assert.equal((await me(next.access_token)).status, 200)
  await renewed(next.refresh_token, device)
})

test('two refreshes with one token at once end on one session', async () => {
  for (let i = 0; i < 6; i++) {
    const device = `race-${i}-${stamp()}`
    const first = await signedIn(`race${i}`, device)
    const [a, b] = await Promise.all([renew(first.refresh_token, device), renew(first.refresh_token, device)])
    assert.equal(a.status, 200, await a.clone().text())
    assert.equal(b.status, 200, await b.clone().text())
    const [x, y] = [(await a.json()) as Pair, (await b.json()) as Pair]
    assert.equal(x.refresh_token, y.refresh_token)
    assert.equal(sidOf(x.access_token), sidOf(y.access_token))
    const [n] = await owner<{ n: number }[]>`
      select count(*)::int as n from refresh_session where actor_id = ${first.actorId} and traded_from is not null`
    assert.equal(n!.n, 1, 'one successor')
    // And it is a session that renews.
    await renewed(x.refresh_token, device)
  }
})

test('signing out in the window is not undone', async () => {
  // With the new token: the browser's sessions end, and the spent one gets nothing back.
  const device = `out-${stamp()}`
  const first = await signedIn('outnew', device)
  const next = await renewed(first.refresh_token, device)
  assert.equal((await post('/auth/logout', { refresh_token: next.refresh_token })).status, 200)
  assert.equal((await renew(first.refresh_token, device)).status, 401)
  assert.equal((await me(next.access_token)).status, 401)

  // With the spent one, from a client that sends no device: the line ends,
  // the successor with it.
  const bare = await signedIn('outspent')
  const after = await renewed(bare.refresh_token)
  assert.equal((await post('/auth/logout', { refresh_token: bare.refresh_token })).status, 200)
  assert.equal((await renew(bare.refresh_token)).status, 401)
  assert.equal((await me(after.access_token)).status, 401)
  assert.equal((await renew(after.refresh_token)).status, 401)
})

/*
 * A refresh holds the spent row from its spend to its commit, with the
 * successor it is writing. Here a connection of the owner's is that
 * refresh, held open while the sign-out is sent: the sign-out must wait
 * for it and end the successor too. Read without waiting, its update ran
 * on a snapshot from before the commit and left the successor live.
 */
test('signing out while a refresh of the same token is in flight ends what that refresh writes', async () => {
  const first = await signedIn('inflight')
  const [s0] = await owner<{ id: string; workspace_id: string; family: string }[]>`
    select id, workspace_id, coalesce(family, id) as family from refresh_session
    where token_hash = ${hashToken(first.refresh_token)}`
  const next = uuidv7()
  const held = await owner.reserve()
  let open = false
  try {
    await held`begin`
    open = true
    await held`update refresh_session set revoked_at = now() where id = ${s0!.id}`
    await held`
      insert into refresh_session (id, actor_id, workspace_id, token_hash, expires_at, family, traded_from)
      values (${next}, ${first.actorId}, ${s0!.workspace_id}, ${`inflight-${next}`}, now() + interval '30 days',
              ${s0!.family}, ${s0!.id})`
    const out = post('/auth/logout', { refresh_token: first.refresh_token })
    // Until the sign-out is waiting on the refresh's lock — a condition, not a clock.
    let waiting = false
    for (let i = 0; i < 400 && !waiting; i++) {
      const [w] = await owner<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock' and query like '%auth_end_session%'`
      waiting = w!.n > 0
      if (!waiting) await new Promise((r) => setTimeout(r, 25))
    }
    assert.ok(waiting, 'the sign-out waits for the refresh in flight')
    await held`commit`
    open = false
    assert.equal((await out).status, 200)
  } finally {
    if (open) await held`rollback`
    held.release()
  }
  const [n] = await owner<{ ended: boolean }[]>`select ended_at is not null as ended from refresh_session where id = ${next}`
  assert.equal(n!.ended, true, 'the session the refresh wrote is ended with the rest')
})

test('another browser gets nothing from this one’s window', async () => {
  const device = `mine-${stamp()}`
  const first = await signedIn('device', device)
  const next = await renewed(first.refresh_token, device)
  assert.equal((await renew(first.refresh_token, `theirs-${stamp()}`)).status, 401, 'another device')
  assert.equal((await renew(first.refresh_token)).status, 401, 'no device')
  // Still within the window for the browser it was spent from.
  assert.equal((await renewed(first.refresh_token, device)).refresh_token, next.refresh_token)

  // Traded by another device first, the session is that device's: the
  // browser the token came from gets nothing of it either.
  const second = await signedIn('device2', device)
  await renewed(second.refresh_token, `thief-${stamp()}`)
  assert.equal((await renew(second.refresh_token, device)).status, 401)
})

test('a successor already spent is not handed back', async () => {
  const device = `chain-${stamp()}`
  const first = await signedIn('chain', device)
  const next = await renewed(first.refresh_token, device)
  const third = await renewed(next.refresh_token, device)
  assert.equal((await renew(first.refresh_token, device)).status, 401)
  // Its own window still answers.
  assert.equal((await renewed(next.refresh_token, device)).refresh_token, third.refresh_token)
})

test('the application role runs neither the window nor the sweep, and the sign-in role not the sweep', async () => {
  await assert.rejects(
    withoutActor((tx) => tx`select * from auth_refresh_again(null::text, null::text, null::interval)`),
    refused,
  )
  await assert.rejects(
    withoutActor((tx) => tx`select refresh_session_sweep(null::int)`),
    refused,
  )
  await assert.rejects(
    asAuth((tx) => tx`select refresh_session_sweep(null::int)`),
    refused,
  )
  const [g] = await owner<{ sweep: boolean; again: boolean }[]>`
    select has_function_privilege('tracker_worker', 'refresh_session_sweep(int)', 'execute') as sweep,
           has_function_privilege('tracker_worker', 'auth_refresh_again(text, text, interval)', 'execute') as again`
  assert.deepEqual({ ...g }, { sweep: true, again: false })
})

test('the sweep takes week-old spent rows and expired ones, and keeps what is read', async () => {
  const who = await signedIn('sweep')
  const [ws] = await owner<{ id: string }[]>`select workspace_id as id from refresh_session where actor_id = ${who.actorId} limit 1`
  const d1 = `d1-${stamp()}`
  const d2 = `d2-${stamp()}`
  const d3 = `d3-${stamp()}`
  const rows: Record<string, { device: string | null; age: string; expires: string; revoked: string | null; ended: string | null }> = {
    live: { device: d1, age: '1 hour', expires: '+29 days', revoked: null, ended: null },
    tradedLongAgo: { device: d1, age: '10 days', expires: '+20 days', revoked: '8 days', ended: null },
    tradedEndedLater: { device: d1, age: '10 days', expires: '+20 days', revoked: '9 days', ended: '8 days' },
    tradedYesterday: { device: d1, age: '2 days', expires: '+28 days', revoked: '1 day', ended: null },
    endedLive: { device: d1, age: '10 days', expires: '+20 days', revoked: '8 days', ended: '8 days' },
    endedLiveRunOut: { device: d1, age: '40 days', expires: '-8 days', revoked: '20 days', ended: '20 days' },
    newestOfItsDevice: { device: d2, age: '40 days', expires: '-8 days', revoked: null, ended: null },
    expiredNoDevice: { device: null, age: '40 days', expires: '-8 days', revoked: null, ended: null },
    onlyRowOfItsDevice: { device: d3, age: '10 days', expires: '+20 days', revoked: '8 days', ended: null },
  }
  const ids: Record<string, string> = {}
  for (const [name, r] of Object.entries(rows)) {
    const id = uuidv7()
    ids[name] = id
    await owner`
      insert into refresh_session (id, actor_id, workspace_id, token_hash, device, created_at, expires_at, revoked_at, ended_at)
      values (${id}, ${who.actorId}, ${ws!.id}, ${`sweep-${id}`}, ${r.device},
              now() - ${r.age}::interval,
              now() + ${r.expires.replace('+', '')}::interval,
              now() - ${r.revoked}::interval,
              now() - ${r.ended}::interval)`
  }
  for (let i = 0; i < 1000; i++) {
    const [r] = await asWorker((tx) => tx<{ n: number }[]>`select refresh_session_sweep(5000) as n`)
    if (r!.n < 5000) break
  }
  const left = await owner<{ id: string }[]>`select id from refresh_session where id = any (${Object.values(ids)})`
  const kept = new Set(left.map((r) => r.id))
  const named = Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, kept.has(id)]))
  assert.deepEqual(named, {
    live: true,
    tradedLongAgo: false,
    tradedEndedLater: false,
    tradedYesterday: true,
    endedLive: true,
    endedLiveRunOut: false,
    newestOfItsDevice: true,
    expiredNoDevice: false,
    onlyRowOfItsDevice: true,
  })
  // The person's own sign-in is live and stays, and still renews.
  await renewed(who.refresh_token)
  // A device whose every row is old is still known to the account.
  const [u] = await owner<{ email: string }[]>`select email::text as email from app_user where actor_id = ${who.actorId}`
  const [k] = await owner<{ known: boolean }[]>`select auth_device_known(${u!.email}::citext, ${d3}) as known`
  assert.equal(k!.known, true)
  // And a call asks for no more than its cap.
  const [none] = await asWorker((tx) => tx<{ n: number }[]>`select refresh_session_sweep(-1) as n`)
  assert.equal(none!.n, 0)
})
