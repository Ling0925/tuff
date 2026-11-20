/*
 * An agent works where it already works, and reaches Tuff through MCP.
 * The way through GitHub Actions is taken out:
 * the model ran in the customer's workflow with their keys beside it, so it
 * was given no shell, and it sent pull requests it had never built or
 * tested. An agent in its own place — a terminal, Cursor, Codex — has its
 * repository, its shell and its checks; from Tuff it needs its tasks and a
 * place to say what it did, which its token and MCP already give it.
 *
 * Agents connected through GitHub keep their token and become agents
 * reached through MCP; nothing is started in a repository any more.
 */
-- The old check first, or it refuses the row it is being moved to.
alter table agent drop constraint agent_reach_check;
update agent set reach = 'mcp' where reach = 'github';
alter table agent add constraint agent_reach_check check (reach in ('webhook', 'mcp'));

/* Connecting one: by a webhook, or through MCP alone. */
create or replace function agent_connect(p_id uuid, p_name text, p_projects uuid[], p_reach text, p_rights text[],
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
     or cardinality(p_projects) = 0 or p_reach not in ('webhook', 'mcp')
     or (p_reach = 'webhook') <> (p_url is not null) then
    return false;
  end if;
  -- The ceiling is written here, not taken on the caller's word.
  p_rights := array['task.create', 'edit.any'];
  -- Twenty a person: each is a membership and a token.
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
              else array(select unnest(pm.rights) intersect select unnest(p_rights))::text[] end
  from unnest(p_projects) x
  left join project_member pm
    on pm.project_id = x and pm.actor_id = current_actor() and pm.deleted_at is null;
  insert into agent (actor_id, workspace_id, created_by, reach) values (p_id, ws, current_actor(), p_reach);
  if p_reach = 'webhook' then
    insert into webhook (id, workspace_id, url, events, secret_enc, created_by, agent_id)
    values (gen_random_uuid(), ws, p_url, '{}', p_secret, current_actor(), p_id);
  end if;
  return true;
end $$;

/* What reaches an agent: its webhook, if it has one. One reached through
   MCP reads its tasks when it comes for them. */
create or replace function agent_hears() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  project uuid;
  handle text;
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
  handle := case when new.object_type::text = 'task' then (
    select pr.key || '-' || t.number from task t join project pr on pr.id = t.project_id where t.id = new.object_id) end;

  insert into webhook_delivery (id, workspace_id, webhook_id, event, payload)
  select gen_random_uuid(), new.workspace_id, w.id,
         case new.reason when 'assigned' then 'agent.assigned' else 'agent.mentioned' end,
         jsonb_build_object('agent_id', g.actor_id, 'reason', new.reason::text,
                            'object_type', new.object_type::text, 'object_id', new.object_id,
                            'handle', handle, 'what', new.what)
  from agent g
  join webhook w on w.agent_id = g.actor_id and w.workspace_id = g.workspace_id
    and w.enabled and w.deleted_at is null
  where g.actor_id = new.actor_id and g.workspace_id = new.workspace_id and g.deleted_at is null
    and g.reach = 'webhook';
  return new;
end $$;

drop function agent_dispatch_claim(int);
drop function agent_dispatch_done(uuid, int, text, boolean);
drop table agent_dispatch;
