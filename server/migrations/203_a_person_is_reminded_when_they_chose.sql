/*
 * Remind me.
 *
 * One moment, chosen by one person, on one task. Theirs alone, like a
 * subscription: the policy is the person and the workspace, and nobody
 * else's reminder can be read, set or cleared. Not a fifth entity — no
 * address, no body, nothing to open.
 *
 * A row is the reminder waiting; when it is sent or skipped the row goes.
 * Hard-deleted, not soft: a reminder somebody cleared is not something
 * anybody looks for again, and the worker's claim is the delete itself.
 */

/* Used only from TypeScript, after this commits: a new enum value cannot be
   used in the transaction that adds it. */
alter type notify_reason add value if not exists 'reminder';

create table task_reminder (
  workspace_id uuid not null references workspace(id),
  task_id uuid not null references task(id) on delete cascade,
  actor_id uuid not null references actor(id),
  at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  /* One per person per task: setting it again moves it. */
  primary key (task_id, actor_id)
);

/* What the worker asks every twenty seconds: what has come, oldest first. */
create index task_reminder_due on task_reminder (at);
/* An account's clear-out finds its rows by the person. */
create index task_reminder_by_actor on task_reminder (actor_id);

create trigger touch before update on task_reminder
  for each row execute function touch_updated_at();

alter table task_reminder enable row level security;
/* Yours, in the workspace you are in. And only on a task you can see:
   the task's own policies answer the `exists`. */
create policy tr_own on task_reminder for select
  using (actor_id = current_actor() and is_member(workspace_id));
create policy tr_write on task_reminder for insert
  with check (actor_id = current_actor() and is_member(workspace_id)
              and exists (select 1 from task t where t.id = task_id and t.workspace_id = task_reminder.workspace_id
                            and t.deleted_at is null));
create policy tr_update on task_reminder for update
  using (actor_id = current_actor() and is_member(workspace_id))
  with check (actor_id = current_actor() and is_member(workspace_id));
create policy tr_delete on task_reminder for delete
  using (actor_id = current_actor() and is_member(workspace_id));
grant select, insert, update, delete on task_reminder to tracker_app;

/*
 * The reminders whose moment has come, claimed by removing them, so a
 * second worker running the same statement skips what the first holds and
 * finds it gone after. Whether each is still worth sending — the task open,
 * still the person's to see — is asked after, as the person
 * (`remindChosen`, `digest.ts`), through the same policies a read is.
 */
create function claim_task_reminders(p_limit int) returns table (
  workspace_id uuid, actor_id uuid, task_id uuid, at timestamptz
)
language sql volatile security definer set search_path = public as $$
  with due as (
    select r.task_id, r.actor_id from task_reminder r
    where r.at <= now()
    order by r.at
    limit p_limit
    for update skip locked
  )
  delete from task_reminder r using due
  where r.task_id = due.task_id and r.actor_id = due.actor_id
  returning r.workspace_id, r.actor_id, r.task_id, r.at
$$;
revoke execute on function claim_task_reminders(int) from public, tracker_app;
grant execute on function claim_task_reminders(int) to tracker_worker;
