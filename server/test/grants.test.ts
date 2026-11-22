import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'
import { closeDb, makeOwner, stamp, uuidv7, withActor, withoutActor } from './helpers.js'

/*
 * Who may run a function that runs as the tables' owner — migrations 227
 * and 228, the sixth audit's M3. These run as the application role, as
 * every request does, and ask the catalogue as the owner.
 */
const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

after(async () => {
  await owner.end()
  await closeDb()
})

const refused = (e: unknown) => (e as { code?: string }).code === '42501'

test('the application role cannot call the purges', async () => {
  const { workspaceId } = await makeOwner()
  await assert.rejects(
    withoutActor((tx) => tx`select purge_workspace(${workspaceId})`),
    refused,
  )
  await assert.rejects(
    withoutActor((tx) => tx`select purge_workspaces_like(array['%'])`),
    refused,
  )
  await assert.rejects(
    withoutActor((tx) => tx`select purge_orphan_actors()`),
    refused,
  )
  // And the workspace is still there.
  const [w] = await owner<{ n: number }[]>`select count(*)::int as n from workspace where id = ${workspaceId} and deleted_at is null`
  assert.equal(w!.n, 1)
})

test('no definer function is anybody’s to run but the roles it is granted to', async () => {
  const open = await owner<{ f: string }[]>`
    select p.oid::regprocedure::text as f from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))`
  assert.deepEqual(
    open.map((r) => r.f),
    [],
  )
  // The worker's role, which has no table of its own, reaches no sign-in
  // function (the application's is phase 2, `auth-role-refused.test.ts`).
  const [w] = await owner<{ worker: boolean }[]>`
    select has_function_privilege('tracker_worker', 'auth_lookup_user(citext)', 'execute') as worker`
  assert.equal(w!.worker, false)
})

test('a function made from now on is nobody’s until it is granted', async () => {
  await owner
    .begin(async (tx) => {
      await tx`create function grants_probe() returns int language sql security definer as 'select 1'`
      const [r] = await tx<{ app: boolean; worker: boolean; auth: boolean }[]>`
        select has_function_privilege('tracker_app', 'grants_probe()', 'execute') as app,
               has_function_privilege('tracker_worker', 'grants_probe()', 'execute') as worker,
               has_function_privilege('tracker_auth', 'grants_probe()', 'execute') as auth`
      assert.deepEqual({ ...r }, { app: false, worker: false, auth: false })
      throw new Error('rolled back')
    })
    .catch((e: Error) => assert.equal(e.message, 'rolled back'))
})

/*
 * Every definer function the server names, runnable by whoever runs it:
 * the application role, or the worker's (`asWorker`), or the sign-in
 * role's (`asAuth`, migration 308), or the owner where the code asks as
 * the owner. Which of them a given call is on is asked by running it — the
 * flows' own tests, as each role. Read from the source, so a function the code
 * starts calling tomorrow is held to it too.
 */
const AS_OWNER = new Set([
  // `instanceOwner.ts`, and the community edition's `ready` — both `DATABASE_URL`.
  'instance_name_owner',
  'instance_started',
  // The community edition's `ready`, arming the setup link's hash — the
  // app role must never be able to set it.
  'instance_setup_armed',
  // What an update did, written by the migrating start and the serving
  // start as the owner (`backup.ts`); no request may write it.
  'instance_migrated',
  'instance_ran',
  // The public half of the push key the serving app signs with, for the
  // worker to compare (`pushKey.ts`); written as the owner, never a request.
  'instance_push_app_key_said',
])

function sources(d: string, out: string[] = []): string[] {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) sources(p, out)
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

test('every definer function the server calls is granted to the role that calls it', async () => {
  const text = sources(join(import.meta.dirname, '..', 'src'))
    .map((p) => readFileSync(p, 'utf8'))
    .join('\n')
  const fns = await owner<{ name: string; app: boolean; worker: boolean; auth: boolean }[]>`
    select p.proname as name,
           bool_or(has_function_privilege('tracker_app', p.oid, 'execute')) as app,
           bool_or(has_function_privilege('tracker_worker', p.oid, 'execute')) as worker,
           bool_or(has_function_privilege('tracker_auth', p.oid, 'execute')) as auth
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype
    group by p.proname`
  const missing = fns
    .filter((f) => new RegExp(`\\b${f.name}\\s*\\(`).test(text))
    .filter((f) => !f.app && !f.worker && !f.auth && !AS_OWNER.has(f.name))
    .map((f) => f.name)
  assert.deepEqual(missing, [])
})

test('the application adds a plain member under its own name, and nothing more', async () => {
  const a = await makeOwner()
  const b = await makeOwner()
  const someone = uuidv7()
  await owner`insert into actor (id, name) values (${someone}, ${`Imported ${stamp()}`})`
  const add = (by: string, ws: string, role: string, invitedBy: string | null) =>
    withActor(
      by,
      (tx) => tx`
      insert into membership (id, workspace_id, actor_id, role, invited_by, joined_at)
      values (${uuidv7()}, ${ws}, ${someone}, ${role}::role_kind, ${invitedBy}, now())`,
    )
  const denied = (e: unknown) => /row-level security/.test(String((e as Error).message))

  // Not as an owner or an admin, not on somebody else's behalf, not into a workspace one is not in.
  await assert.rejects(add(a.ctx.actorId, a.workspaceId, 'owner', a.ctx.actorId), denied)
  await assert.rejects(add(a.ctx.actorId, a.workspaceId, 'admin', a.ctx.actorId), denied)
  await assert.rejects(add(a.ctx.actorId, a.workspaceId, 'member', b.ctx.actorId), denied)
  await assert.rejects(add(a.ctx.actorId, b.workspaceId, 'member', a.ctx.actorId), denied)
  await assert.rejects(
    withoutActor(
      (tx) => tx`
      insert into membership (id, workspace_id, actor_id, role, joined_at)
      values (${uuidv7()}, ${b.workspaceId}, ${a.ctx.actorId}, 'owner', now())`,
    ),
    denied,
  )
  // What an import does.
  await add(a.ctx.actorId, a.workspaceId, 'member', a.ctx.actorId)
})

test('a session is never updated by the application itself', async () => {
  const { ctx } = await makeOwner()
  await assert.rejects(
    withoutActor((tx) => tx`update refresh_session set actor_id = ${ctx.actorId}`),
    refused,
  )
})
