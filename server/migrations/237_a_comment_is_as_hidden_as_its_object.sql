/*
 * What the review of found in migration 236.
 *
 * 1. A comment is read, changed and taken back only by somebody who may
 *    read the thing it is on. The policies asked about the comment's
 *    project and never about its object, and a file sent in a project's
 *    room with chosen people is the project's and the room's
 *    (migration 137): hidden from the owner and whoever runs the project
 *    outside the room — `GET /api/files/:id` answered 404 — while its
 *    comments were read by everybody on the project, and, after 236,
 *    rewritten and deleted by the owner and the runners. Each policy now
 *    asks for the object as well, by its primary key, under the object
 *    table's own policies: a task and an announcement are as visible as
 *    their project, a file as its project and its room.
 *
 * 2. `may_edit_said` counted an owner whose address is unproved as the
 *    owner; `can()` counts them a member (`unproved` in
 *    `shared-schema/src/permissions.ts`). Now the same: the owner's
 *    clause asks `auth_email_confirmed` too — an agent, which has no
 *    address, answers null there and is never unproved.
 *
 * 3. Whoever may change a comment changes what it says, and nothing about
 *    whose it is or where: `cmt_update`'s check is `true`, so anybody past
 *    its `using` could have moved a comment to another object or put it
 *    under another name. A trigger refuses any change to its author, its
 *    workspace, its project, what it is on and when it was made.
 */
create or replace function may_edit_said(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select ((select token_projects()) is null or p = any ((select token_projects())::uuid[])) and (
    exists (
      select 1 from project pr
      where pr.id = p and role_in(pr.workspace_id) = 'owner'
        and auth_email_confirmed(current_actor()) is not false
    ) or exists (
      select 1 from project_member pm
      where pm.project_id = p and pm.actor_id = current_actor()
        and pm.deleted_at is null and pm.rights && array['manage', 'edit.any']
    )
  )
$$;

drop policy cmt_read on comment;
create policy cmt_read on comment for select using (
  (project_id is null or project_id in (select visible_projects()))
  and (
    (object_type = 'task' and exists (select 1 from task o where o.id = comment.object_id))
    or (object_type = 'post' and exists (select 1 from post o where o.id = comment.object_id))
    or (object_type = 'file' and exists (select 1 from file o where o.id = comment.object_id))
  )
);

drop policy cmt_update on comment;
create policy cmt_update on comment for update using (
  (author_id = current_actor()
    or (project_id is not null and project_id in (select visible_projects()) and may_edit_said(project_id)))
  and (
    (object_type = 'task' and exists (select 1 from task o where o.id = comment.object_id))
    or (object_type = 'post' and exists (select 1 from post o where o.id = comment.object_id))
    or (object_type = 'file' and exists (select 1 from file o where o.id = comment.object_id))
  )
) with check (true);

create function comment_stays_whose_it_is() returns trigger
language plpgsql as $$
begin
  if new.author_id is distinct from old.author_id
     or new.workspace_id is distinct from old.workspace_id
     or new.project_id is distinct from old.project_id
     or new.object_type is distinct from old.object_type
     or new.object_id is distinct from old.object_id
     or new.created_at is distinct from old.created_at then
    raise exception 'a comment keeps its author, its place and its time'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger comment_stays_whose_it_is
  before update of author_id, workspace_id, project_id, object_type, object_id, created_at on comment
  for each row execute function comment_stays_whose_it_is();
