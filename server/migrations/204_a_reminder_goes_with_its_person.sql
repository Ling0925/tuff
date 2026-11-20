/*
 * Remind me, after the independent review.
 *
 * Moving a reminder asks what setting one asks. `insert … on conflict do
 * update` checks only the update policies when it takes the conflict path,
 * so the test that the task is one you can see lived on insert alone: a
 * person taken off a project could still move a reminder they had left
 * there, if any path ever upserted it. The endpoint reads the task first
 * and stops them today; the policy now says it too.
 */
drop policy tr_update on task_reminder;
create policy tr_update on task_reminder for update
  using (actor_id = current_actor() and is_member(workspace_id))
  with check (actor_id = current_actor() and is_member(workspace_id)
              and exists (select 1 from task t where t.id = task_id and t.workspace_id = task_reminder.workspace_id
                            and t.deleted_at is null));

/*
 * A person who leaves a workspace, or whose account is deleted, leaves no
 * moments behind. Deleting an account soft-deletes its memberships rather
 * than the actor, so the reminders would otherwise sit there — a task and
 * a time kept after the person asked for their data to go — until each
 * came due and was skipped, and one re-added before then would be reminded
 * again. Every way out of a workspace ends its membership, so that is
 * where they go.
 */
create function membership_ended_drops_reminders() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from task_reminder where workspace_id = new.workspace_id and actor_id = new.actor_id;
  return new;
end $$;
revoke execute on function membership_ended_drops_reminders() from public;

create trigger membership_ended_drops_reminders
  after update of deleted_at on membership
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function membership_ended_drops_reminders();
