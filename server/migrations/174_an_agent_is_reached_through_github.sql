/*
 * An agent reached through GitHub.
 *
 * A task given to it, or a mention of it, in a project linked to a
 * repository starts a workflow in that repository (`tuff-agent.yml`), as our
 * GitHub App, with the task's handle and id. The customer's own model key
 * sits in their repository's secrets and never reaches us.
 */

create table agent_dispatch (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  agent_id uuid not null references actor(id),
  project_id uuid not null references project(id),
  -- The repository's link when it was asked for: a project linked again
  -- in between does not send it to the new repository.
  link_id uuid not null references github_link(id),
  object_id uuid not null,
  event text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  deliver_after timestamptz not null default now(),
  attempts int not null default 0,
  delivered_at timestamptz,
  given_up_at timestamptz,
  last_status int,
  last_error text
);
create index agent_dispatch_due on agent_dispatch (deliver_after)
  where delivered_at is null and given_up_at is null;
alter table agent_dispatch enable row level security;

/* Connected through GitHub only into projects linked to a repository. */
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
     or cardinality(p_projects) = 0 or p_reach not in ('webhook', 'github') then
    return false;
  end if;
  -- Through GitHub, one project: the token sits in that repository's
  -- secrets, and whoever can write there holds what it reaches.
  if p_reach = 'github' and cardinality(p_projects) <> 1 then
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
         where pm.project_id = p and pm.actor_id = current_actor() and pm.deleted_at is null))
       or (p_reach = 'github' and not exists (
         select 1 from github_link l join github_install i on i.id = l.install_id and i.deleted_at is null
         where l.project_id = p and l.deleted_at is null and l.stopped_at is null)) then
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
  if p_reach = 'webhook' then
    insert into webhook (id, workspace_id, url, events, secret_enc, created_by, agent_id)
    values (gen_random_uuid(), ws, p_url, '{}', p_secret, current_actor(), p_id);
  end if;
  return true;
end $$;

/* What reaches an agent, by its webhook or by its repository. */
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

  /* Through GitHub: a task only — the workflow is given a task to do —
     and not more than twenty an hour for one agent, nor the same task
     twice in ten minutes. Each is a run on the customer's Actions minutes
     and model bill, and anybody on the project can give it work. */
  if new.object_type::text = 'task' then
    insert into agent_dispatch (id, workspace_id, agent_id, project_id, link_id, object_id, event, payload)
    select gen_random_uuid(), new.workspace_id, g.actor_id, project, l.id, new.object_id,
           case new.reason when 'assigned' then 'agent.assigned' else 'agent.mentioned' end,
           jsonb_build_object('reason', new.reason::text, 'object_type', 'task',
                              'object_id', new.object_id, 'handle', handle)
    from agent g
    join github_link l on l.project_id = project and l.deleted_at is null and l.stopped_at is null
    where g.actor_id = new.actor_id and g.workspace_id = new.workspace_id and g.deleted_at is null
      and g.reach = 'github'
      and (select count(*) from agent_dispatch d
           where d.agent_id = g.actor_id and d.created_at > now() - interval '1 hour') < 20
      and not exists (select 1 from agent_dispatch d
                      where d.agent_id = g.actor_id and d.object_id = new.object_id
                        and d.created_at > now() - interval '10 minutes');
  end if;
  return new;
end $$;

/*
 * The worker's half: what is due, claimed for five minutes, with where it
 * goes — the project's repository and the installation that may start a
 * workflow in it. Nothing for an agent that has gone or a link that stopped.
 */
create function agent_dispatch_claim(p_limit int)
returns table (id uuid, event text, payload jsonb, attempts int, installation_id bigint, repo_id bigint)
language plpgsql volatile security definer set search_path = public as $$
begin
  /*
   * First, what can no longer be sent, given up rather than kept forever:
   * an hour old; its agent gone or off the project; its link stopped,
   * gone or replaced; the installation gone; the workspace on Duo; a task
   * no longer there, or — given — no longer the agent's.
   */
  update agent_dispatch d set given_up_at = now(), last_error = 'no longer to be sent'
  where d.delivered_at is null and d.given_up_at is null
    and (d.created_at < now() - interval '1 hour'
      or not exists (select 1 from agent g where g.actor_id = d.agent_id and g.deleted_at is null)
      or not exists (select 1 from project_member pm where pm.project_id = d.project_id
                       and pm.actor_id = d.agent_id and pm.deleted_at is null)
      or not exists (select 1 from github_link l join github_install i on i.id = l.install_id and i.deleted_at is null
                     where l.id = d.link_id and l.deleted_at is null and l.stopped_at is null)
      or exists (select 1 from workspace w where w.id = d.workspace_id and w.plan = 'solo')
      or not exists (select 1 from task t where t.id = d.object_id and t.deleted_at is null
                       and (d.event <> 'agent.assigned' or t.assignee_ids @> array[d.agent_id])));

  return query
  with picked as (
    select d.id from agent_dispatch d
    where d.delivered_at is null and d.given_up_at is null and d.deliver_after <= now()
    order by d.deliver_after
    limit p_limit
    for update of d skip locked
  ), claimed as (
    update agent_dispatch d set deliver_after = now() + interval '5 minutes'
    from picked where d.id = picked.id
    returning d.id, d.event, d.payload, d.attempts, d.link_id
  )
  select c.id, c.event, c.payload, c.attempts, i.installation_id, l.repo_id
  from claimed c
  join github_link l on l.id = c.link_id
  join github_install i on i.id = l.install_id;
end $$;

/* What GitHub answered: done, or tried again later, ten times at most. */
create function agent_dispatch_done(p_id uuid, p_status int, p_error text, p_ok boolean)
returns void
language sql volatile security definer set search_path = public as $$
  update agent_dispatch set
    attempts = attempts + 1,
    last_status = p_status,
    last_error = p_error,
    delivered_at = case when p_ok then now() end,
    -- Refused outright (no permission, inputs it will not take): not tried
    -- again. A missing workflow is, a few times: somebody may be adding it.
    given_up_at = case when not p_ok and (attempts + 1 >= 5 or p_status in (401, 403, 422)) then now() end,
    deliver_after = now() + make_interval(mins => least(60, power(2, attempts)::int))
  where id = p_id
$$;

revoke execute on function agent_dispatch_claim(int) from public, tracker_app;
revoke execute on function agent_dispatch_done(uuid, int, text, boolean) from public, tracker_app;
grant execute on function agent_dispatch_claim(int) to tracker_worker;
grant execute on function agent_dispatch_done(uuid, int, text, boolean) to tracker_worker;
