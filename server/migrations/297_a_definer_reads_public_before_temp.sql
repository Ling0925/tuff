/*
 * Every definer function reads `public` before any temporary table —
 * `docs/api.md`, "Cross-actor reads go through security definer
 * functions", and the security audit spec, the night audit
 * (B).
 *
 * Most of them said `set search_path = public`, and Postgres puts
 * `pg_temp` first when a path does not name it. The application role may
 * make temporary tables, so a table it made called `membership` was the
 * one a definer function read: a deletion's dry run listed another
 * company's workspace from it. Named last, `pg_temp` is read only for
 * what `public` does not have — and nothing here reads a name `public`
 * does not have.
 *
 * Read from `pg_proc` rather than listed: every definer function in
 * `public` whose settings do not name `pg_temp` is set to
 * `public, pg_temp`, whatever else it sets (`jit`) kept. A function made
 * after this keeps what it says, so the rule is written down and held by a
 * test (`definer-search-path.test.ts`), which fails on any that does not
 * name `pg_temp` — `create or replace` takes the new text's setting, and
 * a function written again without it would otherwise slip back.
 *
 * Changes no rows. Runs again harmlessly.
 */

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
        where c like 'search_path=%' and c ~ '\mpg_temp\M'
      )
  loop
    execute format('alter routine %s set search_path = public, pg_temp', f.signature);
  end loop;
end $$;
