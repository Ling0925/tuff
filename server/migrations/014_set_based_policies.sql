-- Row-level security was costing more than the query it guarded.
--
-- `can_read_object(workspace_id, project_id, visible_to_client)` takes the row
-- as arguments, so Postgres has to call it once per row: 3 000 calls, each
-- running two subqueries, turned a 20 ms index scan into 1.2 seconds. The
-- index was never the problem — the plan showed it being used, with the whole
-- cost sitting in the filter above it.
--
-- Written as set membership instead, the sets are computed once per query as
-- hashed InitPlans and the check becomes a lookup. Same rule, same answers,
-- evaluated once instead of per row.
--
-- This is the reason the load table is in the design. Nothing here is visible
-- on demo data: with fifty tasks the per-row call is free.

create function visible_projects() returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.id from project p
  join membership m on m.workspace_id = p.workspace_id
    and m.actor_id = current_actor() and m.deleted_at is null and m.joined_at is not null
  where p.deleted_at is null
    and (
      -- An owner or admin runs every project without joining it.
      m.role in ('owner', 'admin')
      or exists (
        select 1 from project_member pm
        where pm.project_id = p.id and pm.actor_id = current_actor() and pm.deleted_at is null
      )
    )
$$;

/* The workspaces where I am the outside party. Usually empty, and never large. */
create function client_workspaces() returns setof uuid
language sql stable security definer set search_path = public as $$
  select workspace_id from membership
  where actor_id = current_actor() and role = 'client'
    and deleted_at is null and joined_at is not null
$$;

grant execute on function visible_projects to tracker_app;
grant execute on function client_workspaces to tracker_app;

do $$
declare t text;
begin
  foreach t in array array['post', 'task_list', 'task', 'file']
  loop
    execute format('drop policy o_read on %I', t);
    execute format('drop policy o_write on %I', t);
    execute format('drop policy o_update on %I', t);
    execute format(
      'create policy o_read on %I for select using (
         project_id in (select visible_projects())
         and (workspace_id not in (select client_workspaces()) or visible_to_client))', t);
    execute format(
      'create policy o_write on %I for insert with check (
         project_id in (select visible_projects()) and author_id = current_actor())', t);
    execute format(
      'create policy o_update on %I for update using (
         project_id in (select visible_projects())
         and (workspace_id not in (select client_workspaces()) or visible_to_client))
       with check (true)', t);
  end loop;
end $$;

drop policy p_read on project;
create policy p_read on project for select using (id in (select visible_projects()));
drop policy p_update on project;
create policy p_update on project for update using (id in (select visible_projects()));

drop policy pm_read on project_member;
create policy pm_read on project_member for select
  using (project_id in (select visible_projects()));

drop policy cmt_read on comment;
create policy cmt_read on comment for select using (
  project_id is null or project_id in (select visible_projects())
);

drop policy te_read on time_entry;
create policy te_read on time_entry for select using (
  project_id in (select visible_projects())
  and workspace_id not in (select client_workspaces())
);
