/*
 * The admin stops being a role.
 *
 * Most of what an
 * admin could do is about one project — archive it, switch its tools, edit
 * what somebody else wrote in it, log hours against it — and a
 * workspace-wide badge says somebody may do all of that to every project
 * there is. Somebody runs the rebrand and has no business archiving the
 * internal wiki.
 *
 * So: `project_member.manages`, one flag meaning this person runs this
 * project. The rest of what an admin could do has no project to be granted
 * in — inviting, roles, the security log, other people's tokens — and
 * belongs to the owner.
 */

alter table project_member add column manages boolean not null default false;

/* Whoever was an admin runs the projects they were on. An admin who was on
   none of them keeps nothing, which is the point: the powers were about
   projects and they were on no projects. */
update project_member pm set manages = true
from membership m
where m.actor_id = pm.actor_id and m.workspace_id = pm.workspace_id
  and m.role = 'admin' and m.deleted_at is null;

update invite set role = 'member' where role = 'admin';
update membership set role = 'member' where role = 'admin';

alter table membership drop constraint membership_role_is_real;
alter table invite drop constraint invite_role_is_real;
alter table membership add constraint membership_role_is_real
  check (role in ('owner', 'member'));
alter table invite add constraint invite_role_is_real
  check (role in ('owner', 'member'));

/* The projects I run. Usually empty, and never large. */
create function managed_projects() returns setof uuid
language sql stable security definer set search_path = public as $$
  select project_id from project_member
  where actor_id = current_actor() and manages and deleted_at is null
$$;
grant execute on function managed_projects to tracker_app;

/*
 * An owner runs every project without joining it. That was true of admins
 * too, and it is the reason neither has to be added to anything to
 * administer it. With the role gone the test is simply the owner.
 */
create or replace function in_project(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from project pr
    where pr.id = p and (
      role_in(pr.workspace_id) = 'owner'
      or exists (
        select 1 from project_member pm
        where pm.project_id = p and pm.actor_id = current_actor()
          and pm.deleted_at is null
      )
    )
  )
$$;

create or replace function visible_projects() returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.id from project p
  join membership m on m.workspace_id = p.workspace_id
    and m.actor_id = current_actor() and m.deleted_at is null and m.joined_at is not null
  where p.deleted_at is null
    and (
      m.role = 'owner'
      or exists (
        select 1 from project_member pm
        where pm.project_id = p.id and pm.actor_id = current_actor() and pm.deleted_at is null
      )
    )
$$;

create or replace function staff_workspaces() returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.workspace_id from membership m
  where m.actor_id = current_actor() and m.deleted_at is null and m.joined_at is not null
    and m.role in ('owner', 'member')
    and not is_outside()
$$;

/* ------------------------------------------------- the owner's, and only */

drop policy m_update on membership;
create policy m_update on membership for update
  using (role_in(workspace_id) = 'owner');

drop policy inv_read on invite;
create policy inv_read on invite for select using (role_in(workspace_id) = 'owner');

drop policy tok_own on api_token;
create policy tok_own on api_token for select using (
  actor_id = current_actor() or role_in(workspace_id) = 'owner'
);
drop policy tok_update on api_token;
create policy tok_update on api_token for update using (
  actor_id = current_actor() or role_in(workspace_id) = 'owner'
);

drop policy sec_read on security_event;
create policy sec_read on security_event for select
  using (role_in(workspace_id) = 'owner');

drop policy wh_read on webhook;
create policy wh_read on webhook for select using (role_in(workspace_id) = 'owner');
drop policy wh_write on webhook;
create policy wh_write on webhook for insert with check (role_in(workspace_id) = 'owner');
drop policy wh_update on webhook;
create policy wh_update on webhook for update using (role_in(workspace_id) = 'owner');
drop policy whd_read on webhook_delivery;
create policy whd_read on webhook_delivery for select
  using (role_in(workspace_id) = 'owner');

/* ------------------------------------------ the project's, for whoever runs it */

drop policy pm_write on project_member;
create policy pm_write on project_member for insert
  with check (role_in(workspace_id) in ('owner', 'member'));

/*
 * Staffing a project is part of running it. Routed through the owner it
 * would make them the bottleneck for work they are not doing.
 */
drop policy pm_update on project_member;
create policy pm_update on project_member for update using (
  role_in(workspace_id) = 'owner' or project_id in (select managed_projects())
);
