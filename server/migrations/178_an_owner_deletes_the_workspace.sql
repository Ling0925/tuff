/*
 * An owner deletes the workspace.
 *
 * Marked, not removed: the workspace and everybody's place in it go dark in
 * one moment, what was held for it — sessions, tokens, agents, push, GitHub,
 * Slack, imports, public links — is ended, its paid plan with it, and the
 * hourly clear-out takes the rest after thirty days. Within them an
 * operator can put it back. Accounts stay.
 */

/* What has failed to clear, so one that never will does not hold the rest back. */
alter table workspace add column purge_tries int not null default 0;

/*
 * The one door that does not go through a membership row is a session for a
 * workspace: none is honoured for a deleted one, whatever else was left.
 */
create or replace function auth_context(p_actor uuid, p_workspace uuid)
returns table (role text, settings jsonb, rights json,
               may_create_projects boolean, may_create_channels boolean,
               operator boolean, plan text,
               may_see_members boolean, may_invite_people boolean,
               may_connect_agents boolean, agent boolean)
language sql stable security definer set search_path = public as $$
  select m.role::text, w.settings,
         coalesce((
           select json_agg(json_build_object('p', pm.project_id, 'r', pm.rights))
           from project_member pm
           where pm.actor_id = m.actor_id and pm.workspace_id = m.workspace_id
             and pm.deleted_at is null
         ), '[]'),
         m.may_create_projects, m.may_create_channels,
         exists (select 1 from operator o where o.actor_id = p_actor),
         w.plan,
         m.may_see_members, m.may_invite_people,
         m.may_connect_agents,
         exists (select 1 from agent g where g.actor_id = p_actor and g.deleted_at is null)
  from membership m join workspace w on w.id = m.workspace_id
  where m.actor_id = p_actor and m.workspace_id = p_workspace
    and m.deleted_at is null and m.joined_at is not null
    and w.deleted_at is null
$$;

/*
 * Nobody joins a workspace that is going: an invitation accepted, an agent
 * connected, a place put back, in the moment it is deleted. The workspace's
 * row is shared-locked here and locked outright by the deletion, so one
 * waits for the other and sees what it did.
 */
create function membership_needs_a_live_workspace() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from workspace where id = new.workspace_id and deleted_at is null for share;
  if not found then
    raise exception 'workspace_deleted';
  end if;
  return new;
end $$;
create trigger membership_needs_a_live_workspace
  before insert or update of deleted_at on membership
  for each row when (new.deleted_at is null)
  execute function membership_needs_a_live_workspace();

/*
 * The owner's, for the workspace they are in. A dry run says what would go
 * and which paid plans to stop first; the real one does it and says who to
 * tell. Nothing for anybody but a joined owner of a workspace not deleted.
 */
create function delete_workspace(p_dry boolean) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  ws uuid := current_workspace();
  at timestamptz := now();
  w record;
  people jsonb;
begin
  -- Locked first: an invitation accepted or a hand-over in this moment
  -- waits for this, and finds it done.
  select id, name into w from workspace where id = ws and deleted_at is null for update;
  if w is null or not exists (
    select 1 from membership m
    where m.workspace_id = ws and m.actor_id = current_actor() and m.role = 'owner'
      and m.deleted_at is null and m.joined_at is not null) then
    return jsonb_build_object('ok', false);
  end if;

  if p_dry then
    return jsonb_build_object(
      'ok', true,
      'name', w.name,
      'projects', (select count(*) from project p where p.workspace_id = ws and p.deleted_at is null),
      'people', (select count(*) from membership m where m.workspace_id = ws and m.deleted_at is null
                   and m.joined_at is not null
                   and not exists (select 1 from agent g where g.actor_id = m.actor_id)),
      'agents', (select count(*) from agent g where g.workspace_id = ws and g.deleted_at is null),
      'subscriptions', coalesce((select jsonb_agg(b.id) from billing_subscription b
                                 where b.workspace_id = ws and b.ended_at is null
                                   and b.status in ('active', 'trialing', 'past_due', 'incomplete')), '[]'::jsonb));
  end if;

  -- Who to tell, read before their places go: the people, not the agents.
  select coalesce(jsonb_agg(m.actor_id), '[]'::jsonb) into people
  from membership m join app_user u on u.actor_id = m.actor_id
  where m.workspace_id = ws and m.deleted_at is null and m.joined_at is not null;

  -- One moment for all of it: what an operator puts back is what went now.
  update workspace set deleted_at = at, updated_at = at, plan = 'solo' where id = ws;
  update membership set deleted_at = at, updated_at = at where workspace_id = ws and deleted_at is null;
  update project_member set deleted_at = at, updated_at = at where workspace_id = ws and deleted_at is null;
  update invite set deleted_at = at, updated_at = at where workspace_id = ws and used_at is null and deleted_at is null;

  -- Its paid plan ended here too: Polar's answer to the revoke lands on a
  -- deleted workspace and is set aside, and one put back is not paid for.
  update billing_subscription set status = 'canceled', ended_at = coalesce(ended_at, at), updated_at = at
  where workspace_id = ws and ended_at is null;

  update refresh_session set revoked_at = coalesce(revoked_at, at), ended_at = at
  where workspace_id = ws and ended_at is null;
  update api_token set revoked_at = at, refresh_hash = null, updated_at = at
  where workspace_id = ws and revoked_at is null;
  update push_subscription set deleted_at = at, updated_at = at where workspace_id = ws and deleted_at is null;

  update agent set deleted_at = at where workspace_id = ws and deleted_at is null;
  update webhook set enabled = false, deleted_at = at, updated_at = at where workspace_id = ws and deleted_at is null;

  -- A document shared by link is read by nobody now.
  update file set public_token = null where workspace_id = ws and public_token is not null;

  -- An import still running stops, and the key it read with goes.
  update linear_import set state = 'failed', key_enc = null where workspace_id = ws and state = 'running';

  update github_link set stopped_at = coalesce(stopped_at, at), deleted_at = at where workspace_id = ws and deleted_at is null;
  update github_install set deleted_at = at where workspace_id = ws and deleted_at is null;
  update slack_link set stopped_at = coalesce(stopped_at, at), stopped = coalesce(stopped, 'workspace_deleted'), deleted_at = at
  where workspace_id = ws and deleted_at is null;
  update slack_connection set deleted_at = at where workspace_id = ws and deleted_at is null;

  insert into security_event (id, workspace_id, actor_id, kind, meta)
  values (gen_random_uuid(), ws, current_actor(), 'workspace.delete', jsonb_build_object('name', w.name));

  return jsonb_build_object('ok', true, 'name', w.name, 'people', people);
