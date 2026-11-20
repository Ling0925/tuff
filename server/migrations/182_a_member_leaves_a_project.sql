/*
 * A member leaves a project on their own.
 *
 * The row's only update policy (`pm_update`) asked whether the caller runs
 * the project, so somebody who did not was refused their own way out and
 * had to ask somebody who did. This lets anybody on a project end their own
 * row there, and nothing more:
 *
 * - their own row, in the workspace the session is in, while it is live;
 * - the row it leaves behind is ended (`deleted_at` set) — never one put
 *   back, and never somebody else's;
 * - not by an agent, which `can()` refuses `project.leave` as it refuses
 *   every decision about who is where.
 *
 * A policy sees rows, not columns, so the policy alone would let the same
 * statement that ends the row rewrite its rights or its project on the way
 * out. The trigger below is the column half: somebody changing their own
 * row without running the project changes `deleted_at` and `updated_at`
 * and nothing else. Whoever runs it is not held by it — their own update
 * is `pm_update`'s, as it always was.
 *
 * Nothing else is touched, because taking somebody off touches nothing
 * else: a project's rooms follow the project (`visible_conversations`,
 * migration 094), and an agent the leaver connected leaves with them
 * (`agent_follows_connector`, migration 173).
 */

create function acts_as_agent() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from agent g where g.actor_id = current_actor() and g.deleted_at is null)
$$;
grant execute on function acts_as_agent to tracker_app;

create policy pm_leave on project_member for update
  using (
    actor_id = current_actor()
    and workspace_id = current_workspace()
    and deleted_at is null
    and not acts_as_agent()
  )
  with check (actor_id = current_actor() and deleted_at is not null);

create function pm_leave_only() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.actor_id = current_actor()
     and not manages_project(old.project_id)
     and (to_jsonb(new) - 'deleted_at' - 'updated_at')
         is distinct from (to_jsonb(old) - 'deleted_at' - 'updated_at')
  then
    raise exception 'leaving_changes_only_the_end' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger pm_leave_only before update on project_member
  for each row execute function pm_leave_only();
