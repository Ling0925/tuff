/*
 * A project that ever had a GitHub repository goes for good,
 * `docs/specs/projects-index.md`, "Delete for good".
 *
 * `purge_project_rows` (101) was written before the GitHub tables (146,
 * 148), and nothing added them to it. Six of them name the project with a
 * foreign key that does not cascade — `github_link`, `github_pull`,
 * `github_pull_task`, `github_issue`, `github_comment`, `github_out`;
 * `github_issue` and `github_pull` name a link the same way, and
 * `github_comment` a comment. (What names a task — `github_issue.task_id`,
 * `github_pull_task.task_id` — already went with it, 158; their
 * `project_id` held the project all the same.) Unlinking a repository stamps
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
 * Its callers: `purge_project` (Delete for good, the owner, a project in
 * the bin), `purge_deleted` (the worker's clear-out, a project in the bin
 * past its days) and `drop_sample` (113, Delete sample — a live sample
 * project, by anybody on it). A sample is refused a repository
 * (`PUT /api/projects/:id/github`, 409), so Delete sample never takes a
 * link somebody set up.
 *
 * This file deletes nothing when it runs; it only replaces two functions.
 * `create or replace` keeps the grants 227 and 154 left; the search path
 * is said again because `create or replace` replaces the settings with
 * what it is given.
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

/*
 * The clear-out, as 109 left it but for one line. The worker prints a
 * database warning now (`db.ts`), and this one came every hour
 * for good — rows past their days that something live still names, an
 * unlinked repository of a live project kept on purpose among them — over
 * the line that matters, a project that could not go. It is a notice,
 * which the worker does not print; a project that could not go is still a
 * warning.
 */
create or replace function purge_deleted(p_days int default 30)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t text;
  todo text[];
  left_over text[];
  moved boolean;
  n integer;
  total integer := 0;
  kept integer := 0;
  gone uuid;
  r record;
begin
  for gone in
    select id from project
    where deleted_at is not null and deleted_at < now() - (p_days || ' days')::interval
  loop
    begin
      perform purge_project_rows(gone);
      total := total + 1;
    exception when others then
      raise warning 'purge: project % could not go: %', gone, sqlerrm;
    end;
  end loop;

  select array_agg(c.table_name::text) into todo
  from information_schema.columns c
  join information_schema.tables tb
    on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
  where c.table_schema = 'public' and c.column_name = 'deleted_at';

  loop
    moved := false;
    left_over := '{}';
    foreach t in array todo loop
      begin
        execute format(
          'delete from %I where deleted_at is not null and deleted_at < now() - $1', t)
          using (p_days || ' days')::interval;
        get diagnostics n = row_count;
        total := total + n;
        moved := true;
      exception when foreign_key_violation then
        left_over := left_over || t;
      end;
    end loop;
    todo := left_over;
    exit when cardinality(todo) = 0;
    if not moved then
      -- Row by row, keeping what something live still names.
      foreach t in array todo loop
        for r in execute format(
          'select ctid from %I where deleted_at is not null and deleted_at < now() - $1', t)
          using (p_days || ' days')::interval
        loop
          begin
            execute format('delete from %I where ctid = $1', t) using r.ctid;
            total := total + 1;
          exception when foreign_key_violation then
            kept := kept + 1;
          end;
        end loop;
      end loop;
      exit;
    end if;
  end loop;
  if kept > 0 then
    raise notice 'purge: % rows past their days are still named by something live, and stay', kept;
  end if;
  return total;
end $$;
