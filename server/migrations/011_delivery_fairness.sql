-- The queue is drained oldest first, globally. One workspace whose endpoint is
-- down therefore fills the front of it and starves everyone else — the failure
-- looks like "webhooks are slow for everybody" and is caused by one customer.
--
-- Taking a workspace at a time makes a stuck receiver cost only its own
-- workspace. It also makes the queue testable: a run can be asked about the
-- deliveries it just made rather than whatever happens to be oldest.
drop function due_webhook_deliveries(int);

create function due_webhook_deliveries(p_limit int, p_workspace uuid default null)
returns table (
  id uuid, url text, secret text, event text, payload jsonb, attempts int
)
language sql volatile security definer set search_path = public as $$
  select d.id, w.url, w.secret_enc, d.event, d.payload, d.attempts
  from webhook_delivery d join webhook w on w.id = d.webhook_id
  where d.delivered_at is null and d.deliver_after <= now() and w.enabled
    and (p_workspace is null or d.workspace_id = p_workspace)
  order by d.deliver_after
  limit p_limit
$$;

grant execute on function due_webhook_deliveries to tracker_app;
