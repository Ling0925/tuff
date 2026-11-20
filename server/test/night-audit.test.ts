import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app } from '../src/http/routes.js'
import { closeRealtime } from '../src/realtime.js'
import { authenticate } from '../src/auth/context.js'
import { registerUser, secondFactor } from '../src/auth/flows.js'
import { tokenHears } from '../src/listening.js'
import { pixelsOf } from '../src/pixels.js'
import { networkOf } from '../src/http/oauth.js'
import { setMarkdownPool, TooComplex } from '../src/mcp/markdownPool.js'
import type { Tx } from '../src/db.js'
import {
  addPerson,
  asTableOwner,
  asWorker,
  bearerFor,
  closeDb,
  inWorkspace,
  makeOwner,
  makeProject,
  stamp,
  uuidv7,
  withoutActor,
} from './helpers.js'

/*
 * The night audit of 20 November 2026 — each of its probes, as
 * the behaviour that answers it. The sockets' own (4 and 11, through the real server) are
 * `night-audit-sockets.test.ts`; the definer functions' search path is
 * `definer-search-path.test.ts`.
 */

after(async () => {
  await closeRealtime()
  await closeDb()
})

type J = Record<string, any>
async function call(method: string, path: string, token: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const r = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await r.text()
  let parsed: J = {}
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { raw: text }
  }
  return { status: r.status, body: parsed }
}

const HOOK = 'https://93.184.215.14/night'

/* ------------------------------------------------------------------ 4 */

test('a token made for its whole workspace hears only that workspace on /ws/me (4)', async () => {
  // P owns A and is a member of B, on one of its projects.
  const a = await makeOwner()
  const b = await makeOwner()
  const P = a.ctx.actorId
  const aProject = await makeProject(a.ctx, a.workspaceId, 'A work')
  const bProject = await makeProject(b.ctx, b.workspaceId, 'B work')
  await asTableOwner()`insert into membership (id, workspace_id, actor_id, role, joined_at)
                       values (${uuidv7()}, ${b.workspaceId}, ${P}, 'member'::role_kind, now())`
  await asTableOwner()`insert into project_member (id, workspace_id, project_id, actor_id, added_by)
                       values (${uuidv7()}, ${b.workspaceId}, ${bProject}, ${P}, ${b.ctx.actorId})`
  const mate = await addPerson(a.ctx, a.workspaceId, 'member', [aProject])
  const mateToken = await bearerFor(mate.actorId, a.workspaceId)

  const made = await call('POST', '/api/tokens', a.token, { name: 'tool for A' })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const ctx = await authenticate(`Bearer ${made.body.token}`)
  assert.ok(ctx?.tokenId && ctx.tokenProjectIds.length === 0)

  // Somebody gives P work and writes to them, in A and in B.
  const aTask = (await call('POST', `/api/projects/${aProject}/tasks`, mateToken, { title: 'A task', assignee_ids: [P] })).body.id
  const bTask = (await call('POST', `/api/projects/${bProject}/tasks`, b.token, { title: 'B task', assignee_ids: [P] })).body.id
  const aRoom = (await call('POST', '/api/conversations/direct', mateToken, { actor_ids: [P] })).body.id
  const bRoom = (await call('POST', '/api/conversations/direct', b.token, { actor_ids: [P] })).body.id
  assert.ok(aTask && bTask && aRoom && bRoom)

  /* Every word on the topic says the workspace it was said in. */
  const said = (ws: string) => (kind: string, payload: object) => tokenHears(ctx, { kind, payload: { ...payload, workspace_id: ws } })
  const inA = said(a.workspaceId)
  const inB = said(b.workspaceId)
  assert.equal(await inA('notification', { reason: 'assigned', object_type: 'task', object_id: aTask }), true)
  assert.equal(await inB('notification', { reason: 'assigned', object_type: 'task', object_id: bTask }), false)
  // A word claiming A about B's task is still asked of its object.
  assert.equal(await inA('notification', { reason: 'assigned', object_type: 'task', object_id: bTask }), false)
  assert.equal(await inA('message', { conversation_id: aRoom }), true)
  assert.equal(await inB('message', { conversation_id: bRoom }), false)
  assert.equal(await inB('read', { conversation_id: bRoom }), false)
  assert.equal(await inA('notification', { reason: 'joined', object_type: 'actor', object_id: mate.actorId }), true)
  // Somebody of A joining B is B's news, not A's.
  assert.equal(await inB('notification', { reason: 'joined', object_type: 'actor', object_id: mate.actorId }), false)
  assert.equal(await inB('notification', { reason: 'assigned', object_type: 'project', object_id: bProject }), false)
  // A word that says no workspace is not heard.
  assert.equal(
    await tokenHears(ctx, { kind: 'notification', payload: { reason: 'assigned', object_type: 'task', object_id: aTask } }),
    false,
  )

  // Its person's read marks: A's notes, not B's, and not "everything".
  const own = asTableOwner()
  const [noteA] = await own`select id from notification where actor_id = ${P} and workspace_id = ${a.workspaceId} limit 1`
  const [noteB] = await own`select id from notification where actor_id = ${P} and workspace_id = ${b.workspaceId} limit 1`
  assert.ok(noteA && noteB, 'both workspaces wrote P a note')
  assert.equal(await inA('read', { id: noteA.id }), true)
  assert.equal(await inB('read', { id: noteB.id }), false)
  assert.equal(await inA('read', {}), false)
})

