-- Access is a property of the row, not of the endpoint.
--
-- The design asks for every query to be bounded by workspace in the query
-- itself. Row-level security is how that becomes true of queries nobody has
-- written yet: a handler that forgets a WHERE clause returns nothing rather
-- than everything.
--
-- The application connects as tracker_app, which is not the table owner and
-- therefore cannot bypass any of this. DELETE is granted nowhere: deletion is
-- soft, with a restore window, as the design requires.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'tracker_app') then
    create role tracker_app nologin;
  end if;
end $$;

grant usage on schema public to tracker_app;
grant select, insert, update on all tables in schema public to tracker_app;
grant usage, select on all sequences in schema public to tracker_app;

-- Who is asking. Set per transaction by the application; a connection that
-- forgets loses to every policy below rather than winning.
create function current_actor() returns uuid
language sql stable as $$
  select nullif(current_setting('app.actor_id', true), '')::uuid
$$;

create function is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from membership
    where workspace_id = ws and actor_id = current_actor()
      and deleted_at is null and joined_at is not null
  )
$$;

create function role_in(ws uuid) returns role_kind
language sql stable security definer set search_path = public as $$
  select role from membership
  where workspace_id = ws and actor_id = current_actor()
    and deleted_at is null and joined_at is not null
  limit 1
$$;

/*
 * Whether the asker is on the project.
 *
 * An owner or admin administers the workspace and is not required to join
 * every project to run it — the alternative default is an administrator who
 * has to add themselves to everything, which is worse than what it guards
 * against.
 */
create function in_project(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from project pr
    where pr.id = p and (
      role_in(pr.workspace_id) in ('owner', 'admin')
      or exists (
        select 1 from project_member pm
        where pm.project_id = p and pm.actor_id = current_actor()
          and pm.deleted_at is null
      )
    )
  )
$$;

