import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from '../src/http/routes.js'
import { authSql, type Tx } from '../src/db.js'
import { authUrlFrom } from '../src/db/authUrl.js'
import { scramVerifier } from '../src/db/migrate.js'
import { env } from '../src/env.js'
import { askRls, rlsVerdict } from '../src/rlsGuard.js'
import { AUTH_DEFINERS } from './auth-definers.js'
import { asAuthEverywhere, asTableOwner, closeDb, makeOwner, uuidv7 } from './helpers.js'

/*
 * Getting in is the sign-in role's — migration 308, phase 1,
 * The role exists, connects, holds every
 * definer and table right signing in needs by name, and the flows run on
 * its connection: this file, and the flows' own tests (`password.test.ts`,
 * `two-factor.test.ts`, `ways-in.test.ts`, `invites.test.ts`,
 * `address.test.ts`, `remote-mcp*.test.ts`, `yourdata.test.ts`,
 * `instance.test.ts`, …). That the application role can no longer do any
 * of it is phase 2, migration 311, and `auth-role-refused.test.ts`.
 */

after(closeDb)

test('the definers granted to the sign-in role by name are exactly the ones named, and nobody else’s', async () => {
  const rows = await asTableOwner()<{ name: string; may: boolean }[]>`
    select p.proname::text as name, bool_and(has_function_privilege('tracker_auth', p.oid, 'execute')) as may
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype
      and exists (
        select 1 from aclexplode(p.proacl) a
        where a.grantee = 'tracker_auth'::regrole and a.privilege_type = 'EXECUTE'
      )
    group by 1 order by 1`
  assert.deepEqual(
    rows.map((r) => r.name),
    AUTH_DEFINERS,
  )
  assert.ok(rows.every((r) => r.may))
  /* Not PUBLIC's, and the worker's only the GitHub token's renewal it always had. */
  const others = await asTableOwner()<{ f: string }[]>`
    select p.oid::regprocedure::text as f from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = any (${AUTH_DEFINERS})
      and (has_function_privilege('tracker_worker', p.oid, 'execute')
           or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0))
    order by 1`
  assert.deepEqual(
    others.map((r) => r.f),
    ['github_person_retoken(uuid,text,text,timestamp with time zone,timestamp with time zone)'],
  )
})

test('docs/api.md names the same definers', () => {
  const doc = readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'api.md'), 'utf8')
  const at = doc.indexOf("**The sign-in role's definers.**")
  assert.ok(at >= 0, 'the paragraph is in docs/api.md')
  const paragraph = doc.slice(at, doc.indexOf('\n\n', at))
  const named = [...paragraph.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]!).sort()
  assert.deepEqual(named, AUTH_DEFINERS)
})

test('the sign-in role holds the session, token and GitHub link writes by name, and inserts only for its own actor', async () => {
  /* Granted to it directly, not only through its membership — 311 takes them from the application. */
  const direct = await asTableOwner()<{ what: string }[]>`
    select c.relname || ' ' || a.privilege_type as what
    from pg_class c, aclexplode(c.relacl) a
    where c.relname in ('refresh_session', 'api_token', 'github_person') and a.grantee = 'tracker_auth'::regrole
    union all
    select c.relname || '.' || t.attname || ' ' || a.privilege_type
    from pg_class c join pg_attribute t on t.attrelid = c.oid, aclexplode(t.attacl) a
    where c.relname = 'api_token' and a.grantee = 'tracker_auth'::regrole
    order by 1`
  assert.deepEqual(
    direct.map((r) => r.what),
    [
      'api_token INSERT',
      'api_token.revoked_at UPDATE',
      'github_person DELETE',
      'github_person INSERT',
      'github_person UPDATE',
      'refresh_session INSERT',
    ],
  )
  const me = await makeOwner()
  const other = await makeOwner()
  const session = (actor: string) => (tx: Tx) =>
    tx`insert into refresh_session (id, actor_id, workspace_id, token_hash, expires_at, family)
       values (${uuidv7()}, ${actor}, null, ${`planted-${uuidv7()}`}, now() + interval '1 day', ${uuidv7()})`
  await assert.rejects(asAuthEverywhere(me.ctx.actorId, session(other.ctx.actorId)), /row-level security/)
  await asAuthEverywhere(me.ctx.actorId, session(me.ctx.actorId))
})

