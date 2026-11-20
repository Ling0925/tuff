/*
 * The application makes no tables, in `public` or in `pg_temp` —
 * `docs/api.md`, "Cross-actor reads go through security definer
 * functions", and the security audit spec, the night audit
 * (B, and its review).
 *
 * Migration 297 put `pg_temp` after `public` on every definer function's
 * path. That stops a temporary table from standing in for one in `public`,
 * and it leaves the other way round open: PUBLIC could still create in
 * schema `public` (Postgres granted it by default before 15, and this
 * database was made so), so the application role could make
 * `public.orphan` with seven ids in it, and `purge_orphan_actors`, which
 * names its temporary `orphan` unqualified, deleted those seven people.
 * And it could plant a lasting overload — `public.can_see_conversation(text)`
 * answering true — which a parameter sent untyped resolves to.
 *
 * So:
 *
 * - **No CREATE on schema `public` for PUBLIC.** The tables' owner makes
 *   every table and function, in migrations; nobody else needs to.
 * - **No TEMP on the database for PUBLIC.** The application and the worker
 *   make no temporary tables; the two definer functions that do run as the
 *   tables' owner, which keeps TEMP — as the database's owner when it is,
 *   and by an explicit grant otherwise. CONNECT, which PUBLIC keeps, is
 *   granted to the two roles by name as well, so they do not hang on
 *   PUBLIC's.
 * - **The temporary tables are named as `pg_temp.…`** in both functions,
 *   every mention — the `drop`, the `create`, and inside `format(…)` — and
 *   the tables they read through `format` as `public.%I`, so neither
 *   reading depends on the path at all.
 *
 * Each statement is right whatever the grants were before: a revoke of
 * what is not there and a grant of what is are both nothing. Production's
 * grants could not be read from here; this is written to hold either way,
 * and on a server of one's own (the compose file's `tracker`, a superuser
 * and the database's owner) it changes only PUBLIC's.
 *
 * And the path rule made strict: `pg_temp` last, not merely named.
 * 297 took any path that named `pg_temp`, `pg_temp, public` included,
 * which reads the temporary schema first. Every definer function in
 * `public` whose path does not end in `pg_temp` is set to
 * `public, pg_temp` here; `definer-search-path.test.ts` asks the same.
 *
 * Otherwise `purge_orphan_actors` is migration 155's and
 * `account_deletion` is 291's.
 */

revoke create on schema public from public;

do $$
begin
  execute format('revoke temporary on database %I from public', current_database());
  execute format('grant connect on database %I to tracker_app, tracker_worker', current_database());
  /* The definers that make temporary tables run as the tables' owner —
     the role running this. The database's owner holds TEMP already; any
     other owner is given it by name. */
  execute format('grant temporary on database %I to %I', current_database(), current_user);
end $$;

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
        where c ~ '^search_path=.*,\s*pg_temp$'
      )
  loop
    execute format('alter routine %s set search_path = public, pg_temp', f.signature);
  end loop;
end $$;

create or replace function purge_orphan_actors() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  todo text[];
  left_over text[];
  t text;
  moved boolean;
  n integer;
begin
  drop table if exists pg_temp.orphan;
  create temporary table pg_temp.orphan on commit drop as
  select a.id from actor a
  where not exists (select 1 from membership m where m.actor_id = a.id)
    and not exists (select 1 from instance_owner o where o.actor_id = a.id);

  /* Not anybody named as the author of something that is still here. */
  for t in
    select table_name::text from information_schema.columns
    where table_schema = 'public' and column_name = 'author_id'
  loop
    execute format('delete from pg_temp.orphan where id in (select author_id from public.%I)', t);
  end loop;

  select count(*) into n from pg_temp.orphan;
  if n = 0 then return 0; end if;

  select array_agg(table_name::text) into todo
  from information_schema.columns
  where table_schema = 'public' and column_name = 'actor_id';

  loop
    moved := false;
    left_over := '{}';
    foreach t in array todo loop
      begin
        execute format('delete from public.%I where actor_id in (select id from pg_temp.orphan)', t);
        moved := true;
      exception when foreign_key_violation then
        left_over := left_over || t;
      end;
    end loop;
    todo := left_over;
    exit when cardinality(todo) = 0;
    if not moved then
      raise exception 'could not clear actors: %', todo;
    end if;
  end loop;

  delete from actor where id in (select id from pg_temp.orphan);
  return n;
end $$;

create or replace function account_deletion(p_actor uuid, p_dry boolean) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_alone json;
  v_blocked json;
  v_leaves json;
  w record;
  t text;
  todo text[];
  left_over text[];
  moved boolean;
