/*
 * Removing somebody from a workspace ends everything they had in it —
 * `docs/specs/removing-someone.md`.
 *
 * Removal set `membership.deleted_at` and nothing else. Every request was
 * refused from then on, but what the person had set going kept going: an
 * invitation they had posted let them walk back in, their tokens and the
 * agents connected through OAuth came back to life the day they were
 * invited again (and the OAuth ones kept minting themselves new tokens in
 * the meantime), their phones kept being sent the workspace's pushes, they
 * stayed in its channels, their open tasks became tasks nobody could see
 * or take them off, and a Slack channel they had linked kept being posted to.
 */

/* Whether somebody is in a workspace now. */
create function member_alive(p_actor uuid, p_workspace uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from membership
    where workspace_id = p_workspace and actor_id = p_actor and deleted_at is null
  )
$$;
grant execute on function member_alive(uuid, uuid) to tracker_app;

/*
 * The removal itself, by the workspace's owner, in one transaction. As the
 * owner, through a definer: the rows it ends are the removed person's own,
 * which the policies rightly do not let anybody else touch one by one.
 */
create function remove_from_workspace(p_target uuid) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  ws uuid := current_workspace();
begin
  if ws is null or p_target = current_actor() or not exists (
    select 1 from membership
    where workspace_id = ws and actor_id = current_actor() and role = 'owner' and deleted_at is null
  ) then
    return false;
  end if;

  update membership set deleted_at = now()
  where workspace_id = ws and actor_id = p_target and deleted_at is null;
  if not found then
    return false;
  end if;
  update project_member set deleted_at = now()
  where workspace_id = ws and actor_id = p_target and deleted_at is null;

  -- What they handed out: nobody walks back in on a link of theirs.
  update invite set deleted_at = now()
  where workspace_id = ws and created_by = p_target and used_at is null and deleted_at is null;

  -- What they hold for this workspace: its sessions on their devices, their
  -- tokens and an agent's OAuth pair, its pushes, what they followed. A
  -- device that slept through the removal came back signed in the day they
  -- were invited again.
  update refresh_session set revoked_at = coalesce(revoked_at, now()), ended_at = now()
  where workspace_id = ws and actor_id = p_target and ended_at is null;
  update subscription set deleted_at = now()
  where workspace_id = ws and actor_id = p_target and deleted_at is null;
  update api_token set revoked_at = now(), refresh_hash = null, updated_at = now()
  where workspace_id = ws and actor_id = p_target and revoked_at is null;
  delete from push_subscription where workspace_id = ws and actor_id = p_target;
  update notification set deleted_at = now()
  where workspace_id = ws and actor_id = p_target and deleted_at is null;

  -- Out of its channels, as leaving one is, and out of a group's direct
  -- conversation, which goes on without them: back, they would read what
  -- was said while they were out. A conversation of two keeps them, so it
  -- still says who it was with — it takes nothing more (`others_gone`).
  update conversation_member cm set joined_at = null, updated_at = now()
  from conversation cv
  where cv.id = cm.conversation_id
    and cm.workspace_id = ws and cm.actor_id = p_target
    and cm.joined_at is not null and cm.deleted_at is null
    and (cv.channel or (
      select count(*) from conversation_member o
      where o.conversation_id = cv.id and o.actor_id <> p_target
        and o.joined_at is not null and o.deleted_at is null) > 1);

  -- Off every open task: nobody's, rather than somebody's nobody can see.
  -- A finished one keeps their name, as the record of who did it.
  update task set assignee_ids = array_remove(assignee_ids, p_target), updated_at = now()
  where workspace_id = ws and assignee_ids @> array[p_target]
    and completed_at is null and deleted_at is null;

  -- A Slack channel they chose stops being posted to.
  update slack_link set stopped_at = now(), stopped = 'linker_removed'
  where workspace_id = ws and linked_by = p_target and stopped_at is null;

  return true;
end $$;
grant execute on function remove_from_workspace(uuid) to tracker_app;

/* A room asks for a live membership as well as a place in it: an open
   socket, a queued push and anything else that asks stopped only when it
   happened to check the session too. */
create or replace function can_see_conversation(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from conversation cv
    where cv.id = c and cv.deleted_at is null
      and (current_workspace() is null or cv.workspace_id = current_workspace())
      and exists (select 1 from membership mm where mm.workspace_id = cv.workspace_id and mm.actor_id = current_actor() and mm.joined_at is not null and mm.deleted_at is null)
      and (cv.project_id is null or in_project(cv.project_id))
      and (
        exists (
          select 1 from conversation_member cm
          where cm.conversation_id = cv.id and cm.actor_id = current_actor()
            and cm.joined_at is not null and cm.deleted_at is null
        )
        or (
          cv.project_id is not null
          and not exists (
            select 1 from conversation_member cm
            where cm.conversation_id = cv.id and cm.joined_at is not null
              and cm.deleted_at is null
          )
        )
      )
  )
$$;

