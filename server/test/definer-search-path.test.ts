import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { addPerson, asTableOwner, asWorker, closeDb, inWorkspace, makeOwner, withoutActor } from './helpers.js'

after(async () => {
  await closeDb()
})

/*
 * What a definer function reads is the tables' owner's — the night audit,
 * B, and its review (migrations 297, 298).
 * A path that does not end in `pg_temp` reads it first, and a role that
 * may create in `public` or make temporary tables could put a table of its
 * own where a definer function looks: a temporary `membership` made a
 * deletion's dry run list another company's workspace, and a
 * `public.orphan` made the clear-out delete the people it named.
 */
test('every security definer function in public says search_path = public, pg_temp, pg_temp last', async () => {
  const bare = await asTableOwner()<{ signature: string; config: string | null }[]>`
    select p.oid::regprocedure::text as signature, array_to_string(p.proconfig, ', ') as config
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
        where c ~ '^search_path=.*,\\s*pg_temp$'
      )
    order by 1`
  assert.deepEqual(
    bare.map((f) => `${f.signature} (${f.config ?? 'no settings'})`),
    [],
    'a definer function without pg_temp last on its path — add `set search_path = public, pg_temp`',
  )
})

test('the application and the worker may neither create in public nor make temporary tables', async () => {
  const [r] = await asTableOwner()<{ app_create: boolean; worker_create: boolean; app_temp: boolean; worker_temp: boolean }[]>`
    select has_schema_privilege('tracker_app', 'public', 'CREATE') as app_create,
           has_schema_privilege('tracker_worker', 'public', 'CREATE') as worker_create,
           has_database_privilege('tracker_app', current_database(), 'TEMP') as app_temp,
           has_database_privilege('tracker_worker', current_database(), 'TEMP') as worker_temp`
  assert.deepEqual({ ...r }, { app_create: false, worker_create: false, app_temp: false, worker_temp: false })

  // As they connect, not only as the catalogue says.
  await assert.rejects(
    withoutActor((tx) => tx`create table public.orphan (id uuid)`),
    /permission denied/,
  )
  await assert.rejects(
    asWorker((tx) => tx`create temp table orphan (id uuid) on commit drop`),
    /permission denied/,
  )
})

/* And the attack the review proved: a member's temporary `membership`
   saying they own the workspace. It cannot be made now; were it there,
   `role_in` would not read it. */
test('a temporary table the application tries to make does not stand in for a table in public', async () => {
  const o = await makeOwner()
  const m = await addPerson(o.ctx, o.workspaceId, 'member')
  await assert.rejects(
    inWorkspace(m.actorId, o.workspaceId, (tx) => tx`create temp table membership (workspace_id uuid) on commit drop`),
    /permission denied/,
  )
  const role = await inWorkspace(m.actorId, o.workspaceId, async (tx) => {
    const [r] = await tx<{ role: string | null }[]>`select role_in(${o.workspaceId})::text as role`
    return r?.role ?? null
  })
  assert.equal(role, 'member')
})

/* The clear-out and a deletion still make their own temporary tables —
   as the tables' owner, who keeps TEMP. */
test('the definers that make temporary tables still run', async () => {
  /* Rolled back: on the shared database, the clear-out is the sweep's to
     run, not a test's. */
  const ROLLBACK = new Error('rolled back')
  let cleared: number | null = null
  await asTableOwner()
    .begin(async (tx) => {
      const [r] = await tx<{ n: number }[]>`select purge_orphan_actors() as n`
      cleared = r?.n ?? null
      throw ROLLBACK
    })
    .catch((e: unknown) => {
      if (e !== ROLLBACK) throw e
    })
  assert.equal(typeof cleared, 'number')
  const o = await makeOwner()
  const [dry] = await asTableOwner()<{ answer: { ok: boolean } }[]>`select account_deletion(${o.ctx.actorId}, true) as answer`
  assert.equal(dry?.answer.ok, true)
})
