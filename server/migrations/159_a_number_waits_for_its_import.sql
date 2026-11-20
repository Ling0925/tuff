/*
 * What the second look at the Linear import found.
 *
 * A task numbered by the counter while its project's import still runs takes
 * a number one of Linear's pages needs. Refused where the number is given,
 * so every way a task is made — by hand, a duplicate, a step, a message made
 * a task, whatever comes next — is refused alike. The import's own tasks
 * bring their numbers and are not counted.
 */
create or replace function task_number_in_project() returns trigger
language plpgsql as $$
begin
  if new.number is null then
    if project_importing(new.project_id) then
      raise exception 'project_importing' using errcode = 'P0001';
    end if;
    update project set task_seq = task_seq + 1 where id = new.project_id
    returning task_seq into new.number;
  end if;
  return new;
end $$;

/*
 * Imports take turns: the one whose last turn was longest ago goes next.
 * Released at the end of a turn and chosen oldest-first, the first import
 * of the day was every turn's, and another company's waited behind it.
 */
alter table linear_import add column last_turn_at timestamptz;

create or replace function linear_import_claim() returns table (
  id uuid, workspace_id uuid, actor_id uuid, key_enc text, teams jsonb, progress jsonb
)
language sql volatile security definer set search_path = public as $$
  update linear_import i set claimed_at = now()
  where i.id = (
    select w.id from linear_import w
    where w.state = 'running' and w.key_enc is not null
      and (w.claimed_at is null or w.claimed_at < now() - interval '10 minutes')
    order by coalesce(w.last_turn_at, w.created_at)
    limit 1
    for update skip locked
  )
  returning i.id, i.workspace_id, i.actor_id, i.key_enc, i.teams, i.progress
$$;

create or replace function linear_import_progress(p_id uuid, p_progress jsonb, p_release boolean default false) returns void
language sql volatile security definer set search_path = public as $$
  update linear_import
  set progress = p_progress,
      claimed_at = case when p_release then null else now() end,
      last_turn_at = case when p_release then now() else last_turn_at end
  where id = p_id and state = 'running'
$$;
