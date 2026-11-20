/*
 * The hop chain, closed again — from the second review of.
 *
 * A reply note to an agent was merged by the next reply in the thread:
 * the merge moved its time and kept its count, so a person's 0 stayed the
 * agent's latest and reset it on every hop. Notes to agents are no longer
 * merged (`notify.ts`), and the count starts again only from a person
 * really handing the agent something — an assignment or a mention with 0 —
 * never from a reply.
 *
 * The backstop counted replies, which wake nothing, so one chatty thread
 * spent the workspace's sixty; and it did not count a person's own token
 * handing work to agents, which is a loop of tools as much as two agents
 * are. Now it counts assignments and mentions that reached an agent from
 * another agent or from a person's token.
 */
alter table notification add column handed_by_token boolean not null default false;

create or replace function agent_chain(p_kind object_kind, p_object uuid) returns int
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := current_actor();
  woke int;
begin
  if not exists (select 1 from agent g where g.actor_id = me and g.deleted_at is null) then
    return 0;
  end if;
  select n.chain into woke from notification n
   where n.actor_id = me and n.chain is not null and n.deleted_at is null
     and n.reason in ('assigned', 'mentioned', 'replied')
     /* A person's reply starts nothing again: only their handing it something. */
     and (n.chain >= 1 or n.reason in ('assigned', 'mentioned'))
     and n.created_at > now() - interval '1 day'
     and (current_workspace() is null or n.workspace_id = current_workspace())
   order by n.created_at desc
   limit 1;
  return coalesce(woke, 0) + 1;
end $$;

/* `0t` is a person's hand-off through their own token: 0, and counted by
   the backstop. */
create or replace function notification_chain() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  said text := nullif(current_setting('app.agent_chain', true), '');
begin
  if new.reason not in ('assigned', 'mentioned', 'replied') then
    return new;
  end if;
  if said = 'none' then
    new.chain := null;
  elsif said = '0t' then
    new.chain := 0;
    new.handed_by_token := true;
  elsif said is not null then
    new.chain := said::int;
  elsif exists (select 1 from agent g where g.actor_id = current_actor()) then
    new.chain := 1;
  else
    new.chain := 0;
  end if;
  return new;
end $$;

drop index if exists notification_handed_ws;
create index notification_handed_ws on notification (workspace_id, created_at desc)
  where (chain >= 1 or handed_by_token) and reason in ('assigned', 'mentioned') and deleted_at is null;

create or replace function agent_handoffs_lately(p_workspace uuid) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from notification n
  where n.workspace_id = p_workspace and is_member(p_workspace)
    and (n.chain >= 1 or n.handed_by_token) and n.reason in ('assigned', 'mentioned')
    and n.deleted_at is null and n.created_at > now() - interval '1 hour'
    and exists (select 1 from agent g where g.actor_id = n.actor_id)
$$;

/* Whether this person was told, this hour, that the current agent's chain
   stopped on this thing — so a stopped agent talking on does not tell
   them again with every message. */
create function told_of_handoff(p_workspace uuid, p_actor uuid, p_object uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select is_member(p_workspace) and exists (
    select 1 from notification n
    where n.workspace_id = p_workspace and n.actor_id = p_actor and n.object_id = p_object
      and n.kind = 'handoff' and n.by_id = current_actor()
      and n.created_at > now() - interval '1 hour')
$$;
revoke all on function told_of_handoff(uuid, uuid, uuid) from public;
grant execute on function told_of_handoff(uuid, uuid, uuid) to tracker_app;
