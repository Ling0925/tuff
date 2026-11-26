import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import type { Tx } from '../src/db.js'
import { asAuthEverywhere, asTableOwner, asWorker, closeDb, makeOwner, uuidv7, withActor, withoutActor } from './helpers.js'

/*
 * What the application role may write of a person directly — migration
 * 306. Their own settings, as
 * themselves; no sign-in column, and no account of its own making.
 * Everything else goes through a definer function, and the flows that use
 * them (`password.test.ts`, `two-factor.test.ts`, `ways-in.test.ts`,
 * `invites.test.ts`, `address.test.ts`, …) say they still work.
 *
 * The definers that write those tables are the sign-in role's: granted to
 * it by migration 308 and taken from the application by 311
 * (`auth-role-refused.test.ts`), so the
 * application role may run none of them, whatever actor it says it is.
 */

after(closeDb)

const refused = (e: unknown) => (e as { code?: string }).code === '42501'

/** Every column of `app_user` that is about getting in, or that nobody sets about themselves. */
const PROTECTED: Record<string, unknown> = {
  password_hash: 'scrypt$planted',
  totp_enabled: false,
  totp_secret_enc: 'planted',
  totp_enabled_at: null,
  totp_begun_at: null,
  totp_last_step: null,
  email: 'taken-over@example.com',
  email_verified_at: null,
  email_by_hand: false,
  actor_id: '00000000-0000-0000-0000-000000000000',
  created_at: new Date(0),
  updated_at: new Date(0),
  last_digest_at: null,
  announced_at: null,
  /* When the account's previous holder was put out — migration 317. */
  sessions_after: null,
}

/** What a person changes about themselves, and the server writes as them. */
const SETTINGS = ['email_digest', 'language', 'notify_chat', 'quiet_from', 'quiet_to', 'timezone']

test('the application role cannot write a sign-in column, even as the account itself', async () => {
  const { ctx } = await makeOwner()
  for (const [column, value] of Object.entries(PROTECTED)) {
    await assert.rejects(
      withActor(ctx.actorId, (tx) => tx`update app_user set ${tx({ [column]: value }, column)} where actor_id = ${ctx.actorId}`),
      refused,
      column,
    )
    await assert.rejects(
      withoutActor((tx) => tx`update app_user set ${tx({ [column]: value }, column)} where actor_id = ${ctx.actorId}`),
      refused,
      `${column}, with no actor`,
    )
  }
  /* And the worker's role holds nothing on the table. */
  await assert.rejects(
    asWorker((tx) => tx`update app_user set password_hash = 'scrypt$planted' where actor_id = ${ctx.actorId}`),
    refused,
  )
  /* Nothing moved. */
  const [row] = await asTableOwner()<{ password_hash: string | null; email: string }[]>`
    select password_hash, email::text as email from app_user where actor_id = ${ctx.actorId}`
  assert.notEqual(row?.password_hash, 'scrypt$planted')
  assert.notEqual(row?.email, PROTECTED.email)
})

test('the application role makes no account', async () => {
  const someone = uuidv7()
  await asTableOwner()`insert into actor (id, name) values (${someone}, 'Planted')`
  const insert = (tx: Tx) => tx`
    insert into app_user (actor_id, email, password_hash, email_verified_at, timezone)
    values (${someone}, ${`planted-${someone}@example.com`}, 'scrypt$planted', now(), 'UTC')`
  await assert.rejects(withoutActor(insert), refused)
  await assert.rejects(withActor(someone, insert), refused)
  await assert.rejects(asWorker(insert), refused)
  /* Nor a way in beside the account: a provider's identity, a recovery code, a ticket. */
  await assert.rejects(
    withoutActor(
      (tx) => tx`insert into auth_identity (id, actor_id, provider, subject) values (${uuidv7()}, ${someone}, 'google', ${someone})`,
    ),
    refused,
  )
  await assert.rejects(
    withoutActor(
      (tx) =>
        tx`insert into auth_ticket (token_hash, kind, actor_id, expires_at) values (${someone}, 'reset', ${someone}, now() + interval '1 hour')`,
    ),
    refused,
  )
  const [n] = await asTableOwner()<{ n: number }[]>`select count(*)::int as n from app_user where actor_id = ${someone}`
  assert.equal(n?.n, 0)
  await asTableOwner()`delete from actor where id = ${someone}`
})

