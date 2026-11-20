/*
 * Three ways to leave.
 *
 * 1. A workspace, by the person themselves. Removal was the owner's alone
 *    (`remove_from_workspace` refuses the caller as its own target), and the
 *    only other way out was deleting the whole account. Leaving does exactly
 *    what removal does — the same body, moved into `workspace_member_end`
 *    so the two cannot drift apart — for the caller, never for the owner,
 *    who hands the workspace over first, and never for an agent.
 *
 * 2. An open project channel: `conversation_member.left_at`. A room of
 *    chosen people is left by ending your place in it, as being unticked
 *    does; an open one cannot be, because "nobody chosen" is everybody on
 *    the project, so leaving it is putting it away muted, for good — a room
 *    left does not come back out when somebody speaks in it, as a hidden one
 *    does. Showing it in the list again clears it.
 *
 * 3. Following a post or a document needs nothing here: `subscription` is
 *    keyed by `(object_type, object_id)` already.
 *
 * And `people.leave` joins the audit log beside `people.remove`.
 *
 * Nothing here rewrites rows.
 */

/* ------------------------------------------------------------ the one body

   What removing somebody ends, for one person in one workspace: the text of
   `remove_from_workspace` (migration 173) from its first update on, so the
   triggers that hang off those rows (`oauth_agent_membership_changed`,
   migration 269, ending the connections they linked) fire for leaving as
   they do for removal. Not callable by the application: it asks nothing,
   and each caller below has asked first. */
create function workspace_member_end(ws uuid, p_target uuid) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  -- Never the owner's row, whoever called: a workspace is not left with
  -- nobody to run it, by a leave racing a hand-over or by anything else.
  update membership set deleted_at = now()
  where workspace_id = ws and actor_id = p_target and deleted_at is null and role <> 'owner';
  if not found then
    return false;
  end if;
  update project_member set deleted_at = now()
  where workspace_id = ws and actor_id = p_target and deleted_at is null;

  -- What they handed out: nobody walks back in on a link of theirs.
  update invite set deleted_at = now()
  where workspace_id = ws and created_by = p_target and used_at is null and deleted_at is null;

  -- What they hold for this workspace: its sessions on their devices, their
  -- tokens and an agent's OAuth pair, its pushes, what they followed.
  update refresh_session set revoked_at = coalesce(revoked_at, now()), ended_at = now()
  where workspace_id = ws and actor_id = p_target and ended_at is null;
  update subscription set deleted_at = now()
  where workspace_id = ws and actor_id = p_target and deleted_at is null;
  update api_token set revoked_at = now(), refresh_hash = null, updated_at = now()
  where workspace_id = ws and actor_id = p_target and revoked_at is null;
  delete from push_subscription where workspace_id = ws and actor_id = p_target;
  update notification set deleted_at = now()
  where workspace_id = ws and actor_id = p_target and deleted_at is null;

  -- Out of its channels, and out of a group's direct conversation, which
  -- goes on without them. A conversation of two keeps them (`others_gone`).
  update conversation_member cm set joined_at = null, updated_at = now()
  from conversation cv
  where cv.id = cm.conversation_id
    and cm.workspace_id = ws and cm.actor_id = p_target
    and cm.joined_at is not null and cm.deleted_at is null
    and (cv.channel or (
      select count(*) from conversation_member o
      where o.conversation_id = cv.id and o.actor_id <> p_target
        and o.joined_at is not null and o.deleted_at is null) > 1);

  -- Off every open task; a finished one keeps their name.
  update task set assignee_ids = array_remove(assignee_ids, p_target), updated_at = now()
  where workspace_id = ws and assignee_ids @> array[p_target]
    and completed_at is null and deleted_at is null;

  -- The agents they connected act with their rights; those go with them.
  perform agent_end(g.actor_id, ws) from agent g
  where g.workspace_id = ws and g.created_by = p_target and g.deleted_at is null;

  -- A Slack channel they chose stops being posted to.
  update slack_link set stopped_at = now(), stopped = 'linker_removed'
  where workspace_id = ws and linked_by = p_target and stopped_at is null;

  return true;
end $$;
revoke all on function workspace_member_end(uuid, uuid) from public;

/* Removal, as 173 wrote it, with its body above. */
create or replace function remove_from_workspace(p_target uuid) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  ws uuid := current_workspace();
begin
  if ws is null or p_target = current_actor() or not exists (
    select 1 from membership
    where workspace_id = ws and actor_id = current_actor() and role = 'owner' and deleted_at is null
  ) then
    return false;
  end if;

  -- An agent taken out from Members is disconnected, whoever connected it.
  if exists (select 1 from agent g where g.actor_id = p_target and g.workspace_id = ws and g.deleted_at is null) then
    perform agent_end(p_target, ws);
    return true;
  end if;

  return workspace_member_end(ws, p_target);
end $$;