begin
  if not exists (select 1 from app_user where actor_id = p_actor) then
    return json_build_object('ok', false, 'why', 'not_found');
  end if;

  -- Their memberships held for the length of this, as `leave_workspace`
  -- holds them: a workspace handed to them mid-deletion would be read as
  -- theirs, never left, and its owner row ended with their agents standing.
  perform 1 from membership where actor_id = p_actor and deleted_at is null
  order by workspace_id for update;

  drop table if exists pg_temp.owned;
  create temporary table pg_temp.owned on commit drop as
  select ws.id, ws.name, ws.icon_key,
         (select count(*) from membership o
          where o.workspace_id = ws.id and o.actor_id <> p_actor
            and o.deleted_at is null and o.joined_at is not null
            -- People, not agents: an owner alone with their own agents has
            -- nobody to hand the workspace to.
            and not exists (select 1 from agent g where g.actor_id = o.actor_id))::int as others,
         exists (select 1 from membership o
                 where o.workspace_id = ws.id and o.actor_id <> p_actor and o.role = 'owner'
                   and o.deleted_at is null and o.joined_at is not null
                   and not exists (select 1 from agent g where g.actor_id = o.actor_id)) as co_owned
  from workspace ws
  join membership m on m.workspace_id = ws.id
  where m.actor_id = p_actor and m.role = 'owner' and m.deleted_at is null and ws.deleted_at is null;

  select json_agg(json_build_object('id', id, 'name', name) order by name) into v_alone
  from pg_temp.owned where others = 0;
  select json_agg(json_build_object('id', id, 'name', name, 'people', others) order by name) into v_blocked
  from pg_temp.owned where others > 0 and not co_owned;
  select json_agg(json_build_object('id', ws.id, 'name', ws.name) order by ws.name) into v_leaves
  from workspace ws join membership m on m.workspace_id = ws.id
  where m.actor_id = p_actor and m.deleted_at is null and ws.deleted_at is null
    and ws.id not in (select id from pg_temp.owned where others = 0);

  if p_dry or v_blocked is not null then
    return json_build_object(
      'ok', v_blocked is null and p_dry,
      'why', case when v_blocked is not null then 'sole_owner' end,
      'alone', coalesce(v_alone, '[]'::json),
      'blocked', coalesce(v_blocked, '[]'::json),
      'leaves', coalesce(v_leaves, '[]'::json));
  end if;

  for w in select id, icon_key from pg_temp.owned where others = 0 loop
    if w.icon_key is not null then
      insert into storage_orphan (key) values (w.icon_key) on conflict do nothing;
    end if;
    perform purge_workspace(w.id);
  end loop;

  -- Every workspace they stay out of, left as a leaver leaves it: their
  -- agents ended with their tokens, OAuth pairs, webhooks and places; the
  -- Slack channels they linked stopped; their unused invitations withdrawn;
  -- that workspace's sessions, tokens, pushes and follows ended.
  for w in select m.workspace_id as id from membership m
           where m.actor_id = p_actor and m.deleted_at is null and m.role <> 'owner'
           order by m.workspace_id loop
    perform workspace_member_end(w.id, p_actor);
  end loop;

  update membership set deleted_at = now() where actor_id = p_actor and deleted_at is null;
  update project_member set deleted_at = now() where actor_id = p_actor and deleted_at is null;

  delete from refresh_session where actor_id = p_actor;
  update api_token set revoked_at = now(), refresh_hash = null, updated_at = now()
  where actor_id = p_actor and revoked_at is null;
  delete from push_subscription where actor_id = p_actor;
  delete from auth_identity where actor_id = p_actor;
  -- The person's own, whether or not other workspaces keep their name.
  delete from recovery_code where actor_id = p_actor;
  delete from instance_applicant where actor_id = p_actor;
  delete from auth_ticket where actor_id = p_actor;
  delete from app_user where actor_id = p_actor;
  insert into storage_orphan (key)
  select avatar_key from actor where id = p_actor and avatar_key is not null
  on conflict do nothing;
  update actor
  set name = 'Deleted account', title = null, avatar_url = null, avatar_key = null, updated_at = now()
  where id = p_actor;

  if not exists (select 1 from membership where actor_id = p_actor) then
    select array_agg(table_name::text) into todo
    from information_schema.columns
    where table_schema = 'public' and column_name = 'actor_id' and table_name <> 'actor';
    loop
      moved := false;
      left_over := '{}';
      foreach t in array todo loop
        begin
          execute format('delete from public.%I where actor_id = $1', t) using p_actor;
          moved := true;
        exception when foreign_key_violation then
          left_over := left_over || t;
        end;
      end loop;
      todo := left_over;
      exit when cardinality(todo) = 0;
      if not moved then exit; end if;
    end loop;
    begin
      delete from actor where id = p_actor;
    exception when foreign_key_violation then
      null;
    end;
  end if;

  return json_build_object('ok', true, 'alone', coalesce(v_alone, '[]'::json), 'leaves', coalesce(v_leaves, '[]'::json));
end $$;
