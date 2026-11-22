import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Tx } from '../src/db.js'
import { AUTH_DEFINERS } from './auth-definers.js'
import { asAuthEverywhere, asTableOwner, closeDb, makeOwner, uuidv7, withActor, withoutActor } from './helpers.js'

/*
 * Getting in is taken from the application — migration 311,
 * phase 2. SQL run as the application role, with
 * its actor setting set to anybody — the account itself, a stranger, an
 * operator — cannot run a definer that writes a way in, hands back what one
 * is made of, makes or ends a session or a token, deletes an account, or
 * sets the server's mail or owners, and cannot insert a session or a token
 * or write a GitHub link. The flows that used to do it as the application
 * run on the sign-in connection (`auth-role.test.ts`, and the whole suite
 * with this migration applied).
 */

after(closeDb)

const refused = (e: unknown) => (e as { code?: string }).code === '42501'

/** Each definer as a statement with every argument a typed null — refused before it runs. */
async function definers(): Promise<{ name: string; call: string }[]> {
  const rows = await asTableOwner()<{ name: string; args: string }[]>`
    select p.proname::text as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype
      and p.proname = any (${AUTH_DEFINERS})
    order by 1, 2`
  return rows.map((r) => {
    /* Identity arguments read `p_actor uuid, p_hash text` — the name is the first word. */
    const types = r.args ? r.args.split(', ').map((a) => a.replace(/^\w+\s+/, '')) : []
    return { name: r.name, call: `select ${r.name}(${types.map((t) => `null::${t}`).join(', ')})` }
  })
}

test('the definers the sign-in role alone may run are exactly the ones named', async () => {
  const rows = await asTableOwner()<{ name: string }[]>`
    select distinct p.proname::text as name from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('tracker_auth', p.oid, 'execute')
      and not has_function_privilege('tracker_app', p.oid, 'execute')
    order by 1`
  assert.deepEqual(
    rows.map((r) => r.name),
    AUTH_DEFINERS,
  )
})

test('as the application role, none of them runs — as the account, as nobody, as an operator', async () => {
  const victim = await makeOwner()
  const operator = await makeOwner()
  await asTableOwner()`insert into operator (actor_id) values (${operator.ctx.actorId}) on conflict do nothing`
  try {
    /* The operator's setting does make the check pass for SQL the application role may run. */
    const [op] = await withActor(operator.ctx.actorId, (tx) => tx<{ yes: boolean }[]>`select is_operator() as yes`)
    assert.equal(op?.yes, true)
    const calls = await definers()
    assert.equal(new Set(calls.map((c) => c.name)).size, AUTH_DEFINERS.length)
    for (const { name, call } of calls) {
      await assert.rejects(
        withoutActor((tx) => tx.unsafe(call)),
        refused,
        `${name}, as nobody`,
      )
      await assert.rejects(
        withActor(victim.ctx.actorId, (tx) => tx.unsafe(call)),
        refused,
        `${name}, as the account`,
      )
      await assert.rejects(
        withActor(operator.ctx.actorId, (tx) => tx.unsafe(call)),
        refused,
        `${name}, as an operator`,
      )
    }
    /* Concretely, the takeovers the reviews named. */
    const as = (fn: (tx: Tx) => Promise<unknown>) => withActor(operator.ctx.actorId, fn)
    await assert.rejects(
      as((tx) => tx`select auth_ticket_make(${`planted-${uuidv7()}`}, 'reset', ${victim.ctx.actorId}, null, interval '1 hour')`),
      refused,
    )
    await assert.rejects(
      as((tx) => tx`select auth_set_password(${victim.ctx.actorId}, 'scrypt$planted')`),
      refused,
    )
    await assert.rejects(
      as((tx) => tx`select operator_delete_account(${victim.ctx.actorId}, false)`),
      refused,
    )
    /* The server's mail pointed at somebody else's SMTP server, and an owner named. */
    await assert.rejects(
      as(
        (tx) => tx`select instance_mail_write(null, 'smtp', 'smtp.attacker.example', 587, 'starttls',
                                             'u', 'sealed', null, true, 'tuff@attacker.example')`,
      ),
      refused,
    )
    await assert.rejects(
      as((tx) => tx`select instance_add_owner(${`planted-${uuidv7()}@example.com`}::citext)`),
      refused,
    )
    const [still] = await asTableOwner()<{ n: number }[]>`
      select count(*)::int as n from app_user where actor_id = ${victim.ctx.actorId} and password_hash is distinct from 'scrypt$planted'`
    assert.equal(still?.n, 1)
  } finally {
    await asTableOwner()`delete from operator where actor_id = ${operator.ctx.actorId}`
  }
})

