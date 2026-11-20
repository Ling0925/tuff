/*
 * The two queues are cleared out, and a delivery is claimed before it is
 * sent.
 *
 * Notifications and webhook deliveries were written for ever and removed
 * never: every mention, every assignment, every event to every endpoint,
 * a table that grows with the product's whole history and is read from the
 * front. And the worker read what was due and sent it with no mark on the
 * rows, so a second worker — or one pass overrunning the next — sent the
 * same delivery twice.
 */

/*
 * What is due, claimed in the same statement that reads it: pushed five
 * minutes into the future, which `record_webhook_attempt` then sets to
 * what it should be. A row another pass holds is skipped, not waited on.
 * And a delivery tried ten times is given up on — it was retried hourly
 * for ever, to an endpoint that was never coming back.
 */
create or replace function due_webhook_deliveries(p_limit int, p_workspace uuid default null)
returns table (
  id uuid, url text, secret text, event text, payload jsonb, attempts int
)
language sql volatile security definer set search_path = public as $$
  with picked as (
    select d.id
    from webhook_delivery d join webhook w on w.id = d.webhook_id
    where d.delivered_at is null and d.deliver_after <= now() and w.enabled
      and d.attempts < 10
      and (p_workspace is null or d.workspace_id = p_workspace)
    order by d.deliver_after
    limit p_limit
    for update of d skip locked
  ), claimed as (
    update webhook_delivery d set deliver_after = now() + interval '5 minutes'
    from picked where d.id = picked.id
    returning d.id, d.webhook_id, d.event, d.payload, d.attempts
  )
  select c.id, w.url, w.secret_enc, c.event, c.payload, c.attempts
  from claimed c join webhook w on w.id = c.webhook_id
$$;

/*
 * The clear-out of both, once an hour from the worker.
 *
 * A notification read ninety days ago, or any more than half a year old:
 * the inbox is what is on somebody now, and the feed keeps what happened.
 * A delivery made a month ago, or given up on a month ago: the endpoint's
 * last answer is kept on the webhook itself. A code to connect an agent a
 * day after it was made, spent or not.
 */
create or replace function purge_queues() returns integer
language plpgsql volatile security definer set search_path = public as $$
declare
  n integer;
  total integer := 0;
begin
  delete from notification
  where (read_at is not null and read_at < now() - interval '90 days')
     or created_at < now() - interval '180 days';
  get diagnostics n = row_count;
  total := total + n;

  delete from webhook_delivery
  where (delivered_at is not null and delivered_at < now() - interval '30 days')
     or (delivered_at is null and attempts >= 10 and created_at < now() - interval '30 days');
  get diagnostics n = row_count;
  total := total + n;

  delete from oauth_code where created_at < now() - interval '1 day';
  get diagnostics n = row_count;
  total := total + n;

  return total;
end $$;

grant execute on function due_webhook_deliveries(int, uuid) to tracker_app;
grant execute on function purge_queues() to tracker_app;