test('the sign-in connection is tracker_auth, a member of the application role, under every policy', async () => {
  const [who] = await authSql()<{ user: string; member: boolean }[]>`
    select current_user::text as user, pg_has_role(current_user, 'tracker_app', 'USAGE') as member`
  assert.deepEqual({ ...who }, { user: 'tracker_auth', member: true })
  assert.equal(rlsVerdict(await askRls(authSql())), null)
  /* And the application role is no member of it. */
  const [app] = await asTableOwner()<{ member: boolean }[]>`select pg_has_role('tracker_app', 'tracker_auth', 'MEMBER') as member`
  assert.equal(app?.member, false)
})

test('a role is given a SCRAM verifier, never its password', async () => {
  const v = scramVerifier('pass-word', Buffer.alloc(16, 7))
  assert.match(v, /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}:[A-Za-z0-9+/=]{44}$/)
  assert.ok(!v.includes('pass-word'))
  /* The same salt, the same verifier; a fresh salt every time otherwise. */
  assert.equal(scramVerifier('pass-word', Buffer.alloc(16, 7)), v)
  assert.notEqual(scramVerifier('pass-word'), scramVerifier('pass-word'))
  /* And Postgres takes it: the sign-in connection above signed in with the
     password the migration gave as a verifier. What is stored says so, where
     the owner may read it. */
  const stored = await asTableOwner()<{ p: string | null }[]>`select rolpassword as p from pg_authid where rolname = 'tracker_auth'`.catch(
    () => null,
  )
  if (stored) assert.match(stored[0]?.p ?? '', /^SCRAM-SHA-256\$4096:/)
})

test('its connection string is DATABASE_URL_AUTH, or made from DATABASE_URL_APP', () => {
  const appUrl = 'postgres://tracker_app:pass%40word@db.internal:5432/tracker'
  const made = authUrlFrom(undefined, appUrl)
  const u = new URL(made)
  assert.equal(u.username, 'tracker_auth')
  assert.equal(`${u.hostname}:${u.port}${u.pathname}`, 'db.internal:5432/tracker')
  assert.match(u.password, /^[0-9a-f]{64}$/)
  assert.notEqual(u.password, 'pass%40word')
  /* The same every time, so the migrating start and the serving start agree. */
  assert.equal(authUrlFrom('', appUrl), made)
  /* Another application password, another one. */
  assert.notEqual(authUrlFrom(undefined, appUrl.replace('pass', 'other')), made)
  /* Said outright, said. */
  assert.equal(authUrlFrom(' postgres://tracker_auth:chosen@h/d ', appUrl), 'postgres://tracker_auth:chosen@h/d')
  /* Nothing to make it from: the owner, no password, no string. */
  assert.equal(authUrlFrom(undefined, 'postgres://tracker:tracker@h/d'), '')
  assert.equal(authUrlFrom(undefined, 'postgres://tracker_app@h/d'), '')
  assert.equal(authUrlFrom(undefined, undefined), '')
  assert.equal(authUrlFrom(undefined, 'not a url'), '')
  /* And this suite connects with what it made, the migration having given the role that password. */
  if (!process.env.DATABASE_URL_AUTH) assert.equal(env.databaseUrlAuth, authUrlFrom(undefined, process.env.DATABASE_URL_APP))
})

test('signing in, refreshing, a token and signing out still go through', async () => {
  const me = await makeOwner()
  const [u] = await asTableOwner()<{ email: string }[]>`select email::text as email from app_user where actor_id = ${me.ctx.actorId}`
  const post = (path: string, body: unknown, bearer?: string) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
    })
  const signedIn = await post('/auth/login', { email: u!.email, password: 'correct-horse-battery-staple' })
  assert.equal(signedIn.status, 200, await signedIn.clone().text())
  const s = (await signedIn.json()) as { access_token: string; refresh_token: string }
  const renewed = await post('/auth/refresh', { refresh_token: s.refresh_token })
  assert.equal(renewed.status, 200, await renewed.clone().text())
  const r = (await renewed.json()) as { access_token: string; refresh_token: string }
  /* The old refresh token is spent. */
  assert.notEqual((await post('/auth/refresh', { refresh_token: s.refresh_token })).status, 200)
  const made = await post('/api/tokens', { name: 'probe', ttl_days: 7 }, r.access_token)
  assert.equal(made.status, 201, await made.clone().text())
  const { token } = (await made.json()) as { token: string }
  const mine = await app.request('/api/me', { headers: { authorization: `Bearer ${token}` } })
  assert.equal(mine.status, 200)
  const out = await post('/auth/logout', { refresh_token: r.refresh_token })
  assert.ok(out.status < 300, await out.clone().text())
  assert.notEqual((await post('/auth/refresh', { refresh_token: r.refresh_token })).status, 200)
})