/** Which columns of a table a role may write, as the role holds it — through any role it is a member of. */
const writable = async (role: string, table: string, privilege: 'INSERT' | 'UPDATE') =>
  (
    await asTableOwner()<{ c: string }[]>`
      select attname::text as c from pg_attribute
      where attrelid = ${table}::regclass and attnum > 0 and not attisdropped
        and has_column_privilege(${role}, attrelid, attnum, ${privilege})
      order by 1`
  ).map((r) => r.c)

test('the catalogue says the same: six columns, no insert, no open policy', async () => {
  const owner = asTableOwner()
  for (const role of ['tracker_app', 'tracker_worker']) {
    const [t] = await owner<{ ins: boolean; upd: boolean; del: boolean }[]>`
      select has_table_privilege(${role}, 'app_user', 'INSERT') as ins,
             has_table_privilege(${role}, 'app_user', 'UPDATE') as upd,
             has_table_privilege(${role}, 'app_user', 'DELETE') as del`
    assert.deepEqual({ ...t }, { ins: false, upd: false, del: false }, `${role}: nothing table-wide`)
    assert.deepEqual(await writable(role, 'app_user', 'INSERT'), [], `${role}: no column to insert`)
  }
  assert.deepEqual(await writable('tracker_app', 'app_user', 'UPDATE'), SETTINGS)
  assert.deepEqual(await writable('tracker_worker', 'app_user', 'UPDATE'), [])
  const policies = await owner<{ name: string }[]>`
    select polname as name from pg_policy where polrelid = 'app_user'::regclass and polcmd = 'a'`
  assert.deepEqual([...policies], [], 'no insert policy left to open')
})

/*
 * Every definer function that writes a password, a second factor, an
 * address, a provider's identity, a ticket or a recovery code — or a
 * session, a token, an OAuth code, an agent's OAuth grant or a spent
 * refresh, an app's start, a GitHub link, the server's mail or its owners,
 * or an invitation — and that the application role may run: none. They
 * went to `tracker_auth` in 308 and were taken from `tracker_app` in 311
 * (`auth-role-refused.test.ts`); a definer that writes one of those tables
 * and is granted to the application fails here. One is left, on purpose:
 * `auth_lookup_api_token`, which every request with a token asks, takes
 * the token's hash — the proof itself — and writes only when it was last
 * used.
 */
test('the application may run no definer that writes a sign-in table', async () => {
  const rows = await asTableOwner()<{ name: string }[]>`
    select distinct p.proname::text as name from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype
      and p.prosrc ~* '(insert\\s+into|update|delete\\s+from)\\s+(public\\.)?(app_user|auth_identity|auth_ticket|recovery_code|refresh_session|api_token|oauth_code|oauth_agent_grant|oauth_refresh_spent|auth_app_start|github_person|instance_mail|instance_owner|invite)\\M'
      and has_function_privilege('tracker_app', p.oid, 'execute')
    order by 1`
  assert.deepEqual(
    rows.map((r) => r.name),
    ['auth_lookup_api_token'],
  )
})

test('a token is revoked and nothing else, and stays revoked', async () => {
  /* By the sign-in role, since 308; the application role writes nothing of it since 311. */
  assert.deepEqual(await writable('tracker_app', 'api_token', 'UPDATE'), [])
  assert.deepEqual(await writable('tracker_auth', 'api_token', 'UPDATE'), ['revoked_at'])
  const { ctx } = await makeOwner()
  /* A fresh probe every time: one of the fixture's tokens may be revoked already. */
  const id = (
    await asTableOwner()<{ id: string }[]>`
      insert into api_token (id, workspace_id, actor_id, name, project_ids, token_hash, expires_at)
      values (${uuidv7()}, ${ctx.workspaceId}, ${ctx.actorId}, 'probe', '{}', ${`probe-${uuidv7()}`}, now() + interval '1 day')
      returning id`
  )[0]!.id
  await assert.rejects(
    asAuthEverywhere(ctx.actorId, (tx) => tx`update api_token set token_hash = 'planted', actor_id = ${ctx.actorId} where id = ${id}`),
    refused,
  )
  const revoked = await asAuthEverywhere(
    ctx.actorId,
    (tx) => tx`update api_token set revoked_at = now() where id = ${id} and revoked_at is null`,
  )
  assert.equal(revoked.count, 1)
  await assert.rejects(
    asAuthEverywhere(ctx.actorId, (tx) => tx`update api_token set revoked_at = null where id = ${id}`),
    refused,
  )
})