test('as the application role, the server’s mail and owners refuse a forged owner; as the sign-in role, they answer the same owner', async () => {
  const someone = await makeOwner()
  /* A server owner by the table, for the length of this test: the actor
     setting is all `is_instance_owner()` asks. */
  await asTableOwner()`insert into instance_owner (actor_id) values (${someone.ctx.actorId}) on conflict do nothing`
  try {
    const [yes] = await withActor(someone.ctx.actorId, (tx) => tx<{ yes: boolean }[]>`select is_instance_owner() as yes`)
    assert.equal(yes?.yes, true, 'the forged owner passes the check itself')
    const calls: Record<string, (tx: Tx) => Promise<{ said: unknown }[]>> = {
      instance_mail_write: (tx) => tx`
        select instance_mail_write(null, 'smtp', 'smtp.attacker.example', 587, 'starttls',
                                   'u', 'sealed', null, true, 'tuff@attacker.example')::text as said`,
      instance_mail_clear: (tx) => tx`select instance_mail_clear(null)::text as said`,
      instance_add_owner: (tx) => tx`select instance_add_owner(${`nobody-${uuidv7()}@example.com`}::citext)::text as said`,
      instance_remove_owner: (tx) => tx`select instance_remove_owner(${uuidv7()})::text as said`,
    }
    for (const [name, call] of Object.entries(calls)) {
      await assert.rejects(withActor(someone.ctx.actorId, call), refused, `${name}, as the application role`)
      /* The control: the same call, as the same owner, through the sign-in
         role, runs and answers — so the refusal above is the grant's, not
         one the function raises itself. Put back, so the shared database
         keeps nothing of this test's. */
      /* As `tracker_auth` itself (`set local role`), on a server that is
         its own for this transaction alone: the mail asks
         `instance_setting.community`, which the shared test database is
         not. */
      const said = await asTableOwner()
        .begin(async (tx) => {
          await tx`update instance_setting set community = true`
          await tx`select set_config('app.actor_id', ${someone.ctx.actorId}, true)`
          await tx`set local role tracker_auth`
          const [r] = await call(tx)
          throw Object.assign(new Error('put back'), { said: r?.said })
        })
        .catch((e: { said?: unknown; code?: string }) => {
          if (e.code) throw e
          return e.said
        })
      assert.notEqual(said, undefined, `${name}, as the sign-in role`)
      assert.notEqual(said, 'forbidden', `${name}, as the sign-in role`)
      assert.notEqual(said, 'false', `${name}, as the sign-in role`)
    }
  } finally {
    await asTableOwner()`delete from instance_owner where actor_id = ${someone.ctx.actorId}`
  }
})

