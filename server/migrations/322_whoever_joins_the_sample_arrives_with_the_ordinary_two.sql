/*
 * Whoever asks for the workspace's sample after a colleague made it is put
 * on it holding the ordinary two — making tasks and channels — like anybody
 * added to a project. The insert named no rights and so gave the column's
 * empty default: a sample to look around in where the second person could
 * not try making a task. Its maker holds every right since the same change
 * that made whoever starts a project run it.
 *
 * Only the function changes; no row is rewritten. Somebody who joined a
 * sample before keeps what they hold, and pressing for the sample again
 * does not touch a row that is already there.
 */
create or replace function join_sample() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  p uuid;
begin
  select id into p from project
  where workspace_id = current_workspace() and sample and deleted_at is null;
  if p is null then
    return null;
  end if;
  if not exists (
    select 1 from project_member
    where project_id = p and actor_id = current_actor() and deleted_at is null
  ) then
    insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
    values (gen_random_uuid(), current_workspace(), p, current_actor(), current_actor(),
            array['task.create', 'channel.create']);
  end if;
  return p;
end $$;
grant execute on function join_sample() to tracker_app;