/*
 * Leaving: the caller, out of the session's workspace. Never its owner — a
 * workspace has one, and it is handed over (`transfer_workspace`) before
 * they go, or it is left with nobody to run it. Never an agent: what an
 * agent is in is its connector's to decide (`agent_disconnect`). The server
 * asks `can()` first; this asks again on the rows, so a path that forgets
 * still cannot take an owner out.
 */
create function leave_workspace() returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  ws uuid := current_workspace();
  me uuid := current_actor();
  held role_kind;
begin
  if ws is null or me is null then
    return false;
  end if;
  if exists (select 1 from agent g where g.actor_id = me and g.deleted_at is null) then
    return false;
  end if;
  -- Their row held until this transaction ends, so a hand-over to them
  -- (`transfer_workspace`, which locks the same row) waits and then finds
  -- them gone, rather than making an owner of somebody leaving.
  select m.role into held from membership m
  where m.workspace_id = ws and m.actor_id = me
    and m.deleted_at is null and m.joined_at is not null
  for update;
  if held is null or held = 'owner' then
    return false;
  end if;
  return workspace_member_end(ws, me);
end $$;
revoke all on function leave_workspace() from public;
grant execute on function leave_workspace() to tracker_app;

/* ----------------------------------------------------- an open channel left */

alter table conversation_member add column left_at timestamptz;

/* ------------------------------------------------------------- the audit log

   `people.leave` beside `people.remove` — otherwise the index and the page
   as migration 268 wrote them. */
drop index if exists activity_audit;
create index activity_audit on activity_event (workspace_id, at desc, id desc)
  where action in (
    'people.remove', 'people.leave', 'people.rights',
    'project.member.add', 'project.member.remove', 'project.member.rights', 'project.leave',
    'workspace.settings',
    'project.delete', 'project.restore',
    'slack.connect', 'slack.disconnect', 'github.install', 'github.remove',
    'agent.connect', 'agent.disconnect', 'webhook.create', 'webhook.remove',
    'webhook.update', 'agent.reach'
  );

create or replace function audit_page(p_kinds text[], p_who uuid, p_at timestamptz, p_id uuid, p_limit int)
returns table (
  id uuid, kind text, at timestamptz, ip text, user_agent text, meta jsonb, origin text,
  actor_id uuid, actor_name text, subject_id uuid, subject_name text,
  project_id uuid, project_name text
)
language sql stable security definer set search_path = public, pg_temp as $$
  with here as (
    select current_workspace() as ws where role_in(current_workspace()) = 'owner'
  ),
  lines as (
    (select s.id, s.kind, s.at, s.ip, s.user_agent, s.meta, null::text as origin, s.actor_id,
            null::uuid as project_id
     from security_event s, here
     where s.workspace_id = here.ws
       and (p_kinds is null or s.kind = any(p_kinds))
       and (p_who is null or s.actor_id = p_who
            or s.meta->>'actor_id' = p_who::text or s.meta->>'to' = p_who::text)
       and (p_at is null or s.at <= p_at)
       and (p_at is null or (s.at, s.id) < (p_at, p_id))
     order by s.at desc, s.id desc
     limit p_limit)
    union all
    (select a.id, a.action, a.at, null, null, a.meta, a.origin::text, a.actor_id, a.project_id
     from activity_event a, here
     where a.workspace_id = here.ws
       and a.action in (
         'people.remove', 'people.leave', 'people.rights',
         'project.member.add', 'project.member.remove', 'project.member.rights', 'project.leave',
         'workspace.settings',
         'project.delete', 'project.restore',
         'slack.connect', 'slack.disconnect', 'github.install', 'github.remove',
         'agent.connect', 'agent.disconnect', 'webhook.create', 'webhook.remove',
         'webhook.update', 'agent.reach'
       )
       and (p_kinds is null or a.action = any(p_kinds))
       and (p_who is null or a.actor_id = p_who or a.meta->>'actor_id' = p_who::text)
       and (p_at is null or a.at <= p_at)
       and (p_at is null or (a.at, a.id) < (p_at, p_id))
     order by a.at desc, a.id desc
     limit p_limit)
  )
  select l.id, l.kind, l.at, l.ip, l.user_agent, l.meta, l.origin,
         l.actor_id, who.name,
         them.id, them.name,
         l.project_id, pr.name
  from (select * from lines order by at desc, id desc limit p_limit) l
  left join actor who on who.id = l.actor_id
  left join actor them on them.id = case
      when coalesce(l.meta->>'actor_id', l.meta->>'to') ~ '^[0-9a-f-]{36}$'
      then coalesce(l.meta->>'actor_id', l.meta->>'to')::uuid end
  left join project pr on pr.id = l.project_id
  order by l.at desc, l.id desc
$$;
revoke all on function audit_page(text[], uuid, timestamptz, uuid, int) from public;
grant execute on function audit_page(text[], uuid, timestamptz, uuid, int) to tracker_app;

