/*
 * The workspace a session is in, inside the policies.
 *
 * Row-level security answered "may this person see this row", and a person is
 * in one workspace the way a person is in one country — which is to say not
 * always. The moment one account held two workspaces, every query that leant
 * on RLS instead of naming the workspace returned both: My tasks listed the
 * other company's work, and the palette searched it. Nothing had changed in
 * those queries. They had been wrong since they were written and could not be
 * wrong until somebody had a second workspace.
 *
 * `app.workspace_id` is set beside `app.actor_id` for the length of the
 * transaction, and the three functions every policy routes through refuse a
 * row outside it. Bounding them here rather than adding a WHERE clause to a
 * hundred handlers is the same argument the schema already makes against
 * checking in controllers: the one that forgets is the one that matters, and
 * there is no way to forget this.
 *
 * Unset means unbounded, which is what the workspace switcher, the login
 * flows and the worker need — they are about the actor across workspaces and
 * say so by not setting it.
 */

create or replace function current_workspace() returns uuid
language sql stable as $$
  select nullif(current_setting('app.workspace_id', true), '')::uuid
$$;

create or replace function is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (current_workspace() is null or ws = current_workspace())
     and exists (
       select 1 from membership
       where workspace_id = ws and actor_id = current_actor()
         and deleted_at is null and joined_at is not null
     )
$$;

create or replace function role_in(ws uuid) returns role_kind
language sql stable security definer set search_path = public as $$
  select role from membership
  where workspace_id = ws and actor_id = current_actor()
    and deleted_at is null and joined_at is not null
    and (current_workspace() is null or ws = current_workspace())
  limit 1
$$;

create or replace function in_project(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from project pr
    where pr.id = p
      and (current_workspace() is null or pr.workspace_id = current_workspace())
      and (
        role_in(pr.workspace_id) in ('owner', 'admin')
        or exists (
          select 1 from project_member pm
          where pm.project_id = p and pm.actor_id = current_actor()
            and pm.deleted_at is null
        )
      )
  )
$$;

/*
 * And the one policy that reaches for people directly rather than through
 * those three: sharing a project makes a person visible, and the project has
 * to be one in this session's workspace or the same name comes back from the
 * other company.
 */
drop policy a_read on actor;
create policy a_read on actor for select using (
  id = current_actor()
  or exists (
    select 1 from membership m
    where m.actor_id = actor.id and m.deleted_at is null
      and role_in(m.workspace_id) in ('owner', 'admin', 'member')
  )
  or exists (
    select 1 from project_member mine
    join project pr on pr.id = mine.project_id
     and (current_workspace() is null or pr.workspace_id = current_workspace())
    join project_member theirs on theirs.project_id = mine.project_id
      and theirs.deleted_at is null
    where mine.actor_id = current_actor() and mine.deleted_at is null
      and theirs.actor_id = actor.id
  )
);

/*
 * And the three set-returning functions the policies actually call.
 *
 * `014_set_based_policies.sql` moved the hot policies off the per-row
 * predicates above and onto these, for the plans; the predicates stayed
 * because other definer functions still ask them. So both have to know about
 * the session's workspace, and these are the ones that decide what a select
 * returns.
 */
create or replace function visible_projects() returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.id from project p
  join membership m on m.workspace_id = p.workspace_id
    and m.actor_id = current_actor() and m.deleted_at is null and m.joined_at is not null
  where p.deleted_at is null
    and (current_workspace() is null or p.workspace_id = current_workspace())
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
    and (current_workspace() is null or m.workspace_id = current_workspace())
$$;

/*
 * A conversation reaches the asker two ways, and only one of them came
 * through a project. Being a member of a room is a fact about the person, so
 * that branch has to be bounded here or a direct message from the other
 * company stands in this workspace's chat list.
 */
create or replace function visible_conversations() returns setof uuid
language sql stable security definer set search_path = public as $$
  select cv.id from conversation cv
  where cv.deleted_at is null
    and (current_workspace() is null or cv.workspace_id = current_workspace())
    and (
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
