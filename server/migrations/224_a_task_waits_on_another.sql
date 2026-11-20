/*
 * Blocked by.
 *
 * A task can wait on another. A field on Task kept in a join table, the way
 * labels are; no address, no body, nothing to open. The row reads
 * "`task_id` waits on `blocker_id`".
 */

/* Used only from TypeScript, after this commits: a new enum value cannot be
   used in the transaction that adds it. */
alter type notify_reason add value if not exists 'unblocked';

create table task_block (
  workspace_id uuid not null references workspace(id),
  /* The task that waits. */
  task_id uuid not null references task(id) on delete cascade,
  /* What it waits on. */
  blocker_id uuid not null references task(id) on delete cascade,
  /* Who said so; kept when they leave, gone with their account. */
  created_by uuid references actor(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (task_id, blocker_id),
  constraint task_block_not_itself check (task_id <> blocker_id)
);

/* "What does this one hold up", asked when it is finished and on its screen. */
create index task_block_by_blocker on task_block (blocker_id);

/*
 * The rules every writer meets, the importer and the seed included: one
 * workspace for both tasks and the row, fifty at most, and no loop.
 *
 * A definer, so the walk sees every relation in the workspace, including
 * the ones the person cannot read: a loop through a task nobody here can
 * see is still a loop. The refusal names nothing.
 *
 * Two requests closing the same loop at once would each find no loop in
 * the rows they can see committed, so the walk is serialised per workspace.
 */
create function task_block_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  a uuid;
  b uuid;
  n int;
begin
  select workspace_id into a from task where id = new.task_id;
  select workspace_id into b from task where id = new.blocker_id;
  if a is null or b is null or a <> new.workspace_id or b <> new.workspace_id then
    raise exception 'a task waits only on a task of its own workspace' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('task_block:' || new.workspace_id::text, 0));

  select count(*) into n from task_block where task_id = new.task_id;
  if n >= 50 then
    raise exception 'a task waits on fifty things at most' using errcode = '23514', constraint = 'task_block_too_many';
  end if;

  /* Does the blocker already wait, however far round, on the task? */
  if exists (
    with recursive up(id, depth) as (
      select tb.blocker_id, 1 from task_block tb where tb.task_id = new.blocker_id
      union
      select tb.blocker_id, up.depth + 1 from task_block tb join up on tb.task_id = up.id
      where up.depth < 1000
    )
    select 1 from up where id = new.task_id
  ) then
    raise exception 'that would make a loop' using errcode = '23514', constraint = 'task_block_loop';
  end if;
  return new;
end $$;

create trigger task_block_rules before insert on task_block
  for each row execute function task_block_rules();

alter table task_block enable row level security;

/*
 * A relation is visible exactly when both its tasks are. The task's own
 * policies answer each `exists`, so a project the reader cannot see hides
 * the row from both ends, and the workspace is bounded by them too.
 */
create policy task_block_both on task_block for all to tracker_app
  using (exists (select 1 from task t where t.id = task_block.task_id)
         and exists (select 1 from task t where t.id = task_block.blocker_id))
  with check (exists (select 1 from task t where t.id = task_block.task_id)
              and exists (select 1 from task t where t.id = task_block.blocker_id));
grant select, insert, delete on task_block to tracker_app;

/*
 * The tasks that this one was the last open blocker of, now that it is
 * finished — asked once, right after the finish, in the same transaction.
 *
 * A definer, because the person finishing a task need not be able to read
 * what it held up: the assignees of a task in another project are told
 * all the same, if they may read both (asked after, as them, with
 * `may_read`). Only for a task the caller can see and that is finished,
 * so it cannot be used to walk somebody else's relations.
 */
create function task_unblocked_by(p_task uuid) returns table (task_id uuid, project_key text, number int, assignee_ids uuid[])
language sql stable security definer set search_path = public as $$
  select w.id, wp.key::text, w.number, w.assignee_ids
  from task f
  join task_block tb on tb.blocker_id = f.id
  join task w on w.id = tb.task_id and w.workspace_id = f.workspace_id
  join project wp on wp.id = w.project_id and wp.deleted_at is null
  /* The caller may see the one finished, and it is finished. */
  where f.id = p_task and f.completed_at is not null and f.deleted_at is null
    and f.project_id in (select visible_projects())
    and w.deleted_at is null and w.completed_at is null
    /* And nothing else it waits on is still open. */
    and not exists (
      select 1 from task_block other join task o on o.id = other.blocker_id
      where other.task_id = w.id and other.blocker_id <> p_task
        and o.deleted_at is null and o.completed_at is null)
$$;
revoke all on function task_unblocked_by(uuid) from public;
grant execute on function task_unblocked_by(uuid) to tracker_app;