/* ------------------------------------------------------------------ 7 */

const PASSWORD = 'correct-horse-battery-staple'

/** The same maths the verifier uses, written out — `totp.test.ts`. */
function code(secret: string, step = 0): string {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of secret) bits += B32.indexOf(ch).toString(2).padStart(5, '0')
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30) + step))
  const mac = createHmac('sha1', Buffer.from(bytes)).update(buf).digest()
  const offset = mac[mac.length - 1]! & 0x0f
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

test('a passcode is taken once: at signing in, at a re-ask, and the one that turned it on (7)', async () => {
  const email = `totp${stamp()}@example.com`
  const u = await registerUser({ email, password: PASSWORD, name: 'T', workspace_name: `T ${stamp().slice(0, 4)}` })
  const begun = await call('POST', '/api/2fa/begin', u.access_token, { password: PASSWORD })
  assert.equal(begun.status, 200, JSON.stringify(begun.body))
  const secret = begun.body.secret as string
  const now = code(secret)
  assert.equal((await call('POST', '/api/2fa/enable', u.access_token, { code: now })).status, 200)

  const login = (totp: string) => call('POST', '/auth/login', null, { email, password: PASSWORD, totp })
  // The code that turned it on was spent turning it on.
  const again = await login(now)
  assert.equal(again.status, 401)
  assert.equal(again.body.access_token, undefined)

  // The next one signs in once, and not twice.
  const next = code(secret, 1)
  const first = await login(next)
  assert.equal(first.status, 200, JSON.stringify(first.body))
  assert.ok(first.body.access_token)
  const second = await login(next)
  assert.equal(second.status, 401)
  assert.equal(second.body.access_token, undefined)

  // Nor is it taken by a door that asks again — turning the factor off.
  const off = await call('POST', '/api/2fa/disable', first.body.access_token, { password: PASSWORD, code: next })
  assert.equal(off.status, 403)
  assert.equal(off.body.error?.code, 'wrong_code')

  // A step that is not one of now's is never kept: kept, it would refuse
  // every code the authenticator ever showed again (the review, F2).
  const far = await withoutActor((tx) => tx<{ ok: boolean }[]>`select auth_totp_spend(${u.actor_id}, 9000000000000000000) as ok`)
  assert.equal(far[0]?.ok, false)
  const [kept] = await asTableOwner()<
    { step: string | null }[]
  >`select totp_last_step::text as step from app_user where actor_id = ${u.actor_id}`
  assert.notEqual(kept?.step, '9000000000000000000')

  // Two at once with one good code: one yes.
  await asTableOwner()`update app_user set totp_last_step = null where actor_id = ${u.actor_id}`
  const both = await Promise.all([secondFactor(u.actor_id, email, next), secondFactor(u.actor_id, email, next)])
  assert.deepEqual([...both].sort(), [false, true])
})

/* ------------------------------------------------------------------ 9 */

