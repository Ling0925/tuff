/*
 * An operator deletes an account.
 *
 * The admin said it did not do this, on the grounds that nobody had asked.
 * Somebody has: test accounts, accounts made with the wrong address, and
 * whoever writes in asking to be gone.
 *
 * What goes, and what stays:
 *
 * - A workspace that is theirs alone — nobody else in it — goes with them,
 *   rows and files.
 * - A workspace they alone own with other people in it stops the deletion:
 *   somebody else there has to be made its owner first. Deleting the
 *   account would leave a team with nobody who can run it, and choosing one
 *   for them is not an operator's to do.
 * - Everywhere else they are taken out as a member is removed.
 * - The account — address, password, sign-ins, sessions, tokens, devices —
 *   goes, so the address is free to sign up with again.
 * - What they said and did in a workspace that stays is the team's record:
 *   it stays, under "Deleted account", with no name or picture of theirs.
 *   Somebody whose every trace was in their own workspaces is removed
 *   altogether.
 *
 * `p_dry` answers what would happen without doing it, for the window that
 * asks first.
 */
create function operator_delete_account(p_actor uuid, p_dry boolean default false) returns json
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
  if not is_operator() or not exists (select 1 from app_user where actor_id = p_actor) then
    return json_build_object('ok', false, 'why', 'not_found');
  end if;
  if p_actor = current_actor() then
    return json_build_object('ok', false, 'why', 'self');
  end if;
  if exists (select 1 from operator where actor_id = p_actor) then
    return json_build_object('ok', false, 'why', 'operator');
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

  -- Theirs alone: gone, bytes queued by the triggers on file and project.
  for w in select id, icon_key from owned where others = 0 loop
    if w.icon_key is not null then
      insert into storage_orphan (key) values (w.icon_key) on conflict do nothing;
    end if;
    perform purge_workspace(w.id);
  end loop;

  -- Everywhere else, out as a removed member is.
  update membership set deleted_at = now() where actor_id = p_actor and deleted_at is null;
  update project_member set deleted_at = now() where actor_id = p_actor and deleted_at is null;

  -- The account.
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
  set name = 'Deleted account', title = null, avatar_url = null, avatar_key = null,
      deleted_at = now(), updated_at = now()
  where id = p_actor;

  /* Nothing of theirs left anywhere anybody can see: the person goes too,
     with whatever else names them. Tables are found rather than listed, as
     `purge_orphan_actors` finds them. */
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
      -- Named somewhere still: it stays, as "Deleted account".
      null;
    end;
  end if;

  return json_build_object('ok', true, 'alone', coalesce(v_alone, '[]'::json), 'leaves', coalesce(v_leaves, '[]'::json));
end $$;
grant execute on function operator_delete_account(uuid, boolean) to tracker_app;
