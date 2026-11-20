/*
 * How an agent's last run went, on its page.
 * A task given to an agent reached through GitHub that never
 * started — the workflow missing, the app refused — was said only in
 * `agent_dispatch.last_error`, which nobody could read: the person who gave
 * the task saw nothing happen and nothing saying why.
 *
 * Read by whoever is in the workspace, as the agent itself is, and only the
 * columns that say how it went: not the payload.
 */
create policy agent_dispatch_read on agent_dispatch for select
  using (workspace_id = current_workspace() and is_member(workspace_id));
grant select (id, workspace_id, agent_id, object_id, event, created_at, attempts,
              delivered_at, given_up_at, last_status, last_error)
  on agent_dispatch to tracker_app;
