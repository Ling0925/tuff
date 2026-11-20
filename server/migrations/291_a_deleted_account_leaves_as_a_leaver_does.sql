/*
 * A deleted account leaves every workspace it stays out of as a leaver
 * does.
 *
 * `account_deletion` (migration 130) ended the person's own rows: their
 * memberships, places on projects, sessions, tokens, pushes, sign-ins. It
 * was written before an agent was a participant (173), before a Slack
 * channel was linked by somebody (the linker's link stops with them), and
 * long before leaving moved removal's body into `workspace_member_end`
 * (273). So deleting an account left behind what leaving ends: the agents
 * they connected, with their year-long tokens, their places and an enabled
 * webhook; the Slack channels they linked; the invitations they made and
 * nobody used. An agent of a deleted account went on reading its owner's
 * chats.
 *
 * Now every workspace the account stays out of — every one it is not
 * deleted with — is ended through `workspace_member_end`, the same body
 * removal and leaving call, so the three cannot drift apart again. It is
 * called before the blanket ending below, because it acts on a live row
 * and does nothing for one already ended.
 *
 * The owner is left as 130 left them. A workspace has one owner (119);
 * the one they own alone goes with them (`purge_workspace`), and one they
 * own with other people in it refuses the deletion (`sole_owner`) before
 * anything is touched. So every row still live when the loop runs is
 * somebody else's workspace, and `workspace_member_end` — which never ends
 * an owner's row — ends each of them.
 *
 * Otherwise the function is 130's. Changes no rows: an account deleted
 * before this, whose agents still stand, is a separate clean-up that runs
 * first on a copy of production.
 */
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

  drop table if exists owned;
  create temporary table owned on commit drop as
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
  from owned where others = 0;
  select json_agg(json_build_object('id', id, 'name', name, 'people', others) order by name) into v_blocked
  from owned where others > 0 and not co_owned;
  select json_agg(json_build_object('id', ws.id, 'name', ws.name) order by ws.name) into v_leaves
  from workspace ws join membership m on m.workspace_id = ws.id
  where m.actor_id = p_actor and m.deleted_at is null and ws.deleted_at is null
    and ws.id not in (select id from owned where others = 0);

  if p_dry or v_blocked is not null then
    return json_build_object(
      'ok', v_blocked is null and p_dry,
      'why', case when v_blocked is not null then 'sole_owner' end,
      'alone', coalesce(v_alone, '[]'::json),
      'blocked', coalesce(v_blocked, '[]'::json),
      'leaves', coalesce(v_leaves, '[]'::json));
  end if;

  for w in select id, icon_key from owned where others = 0 loop
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
          execute format('delete from %I where actor_id = $1', t) using p_actor;
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
revoke all on function account_deletion(uuid, boolean) from public;

-- The ways in, and the purge they call, look for tables in `public` only:
-- without `pg_temp` last, a temporary table named `membership` made by the
-- application role was read first, and a dry run listed another company's
-- workspace as the caller's own (the review of).
alter function delete_my_account(boolean) set search_path = public, pg_temp;
alter function operator_delete_account(uuid, boolean) set search_path = public, pg_temp;
alter function purge_workspace(uuid) set search_path = public, pg_temp;