create or replace function visible_conversations() returns setof uuid
language sql stable security definer set search_path = public as $$
  select cv.id from conversation_member cm
  join conversation cv on cv.id = cm.conversation_id
  where cm.actor_id = current_actor() and cm.joined_at is not null and cm.deleted_at is null
    and cv.deleted_at is null
    and (current_workspace() is null or cv.workspace_id = current_workspace())
    and exists (select 1 from membership mm where mm.workspace_id = cv.workspace_id and mm.actor_id = current_actor() and mm.joined_at is not null and mm.deleted_at is null)
    and (cv.project_id is null or cv.project_id in (select visible_projects()))
  union
  select cv.id from conversation cv
  where cv.project_id in (select visible_projects()) and cv.deleted_at is null
    and not exists (
      select 1 from conversation_member cm
      where cm.conversation_id = cv.id and cm.joined_at is not null and cm.deleted_at is null
    )
$$;

/* Who is in a room: not somebody removed, who could be mentioned there and
   would hear nothing. */
create or replace function channel_members(p_conversation uuid)
returns table (actor_id uuid, name text, avatar_key text)
language sql stable security definer set search_path = public as $$
  with room as (
    select * from conversation where id = p_conversation and deleted_at is null
  ),
  chosen as (
    select cm.actor_id from conversation_member cm, room
    where cm.conversation_id = room.id and cm.joined_at is not null
      and cm.deleted_at is null
  )
  , who as (
    select actor_id from chosen
    union
    select pm.actor_id
    from project_member pm, room
    where not exists (select 1 from chosen)
      and pm.project_id = room.project_id and pm.deleted_at is null
  )
  /* From the room's people to their names, never from every actor there
     is; and only those still in the workspace. */
  select a.id, a.name, a.avatar_key
  from who
  join actor a on a.id = who.actor_id
  join room on true
  join membership m on m.workspace_id = room.workspace_id and m.actor_id = a.id and m.deleted_at is null
  where can_see_conversation(p_conversation)
  order by a.name
$$;

create or replace function accept_invite(
  p_token_hash text,
  p_actor_id uuid,
  p_name text,
  p_email citext,
  p_password_hash text
) returns table (workspace_id uuid, actor_id uuid, created_account boolean)
language plpgsql security definer set search_path = public as $$
declare
  inv     record;
  v_actor uuid;
  v_new   boolean := false;
  p       uuid;
  v_cap   integer;
begin
  update invite set used_at = now()
  where token_hash = p_token_hash
    and used_at is null
    and deleted_at is null
    and expires_at > now()
  returning * into inv;

  if inv is null then
    return;
  end if;

  select u.actor_id into v_actor from app_user u where u.email = p_email;

  /*
   * Somebody removed after this invitation was made does not come back on
   * it — a link they posted in a channel, or one somebody kept. Only an
   * invitation made since they were removed brings them back. Given back
   * rather than burned: it may be meant for somebody else.
   * `docs/specs/removing-someone.md`.
   */
  if v_actor is not null and exists (
    select 1 from membership m
    where m.workspace_id = inv.workspace_id and m.actor_id = v_actor
      and m.deleted_at is not null and m.deleted_at > inv.created_at
  ) and not exists (
    select 1 from membership m
    where m.workspace_id = inv.workspace_id and m.actor_id = v_actor and m.deleted_at is null
  ) then
    update invite set used_at = null where id = inv.id;
    return;
  end if;

  /*
   * The ceiling, before anything is written and after the invite is known
   * to be good.
   *
   * Only for somebody who is not already in: accepting a second invite to a
   * a workspace you are in adds no row, and refusing it would lock a member
   * out of their own workspace for being the eleventh person to be invited.
   */
  select plan_people(w.plan) into v_cap from workspace w where w.id = inv.workspace_id;
  if v_cap is not null
     and not exists (select 1 from membership m
                     where m.workspace_id = inv.workspace_id
                       and m.actor_id = v_actor and m.deleted_at is null)
     and workspace_people(inv.workspace_id) >= v_cap then
    -- The invite is given back rather than burned: the owner upgrades and
    -- the same link works, instead of having to issue it again.
    update invite set used_at = null where id = inv.id;
    raise exception 'workspace_full' using errcode = 'check_violation';
  end if;

  if v_actor is null then
    v_actor := p_actor_id;
    v_new := true;
    insert into actor (id, name) values (v_actor, p_name);
    insert into app_user (actor_id, email, password_hash, email_verified_at)
      values (v_actor, p_email, p_password_hash, now());
  end if;

  insert into membership (id, workspace_id, actor_id, role, invited_by, joined_at)
  values (gen_random_uuid(), inv.workspace_id, v_actor, inv.role, inv.created_by, now())
  on conflict do nothing;

  foreach p in array inv.project_ids
  loop
    insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
    values (gen_random_uuid(), inv.workspace_id, p, v_actor, inv.created_by, inv.rights)
    on conflict do nothing;
  end loop;

  update invite set used_by = v_actor where id = inv.id;

  insert into security_event (id, workspace_id, actor_id, kind, meta)
  values (gen_random_uuid(), inv.workspace_id, v_actor, 'invite_accepted',
          jsonb_build_object('role', inv.role, 'rights', inv.rights));

  return query select inv.workspace_id, v_actor, v_new;
end $$;