test('the webhook queue goes round the workspaces, ten of one at most a pass (9)', async () => {
  const a = await makeOwner()
  const b = await makeOwner()
  const urlA = `https://slow.example.com/${stamp()}`
  const urlB = `https://b.example.com/${stamp()}`
  /* All of it inside one transaction that is rolled back: the rows are the
     oldest in the instance and nobody's worker may see them, claim them or
     send them anywhere. */
  const ROLLBACK = new Error('rolled back')
  let ours: string[] = []
  await asTableOwner()
    .begin(async (tx) => {
      const hookA = uuidv7()
      const hookB = uuidv7()
      await tx`insert into webhook (id, workspace_id, url, events, secret_enc, created_by)
               values (${hookA}, ${a.workspaceId}, ${urlA}, '{}', 'whs_x', ${a.ctx.actorId}),
                      (${hookB}, ${b.workspaceId}, ${urlB}, '{}', 'whs_x', ${b.ctx.actorId})`
      // Sixty of A's, the oldest of everything, then one of B's a second later.
      await tx`insert into webhook_delivery (id, workspace_id, webhook_id, event, payload, deliver_after)
               select gen_random_uuid(), ${a.workspaceId}, ${hookA}, 'task.create', '{}'::jsonb,
                      timestamptz '2000-01-01 00:00:00+00' + make_interval(secs => i / 1000.0)
               from generate_series(1, 60) i`
      await tx`insert into webhook_delivery (id, workspace_id, webhook_id, event, payload, deliver_after)
               values (gen_random_uuid(), ${b.workspaceId}, ${hookB}, 'task.create', '{}'::jsonb, timestamptz '2000-01-01 00:00:01+00')`
      const due = await tx<{ url: string }[]>`select url from due_webhook_deliveries(1000, null, 10)`
      ours = due.map((d) => d.url).filter((u) => u === urlA || u === urlB)
      throw ROLLBACK
    })
    .catch((e: unknown) => {
      if (e !== ROLLBACK) throw e
    })
  assert.equal(ours.filter((u) => u === urlA).length, 10)
  // A's oldest, then B's: its one delivery is in the first round, not behind A's backlog.
  assert.equal(ours.indexOf(urlB), 1)
})

test('a workspace has twenty webhooks of its own at most, and an agent’s is not one of them (9)', async () => {
  const o = await makeOwner()
  const p = await makeProject(o.ctx, o.workspaceId, 'Hooks')
  try {
    const made: string[] = []
    for (let i = 0; i < 20; i++) {
      const r = await call('POST', '/api/webhooks', o.token, { url: `${HOOK}/${i}` })
      assert.equal(r.status, 201, JSON.stringify(r.body))
      made.push(r.body.id)
    }
    // Turned off still counts: it is still a webhook.
    assert.equal((await call('PATCH', `/api/webhooks/${made[0]}`, o.token, { enabled: false })).status, 200)
    const over = await call('POST', '/api/webhooks', o.token, { url: `${HOOK}/20` })
    assert.equal(over.status, 409)
    assert.equal(over.body.error?.code, 'too_many_webhooks')
    assert.equal(((await call('GET', '/api/webhooks', o.token)).body.webhooks as unknown[]).length, 20)

    const agent = await call('POST', '/api/agents', o.token, { name: 'Hooked', project_ids: [p], reach: 'webhook', url: HOOK })
    assert.equal(agent.status, 201, JSON.stringify(agent.body))

    // Deleted, it makes room.
    assert.equal((await call('DELETE', `/api/webhooks/${made[1]}`, o.token)).status, 200)
    assert.equal((await call('POST', '/api/webhooks', o.token, { url: `${HOOK}/21` })).status, 201)

    // Twenty again: bringing the deleted one back is a twenty-first too, and
    // taking one from an agent the same (the review, F3).
    await assert.rejects(asTableOwner()`update webhook set deleted_at = null where id = ${made[1]!}`, /twenty webhooks at most/)
    await assert.rejects(
      asTableOwner()`update webhook set agent_id = null where workspace_id = ${o.workspaceId} and agent_id is not null`,
      /twenty webhooks at most/,
    )
    // One of the twenty changed is not refused.
    assert.equal((await call('PATCH', `/api/webhooks/${made[2]}`, o.token, { events: ['task.create'] })).status, 200)
    assert.equal((await call('DELETE', `/api/webhooks/${made[3]}`, o.token)).status, 200)
  } finally {
    await asTableOwner()`update webhook set enabled = false where workspace_id = ${o.workspaceId}`
  }
})

/* ----------------------------------------------------------------- 12 */

