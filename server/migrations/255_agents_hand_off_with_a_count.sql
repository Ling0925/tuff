/*
 * Agents wake each other, three hops at most.
 *
 * What one agent gave or mentioned to another was never sent, so two of
 * them could not go round until the ceiling on the customer's model bill —
 * and so one agent could not hand a piece of its work to another at all.
 * Now each hand-off carries how many agents in a row have handed this thing
 * on since a person last touched it: `chain`, on the note that is the
 * hand-off (an `assigned` or `mentioned` note to an agent). No new thing:
 * the note was already the hand-off, and the webhook is made from it.
 *
 * A person's hand-off is 0. An agent's is one more than the hand-off that
 * woke it on the same thing — unless a person did anything to that thing
 * since, which starts it again. The application stops the third
 * (`notify.ts`) and puts the thing in front of the people instead; this
 * keeps the count and carries it to the webhook.
 */
alter table notification add column chain smallint;

create index notification_handed on notification (actor_id, object_id, created_at desc)
  where chain is not null and deleted_at is null;

/*
 * The count a hand-off by the current actor would carry, on this thing.
 * A definer, because the notes it reads are the agent's own but the
 * activity it reads — whether a person did anything since — is anybody's.
 * Asked only for the session's own actor, in its own workspace.
 */
create function agent_chain(p_kind object_kind, p_object uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := current_actor();
  woke notification%rowtype;
begin
  if not exists (select 1 from agent g where g.actor_id = me and g.deleted_at is null) then
    return 0;
  end if;
  select n.* into woke from notification n
   where n.actor_id = me and n.object_id = p_object and n.object_type = p_kind
     and n.chain is not null and n.deleted_at is null
     and (current_workspace() is null or n.workspace_id = current_workspace())
   order by n.created_at desc
   limit 1;
  if not found then
    return 1;
  end if;
  /* A person did something to it since: the chain starts again. */
  if p_kind = 'conversation' then
    if exists (select 1 from message m
                where m.conversation_id = p_object and m.created_at > woke.created_at
                  and m.deleted_at is null
                  and not exists (select 1 from agent g where g.actor_id = m.author_id)) then
      return 1;
    end if;
  elsif exists (select 1 from activity_event e
                 where e.object_id = p_object and e.at > woke.created_at
                   and not exists (select 1 from agent g where g.actor_id = e.actor_id)) then
    return 1;
  end if;
  return woke.chain + 1;
end $$;
revoke all on function agent_chain(object_kind, uuid) from public;
grant execute on function agent_chain(object_kind, uuid) to tracker_app;

/*
 * The count, written on the note as it is made. A person's is 0; an
 * agent's is what the application worked out for this request
 * (`app.agent_chain`, set beside the write), and 1 when it said nothing.
 */
create function notification_chain() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.reason not in ('assigned', 'mentioned') then
    return new;
  end if;
  if exists (select 1 from agent g where g.actor_id = current_actor()) then
    new.chain := coalesce(nullif(current_setting('app.agent_chain', true), '')::int, 1);
  else
    new.chain := 0;
  end if;
  return new;
end $$;
create trigger notification_chain before insert on notification
  for each row execute function notification_chain();

/* What reaches an agent: its webhook, now from another agent as well, with
   the count. The other stops stand — Duo, a thing it cannot see. */
create or replace function agent_hears() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  project uuid;
  handle text;
begin
  if new.reason not in ('assigned', 'mentioned') then
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
                            'handle', handle, 'what', new.what, 'chain', coalesce(new.chain, 0))
  from agent g
  join webhook w on w.agent_id = g.actor_id and w.workspace_id = g.workspace_id
    and w.enabled and w.deleted_at is null
  where g.actor_id = new.actor_id and g.workspace_id = new.workspace_id and g.deleted_at is null
    and g.reach = 'webhook';
  return new;
end $$;