/* ------------------------------------------------------------- the hand-over

   `transfer_workspace` as migration 119 wrote it, with both rows locked
   first and the promotion checked: a hand-over racing the new owner's own
   leave stepped the owner down and then promoted nobody, and the
   workspace had no owner. Now the leave and the hand-over queue on the
   same row, and a promotion that finds nobody raises, taking the
   step-down back with it. */
create or replace function transfer_workspace(p_workspace uuid, p_to uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_from uuid := current_actor();
begin
  if v_from is null or p_to = v_from or p_workspace is distinct from current_workspace() then
    return false;
  end if;
  -- Both rows, in one order whoever asks, so two hand-overs cannot deadlock.
  perform 1 from membership
  where workspace_id = p_workspace and actor_id in (v_from, p_to) and deleted_at is null
  order by actor_id
  for update;
  if not exists (
    select 1 from membership
    where workspace_id = p_workspace and actor_id = v_from and role = 'owner'
      and deleted_at is null and joined_at is not null
  ) or not exists (
    select 1 from membership
    where workspace_id = p_workspace and actor_id = p_to
      and deleted_at is null and joined_at is not null
  ) then
    return false;
  end if;
  update membership set role = 'member'
  where workspace_id = p_workspace and actor_id = v_from and deleted_at is null;
  update membership set role = 'owner', may_create_projects = null
  where workspace_id = p_workspace and actor_id = p_to and deleted_at is null and joined_at is not null;
  if not found then
    raise exception 'transfer_workspace: nobody to hand it to';
  end if;
  insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
  select gen_random_uuid(), p_workspace, p.id, v_from, v_from, array['task.create', 'channel.create']
  from project p
  where p.workspace_id = p_workspace and p.deleted_at is null
    and not exists (
      select 1 from project_member pm
      where pm.project_id = p.id and pm.actor_id = v_from and pm.deleted_at is null
    );
  insert into security_event (id, workspace_id, actor_id, kind, meta)
  values (gen_random_uuid(), p_workspace, v_from, 'ownership_transferred', jsonb_build_object('to', p_to));
  return true;
end $$;

/* ------------------------------------------------------------ no workspaces

   A session in no workspace.
   It never sets `current_workspace()`, so every policy answers it nothing;
   what it reads, it reads through these two, asked by the actor its token
   names and about that actor alone. */

/* The person: their name and face, their address, and what `can()` needs
   to say whether they may make a workspace. Nothing for an account that is
   gone. */
create function auth_nowhere(p_actor uuid)
returns table (name text, avatar_key text, email citext, unproved boolean, instance_owner boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.name, a.avatar_key, u.email, u.email_verified_at is null,
         exists (select 1 from instance_owner i where i.actor_id = p_actor)
  from actor a join app_user u on u.actor_id = a.id
  where a.id = p_actor
$$;
revoke all on function auth_nowhere(uuid) from public;
grant execute on function auth_nowhere(uuid) to tracker_app;

/* The invitations waiting for their proved address: unused, unexpired, to a
   workspace that stands and they are not in. The hash is the server's, to
   take one as its link would (`accept_invite`); a client is never sent it. */
create function invites_waiting(p_actor uuid)
returns table (id uuid, workspace_name text, token_hash text)
language sql stable security definer set search_path = public, pg_temp as $$
  select i.id, w.name, i.token_hash
  from invite i
  join workspace w on w.id = i.workspace_id and w.deleted_at is null
  join app_user u on u.actor_id = p_actor and u.email_verified_at is not null
  where i.email = u.email
    and i.used_at is null and i.deleted_at is null and i.expires_at > now()
    and not exists (
      select 1 from membership m
      where m.workspace_id = i.workspace_id and m.actor_id = p_actor and m.deleted_at is null)
    -- Not one made before they left or were removed: `accept_invite`
    -- refuses those, and a row that cannot be joined is not offered.
    and not exists (
      select 1 from membership m
      where m.workspace_id = i.workspace_id and m.actor_id = p_actor and m.deleted_at > i.created_at)
  order by i.created_at desc
  limit 20
$$;
revoke all on function invites_waiting(uuid) from public;
grant execute on function invites_waiting(uuid) to tracker_app;

/* That session ended once it has gone into a workspace — that one row, of
   that person, in no workspace; not the browser's other sessions, which
   `auth_end_session` would end with it, the new one among them. */
create function nowhere_session_end(p_actor uuid, p_id uuid) returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  update refresh_session set revoked_at = coalesce(revoked_at, now()), ended_at = now()
  where id = p_id and actor_id = p_actor and workspace_id is null and ended_at is null
$$;
revoke all on function nowhere_session_end(uuid, uuid) from public;
grant execute on function nowhere_session_end(uuid, uuid) to tracker_app;
