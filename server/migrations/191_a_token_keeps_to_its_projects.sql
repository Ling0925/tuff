/*
 * A token made for some projects reaches those projects and nothing else.
 *
 * `api_token.project_ids` was written and never read: the server carried it
 * on the request (`tokenProjectIds`) and no query, policy or check asked, so
 * a token "for one project" read and wrote in every project its person
 * could see. Personal tokens with projects have been refused since the
 * first audit for exactly that reason; the ones made before it, and the
 * agents' (whose list was never meant to bound them), still held a list.
 *
 * The bound is kept where visibility already is. A request that carries a
 * limited token says so in two settings (`withActor`): which actor the
 * token is, and its projects. `token_projects()` answers the list only
 * while the actor being asked about is the token's own — `may_read` asks
 * on behalf of somebody else by moving `app.actor_id`, and that somebody
 * is not bound by this token. Null is unbounded: a session, an unlimited
 * token, the worker.
 *
 * Every policy and definer function that decides "may see this project"
 * goes through `visible_projects()` or `in_project()`, and every room
 * through `visible_conversations()` or `can_see_conversation()` (which asks
 * `in_project()`), so narrowing those narrows tasks, posts, files, docs,
 * messages, comments, labels, cycles, time, search, the move between
 * projects and the sockets at once. What is not about a project — direct
 * messages, channels outside every project, the workspace's own feed lines
 * and notes about people — a limited token does not see at all.
 */

/* No `set search_path`: a function with one cannot be inlined, and this is
   asked in every policy of every query. Written schema-qualified instead,
   and asked as `(select token_projects())` so a query reads it once rather
   than once a row — a session's activity count went from 7 to 26 ms
   without that. */
create or replace function token_projects() returns uuid[]
language sql stable as $$
  select case
    when nullif(pg_catalog.current_setting('app.token_actor', true), '')::uuid = public.current_actor()
    then nullif(pg_catalog.current_setting('app.token_projects', true), '')::uuid[]
  end
$$;
grant execute on function token_projects() to tracker_app;

create or replace function visible_projects() returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.id from project p
  join membership m on m.workspace_id = p.workspace_id
    and m.actor_id = current_actor() and m.deleted_at is null and m.joined_at is not null
  where p.deleted_at is null
    and (current_workspace() is null or p.workspace_id = current_workspace())
    and ((select token_projects()) is null or p.id = any ((select token_projects())::uuid[]))
    and (
      m.role = 'owner'
      or exists (
        select 1 from project_member pm
        where pm.project_id = p.id and pm.actor_id = current_actor() and pm.deleted_at is null
      )
    )
$$;

