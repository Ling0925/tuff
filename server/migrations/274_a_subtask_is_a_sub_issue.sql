/*
 * A subtask is a sub-issue.
 *
 * A subtask of a synced task is an issue of its own, and that issue a
 * sub-issue of its parent's. GitHub names a sub-issue by the issue's id, not
 * its number, so the pairing keeps the id beside the number. It keeps the
 * nesting the way it keeps every other field, from each side:
 *
 * - `parent_number`: the parent issue GitHub last said this one is under, in
 *   the same repository; null for none, or for a parent in another
 *   repository, which is not ours to undo;
 * - `parent_here`: the task this one was under here at the last sync, so a
 *   move made here is told from nesting that only GitHub has — which Tuff
 *   may not be able to hold (one level), and is then left alone there;
 * - `nest_said`: what was last said on the task about nesting that could not
 *   be done — a limit hit on either side — so it is said once, not on every
 *   sync.
 */
alter table github_issue
  add column issue_id bigint,
  add column parent_number int,
  add column parent_here uuid,
  add column nest_said text;

/*
 * One level, now from both ends.
 *
 * A subtask could already not be given subtasks: the trigger refused a
 * parent that has a parent. It could not yet happen the other way, because
 * a task was never put under another after it was made. Now it can be
 * (`PATCH /api/tasks/:id { parent_id }`, and GitHub's sub-issues), so a
 * task that has subtasks of its own is refused as somebody's subtask too.
 */
create or replace function task_parent_is_flat() returns trigger
language plpgsql as $$
declare p record;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'a task cannot be its own parent';
  end if;
  select parent_id, project_id into p from task where id = new.parent_id;
  if not found then
    raise exception 'no such parent';
  end if;
  if p.parent_id is not null then
    raise exception 'a subtask cannot have subtasks';
  end if;
  if p.project_id <> new.project_id then
    raise exception 'a parent belongs to another project';
  end if;
  if exists (select 1 from task c where c.parent_id = new.id and c.deleted_at is null) then
    raise exception 'a task with subtasks cannot be a subtask';
  end if;
  return new;
end $$;
