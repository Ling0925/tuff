/*
 * A person deletes their own account.
 *
 * The operator could delete an account, for somebody who wrote in; the
 * person now does it themself, through the same steps. Those steps move
 * here, into `account_deletion`, which nobody but these definer functions
 * may call: `operator_delete_account` asks whether the caller is an
 * operator first, `delete_my_account` deletes only the caller.
 */
create function account_deletion(p_actor uuid, p_dry boolean) returns json
language plpgsql security definer set search_path = public as $$
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

  drop table if exists owned;
  create temporary table owned on commit drop as
  select ws.id, ws.name, ws.icon_key,
         (select count(*) from membership o
          where o.workspace_id = ws.id and o.actor_id <> p_actor
            and o.deleted_at is null and o.joined_at is not null)::int as others,
         exists (select 1 from membership o
                 where o.workspace_id = ws.id and o.actor_id <> p_actor and o.role = 'owner'
                   and o.deleted_at is null and o.joined_at is not null) as co_owned
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

  update membership set deleted_at = now() where actor_id = p_actor and deleted_at is null;
  update project_member set deleted_at = now() where actor_id = p_actor and deleted_at is null;

  delete from refresh_session where actor_id = p_actor;
  update api_token set revoked_at = now() where actor_id = p_actor and revoked_at is null;
  delete from push_subscription where actor_id = p_actor;
  delete from auth_identity where actor_id = p_actor;
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

create or replace function operator_delete_account(p_actor uuid, p_dry boolean default false) returns json
language plpgsql security definer set search_path = public as $$
begin
  if not is_operator() or not exists (select 1 from app_user where actor_id = p_actor) then
    return json_build_object('ok', false, 'why', 'not_found');
  end if;
  if p_actor = current_actor() then
    return json_build_object('ok', false, 'why', 'self');
  end if;
  if exists (select 1 from operator where actor_id = p_actor) then
    return json_build_object('ok', false, 'why', 'operator');
  end if;
  return account_deletion(p_actor, p_dry);
end $$;

/*
 * The caller's own. The server has asked for their password, or their
 * address where they have none, before it calls this without `p_dry`.
 */
create function delete_my_account(p_dry boolean) returns json
language plpgsql security definer set search_path = public as $$
begin
  if current_actor() is null then
    return json_build_object('ok', false, 'why', 'not_found');
  end if;
  if exists (select 1 from operator where actor_id = current_actor()) then
    return json_build_object('ok', false, 'why', 'operator');
  end if;
  return account_deletion(current_actor(), p_dry);
end $$;
grant execute on function delete_my_account(boolean) to tracker_app;

/*
 * The paid subscriptions of the workspaces that would go with the caller —
 * the ones they own and are alone in — so they are revoked at Polar before
 * the workspace is, and a deleted account is not charged again.
 */
create function my_lone_subscriptions() returns table (id text)
language sql stable security definer set search_path = public as $$
  select b.id from billing_subscription b
  join membership m on m.workspace_id = b.workspace_id and m.actor_id = current_actor()
    and m.role = 'owner' and m.deleted_at is null
  where b.ended_at is null and b.status in ('active', 'trialing', 'past_due', 'incomplete')
    and not exists (select 1 from membership o where o.workspace_id = b.workspace_id
                      and o.actor_id <> current_actor() and o.deleted_at is null and o.joined_at is not null)
$$;
grant execute on function my_lone_subscriptions() to tracker_app;
