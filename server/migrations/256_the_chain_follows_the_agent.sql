/*
 * The chain follows the agent, not the thing.
 * From the review of
 *
 * Migration 255 counted hand-offs per thing: two agents waking each other
 * on two different tasks, or each making a fresh task for the other, were
 * at one hop for ever. And a person's activity on the thing started the
 * count again — which a GitHub-synced change, an incoming webhook's message
 * or anybody talking in a busy room all looked like.
 *
 * Now an agent's hand-off is one more than the latest hand-off that reached
 * that agent, on anything, in the last day; and only a person's own hand-off
 * to it (a note with chain 0) starts it again. What GitHub, an import, a
 * board's guest or a feedback page did is counted as nobody's (chain null):
 * it neither wakes the count nor starts it again.
 */
drop index if exists notification_handed;
create index notification_handed on notification (actor_id, created_at desc)
  where chain is not null and deleted_at is null;

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
     and n.created_at > now() - interval '1 day'
     and (current_workspace() is null or n.workspace_id = current_workspace())
   order by n.created_at desc
   limit 1;
  return coalesce(woke, 0) + 1;
end $$;

/*
 * The count on the note: what the application set for this request
 * (`app.agent_chain` — a number, or `none` for what no person did), and
 * when it said nothing, 1 for an agent and 0 for a person.
 */
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
  elsif said is not null then
    new.chain := said::int;
  elsif exists (select 1 from agent g where g.actor_id = current_actor()) then
    new.chain := 1;
  else
    new.chain := 0;
  end if;
  return new;
end $$;

alter function agent_hears() set search_path = public, pg_temp;

/*
 * Agent-to-agent hand-offs in this workspace in the last hour — the
 * backstop under the chain: past sixty, none is sent (`notify.ts`).
 */
create function agent_handoffs_lately(p_workspace uuid) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from notification n
  where n.workspace_id = p_workspace and is_member(p_workspace)
    and n.chain >= 1 and n.created_at > now() - interval '1 hour'
    and exists (select 1 from agent g where g.actor_id = n.actor_id)
$$;
revoke all on function agent_handoffs_lately(uuid) from public;
grant execute on function agent_handoffs_lately(uuid) to tracker_app;

/* Whether this person was told the backstop held, this hour. A definer:
   the note is theirs, not the asker's. */
create function told_of_handoff_cap(p_workspace uuid, p_actor uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select is_member(p_workspace) and exists (
    select 1 from notification n
    where n.workspace_id = p_workspace and n.actor_id = p_actor and n.kind = 'handoff_cap'
      and n.created_at > now() - interval '1 hour')
$$;
revoke all on function told_of_handoff_cap(uuid, uuid) from public;
grant execute on function told_of_handoff_cap(uuid, uuid) to tracker_app;

create index notification_handed_ws on notification (workspace_id, created_at desc)
  where chain >= 1 and deleted_at is null;

/* Which question is the chain's own, so only that one is not asked twice. */
alter table comment add column stops_chain boolean not null default false;
alter table comment add constraint comment_stops_chain_asks check (not stops_chain or choices is not null);

/*
 * An answer is a person's, and theirs: never an agent, and `answered_by`
 * is whoever is asking. Said in the function and again in the trigger, so
 * no other way of writing the row can say otherwise.
 */
create or replace function answer_question(q uuid, pick int) returns text
  language plpgsql security definer set search_path = public, pg_temp
  as $$
declare
  q_row comment%rowtype;
begin
  if current_actor() is null or exists (select 1 from agent g where g.actor_id = current_actor()) then
    return 'missing';
  end if;
  select c.* into q_row from comment c
   where c.id = q and c.deleted_at is null and c.choices is not null
     and c.object_type = 'task'
     and (current_workspace() is null or c.workspace_id = current_workspace())
     and c.project_id in (select visible_projects())
     and exists (select 1 from task t where t.id = c.object_id and t.deleted_at is null
                   and t.project_id in (select visible_projects()))
   for update;
  if not found then
    return 'missing';
  end if;
  if q_row.answered_at is not null then
    return 'answered';
  end if;
  if pick < 0 or pick >= jsonb_array_length(q_row.choices) then
    return 'out_of_range';
  end if;
  update comment set answer = pick, answered_by = current_actor(), answered_at = now()
   where id = q;
  return 'done';
end $$;

create or replace function question_stays_as_asked() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.choices is distinct from old.choices or new.asked is distinct from old.asked
     or new.stops_chain is distinct from old.stops_chain then
    raise exception 'a question keeps its choices and who it asked'
      using errcode = 'check_violation';
  end if;
  if old.answered_at is not null and (
       new.answer is distinct from old.answer
       or new.answered_by is distinct from old.answered_by
       or new.answered_at is distinct from old.answered_at) then
    raise exception 'a question is answered once'
      using errcode = 'check_violation';
  end if;
  if old.answered_at is null and new.answered_at is not null and (
       new.answered_by is distinct from current_actor()
       or exists (select 1 from agent g where g.actor_id = current_actor())) then
    raise exception 'a question is answered by the person pressing, never an agent'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger question_stays_as_asked on comment;
create trigger question_stays_as_asked
  before update of choices, asked, answer, answered_by, answered_at, stops_chain on comment
  for each row execute function question_stays_as_asked();