test('an MCP body spends the token’s minute before it is read, and is read under its person’s key (12)', async () => {
  const seen: (string | undefined)[] = []
  await setMarkdownPool({
    read(_text: string, who?: string) {
      seen.push(who)
      return Promise.reject(new TooComplex())
    },
    async close() {},
  })
  try {
    const o = await makeOwner()
    const tok = (await call('POST', '/api/tokens', o.token, { name: 'mcp' })).body.token as string
    const ctx = await authenticate(`Bearer ${tok}`)
    assert.ok(ctx?.tokenId)
    const key = `t:${ctx.tokenId}`
    let n = 0
    const one = async () => {
      const r = await app.request('/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${tok}` },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: ++n,
          method: 'tools/call',
          params: { name: 'update_message', arguments: { message_id: uuidv7(), body: 'hello **there**' } },
        }),
      })
      return (await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }
    }
    const spent = async () =>
      (await asTableOwner()<{ n: number }[]>`select coalesce(sum(hits), 0)::int as n from rate_window where key = ${key}`)[0]!.n

    await Promise.all(Array.from({ length: 5 }, () => one()))
    assert.equal(seen.length, 5)
    assert.deepEqual([...new Set(seen)], [`person:${o.ctx.actorId}`])
    // Each body spent one request before it was read; refused as too complex, nothing else did.
    assert.equal(await spent(), 5)

    // Past the token's minute, the body is not read at all.
    await asTableOwner()`
      insert into rate_window (key, window_start, hits)
      select ${key}, to_timestamp(floor(extract(epoch from now()) / 60) * 60) + make_interval(secs => s), 100000
      from (values (0), (60)) v(s)
      on conflict (key, window_start) do update set hits = 100000`
    seen.length = 0
    const refused = await one()
    assert.equal(refused.result.isError, true)
    assert.match(refused.result.content[0]!.text, /rate_limited/)
    assert.equal(seen.length, 0)
  } finally {
    await setMarkdownPool(null)
  }
})

/* ----------------------------------------------------------------- 13 */

test('an IPv6 address is one network of 2⁶⁴ at OAuth registration (13)', async () => {
  assert.equal(networkOf('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64')
  assert.equal(networkOf('2001:db8:1:2::ffff'), '2001:db8:1:2::/64')
  assert.equal(networkOf('[2001:0DB8:0001:0002::1]'), '2001:db8:1:2::/64')
  assert.equal(networkOf('2001:db8::1'), '2001:db8:0:0::/64')
  assert.equal(networkOf('fe80::1%en0'), 'fe80:0:0:0::/64')
  assert.equal(networkOf('::ffff:192.0.2.7'), '192.0.2.7')
  assert.equal(networkOf('192.0.2.7'), '192.0.2.7')
  assert.equal(networkOf('local'), 'local')

  const tag = `night13-${stamp()}`
  const hex = () => Math.floor(Math.random() * 0xffff).toString(16)
  const net = `2001:db8:${hex()}:${hex()}`
  try {
    const statuses: number[] = []
    for (let i = 1; i <= 31; i++) {
      const r = await app.request('/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `${net}::${i.toString(16)}, 10.0.0.1` },
        body: JSON.stringify({ client_name: tag, redirect_uris: ['https://agent.example/cb'] }),
      })
      statuses.push(r.status)
    }
    assert.deepEqual(statuses.slice(0, 30), new Array(30).fill(201))
    assert.equal(statuses[30], 429)
  } finally {
    await asTableOwner()`delete from oauth_client where name = ${tag}`
  }
})

test('the clear-out removes OAuth clients nothing has named for a week, and only those (13)', async () => {
  const own = asTableOwner()
  const tag = `night13c-${stamp()}`
  const old = uuidv7()
  const fresh = uuidv7()
  const used = uuidv7()
  const o = await makeOwner()
  await own`insert into oauth_client (id, name, redirect_uris, created_at) values
              (${old}, ${tag}, '{https://agent.example/cb}', now() - interval '8 days'),
              (${fresh}, ${tag}, '{https://agent.example/cb}', now() - interval '1 day'),
              (${used}, ${tag}, '{https://agent.example/cb}', now() - interval '8 days')`
  await own`insert into oauth_code (code_hash, workspace_id, client_id, actor_id, redirect_uri, challenge, expires_at)
            values (${`night-${stamp()}`}, ${o.workspaceId}, ${used}, ${o.ctx.actorId}, 'https://agent.example/cb', 'c', now())`
  try {
    // As the worker's clear-out calls it, under the worker's own role.
    const [r] = await asWorker((tx) => tx<{ n: number }[]>`select oauth_clients_clear() as n`)
    assert.ok(r!.n >= 1)
    const left = (await own<{ id: string }[]>`select id from oauth_client where name = ${tag}`).map((x) => x.id).sort()
    assert.deepEqual(left, [fresh, used].sort())
  } finally {
    await own`delete from oauth_code where client_id = ${used}`
    await own`delete from oauth_client where name = ${tag}`
  }
})

/* ----------------------------------------------------------------- 14 */

