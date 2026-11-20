/*
 * The object a comment is on, asked only where it can say something the
 * comment's project does not, the second review.
 *
 * Migration 237 asked for the task, the announcement or the file under
 * its own policies, for every comment read. For a task and an
 * announcement that was the comment's own question again: their read
 * policies are `project_id in visible_projects()`, which `cmt_read`
 * already asks of the comment, and a comment's project is its object's —
 * `addComment` takes it from the object, nothing moves a task or an
 * announcement to another project, and the trigger of 237 keeps a
 * comment's project and object where they were made. And it cost: every
 * list that counts or reads comments task by task probed `task` once per
 * comment, with the task's policy asked each time — the per-task subquery
 * across a project went from 58 to 211 ms.
 *
 * A file is the one that says more: one sent in a room with chosen people
 * is hidden by its room as well as its project (migration 137). So a file's
 * comments ask for the file, a task's and an announcement's for a project,
 * and a comment on anything else is nobody's — there are none, and one
 * would not be read rather than be read by everybody.
 *
 * And a person's own comments for "Download your data", read past the
 * policies: what somebody wrote on a file in a room they left, or in a
 * project they left, is still theirs, and the export dropped it.
 */
drop policy cmt_read on comment;
create policy cmt_read on comment for select using (
  (project_id is null or project_id in (select visible_projects()))
  and (
    (object_type in ('task', 'post') and project_id is not null)
    or (object_type = 'file' and exists (select 1 from file o where o.id = comment.object_id))
  )
);

drop policy cmt_update on comment;
create policy cmt_update on comment for update using (
  (author_id = current_actor()
    or (project_id is not null and project_id in (select visible_projects()) and may_edit_said(project_id)))
  and (
    (object_type in ('task', 'post') and project_id is not null)
    or (object_type = 'file' and exists (select 1 from file o where o.id = comment.object_id))
  )
) with check (true);

/* Everything the asker wrote in the workspace they are in, and nothing
   through a token held to some projects (an export never comes through a
   token; this says so again). */
create function my_comments() returns table (on_a object_kind, said jsonb, said_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.object_type, c.body, c.created_at
  from comment c
  where c.author_id = current_actor()
    and c.workspace_id = current_workspace()
    and c.deleted_at is null
    and is_member(current_workspace())
    and (select token_projects()) is null
  order by c.created_at
$$;
revoke all on function my_comments() from public;
grant execute on function my_comments() to tracker_app;
