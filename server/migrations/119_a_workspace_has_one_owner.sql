/*
 * One owner a workspace.
 *
 * Anybody could be made an owner, by an invitation or from their card, and
 * a workspace could have three: three people who could change the plan,
 * remove each other and take the workspace from whoever pays for it. The
 * owner is one person. Ownership moves, from the workspace's settings, and
 * nothing else makes an owner.
 */

/*
 * The workspaces that have more than one: the first owner keeps it, and
 * the rest are members — on every project they could open as owners, so
 * nobody finds their work gone the morning after.
 */
with ranked as (
  select id, workspace_id, actor_id,
         row_number() over (partition by workspace_id order by created_at, id) as n
  from membership
  where role = 'owner' and deleted_at is null
),
demoted as (
  update membership m set role = 'member'
  from ranked r
  where m.id = r.id and r.n > 1
  returning m.workspace_id, m.actor_id
)
insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
select gen_random_uuid(), d.workspace_id, p.id, d.actor_id, d.actor_id, array['task.create', 'channel.create']
from demoted d
join project p on p.workspace_id = d.workspace_id and p.deleted_at is null
where not exists (
  select 1 from project_member pm
  where pm.project_id = p.id and pm.actor_id = d.actor_id and pm.deleted_at is null
);

/* And an invitation still out as an owner joins as a member. */
update invite set role = 'member' where role = 'owner';

create unique index membership_one_owner on membership (workspace_id)
  where role = 'owner' and deleted_at is null;

/*
 * Handing the workspace to somebody in it.
 *
 * Only by its owner, to a member who has joined, in the workspace the
 * session is in. The two rows change in order — the owner steps down, then
 * the other steps up — because one owner is checked at each, and a definer
 * because the second step is made by somebody who, after the first, is no
 * longer the owner the rows' policy asks for. The one handing it over stays,
 * as a member of every project they could open: what they were working on
 * is still theirs to work on.
 */
create function transfer_workspace(p_workspace uuid, p_to uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_from uuid := current_actor();
begin
  if v_from is null or p_to = v_from or p_workspace is distinct from current_workspace() then
    return false;
  end if;
  if not exists (
    select 1 from membership
    where workspace_id = p_workspace and actor_id = v_from and role = 'owner'
      and deleted_at is null and joined_at is not null
  ) or not exists (
    select 1 from membership
    where workspace_id = p_workspace and actor_id = p_to
      and deleted_at is null and joined_at is not null
  ) then
    return false;
  end if;
  update membership set role = 'member'
  where workspace_id = p_workspace and actor_id = v_from and deleted_at is null;
  update membership set role = 'owner', may_create_projects = null
  where workspace_id = p_workspace and actor_id = p_to and deleted_at is null;
  insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
  select gen_random_uuid(), p_workspace, p.id, v_from, v_from, array['task.create', 'channel.create']
  from project p
  where p.workspace_id = p_workspace and p.deleted_at is null
    and not exists (
      select 1 from project_member pm
      where pm.project_id = p.id and pm.actor_id = v_from and pm.deleted_at is null
    );
  insert into security_event (id, workspace_id, actor_id, kind, meta)
  values (gen_random_uuid(), p_workspace, v_from, 'ownership_transferred', jsonb_build_object('to', p_to));
  return true;
end $$;
grant execute on function transfer_workspace(uuid, uuid) to tracker_app;