create or replace function in_project(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select ((select token_projects()) is null or p = any ((select token_projects())::uuid[])) and exists (
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

create or replace function manages_project(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select ((select token_projects()) is null or p = any ((select token_projects())::uuid[])) and (
    exists (
      select 1 from project pr
      where pr.id = p and role_in(pr.workspace_id) = 'owner'
    ) or exists (
      select 1 from project_member pm
      where pm.project_id = p and pm.actor_id = current_actor()
        and pm.deleted_at is null and 'manage' = any (pm.rights)
    )
  )
$$;

/* A room outside every project is nobody's project: a limited token does
   not see it. A project's room follows its project, as it always did. */
create or replace function visible_conversations() returns setof uuid
language sql stable security definer set search_path = public as $$
  select cv.id from conversation_member cm
  join conversation cv on cv.id = cm.conversation_id
  where cm.actor_id = current_actor() and cm.joined_at is not null and cm.deleted_at is null
    and cv.deleted_at is null
    and (current_workspace() is null or cv.workspace_id = current_workspace())
    and exists (select 1 from membership mm where mm.workspace_id = cv.workspace_id and mm.actor_id = current_actor() and mm.joined_at is not null and mm.deleted_at is null)
    and ((cv.project_id is null and (select token_projects()) is null) or cv.project_id in (select visible_projects()))
  union
  select cv.id from conversation cv
  where cv.project_id in (select visible_projects()) and cv.deleted_at is null
    and not exists (
      select 1 from conversation_member cm
      where cm.conversation_id = cv.id and cm.joined_at is not null and cm.deleted_at is null
    )
$$;

create or replace function can_see_conversation(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from conversation cv
    where cv.id = c and cv.deleted_at is null
      and (current_workspace() is null or cv.workspace_id = current_workspace())
      and exists (select 1 from membership mm where mm.workspace_id = cv.workspace_id and mm.actor_id = current_actor() and mm.joined_at is not null and mm.deleted_at is null)
      and ((cv.project_id is null and (select token_projects()) is null) or in_project(cv.project_id))
      and (
        exists (
          select 1 from conversation_member cm
          where cm.conversation_id = cv.id and cm.actor_id = current_actor()
            and cm.joined_at is not null and cm.deleted_at is null
        )
        or (
          cv.project_id is not null
          and not exists (
            select 1 from conversation_member cm
            where cm.conversation_id = cv.id and cm.joined_at is not null
              and cm.deleted_at is null
          )
        )
      )
  )
$$;

create or replace function conversation_seen(p uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(cv.name, 'main') from conversation cv
  where cv.id = p
    and (current_workspace() is null or cv.workspace_id = current_workspace())
    and ((cv.project_id is null and (select token_projects()) is null) or cv.project_id in (select visible_projects()))
    and (
      exists (
        select 1 from conversation_member cm
        where cm.conversation_id = cv.id and cm.actor_id = current_actor()
          and cm.joined_at is not null and cm.deleted_at is null
      )
      or (
        cv.project_id is not null
        and not exists (
          select 1 from conversation_member cm
          where cm.conversation_id = cv.id and cm.joined_at is not null
            and cm.deleted_at is null
        )
      )
    )
$$;

/*
 * Whether a note is about one of the token's projects. A note has an object
 * and no project, so the project is looked up from the object; a note about
 * a person (somebody joined) is about no project and is not the token's.
 */
create or replace function token_reaches(p_type object_kind, p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (select token_projects()) is null or coalesce((
    case p_type
      when 'task' then (select x.project_id from task x where x.id = p_id)
      when 'post' then (select x.project_id from post x where x.id = p_id)
      when 'file' then (select x.project_id from file x where x.id = p_id)
      when 'conversation' then (select x.project_id from conversation x where x.id = p_id)
      when 'message' then (select cv.project_id from message m join conversation cv on cv.id = m.conversation_id where m.id = p_id)
      when 'project' then p_id
    end
  ) = any ((select token_projects())::uuid[]), false)
$$;
grant execute on function token_reaches(object_kind, uuid) to tracker_app;

create or replace function unread_for(p_workspace uuid, p_actor uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from notification
  where workspace_id = p_workspace and actor_id = p_actor
    and read_at is null and deleted_at is null
    /* Asked for the one asking, or by the worker, which asks for nobody. */
    and (current_actor() is null or p_actor = current_actor())
    and ((select token_projects()) is null or token_reaches(object_type, object_id))
$$;

/*
 * The four tables that hold rows about no project beside rows about one.
 * Restrictive, so they narrow whatever the permissive policies let through
 * and change nothing when no limited token is asking.
 */
create policy tok_bound_read on activity_event as restrictive for select
  using ((select token_projects()) is null or project_id = any ((select token_projects())::uuid[]));

create policy tok_bound on comment as restrictive for all
  using ((select token_projects()) is null or project_id is not null)
  with check ((select token_projects()) is null or project_id is not null);

create policy tok_bound on file as restrictive for all
  using ((select token_projects()) is null or project_id is not null)
  with check ((select token_projects()) is null or project_id is not null);

create policy tok_bound_read on notification as restrictive for select
  using ((select token_projects()) is null or token_reaches(object_type, object_id));
create policy tok_bound_update on notification as restrictive for update
  using ((select token_projects()) is null or token_reaches(object_type, object_id));

/*
 * An agent's token was written with the projects it was connected to, and
 * what an agent reaches is its places (`project_member`), which change on
 * its page after it is connected. Bounding it
 * by the list it was born with would take away every project it was put
 * on since, so its list is emptied: its places bound it, as they did.
 */
update api_token t set project_ids = '{}', updated_at = now()
where cardinality(t.project_ids) > 0
  and exists (select 1 from agent g where g.actor_id = t.actor_id);