create function is_client(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select role_in(ws) = 'client'
$$;

/*
 * Whether an object in this project is readable.
 *
 * One predicate for all four entities, because client visibility is a flag on
 * the object rather than a branch in the logic. A client reads what is on the
 * project they are on and marked open; everyone else reads the project.
 */
create function can_read_object(ws uuid, p uuid, visible boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select in_project(p) and (not is_client(ws) or visible)
$$;

alter table actor enable row level security;
alter table app_user enable row level security;
alter table workspace enable row level security;
alter table membership enable row level security;
alter table project enable row level security;
alter table project_member enable row level security;
alter table post enable row level security;
alter table task_list enable row level security;
alter table task enable row level security;
alter table task_step enable row level security;
alter table file enable row level security;
alter table conversation enable row level security;
alter table conversation_member enable row level security;
alter table message enable row level security;
alter table comment enable row level security;
alter table subscription enable row level security;
alter table time_entry enable row level security;
alter table object_link enable row level security;
alter table activity_event enable row level security;
alter table notification enable row level security;
alter table invite enable row level security;
alter table api_token enable row level security;
alter table refresh_session enable row level security;
alter table security_event enable row level security;

create policy ws_read on workspace for select using (is_member(id));
create policy ws_write on workspace for insert with check (true);
create policy ws_update on workspace for update using (role_in(id) = 'owner');

/*
 * A client never learns who else is in the workspace.
 *
 * They read their own row and nothing more. A workspace-wide people list hands
 * an agency's client every other client's staff and, through project names,
 * the client list itself.
 */
create policy m_read on membership for select using (
  actor_id = current_actor()
  or role_in(workspace_id) in ('owner', 'admin', 'member')
);
create policy m_write on membership for insert with check (true);
create policy m_update on membership for update
  using (role_in(workspace_id) in ('owner', 'admin'));

-- An actor is visible to someone who shares a project with them, or to staff.
create policy a_read on actor for select using (
  id = current_actor()
  or exists (
    select 1 from membership m
    where m.actor_id = actor.id and m.deleted_at is null
      and role_in(m.workspace_id) in ('owner', 'admin', 'member')
  )
  or exists (
    select 1 from project_member mine
    join project_member theirs on theirs.project_id = mine.project_id
      and theirs.deleted_at is null
    where mine.actor_id = current_actor() and mine.deleted_at is null
      and theirs.actor_id = actor.id
  )
);
create policy a_write on actor for insert with check (true);
create policy a_update on actor for update using (id = current_actor());

create policy p_read on project for select using (
  is_member(workspace_id) and in_project(id)
);
create policy p_write on project for insert with check (is_member(workspace_id));
create policy p_update on project for update using (in_project(id));

create policy pm_read on project_member for select using (in_project(project_id));
create policy pm_write on project_member for insert
  with check (role_in(workspace_id) in ('owner', 'admin', 'member'));
create policy pm_update on project_member for update
  using (role_in(workspace_id) in ('owner', 'admin'));

-- The four, and the things that hang off them, share one shape.
do $$
declare t text;
begin
  foreach t in array array['post', 'task_list', 'task', 'file']
  loop
    execute format(
      'create policy o_read on %I for select
         using (can_read_object(workspace_id, project_id, visible_to_client))', t);
    execute format(
      'create policy o_write on %I for insert
         with check (in_project(project_id) and author_id = current_actor())', t);
    execute format(
      'create policy o_update on %I for update
         using (can_read_object(workspace_id, project_id, visible_to_client))
         with check (true)', t);
  end loop;
end $$;

create policy ts_read on task_step for select using (
  exists (select 1 from task t where t.id = task_step.task_id
          and can_read_object(t.workspace_id, t.project_id, t.visible_to_client))
);
create policy ts_write on task_step for insert with check (
  exists (select 1 from task t where t.id = task_step.task_id and in_project(t.project_id))
);
create policy ts_update on task_step for update using (
  exists (select 1 from task t where t.id = task_step.task_id and in_project(t.project_id))
) with check (true);

/*
 * A channel is readable by the people in it. For a project channel that is the
 * project, narrowed by the client flag — the team's own channel and the one
 * the client reads are separate rows on the same project, not one row with a
 * filter somebody remembers to apply.
 */
create function can_see_conversation(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from conversation cv
    where cv.id = c and cv.deleted_at is null and (
      (cv.project_id is not null
        and can_read_object(cv.workspace_id, cv.project_id, cv.visible_to_client))
      or exists (
        select 1 from conversation_member cm
        where cm.conversation_id = cv.id and cm.actor_id = current_actor()
          and cm.deleted_at is null
      )
    )
  )
$$;

create policy c_read on conversation for select using (can_see_conversation(id));
create policy c_write on conversation for insert with check (is_member(workspace_id));
create policy c_update on conversation for update using (can_see_conversation(id));

create policy cm_read on conversation_member for select
  using (can_see_conversation(conversation_id));
create policy cm_write on conversation_member for insert with check (is_member(workspace_id));
create policy cm_update on conversation_member for update
  using (can_see_conversation(conversation_id));

create policy msg_read on message for select using (can_see_conversation(conversation_id));
create policy msg_write on message for insert
  with check (can_see_conversation(conversation_id) and author_id = current_actor());
create policy msg_update on message for update
  using (can_see_conversation(conversation_id)) with check (true);

create policy cmt_read on comment for select using (
  project_id is null or in_project(project_id)
);
create policy cmt_write on comment for insert
  with check (author_id = current_actor() and (project_id is null or in_project(project_id)));
create policy cmt_update on comment for update using (author_id = current_actor())
  with check (true);

create policy sub_own on subscription for select using (actor_id = current_actor());
create policy sub_write on subscription for insert with check (actor_id = current_actor());
create policy sub_update on subscription for update using (actor_id = current_actor());

create policy te_read on time_entry for select using (
  in_project(project_id) and not is_client(workspace_id)
);
create policy te_write on time_entry for insert with check (in_project(project_id));
create policy te_update on time_entry for update using (in_project(project_id));

create policy ol_read on object_link for select using (is_member(workspace_id));
create policy ol_write on object_link for insert with check (is_member(workspace_id));
create policy ol_update on object_link for update using (is_member(workspace_id));

-- A client is never served the activity feed. Not filtered: not served.
create policy ae_read on activity_event for select using (
  is_member(workspace_id) and not is_client(workspace_id)
);
create policy ae_write on activity_event for insert with check (is_member(workspace_id));

create policy n_own on notification for select using (actor_id = current_actor());
create policy n_write on notification for insert with check (is_member(workspace_id));
create policy n_update on notification for update using (actor_id = current_actor());

create policy inv_read on invite for select
  using (role_in(workspace_id) in ('owner', 'admin'));
create policy inv_write on invite for insert with check (is_member(workspace_id));
create policy inv_update on invite for update using (is_member(workspace_id));

create policy tok_own on api_token for select using (
  actor_id = current_actor() or role_in(workspace_id) in ('owner', 'admin')
);
create policy tok_write on api_token for insert with check (actor_id = current_actor());
create policy tok_update on api_token for update using (
  actor_id = current_actor() or role_in(workspace_id) in ('owner', 'admin')
);

create policy sess_own on refresh_session for select using (actor_id = current_actor());
create policy sess_write on refresh_session for insert with check (true);
create policy sess_update on refresh_session for update using (true) with check (true);

create policy sec_write on security_event for insert with check (true);
create policy sec_read on security_event for select
  using (role_in(workspace_id) in ('owner', 'admin'));

create policy u_read on app_user for select using (actor_id = current_actor());
create policy u_write on app_user for insert with check (true);
create policy u_update on app_user for update using (actor_id = current_actor());

/*
 * Secrets are not merely policy-protected, they are not selectable at all.
 *
 * A column grant is enforced by the database rather than by every select list
 * staying correct forever.
 */
revoke select on app_user from tracker_app;
grant select (actor_id, email, email_verified_at, totp_enabled, created_at, updated_at)
  on app_user to tracker_app;

revoke select on api_token from tracker_app;
grant select (id, workspace_id, actor_id, name, project_ids, last_used_at,
              last_used_ip, expires_at, revoked_at, created_at, updated_at, deleted_at)
  on api_token to tracker_app;

revoke select on invite from tracker_app;
grant select (id, workspace_id, email, role, project_ids, created_by, expires_at,
              used_at, used_by, created_at, updated_at, deleted_at)
  on invite to tracker_app;

revoke select on refresh_session from tracker_app;
grant select (id, actor_id, user_agent, ip, expires_at, revoked_at, last_used_at, created_at)
  on refresh_session to tracker_app;

grant execute on all functions in schema public to tracker_app;