end $$;
revoke all on function delete_workspace(boolean) from public;
grant execute on function delete_workspace(boolean) to tracker_app;

/*
 * Put back, within the thirty days, by an operator at the owner's request.
 * Found by its address, which the owner can tell us and the listing does
 * not show for a deleted workspace. The memberships and places marked in
 * the moment it went come back — not ones that had gone before, not the
 * agents', and not the people whose accounts have been deleted since; an
 * owner whose account is gone means there is nobody to give it back to.
 * Sessions, tokens, agents, integrations and the plan stay ended.
 */
create function operator_restore_workspace(p_slug text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  w record;
begin
  if not is_operator() then
    return 'not_found';
  end if;
  select id, deleted_at into w from workspace where lower(slug::text) = lower(trim(p_slug)) for update;
  if w.id is null then
    return 'not_found';
  end if;
  if w.deleted_at is null or w.deleted_at < now() - interval '30 days' then
    return 'gone';
  end if;
  if not exists (
    select 1 from membership m join app_user u on u.actor_id = m.actor_id
    join actor a on a.id = m.actor_id and a.deleted_at is null
    where m.workspace_id = w.id and m.deleted_at = w.deleted_at and m.role = 'owner') then
    return 'owner_gone';
  end if;
  update workspace set deleted_at = null, updated_at = now() where id = w.id;
  update membership m set deleted_at = null, updated_at = now()
  where m.workspace_id = w.id and m.deleted_at = w.deleted_at
    and exists (select 1 from app_user u join actor a on a.id = u.actor_id and a.deleted_at is null
                where u.actor_id = m.actor_id);
  update project_member pm set deleted_at = null, updated_at = now()
  where pm.workspace_id = w.id and pm.deleted_at = w.deleted_at
    and exists (select 1 from membership m where m.workspace_id = w.id and m.actor_id = pm.actor_id
                  and m.deleted_at is null);
  insert into security_event (id, workspace_id, actor_id, kind, meta)
  values (gen_random_uuid(), w.id, current_actor(), 'workspace.restore', '{}'::jsonb);
  return 'ok';
end $$;
revoke all on function operator_restore_workspace(text) from public;
grant execute on function operator_restore_workspace(text) to tracker_app;

/*
 * After the days: the workspace and everything in it, its files with it.
 * The worker passes the same days the rest of the clear-out keeps. One that
 * fails is tried again, after the ones that have not failed — a workspace
 * that never clears does not keep the others for ever.
 */
create function purge_deleted_workspaces(p_days int) returns integer
language plpgsql volatile security definer set search_path = public as $$
declare
  w record;
  n integer := 0;
begin
  for w in
    select id, icon_key from workspace
    where deleted_at is not null and deleted_at < now() - make_interval(days => p_days)
    order by purge_tries, deleted_at
    limit 10
  loop
    begin
      -- Its files' bytes are queued by the triggers on file and project.
      if w.icon_key is not null then
        insert into storage_orphan (key) values (w.icon_key) on conflict do nothing;
      end if;
      perform purge_workspace(w.id);
      n := n + 1;
    exception when others then
      update workspace set purge_tries = purge_tries + 1 where id = w.id;
      raise warning 'purge: workspace % could not go: %', w.id, sqlerrm;
    end;
  end loop;
  return n;
end $$;
revoke all on function purge_deleted_workspaces(int) from public;
grant execute on function purge_deleted_workspaces(int) to tracker_worker;
