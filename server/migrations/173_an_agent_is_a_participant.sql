/*
 * Agents in the workspace.
 *
 * An agent is an actor with a membership, as a person is, so that giving it
 * a task, mentioning it and seeing what it did go through the paths a
 * person's do and the rules they keep. What makes it an agent is a row here:
 * who connected it, how it is reached. It has no account, so it never signs
 * in; it acts through a token made for it, inside the projects it was given,
 * with the rights its connector held there.
 */

-- What the owner says about one person: whether they may connect agents.
alter table membership add column may_connect_agents boolean not null default false;

create table agent (
  actor_id uuid primary key references actor(id),
  workspace_id uuid not null references workspace(id),
  created_by uuid not null references actor(id),
  reach text not null check (reach in ('webhook', 'github')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index agent_in_workspace on agent (workspace_id) where deleted_at is null;
alter table agent enable row level security;
create policy agent_read on agent for select
  using (workspace_id = current_workspace() and is_member(workspace_id));
grant select on agent to tracker_app;

-- An agent reached by webhook has a webhook of its own, which carries only
-- what is given to it — never the workspace's events.
alter table webhook add column agent_id uuid references actor(id);
-- Granted by column, as the rest of the table is: the secret's never is.
grant select (agent_id), insert (agent_id) on webhook to tracker_app;

create or replace function queue_webhooks(p_workspace uuid, p_event text, p_payload jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if current_workspace() is not null and p_workspace <> current_workspace() then
    return 0;
  end if;
  if p_payload->>'object_type' = 'conversation' and not exists (
    select 1 from conversation cv
    where cv.id = (p_payload->>'object_id')::uuid and cv.workspace_id = p_workspace
      and cv.project_id is not null
      and not exists (
        select 1 from conversation_member cm
        where cm.conversation_id = cv.id and cm.joined_at is not null and cm.deleted_at is null
      )
  ) then
    return 0;
  end if;
  insert into webhook_delivery (id, workspace_id, webhook_id, event, payload)
  select gen_random_uuid(), p_workspace, w.id, p_event, p_payload
  from webhook w
  where w.workspace_id = p_workspace and w.enabled and w.deleted_at is null
    and w.agent_id is null
    and (cardinality(w.events) = 0 or p_event = any(w.events));
  get diagnostics n = row_count;
  return n;
end $$;

-- An agent takes no seat: the plan's ceiling counts people.
create or replace function workspace_people(ws uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from membership m
  where m.workspace_id = ws and m.deleted_at is null
    and not exists (select 1 from agent g where g.actor_id = m.actor_id)
$$;

-- The owner's word about connecting agents, read with the rest.
drop function auth_context(uuid, uuid);
create function auth_context(p_actor uuid, p_workspace uuid)
returns table (role text, settings jsonb, rights json,
               may_create_projects boolean, may_create_channels boolean,
               operator boolean, plan text,
               may_see_members boolean, may_invite_people boolean,
               may_connect_agents boolean)
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
         m.may_connect_agents
  from membership m join workspace w on w.id = m.workspace_id
  where m.actor_id = p_actor and m.workspace_id = p_workspace
    and m.deleted_at is null and m.joined_at is not null
$$;
grant execute on function auth_context(uuid, uuid) to tracker_app;

/*
 * Connecting one, by the owner or a member the owner lets, into projects
 * they are on, with the rights they hold there — never more. `p_rights` is
 * what an agent may hold at most: all of it for an owner, who holds every
 * project without a row, and of a member's rights only those.
 */
create function agent_connect(p_id uuid, p_name text, p_projects uuid[], p_reach text, p_rights text[],
                              p_url text, p_secret text)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  ws uuid := current_workspace();
  me record;
  p uuid;
begin
  select m.role, m.may_connect_agents into me from membership m
  where m.workspace_id = ws and m.actor_id = current_actor()
    and m.deleted_at is null and m.joined_at is not null;
  if ws is null or me is null or not (me.role = 'owner' or me.may_connect_agents)
     or cardinality(p_projects) = 0 then
    return false;
  end if;
  -- The ceiling is written here, not taken on the caller's word.
  p_rights := array['task.create', 'edit.any'];
  -- Twenty a person: each is a membership, a token and a webhook.
  if (select count(*) from agent g where g.workspace_id = ws and g.created_by = current_actor()
      and g.deleted_at is null) >= 20 then
    return false;
  end if;
  foreach p in array p_projects loop
    if not exists (select 1 from project pr where pr.id = p and pr.workspace_id = ws
                   and pr.deleted_at is null and pr.archived_at is null)
       or (me.role <> 'owner' and not exists (
         select 1 from project_member pm
         where pm.project_id = p and pm.actor_id = current_actor() and pm.deleted_at is null)) then
      return false;
    end if;
  end loop;

  insert into actor (id, name) values (p_id, p_name);
  insert into membership (id, workspace_id, actor_id, role, invited_by, joined_at,
                          may_create_projects, may_create_channels, may_see_members, may_invite_people)
  values (gen_random_uuid(), ws, p_id, 'member', current_actor(), now(), false, false, false, false);
  insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
  select gen_random_uuid(), ws, x, p_id, current_actor(),
         case when me.role = 'owner' then p_rights
              /* What the member holds there, and of that only what an
                 agent works with: making tasks and changing them — never
                 deleting, never running the project. */
              else array(select unnest(pm.rights) intersect select unnest(p_rights))::text[] end
  from unnest(p_projects) x
  left join project_member pm
    on pm.project_id = x and pm.actor_id = current_actor() and pm.deleted_at is null;
  insert into agent (actor_id, workspace_id, created_by, reach) values (p_id, ws, current_actor(), p_reach);
  -- Its webhook, here rather than by the caller: the workspace's webhooks
  -- are the owner's to write, and a member the owner lets connects one too.
  if p_reach = 'webhook' then
    insert into webhook (id, workspace_id, url, events, secret_enc, created_by, agent_id)
    values (gen_random_uuid(), ws, p_url, '{}', p_secret, current_actor(), p_id);
  end if;
  return true;
end $$;
grant execute on function agent_connect(uuid, text, uuid[], text, text[], text, text) to tracker_app;

/* Everything an agent had, ended: as removing a person ends theirs. Not
   granted: reached only through the two that decide who may. */
create function agent_end(p_agent uuid, p_ws uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  update agent set deleted_at = now() where actor_id = p_agent and workspace_id = p_ws and deleted_at is null;
  update membership set deleted_at = now()
  where workspace_id = p_ws and actor_id = p_agent and deleted_at is null;
  update project_member set deleted_at = now()
  where workspace_id = p_ws and actor_id = p_agent and deleted_at is null;
  update api_token set revoked_at = now(), refresh_hash = null, updated_at = now()
  where workspace_id = p_ws and actor_id = p_agent and revoked_at is null;
  update webhook set enabled = false, deleted_at = now()
  where workspace_id = p_ws and agent_id = p_agent and deleted_at is null;
  update notification set deleted_at = now()
  where workspace_id = p_ws and actor_id = p_agent and deleted_at is null;
  update conversation_member set joined_at = null, updated_at = now()
  where workspace_id = p_ws and actor_id = p_agent and joined_at is not null and deleted_at is null;
  update task set assignee_ids = array_remove(assignee_ids, p_agent), updated_at = now()
  where workspace_id = p_ws and assignee_ids @> array[p_agent]
    and completed_at is null and deleted_at is null;
end $$;
revoke all on function agent_end(uuid, uuid) from public;

/* Disconnecting: the owner, or whoever connected it. */
create function agent_disconnect(p_agent uuid) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  ws uuid := current_workspace();
begin
  if ws is null or not exists (
    select 1 from agent g where g.actor_id = p_agent and g.workspace_id = ws and g.deleted_at is null
      and (g.created_by = current_actor() or exists (
        select 1 from membership m
        where m.workspace_id = ws and m.actor_id = current_actor() and m.role = 'owner' and m.deleted_at is null))
  ) then
    return false;
  end if;
  perform agent_end(p_agent, ws);
  return true;
end $$;
grant execute on function agent_disconnect(uuid) to tracker_app;

/*
 * What is given to an agent reaches it. A note written for an agent —
 * given a task, mentioned — becomes a delivery to its webhook, signed and
 * retried as every webhook is. Only those two: what it is watching is not
 * a request to work.
 */
create function agent_hears() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.reason not in ('assigned', 'mentioned') then
    return new;
  end if;
  insert into webhook_delivery (id, workspace_id, webhook_id, event, payload)
  select gen_random_uuid(), new.workspace_id, w.id,
         case new.reason when 'assigned' then 'agent.assigned' else 'agent.mentioned' end,
         jsonb_build_object('agent_id', g.actor_id, 'reason', new.reason::text,
                            'object_type', new.object_type::text, 'object_id', new.object_id,
                            'what', new.what)
  from agent g
  join webhook w on w.agent_id = g.actor_id and w.workspace_id = g.workspace_id
    and w.enabled and w.deleted_at is null
  where g.actor_id = new.actor_id and g.workspace_id = new.workspace_id and g.deleted_at is null;
  return new;
end $$;
create trigger agent_hears after insert on notification for each row execute function agent_hears();

/* Removing somebody ends the agents they connected — `docs/specs/removing-someone.md`. */
create or replace function remove_from_workspace(p_target uuid) returns boolean
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

  -- An agent taken out from Members is disconnected, whoever connected it.
  if exists (select 1 from agent g where g.actor_id = p_target and g.workspace_id = ws and g.deleted_at is null) then
    perform agent_end(p_target, ws);
    return true;
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

  -- The agents they connected act with their rights; those go with them.
  perform agent_end(g.actor_id, ws) from agent g
  where g.workspace_id = ws and g.created_by = p_target and g.deleted_at is null;

  -- A Slack channel they chose stops being posted to.
  update slack_link set stopped_at = now(), stopped = 'linker_removed'
  where workspace_id = ws and linked_by = p_target and stopped_at is null;

  return true;
end $$;

/* ---------------------------------------------------- what the review found

   An agent's rights were copied once, when it was connected: its connector
   taken off a project kept reading it — and could put themselves back on —
   through the agent's token, and anybody could add the agent, with the
   ordinary rights, to projects its connector was not on. The ceiling and
   the connector's standing are held here, on the rows themselves, whoever
   writes them. */

/* What an agent may hold on a project: the ceiling, and no more than its
   connector holds there now. Somewhere its connector is not, it is not. */
create function agent_rights_hold() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  g agent%rowtype;
  held text[];
  ceiling text[] := array['task.create', 'edit.any'];
begin
  select * into g from agent where actor_id = new.actor_id and deleted_at is null;
  if not found or new.deleted_at is not null then
    return new;
  end if;
  if exists (select 1 from membership m
             where m.workspace_id = new.workspace_id and m.actor_id = g.created_by
               and m.role = 'owner' and m.deleted_at is null) then
    held := ceiling;
  else
    select pm.rights into held from project_member pm
    where pm.project_id = new.project_id and pm.actor_id = g.created_by and pm.deleted_at is null;
    if not found then
      raise exception 'agent_outside_connector' using errcode = '42501';
    end if;
  end if;
  new.rights := array(select unnest(new.rights) intersect select unnest(held)
                      intersect select unnest(ceiling));
  return new;
end $$;
create trigger agent_rights_hold before insert or update on project_member
  for each row execute function agent_rights_hold();

/* And when the connector's place changes, the agent's follows it: off the
   project with them, narrowed with them. */
create function agent_follows_connector() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from agent where actor_id = new.actor_id) then
    return new;
  end if;
  if new.deleted_at is not null then
    update project_member pm set deleted_at = now()
    from agent g
    where g.created_by = new.actor_id and g.workspace_id = new.workspace_id and g.deleted_at is null
      and pm.actor_id = g.actor_id and pm.project_id = new.project_id and pm.deleted_at is null;
  elsif new.rights is distinct from old.rights then
    update project_member pm set rights = pm.rights
    from agent g
    where g.created_by = new.actor_id and g.workspace_id = new.workspace_id and g.deleted_at is null
      and pm.actor_id = g.actor_id and pm.project_id = new.project_id and pm.deleted_at is null;
  end if;
  return new;
end $$;
create trigger agent_follows_connector after update on project_member
  for each row execute function agent_follows_connector();

/* Whether somebody is an agent, read with the rest of who they are, so that
   `can()` refuses an agent what only a person decides. */
drop function auth_context(uuid, uuid);
create function auth_context(p_actor uuid, p_workspace uuid)
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
$$;
grant execute on function auth_context(uuid, uuid) to tracker_app;

/*
 * What reaches an agent: a task given to it, a mention of it — where it can
 * see the thing, while the workspace pays for agents, and never from another
 * agent: two of them giving each other work would go round until the
 * ceiling stopped them, on the customer's model bill.
 */
create or replace function agent_hears() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  project uuid;
begin
  if new.reason not in ('assigned', 'mentioned') then
    return new;
  end if;
  if exists (select 1 from agent d where d.actor_id = current_actor()) then
    return new;
  end if;
  if exists (select 1 from workspace w where w.id = new.workspace_id and w.plan = 'solo') then
    return new;
  end if;
  project := case new.object_type::text
    when 'task' then (select t.project_id from task t where t.id = new.object_id)
    when 'post' then (select p.project_id from post p where p.id = new.object_id)
    when 'file' then (select f.project_id from file f where f.id = new.object_id)
    when 'conversation' then (select c.project_id from conversation c where c.id = new.object_id)
  end;
  if project is null or not exists (
    select 1 from project_member pm
    where pm.project_id = project and pm.actor_id = new.actor_id and pm.deleted_at is null) then
    return new;
  end if;
  insert into webhook_delivery (id, workspace_id, webhook_id, event, payload)
  select gen_random_uuid(), new.workspace_id, w.id,
         case new.reason when 'assigned' then 'agent.assigned' else 'agent.mentioned' end,
         jsonb_build_object('agent_id', g.actor_id, 'reason', new.reason::text,
                            'object_type', new.object_type::text, 'object_id', new.object_id,
                            'what', new.what)
  from agent g
  join webhook w on w.agent_id = g.actor_id and w.workspace_id = g.workspace_id
    and w.enabled and w.deleted_at is null
  where g.actor_id = new.actor_id and g.workspace_id = new.workspace_id and g.deleted_at is null;
  return new;
end $$;
