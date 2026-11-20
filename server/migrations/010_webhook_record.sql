-- The delivery worker has no actor, so every row-level policy it meets says
-- no: it could read the queue through a function and then silently update
-- nothing. Recording the outcome goes the same way as reading it.
--
-- A worker that appears to run and changes nothing is worse than one that
-- fails, because the queue looks drained and is not.
create function record_webhook_attempt(
  p_delivery uuid, p_status int, p_error text, p_ok boolean
) returns void
language sql volatile security definer set search_path = public as $$
  with d as (
    update webhook_delivery set
      attempts = attempts + 1,
      last_status = p_status,
      last_error = p_error,
      delivered_at = case when p_ok then now() else null end,
      deliver_after = case
        when p_ok then deliver_after
        -- Back off, and cap it: an endpoint that has been down for a day
        -- should be retried hourly, not every three minutes forever.
        else now() + (interval '1 minute' * power(3, least(attempts, 5)))
      end
    where id = p_delivery
    returning webhook_id
  )
  update webhook set last_status = p_status, last_at = now()
  where id = (select webhook_id from d)
$$;

grant execute on function record_webhook_attempt to tracker_app;
