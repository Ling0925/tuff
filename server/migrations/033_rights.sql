/*
 * No sorts of people. A list of permissions instead.
 *
 * Client, then guest, then admin were all categories —
 * "this person is a lesser sort of member", "this one is a greater sort" —
 * and what anybody actually wants to say is "this person may delete tasks
 * here". So that is what is stored.
 *
 * Partial visibility goes with them. `visible_to_client` marked an object
 * as open to somebody who sees only open ones, and there is no longer such
 * a somebody: it would be a column nothing consults, on five tables, read
 * by policies on every query.
 */

alter table project_member add column rights text[] not null default '{}';

/* Whoever ran a project may do everything in it; everybody else keeps the
   ordinary two, which is what being on a project has always meant. */
update project_member set rights = case
  when manages then array['task.create','task.delete','channel.create','channel.delete','edit.any','manage']
  else array['task.create','channel.create']
end;

alter table project_member drop column manages;
alter table project_member drop column restricted;
alter table invite drop column restricted;

/* ---------------------------------------------- the policies, simplified */

create or replace function can_read_object(ws uuid, p uuid, visible boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select in_project(p)
$$;

create or replace function can_see_conversation(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from conversation cv
    where cv.id = c and cv.deleted_at is null and (
      exists (
        select 1 from conversation_member cm
        where cm.conversation_id = cv.id and cm.actor_id = current_actor()
          and cm.joined_at is not null and cm.deleted_at is null
      )
      or (
        cv.project_id is not null
        and in_project(cv.project_id)
        and not exists (
          select 1 from conversation_member cm
          where cm.conversation_id = cv.id and cm.joined_at is not null
            and cm.deleted_at is null
        )
      )
    )
  )
$$;

create or replace function visible_conversations() returns setof uuid
language sql stable security definer set search_path = public as $$
  select cv.id from conversation cv
  where cv.deleted_at is null and (
    exists (
      select 1 from conversation_member cm
      where cm.conversation_id = cv.id and cm.actor_id = current_actor()
        and cm.joined_at is not null and cm.deleted_at is null
    )
    or (
      cv.project_id is not null
      and cv.project_id in (select visible_projects())
      and not exists (
        select 1 from conversation_member cm
        where cm.conversation_id = cv.id and cm.joined_at is not null
          and cm.deleted_at is null
      )
    )
  )
$$;

do $$
declare t text;
begin
  foreach t in array array['post', 'task_list', 'task', 'file']
  loop
    execute format('drop policy o_read on %I', t);
    execute format('drop policy o_update on %I', t);
    execute format(
      'create policy o_read on %I for select using (
         project_id in (select visible_projects()))', t);
    execute format(
      'create policy o_update on %I for update using (
         project_id in (select visible_projects())) with check (true)', t);
  end loop;
end $$;

drop policy te_read on time_entry;
create policy te_read on time_entry for select using (in_project(project_id));

drop policy ae_read on activity_event;
create policy ae_read on activity_event for select using (is_member(workspace_id));

drop policy m_read on membership;
create policy m_read on membership for select using (
  actor_id = current_actor() or workspace_id in (select staff_workspaces())
);

create or replace function staff_workspaces() returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.workspace_id from membership m
  where m.actor_id = current_actor() and m.deleted_at is null and m.joined_at is not null
    and m.role in ('owner', 'member')
$$;

create or replace function visible_actors() returns setof uuid
language sql stable security definer set search_path = public as $$
  select current_actor()
  union
  select m.actor_id from membership m
  where m.deleted_at is null and m.workspace_id in (select staff_workspaces())
  union
  select theirs.actor_id
  from project_member mine
  join project_member theirs on theirs.project_id = mine.project_id
    and theirs.deleted_at is null
  where mine.actor_id = current_actor() and mine.deleted_at is null
$$;

/*
 * Who may change what somebody is allowed to do here.
 *
 * Whoever holds `manage` on the project, and the owner — who holds
 * everything everywhere and need not be on it.
 */
create or replace function manages_project(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from project pr
    where pr.id = p and role_in(pr.workspace_id) = 'owner'
  ) or exists (
    select 1 from project_member pm
    where pm.project_id = p and pm.actor_id = current_actor()
      and pm.deleted_at is null and 'manage' = any (pm.rights)
  )
$$;
grant execute on function manages_project to tracker_app;

drop policy pm_update on project_member;
create policy pm_update on project_member for update using (manages_project(project_id));

drop function if exists managed_projects();
drop function if exists is_outside();
drop function if exists restricted_projects();

/* The checklist reads its task's visibility, so it has to stop reading it
   before the column can go. Being on the project is the whole test now. */
drop policy ts_read on task_step;
create policy ts_read on task_step for select using (
  exists (select 1 from task t where t.id = task_step.task_id and in_project(t.project_id))
);

alter table post drop column visible_to_client;
alter table task drop column visible_to_client;
alter table file drop column visible_to_client;
alter table task_list drop column visible_to_client;
alter table conversation drop column visible_to_client;