test('a PNG past the format’s bounds has no size, and an upload that fails leaves no bytes behind (14)', async () => {
  const png = (width: number) => {
    const b = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 0, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0, 0, 0,
      0,
    ])
    b.writeUInt32BE(width, 16)
    return b
  }
  assert.equal(pixelsOf(png(0x80000000)), null)
  assert.equal(pixelsOf(png(0)), null)
  assert.deepEqual(pixelsOf(png(0x7fffffff)), { width: 0x7fffffff, height: 1 })

  const o = await makeOwner()
  const p = await makeProject(o.ctx, o.workspaceId, 'Uploads')
  const m = await addPerson(o.ctx, o.workspaceId, 'member', [p])
  const bearer = await bearerFor(m.actorId, o.workspaceId)
  const dir = join(resolve(process.env.STORAGE_DIR ?? '.storage'), o.workspaceId)
  const objects = () => (existsSync(dir) ? readdirSync(dir).length : 0)
  const rows = async () =>
    (
      await asTableOwner()<
        { n: number }[]
      >`select count(*)::int as n from file where workspace_id = ${o.workspaceId} and storage_key is not null`
    )[0]!.n
  const send = (bytes: Buffer, name: string, type: string) => {
    const form = new FormData()
    form.set('file', new File([new Uint8Array(bytes)], name, { type }))
    return app.request(`/api/projects/${p}/uploads`, { method: 'POST', headers: { authorization: `Bearer ${bearer}` }, body: form })
  }

  // The probe's file: taken, with no size, and its bytes named by its row.
  const crafted = await send(png(0x80000000), 'big.png', 'image/png')
  assert.equal(crafted.status, 201)
  const { id } = (await crafted.json()) as { id: string }
  const [row] = await asTableOwner()`select pixel_width, pixel_height from file where id = ${id}`
  assert.deepEqual({ ...row }, { pixel_width: null, pixel_height: null })
  assert.equal(objects(), await rows())

  // Anything failing after the store takes the bytes back out: a name the
  // database refuses fails the insert.
  const before = objects()
  const broken = await send(Buffer.from('hello'), 'bad\u0000name.txt', 'text/plain')
  assert.notEqual(broken.status, 201)
  assert.equal(objects(), before)
  assert.equal(objects(), await rows())
})

/* ------------------------------------------------------------------ A */

test('an agent’s webhook is not the owner’s to read or rewrite through the table (A)', async () => {
  const boss = await makeOwner()
  const p = await makeProject(boss.ctx, boss.workspaceId, 'Agentic')
  const made = await call('POST', '/api/agents', boss.token, { name: 'Hooked', project_ids: [p], reach: 'webhook', url: HOOK })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const agent = made.body.agent_id as string
  const own = asTableOwner()
  try {
    const [hook] = await own<{ id: string; url: string }[]>`select id, url from webhook where agent_id = ${agent}`
    assert.ok(hook)
    const as = <T>(fn: (tx: Tx) => Promise<T>) => inWorkspace(boss.ctx.actorId, boss.workspaceId, fn)

    assert.equal((await as((tx) => tx`select id from webhook where agent_id = ${agent}`)).length, 0)
    const changed = await as(
      (tx) => tx`update webhook set url = 'https://198.51.100.7/elsewhere', enabled = false where id = ${hook.id} returning id`,
    )
    assert.equal(changed.length, 0)
    await assert.rejects(
      as(
        (tx) => tx`insert into webhook (id, workspace_id, url, events, secret_enc, created_by, agent_id)
                   values (${uuidv7()}, ${boss.workspaceId}, 'https://198.51.100.7/x', '{}', 'whs_x', ${boss.ctx.actorId}, ${agent})`,
      ),
    )
    const [still] = await own`select url, enabled from webhook where id = ${hook.id}`
    assert.deepEqual({ ...still }, { url: HOOK, enabled: true })

    // Its own routes, which ask who manages it, still reach it.
    const listed = (await call('GET', '/api/agents', boss.token)).body.agents as { actor_id: string; webhook_url?: string }[]
    assert.equal(listed.find((g) => g.actor_id === agent)?.webhook_url, HOOK)
    const moved = await call('PUT', `/api/agents/${agent}/reach`, boss.token, { reach: 'webhook', url: `${HOOK}/moved` })
    assert.equal(moved.status, 200, JSON.stringify(moved.body))
    const [now] = await own`select url from webhook where agent_id = ${agent} and deleted_at is null`
    assert.equal(now?.url, `${HOOK}/moved`)
    // And the workspace's own webhooks are the owner's as they were.
    const mine = await call('POST', '/api/webhooks', boss.token, { url: `${HOOK}/workspace` })
    assert.equal(mine.status, 201)
    assert.equal((await call('PATCH', `/api/webhooks/${mine.body.id}`, boss.token, { enabled: false })).status, 200)
  } finally {
    await own`update webhook set enabled = false where workspace_id = ${boss.workspaceId}`
  }
})
