/*
 * Getting in is taken from the application, phase 2 of 2.
 *
 * Migration 308 made `tracker_auth` and gave it everything signing in
 * needs; the deploy that carried it moved the sign-in code onto that role's
 * connection. This takes the same rights from `tracker_app`, so SQL run as
 * the application — an injection anywhere in the request code — can no
 * longer write a way in, make or end a session or a token, delete an
 * account, or set the server's mail or owners, whatever actor it says it
 * is. **Ship it in a deploy after 308's**, never with it: a container still
 * running the code from before 308 signs nobody in once this is applied.
 *
 * 1. EXECUTE on every definer 308 granted to `tracker_auth` — the same
 *    list, `AUTH_DEFINERS` in `test/auth-role.test.ts` — taken from
 *    `tracker_app` and from PUBLIC (which 227 had taken already).
 * 2. INSERT on `refresh_session` and `api_token`, UPDATE of
 *    `api_token.revoked_at`, and INSERT, UPDATE and DELETE on
 *    `github_person`, taken from `tracker_app`. The insert policies
 *    `sess_write` and `tok_write`, which were `to public`, are the sign-in
 *    role's alone, still asking that the row is for the actor of the
 *    transaction. The application keeps reading `refresh_session` and
 *    `api_token` as before.
 * 3. `github_person`'s sealed tokens are no longer the application's to
 *    read; who is linked still is.
 *
 * To roll back to code from before 308 after this is applied, the SQL that
 * undoes it is in the auth role spec.
 *
 * Not definers for the two inserts: the role is the boundary, and a
 * definer only it may run, taking any actor id, would be the same power as
 * this grant with the statement moved out of the code reviewed with it.
 */

-- 1. The definers: every function granted to tracker_auth by name.
do $$
declare
  f regprocedure;
  n int := 0;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and exists (
        select 1 from aclexplode(p.proacl) a
        where a.grantee = 'tracker_auth'::regrole and a.privilege_type = 'EXECUTE'
      )
  loop
    execute format('revoke execute on function %s from tracker_app, public', f);
    n := n + 1;
  end loop;
  if n < 55 then
    raise exception 'only % functions are granted to tracker_auth: is 308 applied?', n;
  end if;
end $$;

-- 2. The tables.
revoke insert on refresh_session from tracker_app;
drop policy if exists sess_write on refresh_session;
create policy sess_write on refresh_session for insert to tracker_auth with check (actor_id = current_actor());

revoke insert on api_token from tracker_app;
revoke update (revoked_at) on api_token from tracker_app;
drop policy if exists tok_write on api_token;
create policy tok_write on api_token for insert to tracker_auth with check (actor_id = current_actor());

revoke insert, update, delete on github_person from tracker_app;

/* 3. And the application reads who is linked, not their tokens. It
   selected `github_id`, `login` and `avatar_url` and nothing else; the
   sealed `token_enc` and `refresh_enc` are read through
   `github_person_token` (the sign-in role's) and `github_person_token_in`
   (the worker's). The sign-in role keeps the whole table by name, which
   linking needs for its `on conflict`. */
grant select on github_person to tracker_auth;
revoke select on github_person from tracker_app;
grant select (actor_id, github_id, login, avatar_url, token_until, refresh_until, created_at, updated_at)
  on github_person to tracker_app;
