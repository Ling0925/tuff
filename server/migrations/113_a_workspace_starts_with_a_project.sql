/*
 * A sample project to look around in.
 *
 * It is nobody's work: kept out of My tasks, made without a line in the
 * feed, and taken out for good at once rather than to the bin. One per
 * workspace at a time, which the index below holds rather than a check in
 * the handler that two presses could both pass.
 */
alter table project add column sample boolean not null default false;

create unique index project_one_sample on project (workspace_id)
  where sample and deleted_at is null;

/*
 * Out for good, now: the sample of the asker's workspace, and only if they
 * are on it. Asks nobody else — it is a sample, and the bin and its thirty
 * days are for work somebody might want back.
 */
create function drop_sample(p uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from project pr
    where pr.id = p and pr.sample
      and pr.workspace_id = current_workspace()
      and exists (
        select 1 from project_member m
        where m.project_id = pr.id and m.actor_id = current_actor() and m.deleted_at is null)
  ) then
    return false;
  end if;
  perform purge_project_rows(p);
  return true;
end $$;
grant execute on function drop_sample(uuid) to tracker_app;

/*
 * The workspace's sample, if it has one, with the asker put on it — so
 * asking for a sample a colleague already made opens that one rather than
 * failing on the index above, or making a second.
 */
create function join_sample() returns uuid
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
    insert into project_member (id, workspace_id, project_id, actor_id, added_by)
    values (gen_random_uuid(), current_workspace(), p, current_actor(), current_actor());
  end if;
  return p;
end $$;
grant execute on function join_sample() to tracker_app;