test('a session is inserted only for the actor of its transaction', async () => {
  const me = await makeOwner()
  const other = await makeOwner()
  const insert = (actor: string) => (tx: Tx) =>
    tx`
    insert into refresh_session (id, actor_id, workspace_id, token_hash, expires_at, family)
    values (${uuidv7()}, ${actor}, null, ${`planted-${uuidv7()}`}, now() + interval '1 day', ${uuidv7()})`
  const rls = (e: unknown) => /row-level security/.test(String((e as Error).message))
  /* The application role inserts none at all since 311; the sign-in role
     only for the actor of its transaction. */
  await assert.rejects(withoutActor(insert(other.ctx.actorId)), refused)
  await assert.rejects(withActor(me.ctx.actorId, insert(me.ctx.actorId)), refused)
  await assert.rejects(asAuthEverywhere(me.ctx.actorId, insert(other.ctx.actorId)), rls)
  /* Signing in still makes one: `makeOwner` signed in, and so does this. */
  const [u] = await asTableOwner()<{ email: string }[]>`select email::text as email from app_user where actor_id = ${me.ctx.actorId}`
  const r = await app.request('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: u!.email, password: 'correct-horse-battery-staple' }),
  })
  assert.equal(r.status, 200, await r.clone().text())
  const [n] = await asTableOwner()<{ n: number }[]>`
    select count(*)::int as n from refresh_session where actor_id = ${me.ctx.actorId}`
  assert.ok((n?.n ?? 0) >= 2, 'the fixture’s session and the sign-in’s')
})

test('a time zone the database does not know is refused, whoever writes it', async () => {
  const { ctx } = await makeOwner()
  await assert.rejects(
    withActor(ctx.actorId, (tx) => tx`update app_user set timezone = 'Berlin' where actor_id = ${ctx.actorId}`),
    (e: unknown) => (e as { code?: string }).code === '22023',
  )
  await assert.rejects(
    asTableOwner()`update app_user set timezone = 'Mars/Olympus' where actor_id = ${ctx.actorId}`,
    (e: unknown) => (e as { code?: string }).code === '22023',
  )
  const ok = await withActor(ctx.actorId, (tx) => tx`update app_user set timezone = 'Europe/Berlin' where actor_id = ${ctx.actorId}`)
  assert.equal(ok.count, 1)
})

test('a person still saves their own settings, and only their own', async () => {
  const me = await makeOwner()
  const other = await makeOwner()
  const call = async (path: string, body: unknown) =>
    (
      await app.request(path, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${me.token}` },
        body: JSON.stringify(body),
      })
    ).status
  assert.equal(
    await call('/api/inbox/settings', {
      notify_chat: false,
      email_digest: false,
      quiet_from: '22:00',
      quiet_to: '07:00',
      timezone: 'Europe/Paris',
    }),
    200,
  )
  assert.equal(await call('/api/me', { language: 'fr' }), 200)
  const [row] = await asTableOwner()<Record<string, unknown>[]>`
    select notify_chat, email_digest, quiet_from::text as quiet_from, quiet_to::text as quiet_to, timezone, language
    from app_user where actor_id = ${me.ctx.actorId}`
  assert.deepEqual(
    { ...row },
    { notify_chat: false, email_digest: false, quiet_from: '22:00:00', quiet_to: '07:00:00', timezone: 'Europe/Paris', language: 'fr' },
  )
  /* Somebody else's row is not theirs to write: row-level security finds nothing. */
  const elsewhere = await withActor(
    me.ctx.actorId,
    (tx) => tx`update app_user set timezone = 'Asia/Tokyo', language = 'fr' where actor_id = ${other.ctx.actorId}`,
  )
  assert.equal(elsewhere.count, 0)
})
