/*
 * The hop chain, from the third review of.
 *
 * The latest note to an agent stood for its count, so a third agent's reply
 * at one hop, landing between, lowered the count of two agents handing work
 * back and forth and they were never stopped. Now it is the highest count
 * that reached the agent since a person last handed it something (a chain-0
 * assignment or mention), within the day.
 *
 * And what nobody did — a feedback page, an import, GitHub, a board: a note
 * with no count — never wakes an agent. A stranger who knows an agent's id
 * could name it from a feedback page as often as they liked, uncounted.
 */
create or replace function agent_chain(p_kind object_kind, p_object uuid) returns int
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := current_actor();
  since timestamptz;
  woke int;
begin
  if not exists (select 1 from agent g where g.actor_id = me and g.deleted_at is null) then
    return 0;
  end if;
  select max(n.created_at) into since from notification n
   where n.actor_id = me and n.chain = 0 and n.reason in ('assigned', 'mentioned') and n.deleted_at is null
     and n.created_at > now() - interval '1 day'
     and (current_workspace() is null or n.workspace_id = current_workspace());
  select max(n.chain) into woke from notification n
   where n.actor_id = me and n.chain >= 1 and n.deleted_at is null
     and n.reason in ('assigned', 'mentioned', 'replied')
     and n.created_at > coalesce(since, now() - interval '1 day')
     and (current_workspace() is null or n.workspace_id = current_workspace());
  return coalesce(woke, 0) + 1;
end $$;

/* Nobody's hand-off wakes nobody: no webhook from a note with no count. */
create or replace function agent_hears() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  project uuid;
  handle text;
begin
  if new.reason not in ('assigned', 'mentioned') or new.chain is null then
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
                            'handle', handle, 'what', new.what, 'chain', new.chain)
  from agent g
  join webhook w on w.agent_id = g.actor_id and w.workspace_id = g.workspace_id
    and w.enabled and w.deleted_at is null
  where g.actor_id = new.actor_id and g.workspace_id = new.workspace_id and g.deleted_at is null
    and g.reach = 'webhook';
  return new;
end $$;

/* How many hand-off alarms this person had this hour — five at most. */
create function handoff_alarms_lately(p_workspace uuid, p_actor uuid) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select case when is_member(p_workspace) then (
    select count(*)::int from notification n
    where n.workspace_id = p_workspace and n.actor_id = p_actor
      and n.kind in ('handoff', 'handoff_cap') and n.created_at > now() - interval '1 hour')
  else 0 end
$$;
revoke all on function handoff_alarms_lately(uuid, uuid) from public;
grant execute on function handoff_alarms_lately(uuid, uuid) to tracker_app;
