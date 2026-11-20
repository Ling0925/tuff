/*
 * What an agent is doing now.
 *
 * A property of the agent, as being here is a property of a person: one row
 * an agent at most, replaced each time it says something and gone when it
 * says nothing. Not history — the next one replaces it.
 *
 * `since` is when it began on this task, `at` when it last said so. A row
 * older than three minutes is not shown, which every read asks through
 * `agent_doing_fresh`, so nothing has to run to put it out.
 */
create table agent_doing (
  agent_id uuid primary key references actor(id) on delete cascade,
  workspace_id uuid not null references workspace(id) on delete cascade,
  task_id uuid references task(id) on delete cascade,
  doing text not null check (char_length(doing) between 1 and 120),
  since timestamptz not null default now(),
  at timestamptz not null default now()
);
/* The task's own read, and the finishing trigger, find its rows by it. */
create index agent_doing_by_task on agent_doing (task_id) where task_id is not null;
create index agent_doing_in_workspace on agent_doing (workspace_id);

alter table agent_doing enable row level security;

/*
 * Seen by whoever can see its task — read under the task's own policies, so
 * somebody who cannot open the task cannot read that an agent is at it. One
 * that names no task, by anybody in the workspace. And the agent its own.
 */
create policy ad_read on agent_doing for select to tracker_app using (
  workspace_id = current_workspace() and is_member(workspace_id)
  and (agent_id = current_actor()
       or task_id is null
       or exists (select 1 from task t where t.id = agent_doing.task_id and t.deleted_at is null))
);

/* Said only by an agent, about itself, on a task it can see. */
create policy ad_say on agent_doing for insert to tracker_app with check (
  workspace_id = current_workspace() and agent_id = current_actor()
  and exists (select 1 from agent g where g.actor_id = agent_doing.agent_id
                and g.workspace_id = agent_doing.workspace_id and g.deleted_at is null)
  and (task_id is null
       or exists (select 1 from task t where t.id = agent_doing.task_id and t.deleted_at is null))
);
create policy ad_say_again on agent_doing for update to tracker_app
  using (workspace_id = current_workspace() and agent_id = current_actor())
  with check (
    workspace_id = current_workspace() and agent_id = current_actor()
    and exists (select 1 from agent g where g.actor_id = agent_doing.agent_id
                  and g.workspace_id = agent_doing.workspace_id and g.deleted_at is null)
    and (task_id is null
         or exists (select 1 from task t where t.id = agent_doing.task_id and t.deleted_at is null))
  );
create policy ad_stop on agent_doing for delete to tracker_app
  using (workspace_id = current_workspace() and agent_id = current_actor());
grant select, insert, update, delete on agent_doing to tracker_app;

/* The one place the three minutes are written. */
create function agent_doing_fresh(said timestamptz) returns boolean
language sql stable as $$ select said > now() - interval '3 minutes' $$;
create function agent_doing_until(said timestamptz) returns timestamptz
language sql immutable as $$ select said + interval '3 minutes' $$;
grant execute on function agent_doing_fresh(timestamptz) to tracker_app;
grant execute on function agent_doing_until(timestamptz) to tracker_app;

/*
 * Finishing a task takes away what any agent said about it — completed, or
 * put in the bin — whoever did it and however. As the tables' owner,
 * because the rows are the agents' and the policy lets each touch its own.
 */
create function agent_doing_finished() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from agent_doing where task_id = new.id;
  return new;
end $$;
revoke all on function agent_doing_finished() from public;
create trigger agent_doing_finished
  after update of completed_at, deleted_at on task
  for each row
  when ((new.completed_at is not null and old.completed_at is null)
        or (new.deleted_at is not null and old.deleted_at is null))
  execute function agent_doing_finished();
