-- A notification is read in the workspace it belongs to — `docs/specs/inbox.md`.
--
-- The policy knew who was asking and not where from, so somebody in two
-- workspaces saw one company's mentions in the other company's inbox: the
-- same shape as the My tasks leak the project's handbook records, one table later.
-- Bounded by the session's workspace in the policy itself, so a query that
-- forgets says nothing rather than too much.
drop policy n_own on notification;
create policy n_own on notification for select using (
  actor_id = current_actor()
  and (current_workspace() is null or workspace_id = current_workspace())
);

drop policy n_update on notification;
create policy n_update on notification for update using (
  actor_id = current_actor()
  and (current_workspace() is null or workspace_id = current_workspace())
);
