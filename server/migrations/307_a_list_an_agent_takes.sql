/*
 * A list can name one agent of its project that takes its new tasks.
 *
 * A column on the list, nullable: not a fifth entity and not a second way
 * to assign. The application gives a task made in the list, or moved into
 * it, with nobody on it, to this agent, through the path every assignment
 * takes; what it asks of the agent then (on the project now, not
 * disconnected) is asked at that moment, so an agent that has gone is kept
 * here and ignored, and the list's settings say so.
 *
 * The database holds the one thing the column must never be: anything but
 * a live agent of the list's own workspace. A person's id, another
 * company's agent, or one disconnected is refused when it is written —
 * through a definer, because who is an agent is read under the agent
 * table's own policy.
 *
 * Changes no rows.
 */

alter table task_list add column agent_id uuid references actor(id);

create function task_list_agent_is_an_agent() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.agent_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.agent_id is not distinct from old.agent_id then
    return new;
  end if;
  if not exists (
    select 1 from agent g
    where g.actor_id = new.agent_id and g.workspace_id = new.workspace_id and g.deleted_at is null) then
    raise exception 'a list is taken only by an agent of its workspace' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function task_list_agent_is_an_agent() from public;

create trigger task_list_agent_is_an_agent
  before insert or update of agent_id on task_list
  for each row execute function task_list_agent_is_an_agent();
