/*
 * What a screen costs is what it shows, not what the database holds
 * (the third audit).
 *
 * `pnpm load` was inside its budget on every line and the screens were not:
 * it timed simpler queries than the endpoints run, in one workspace, and
 * the cost below grows with every company's rows, not this one's. Measured
 * against the load table with other companies' rooms and members
 * beside it, the sidebar's rooms took 1.2 s, opening the million-message
 * room 0.85 s, a person's page 1.5 s, and the feed eleven seconds.
 */

/* ------------------------------------------- who somebody is, from them out

   Every policy asks "which projects, which rooms, which workspaces are
   mine", and every one of those started from the whole table: no index led
   with the person. A company with a hundred thousand rooms made every other
   company's sidebar slower. */
create index membership_by_actor on membership (actor_id, workspace_id);
create index conversation_member_by_actor on conversation_member (actor_id, conversation_id)
  where deleted_at is null and joined_at is not null;

/* The rooms somebody reads: the ones they were put in, and the channels of
   their projects that nobody was chosen for. It read every room of every
   company to find them. Same rule, driven from the reader. */
create or replace function visible_conversations() returns setof uuid
language sql stable security definer set search_path = public as $$
  select cv.id from conversation_member cm
  join conversation cv on cv.id = cm.conversation_id
  where cm.actor_id = current_actor() and cm.joined_at is not null and cm.deleted_at is null
    and cv.deleted_at is null
    and (current_workspace() is null or cv.workspace_id = current_workspace())
    and (cv.project_id is null or cv.project_id in (select visible_projects()))
  union
  select cv.id from conversation cv
  where cv.project_id in (select visible_projects()) and cv.deleted_at is null
    and not exists (
      select 1 from conversation_member cm
      where cm.conversation_id = cv.id and cm.joined_at is not null and cm.deleted_at is null
    )
$$;

/* ------------------------------------------------- asked once, not per row

   Two rules called a function for every row they looked at — thirty to
   fifty microseconds each, which is eleven seconds over the feed's three
   hundred thousand lines. Written as membership of a set, the set is made
   once per query: the shape `014_set_based_policies.sql` gave the rest.
   Roles are owner and member, so being a member of a workspace and being
   one of its staff are the same set. */
drop policy ae_read on activity_event;
create policy ae_read on activity_event for select using (
  workspace_id in (select staff_workspaces())
  and (
    (project_id is not null and project_id in (select visible_projects()))
    or (project_id is null and object_type is distinct from 'conversation')
    or (project_id is null and object_type = 'conversation' and object_id in (select visible_conversations()))
  )
);

/* Somebody is readable who is, or was, a member where I am staff — having
   been one is enough to be named in the record (`109_what_the_audit_found.sql`)
   — or who shares a project with me in this workspace. One set, made once. */
create or replace function visible_actors() returns setof uuid
language sql stable security definer set search_path = public as $$
  select current_actor()
  union
  select m.actor_id from membership m
  where m.workspace_id in (select staff_workspaces())
  union
  select theirs.actor_id
  from project_member mine
  join project pr on pr.id = mine.project_id
   and (current_workspace() is null or pr.workspace_id = current_workspace())
  join project_member theirs on theirs.project_id = mine.project_id and theirs.deleted_at is null
  where mine.actor_id = current_actor() and mine.deleted_at is null
$$;
drop policy a_read on actor;
create policy a_read on actor for select using (id in (select visible_actors()));

drop policy ol_read on object_link;
create policy ol_read on object_link for select using (workspace_id in (select staff_workspaces()));

drop policy te_read on time_entry;
create policy te_read on time_entry for select using (project_id in (select visible_projects()));

/* ---------------------------------------- indexes a policy lets a query use

   Under row-level security an index is used only for a comparison that is
   leakproof, and `=` on an enum is not: an index that starts with
   `object_type` is no index at all to a query that runs as somebody. A
   task's ten comments were found by reading every comment there is. */
create index comment_on on comment (object_id, created_at) where deleted_at is null;
create index subscription_on on subscription (object_id, actor_id) where deleted_at is null;
create index object_link_from on object_link (from_id) where deleted_at is null;
create index object_link_to on object_link (to_id) where deleted_at is null;
create index time_entry_on on time_entry (object_id, spent_on) where object_id is not null and deleted_at is null;

/* A room's page, newest first, whatever was deleted: the only room index
   covered the undeleted, and a deleted line stays while it has answers, so
   the page read all million. Not partial, so the checks that a removed room
   leaves nothing behind can use it too. */
create index message_by_room on message (conversation_id, created_at desc);

/* The notifications panel: the person's own, newest first, read or not. */
create index notification_by_reader on notification (actor_id, workspace_id, created_at desc)
  where deleted_at is null;

/* A project's Activity tab walked the workspace's whole feed for it. */
create index activity_by_project on activity_event (project_id, at desc) where project_id is not null;

/* What removing a row checks. A foreign key's check names no `deleted_at`,
   so the indexes over the undeleted could not answer it: deleting one room
   read every message, and the hourly clear-out took that path for every row
   it cleared. */
create index conversation_member_in_room on conversation_member (conversation_id);
create index comment_by_parent on comment (parent_id) where parent_id is not null;
create index task_by_parent_any on task (parent_id) where parent_id is not null;

