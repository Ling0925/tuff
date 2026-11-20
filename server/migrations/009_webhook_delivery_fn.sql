-- Signing needs the secret, and no application role may select it — the same
-- rule that keeps a password hash unreadable. So the queue is drained through
-- a function owned by the table owner, exactly as the auth lookups are.
--
-- The secret reaches the process that signs and nowhere else: there is no
-- endpoint that returns it after it is created, and the column grant means a
-- stray select cannot start returning it by accident later.
create function due_webhook_deliveries(p_limit int)
returns table (
  id uuid, url text, secret text, event text, payload jsonb, attempts int
)
language sql volatile security definer set search_path = public as $$
  select d.id, w.url, w.secret_enc, d.event, d.payload, d.attempts
  from webhook_delivery d join webhook w on w.id = d.webhook_id
  where d.delivered_at is null and d.deliver_after <= now() and w.enabled
  order by d.deliver_after
  limit p_limit
$$;

grant execute on function due_webhook_deliveries to tracker_app;