test('as the application role, no session, token or GitHub link is written — not even for its own actor', async () => {
  const me = await makeOwner()
  const session = (actor: string) => (tx: Tx) =>
    tx`insert into refresh_session (id, actor_id, workspace_id, token_hash, expires_at, family)
       values (${uuidv7()}, ${actor}, null, ${`planted-${uuidv7()}`}, now() + interval '1 day', ${uuidv7()})`
  const token = (actor: string) => (tx: Tx) =>
    tx`insert into api_token (id, workspace_id, actor_id, name, project_ids, token_hash, expires_at)
       values (${uuidv7()}, ${me.workspaceId}, ${actor}, 'planted', '{}', ${`planted-${uuidv7()}`}, now() + interval '1 day')`
  await assert.rejects(withoutActor(session(me.ctx.actorId)), refused)
  await assert.rejects(withActor(me.ctx.actorId, session(me.ctx.actorId)), refused)
  await assert.rejects(withoutActor(token(me.ctx.actorId)), refused)
  await assert.rejects(withActor(me.ctx.actorId, token(me.ctx.actorId)), refused)
  await assert.rejects(
    withActor(me.ctx.actorId, (tx) => tx`update api_token set revoked_at = now() where actor_id = ${me.ctx.actorId}`),
    refused,
  )
  await assert.rejects(
    withActor(
      me.ctx.actorId,
      (tx) =>
        tx`insert into github_person (actor_id, github_id, login) values (${me.ctx.actorId}, ${Math.floor(Math.random() * 1e9)}, 'planted')`,
    ),
    refused,
  )
  await assert.rejects(
    withActor(me.ctx.actorId, (tx) => tx`delete from github_person where actor_id = ${me.ctx.actorId}`),
    refused,
  )
  /* Nor read a sealed GitHub token, even its own; who is linked it still reads. */
  for (const column of ['token_enc', 'refresh_enc']) {
    await assert.rejects(
      withActor(me.ctx.actorId, (tx) => tx`select ${tx(column)} from github_person where actor_id = ${me.ctx.actorId}`),
      refused,
      column,
    )
  }
  await withActor(
    me.ctx.actorId,
    (tx) => tx`select actor_id, github_id, login, avatar_url from github_person where actor_id = ${me.ctx.actorId}`,
  )
  /* The catalogue says the same — by any column, since a column grant inserts too. */
  const [t] = await asTableOwner()<Record<string, boolean>[]>`
    select has_any_column_privilege('tracker_app', 'refresh_session', 'INSERT') as app_session,
           has_any_column_privilege('tracker_app', 'api_token', 'INSERT') as app_token,
           has_any_column_privilege('tracker_app', 'api_token', 'UPDATE') as app_token_update,
           has_any_column_privilege('tracker_app', 'github_person', 'INSERT') as app_github_insert,
           has_any_column_privilege('tracker_app', 'github_person', 'UPDATE') as app_github_update,
           has_table_privilege('tracker_app', 'github_person', 'DELETE') as app_github_delete,
           has_any_column_privilege('tracker_auth', 'refresh_session', 'INSERT') as auth_session,
           has_any_column_privilege('tracker_auth', 'api_token', 'INSERT') as auth_token,
           has_column_privilege('tracker_auth', 'api_token', 'revoked_at', 'UPDATE') as auth_revoke,
           has_any_column_privilege('tracker_auth', 'github_person', 'INSERT') as auth_github`
  assert.deepEqual(
    { ...t },
    {
      app_session: false,
      app_token: false,
      app_token_update: false,
      app_github_insert: false,
      app_github_update: false,
      app_github_delete: false,
      auth_session: true,
      auth_token: true,
      auth_revoke: true,
      auth_github: true,
    },
  )
  /* The insert policies are the sign-in role's, and still for the actor of the transaction. */
  const policies = await asTableOwner()<{ name: string; roles: string }[]>`
    select polname::text as name, (select string_agg(rolname, ',') from pg_roles where oid = any (polroles)) as roles
    from pg_policy where polname in ('sess_write', 'tok_write') order by 1`
  assert.deepEqual(
    policies.map((p) => `${p.name} ${p.roles}`),
    ['sess_write tracker_auth', 'tok_write tracker_auth'],
  )
  const other = await makeOwner()
  await assert.rejects(asAuthEverywhere(me.ctx.actorId, session(other.ctx.actorId)), /row-level security/)
})
