/*
 * What the independent review of found,
 * and the subtasks spec.
 *
 * 1. One level held under two writers at once. The trigger read the parent
 *    without a lock, so two requests — A put under B while B is put under A,
 *    or a subtask made under a task that is at that moment being put under
 *    another — could each pass and leave a cycle or two levels. The parent
 *    is now read `for share`: a writer that would nest it waits, and then
 *    sees the other's row.
 *
 * 2. Putting a task back from Trash is a write too. A subtask deleted on
 *    its own, whose parent was put under another task meanwhile, came back
 *    two levels deep: putting back touched only `deleted_at`, which the
 *    trigger did not watch. It watches it now, on the way back only; the
 *    endpoint lets such a subtask stand on its own rather than be refused.
 *
 * 3. A refusal from GitHub is remembered: `nest_refused_number` (the issue
 *    it would not take this one under) and `nest_refused_at`, so a subtask
 *    over GitHub's limit is not sent again on every write of it or of its
 *    parent — once an hour at most, or at once under another parent.
 *
 * 4. `reattached_link`: the link under which the first import re-attached
 *    this issue to its task. An import retried half-way did not
 *    remember which it had re-attached, and put GitHub's nesting over the
 *    task's for those; now it is read from the row.
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
  select parent_id, project_id into p from task where id = new.parent_id for share;
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

create trigger task_parent_is_flat_on_restore
  before update of deleted_at on task
  for each row when (old.deleted_at is not null and new.deleted_at is null)
  execute function task_parent_is_flat();

alter table github_issue
  add column nest_refused_number int,
  add column nest_refused_at timestamptz,
  add column reattached_link uuid;

/*
 * 5. Only new subtasks go to GitHub, as Linear's do — a decision.
 *    A subtask made before sub-issues were on for a link is not sent when
 *    its parent is written; it goes when it is itself written. Existing
 *    links take the moment this ran; a new link the moment it is made.
 */
alter table github_link add column sub_issues_since timestamptz not null default now();