/* ------------------------------------------------------------------ search

   The palette read every task, post and file in the database on every key,
   and a room's search every message in the room: `ilike` is not leakproof,
   so under row-level security the trigram indexes were never used. These
   run as their owner, so they are — and say in the query what the policies
   say: the session's workspace, and what the asker can see there. A session
   with no workspace finds nothing. Words inside a body from three letters,
   which is the shortest a trigram index can find. */
create function search_tasks(p_q text, p_project uuid)
returns table (id uuid, number int, project_id uuid, title text, created_at timestamptz, snippet text)
language sql stable security definer set search_path = public as $$
  with q as (select '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%' as l)
  select t.id, t.number, t.project_id, t.title, t.created_at,
         case when t.title ilike q.l then null
              else substr(t.said, greatest(1, strpos(lower(t.said), lower(p_q)) - 32), 96) end
  from task t, q
  where t.workspace_id = current_workspace()
    and t.project_id in (select visible_projects())
    and t.deleted_at is null
    and (t.title ilike q.l or (length(p_q) >= 3 and t.said ilike q.l))
    and (p_project is null or t.project_id = p_project)
  order by t.title ilike q.l desc, t.created_at desc
  limit 20
$$;

create function search_posts(p_q text, p_project uuid)
returns table (id uuid, number int, project_id uuid, title text, created_at timestamptz, snippet text)
language sql stable security definer set search_path = public as $$
  with q as (select '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%' as l)
  select p.id, p.number, p.project_id, p.title, p.created_at,
         case when p.title ilike q.l then null
              else substr(p.said, greatest(1, strpos(lower(p.said), lower(p_q)) - 32), 96) end
  from post p, q
  where p.workspace_id = current_workspace()
    and p.project_id in (select visible_projects())
    and p.deleted_at is null
    and (p.title ilike q.l or (length(p_q) >= 3 and p.said ilike q.l))
    and (p_project is null or p.project_id = p_project)
  order by p.title ilike q.l desc, p.created_at desc
  limit 20
$$;

create function search_files(p_q text, p_project uuid)
returns table (id uuid, number int, project_id uuid, title text, created_at timestamptz, snippet text)
language sql stable security definer set search_path = public as $$
  with q as (select '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%' as l)
  select f.id, f.number, f.project_id, f.name, f.created_at,
         case when f.name ilike q.l then null
              else substr(f.said, greatest(1, strpos(lower(f.said), lower(p_q)) - 32), 96) end
  from file f, q
  where f.workspace_id = current_workspace()
    and (f.project_id in (select visible_projects())
         or (f.project_id is null and f.conversation_id in (select visible_conversations())))
    and f.deleted_at is null
    and (f.name ilike q.l or (length(p_q) >= 3 and f.said ilike q.l))
    and (p_project is null or f.project_id = p_project)
  order by f.name ilike q.l desc, f.created_at desc
  limit 20
$$;

/* A room's own search — `docs/specs/find.md`: replies too, newest first.
   Made with the words in hand (`execute … using`), not as a plan for any
   words at all: in a room of a million, a phrase found forty times is read
   from the words' index, and a plan made without knowing the phrase walked
   the room from its newest line looking for it. */
create function search_room(p_room uuid, p_q text, p_before timestamptz, p_limit int)
returns table (id uuid, body jsonb, author_id uuid, author_name text, said_as text, author_avatar text,
               parent_id uuid, created_at timestamptz, edited_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not can_see_conversation(p_room) then
    return;
  end if;
  return query execute $q$
    select m.id, m.body,
           case when m.said_as is null then m.author_id end,
           coalesce(m.said_as, a.name), m.said_as,
           case when m.said_as is null then a.avatar_key end,
           m.parent_id, m.created_at, m.edited_at
    from message m join actor a on a.id = m.author_id
    where m.conversation_id = $1 and m.deleted_at is null
      and m.said ilike $2
      and ($3::timestamptz is null or m.created_at < $3)
    order by m.created_at desc
    limit $4
  $q$
  using p_room,
        '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%',
        p_before, least(p_limit, 30);
end $$;

grant execute on function search_tasks(text, uuid) to tracker_app;
grant execute on function search_posts(text, uuid) to tracker_app;
grant execute on function search_files(text, uuid) to tracker_app;
grant execute on function search_room(uuid, text, timestamptz, int) to tracker_app;

/* ------------------------------------------------ a ceiling the size of the place

   Six thousand requests a minute for a workspace was six a person in a
   company of a thousand, and three hundred people at work at once used it
   up for all of them. Sixty a minute for each person in it, and never less
   than it was. Asked through a definer: the limiter runs before anybody is
   known to the database. */
create function rate_allowance(p_workspace uuid, p_floor int, p_each int) returns int
language sql stable security definer set search_path = public as $$
  select greatest(p_floor, p_each * (
    select count(*)::int from membership
    where workspace_id = p_workspace and deleted_at is null and joined_at is not null))
$$;
grant execute on function rate_allowance(uuid, int, int) to tracker_app;

/* ------------------------------------------------- My tasks and the overview

   What somebody made, follows and was given, across every project they are
   on — read from the whole task table for want of an index that starts with
   the person, and "given" counted finished work the one it had left out. */
create index task_by_author on task (author_id, created_at desc) where deleted_at is null;
create index task_by_assignee_any on task (assignee_id) where deleted_at is null and assignee_id is not null;
create index subscription_by_actor on subscription (actor_id, object_id) where deleted_at is null;
create index task_unassigned_in on task (workspace_id, created_at desc)
  where deleted_at is null and completed_at is null and assignee_id is null;
