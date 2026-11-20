/*
 * The client stops being a role.
 *
 * The fourth role
 * answered two questions at once — this person is not on the team, and this
 * person sees only what was opened — and a workspace-wide role gets the
 * first one wrong. Somebody can be a client on one project and a contractor
 * on another, and a role cannot say both.
 *
 * Three roles now, and `restricted` on the membership of a project. The
 * object flag does not move: `visible_to_client` is still what makes partial
 * visibility work, and it is still checked in the query.
 */

alter table project_member add column restricted boolean not null default false;
alter table invite add column restricted boolean not null default false;

/* Whoever was a client is a restricted member of the projects they were on. */
update project_member pm set restricted = true
from membership m
where m.actor_id = pm.actor_id and m.workspace_id = pm.workspace_id
  and m.role = 'client' and m.deleted_at is null;

update invite set restricted = true, role = 'member' where role = 'client';
update membership set role = 'member' where role = 'client';

/* The projects where I am somebody's guest. Usually empty, and never large. */
create function restricted_projects() returns setof uuid
language sql stable security definer set search_path = public as $$
  select project_id from project_member
  where actor_id = current_actor() and restricted and deleted_at is null
$$;

/*
 * Whether I am a guest rather than one of the team.
 *
 * The one derived rule in the design: restricted anywhere means outside
 * everywhere. Written once and named, rather than as the same `exists` in
 * six policies — it is the place the design is implicit, so it should be the
 * place somebody can read.
 */
create function is_outside() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from project_member
    where actor_id = current_actor() and restricted and deleted_at is null
  )
$$;

grant execute on function restricted_projects to tracker_app;
grant execute on function is_outside to tracker_app;

/* Same rule, keyed to the project instead of the workspace. */
create or replace function can_read_object(ws uuid, p uuid, visible boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select in_project(p) and (p not in (select restricted_projects()) or visible)
$$;

/*
 * The four entities, set-based as migration 014 left them: the sets are
 * computed once per query as hashed InitPlans rather than once per row.
 */
do $$
declare t text;
begin
  foreach t in array array['post', 'task_list', 'task', 'file']
  loop
    execute format('drop policy o_read on %I', t);
    execute format('drop policy o_update on %I', t);
    execute format(
      'create policy o_read on %I for select using (
         project_id in (select visible_projects())
         and (project_id not in (select restricted_projects()) or visible_to_client))', t);
    execute format(
      'create policy o_update on %I for update using (
         project_id in (select visible_projects())
         and (project_id not in (select restricted_projects()) or visible_to_client))
       with check (true)', t);
  end loop;
end $$;

drop policy te_read on time_entry;
create policy te_read on time_entry for select using (
  in_project(project_id) and not is_outside()
);

-- A guest is never served the activity feed. Not filtered: not served.
drop policy ae_read on activity_event;
create policy ae_read on activity_event for select using (
  is_member(workspace_id) and not is_outside()
);

/*
 * The roster, and the people in it.
 *
 * These two used to lean on the role being `client`, which meant that the
 * moment the role went away every guest could read the whole workspace's
 * membership — an agency's client handed every other client's staff. The
 * guard is the same shape, asked of the flag instead.
 */
drop policy m_read on membership;
create policy m_read on membership for select using (
  actor_id = current_actor()
  or (role_in(workspace_id) in ('owner', 'admin', 'member') and not is_outside())
);

drop policy a_read on actor;
create policy a_read on actor for select using (
  id = current_actor()
  or (
    not is_outside()
    and exists (
      select 1 from membership m
      where m.actor_id = actor.id and m.deleted_at is null
        and role_in(m.workspace_id) in ('owner', 'admin', 'member')
    )
  )
  or exists (
    select 1 from project_member mine
    join project_member theirs on theirs.project_id = mine.project_id
      and theirs.deleted_at is null
    where mine.actor_id = current_actor() and mine.deleted_at is null
      and theirs.actor_id = actor.id
  )
);

drop function client_workspaces();
drop function is_client(uuid);

/*
 * The value nothing implements any more, refused rather than removed.
 *
 * Dropping it from the enum means dropping and rebuilding `role_in`, and ten
 * policies across eight tables depend on that function. Rebuilding ten
 * policies by hand to delete a word is the trade this repository has lost
 * before: the cost is not the work, it is the one that comes back subtly
 * different.
 *
 * So the type keeps the value and the tables refuse it, by name, at the
 * point somebody tries. `Role` in the shared schema has three, and the
 * database agrees with it — which is the property that actually mattered.
 */
alter table membership add constraint membership_role_is_real check (role <> 'client');
alter table invite add constraint invite_role_is_real check (role <> 'client');

/*
 * Accepting an invite lands the person restricted where the invite said so.
 *
 * Otherwise an outsider arrives as a full member of the projects named and
 * somebody has to remember to cut them down — and the window between the two
 * is the window where they read everything.
 */
create or replace function accept_invite(
  p_token_hash text,
  p_actor_id uuid,
  p_email citext,
  p_name text,
  p_password_hash text
) returns table (workspace_id uuid, actor_id uuid, created_account boolean)
language plpgsql security definer set search_path = public as $$
declare
  inv     record;
  v_actor uuid;
  v_new   boolean := false;
  p       uuid;
begin
  update invite set used_at = now()
  where token_hash = p_token_hash
    and used_at is null
    and deleted_at is null
    and expires_at > now()
  returning * into inv;

  if inv is null then
    return;
  end if;

  select u.actor_id into v_actor from app_user u where u.email = p_email;

  if v_actor is null then
    v_actor := p_actor_id;
    v_new := true;
    insert into actor (id, name) values (v_actor, p_name);
    insert into app_user (actor_id, email, password_hash, email_verified_at)
      values (v_actor, p_email, p_password_hash, now());
  end if;

  insert into membership (id, workspace_id, actor_id, role, invited_by, joined_at)
  values (gen_random_uuid(), inv.workspace_id, v_actor, inv.role, inv.created_by, now())
  on conflict do nothing;

  foreach p in array inv.project_ids
  loop
    insert into project_member (id, workspace_id, project_id, actor_id, added_by, restricted)
    values (gen_random_uuid(), inv.workspace_id, p, v_actor, inv.created_by, inv.restricted)
    on conflict do nothing;
  end loop;

  update invite set used_by = v_actor where id = inv.id;

  insert into security_event (id, workspace_id, actor_id, kind, meta)
  values (gen_random_uuid(), inv.workspace_id, v_actor, 'invite_accepted',
          jsonb_build_object('role', inv.role, 'restricted', inv.restricted));

  return query select inv.workspace_id, v_actor, v_new;
end $$;
