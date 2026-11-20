/*
 * A function that runs as the tables' owner is run by the roles it is
 * granted to, by name, and by nobody else,
 * the sixth audit, M3.
 *
 * Postgres gives `execute` on every new function to PUBLIC. For a
 * `security definer` function — one that runs as the owner, past every
 * policy — that meant any role that could connect could call it: the
 * clear-out that deletes a whole workspace by id, the sweep that deletes
 * every workspace whose address matches a pattern, the session and ticket
 * functions that take an actor's id from their caller. Migration 153 took
 * the worker's functions back one at a time; the other hundred and seventy
 * were still everybody's.
 *
 * Three things here:
 *
 * 1. `accept_invite`, which the application calls and had only through
 *    PUBLIC, is granted to it by name first, so taking PUBLIC away takes
 *    nothing the application uses. Every other definer function the
 *    application calls was already granted to it by name.
 * 2. PUBLIC loses `execute` on every definer function in the schema. The
 *    owner keeps it (an owner's right is not PUBLIC's), and so does every
 *    role granted one by name. Trigger functions are in the sweep too: a
 *    trigger's function is checked for `execute` when the trigger is
 *    made, by the migration's role, and never when it fires.
 * 3. The application loses `execute` on what only the owner runs or nobody
 *    runs any more: the purges, which the development scripts call as the
 *    owner and the worker reaches through its own functions
 *    (`purge_deleted_workspaces`, migration 153), and the functions of a
 *    feedback page, an export and an import that were replaced and that no
 *    code calls. Each was checked against `server/src` for a caller before
 *    it went on this list. `purge_project`, which a workspace's owner calls
 *    from the bin, stays.
 *
 * And from now on a function made by the role that migrates is nobody's
 * until it is granted: `alter default privileges`. A migration that makes
 * a function the application calls — or one a policy calls, which runs as
 * whoever is asking — says `grant execute … to tracker_app`, as every
 * migration since 002 has said for tables. One that forgets fails the
 * server's tests at the first call, which run as `tracker_app`, rather than
 * leaving a definer function open to every role in the database.
 */

-- 1.
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = 'accept_invite'
  loop
    execute format('grant execute on function %s to tracker_app', f);
  end loop;
end $$;

-- 2.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prosecdef
      -- An extension's functions are the extension's to grant.
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke execute on function %s from public', f);
  end loop;
end $$;

-- 3.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (
        p.proname = any (array[
          -- The purges: the owner's, and the worker's through its own functions.
          'purge_workspace', 'purge_workspaces_like', 'purge_orphan_actors', 'purge_project_rows',
          -- Replaced, and called by nothing.
          'feedback_block', 'feedback_forget', 'feedback_forget_by_team', 'feedback_hide',
          'feedback_hold_vote', 'feedback_my_votes', 'feedback_person_page', 'feedback_public',
          'feedback_ship', 'feedback_ship_count', 'feedback_show', 'feedback_stage',
          'feedback_unsubscribe', 'feedback_vote_by_key', 'feedback_votes',
          'billing_customer_of_actor', 'rate_peek', 'slack_person_link',
          'tuff_import_begin', 'tuff_import_start', 'workspace_export_key'
        ])
        -- The first `new_workspace`, three arguments, which sign-up stopped calling.
        or p.oid = to_regprocedure('new_workspace(uuid, uuid, text)')
      )
  loop
    execute format('revoke execute on function %s from public, tracker_app', f);
  end loop;
end $$;

-- And every function made from here on.
alter default privileges revoke execute on functions from public;
