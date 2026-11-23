/*
 * A project that ever had a GitHub repository goes for good,
 * `docs/specs/projects-index.md`, "Delete for good".
 *
 * `purge_project_rows` (101) was written before the GitHub tables (146,
 * 148), and nothing added them to it. Six of them name the project with a
 * foreign key that does not cascade — `github_link`, `github_pull`,
 * `github_pull_task`, `github_issue`, `github_comment`, `github_out` — and
 * `github_comment` names a comment too. Unlinking a repository stamps
 * `github_link.deleted_at` and keeps the row, so a project that had one
 * once could never be deleted: `DELETE /api/projects/:id/forever` met the
 * foreign key (23503, answered `400 invalid`), and the clear-out's loop
 * caught it, warned to a worker that threw warnings away, and tried again
 * every hour.
 *
 * Redefined, not altered: it is the same function with the GitHub rows
 * taken first — the rows pointing at what goes before what they point at —
 * and nothing else changed. Only rows of the project being purged, or rows
 * that point at a task or comment of it and cannot stand without one.
 * Nothing is sent to GitHub: the repository, its issues and comments are
 * GitHub's, and only this side's memory of them goes.
 *
 * This file deletes nothing when it runs; it only replaces a function.
 * `create or replace` keeps the grants 227 left (nobody's but the owner's
 * and the definers that call it); the search path is said again because
 * `create or replace` replaces the settings with what it is given.
 */
create or replace function purge_project_rows(p uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  rooms uuid[];
  tasks uuid[];
  things uuid[];
  links uuid[];
begin
  select coalesce(array_agg(id), '{}') into rooms from conversation where project_id = p;
  select coalesce(array_agg(id), '{}') into tasks from task where project_id = p;
  select coalesce(array_agg(id), '{}') into links from github_link where project_id = p;
  things := tasks || rooms
    || coalesce((select array_agg(id) from post where project_id = p), '{}')
    || coalesce((select array_agg(id) from file where project_id = p or conversation_id = any(rooms)), '{}');

  /* GitHub's side of it first: what pairs a pull request with a task, the
     comments mirrored either way (before the comments), the issues (before
     the tasks and the links), the pull requests, what was still owed, and
     the links themselves — unlinked ones included. */
  delete from github_pull_task where project_id = p or task_id = any(tasks);
  delete from github_comment
  where project_id = p
     or comment_id in (select id from comment where project_id = p or object_id = any(things));
  delete from github_issue where project_id = p or task_id = any(tasks) or link_id = any(links);
  delete from github_pull where project_id = p or link_id = any(links);
  delete from github_out where project_id = p;
  delete from github_link where id = any(links);

  delete from message where conversation_id = any(rooms);
  delete from conversation_member where conversation_id = any(rooms);
  delete from task_label where task_id = any(tasks) or label_id in (select id from label where project_id = p);
  delete from time_entry where project_id = p;
  delete from comment where project_id = p or object_id = any(things);
  delete from subscription where object_id = any(things);
  delete from notification where object_id = any(things);
  delete from object_link where from_id = any(things) or to_id = any(things);
  delete from sidebar_place where object_id = p or object_id = any(rooms);
  delete from activity_event where project_id = p or object_id = any(things);
  delete from task where project_id = p;
  delete from file where project_id = p or conversation_id = any(rooms);
  delete from conversation where id = any(rooms);
  delete from task_list where project_id = p;
  delete from cycle where project_id = p;
  delete from label where project_id = p;
  delete from post where project_id = p;
  delete from project_member where project_id = p;
  /* An invite still naming it would fail on being accepted, adding its
     person to a project that is not there. A token keeps the name: taking
     the last one off would leave a list that is empty, and an empty list is
     a token for every project. */
  update invite set project_ids = array_remove(project_ids, p) where p = any(project_ids);
  delete from project where id = p;
end $$;
