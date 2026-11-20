/*
 * Twenty webhooks a workspace, whichever way a row comes to count,
 * and the review of the
 * night audit (9).
 *
 * The cap (migration 294) was asked on insert only, so a row brought back
 * from deleted, moved to another workspace, or taken from an agent became
 * a workspace's twenty-first without being asked. Nothing in the product
 * does any of those today; the cap is the schema's so that nothing has to
 * remember. Now asked on insert and on an update of `deleted_at`,
 * `workspace_id` or `agent_id`, and counted only when the row it leaves is
 * a live webhook of the workspace's own — so turning one off, deleting it
 * or editing its events is never refused.
 *
 * Runs again harmlessly.
 */

create or replace function webhook_within_cap() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.agent_id is not null or new.deleted_at is not null then
    return new;
  end if;
  /* Already one of the twenty: nothing new counts. */
  if tg_op = 'UPDATE' and old.agent_id is null and old.deleted_at is null
     and old.workspace_id = new.workspace_id then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('webhooks:' || new.workspace_id::text, 0));
  if (select count(*) from webhook h
      where h.workspace_id = new.workspace_id and h.agent_id is null and h.deleted_at is null
        and h.id <> new.id) >= 20 then
    raise exception 'a workspace has twenty webhooks at most'
      using errcode = '23514', constraint = 'webhook_too_many';
  end if;
  return new;
end $$;
revoke all on function webhook_within_cap() from public;

drop trigger if exists webhook_within_cap on webhook;
create trigger webhook_within_cap before insert or update of deleted_at, workspace_id, agent_id on webhook
  for each row execute function webhook_within_cap();
