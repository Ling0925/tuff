/*
 * An agent's webhook is written by whoever manages the agent, and through
 * nothing else, the night audit (A).
 *
 * `wh_update` (migration 031) let the workspace's owner update any row of
 * `webhook`, and migration 008 granted update on the whole table: the
 * owner could point an agent somebody else connected at another address,
 * or turn it off, under nobody's name. An agent's webhook is meant to be
 * written only by the definer functions that ask `agent_may_be_managed`
 * first — connecting (173, 176), its key and shape (266), its reach (268,
 * 290), ending it (291) — and read only through `agent_webhook_said`.
 *
 * So the three policies keep to the workspace's own webhooks. Nothing the
 * application asks of an agent's webhook went through them: every one of
 * those functions runs as the tables' owner, past the policies.
 *
 * Written to run again harmlessly, should its number change.
 */

drop policy if exists wh_read on webhook;
create policy wh_read on webhook for select
  using (role_in(workspace_id) = 'owner' and agent_id is null);

drop policy if exists wh_write on webhook;
create policy wh_write on webhook for insert
  with check (role_in(workspace_id) = 'owner' and agent_id is null);

drop policy if exists wh_update on webhook;
create policy wh_update on webhook for update
  using (role_in(workspace_id) = 'owner' and agent_id is null)
  with check (role_in(workspace_id) = 'owner' and agent_id is null);
