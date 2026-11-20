/*
 * An OAuth client nothing names is cleared after a week,
 * and
 * The night audit (13).
 *
 * Registration is open, as RFC 7591 has it, and every registration was a
 * row kept for ever. The limit in front of it is per network now; this is
 * the other half: the hourly clear-out deletes a client registered more
 * than seven days ago that no code, no token and no agent's grant names.
 * Codes are cleared after a day (`purge_queues`, migration 124), so a
 * client whose code was never traded is unnamed by then.
 *
 * A recurring delete on rows nobody owns, said as such: a client is no
 * workspace's and no person's — one ChatGPT serves everybody — so there is
 * nobody to ask, and the foreign keys refuse to delete one anything still
 * names. A client that comes back after a week registers again.
 *
 * The worker's, as its other clear-outs are. Written to run again
 * harmlessly, should its number change.
 */

create or replace function oauth_clients_clear() returns integer
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  n integer;
begin
  delete from oauth_client c
  where c.created_at < now() - interval '7 days'
    and not exists (select 1 from oauth_code o where o.client_id = c.id)
    and not exists (select 1 from api_token t where t.oauth_client_id = c.id)
    and not exists (select 1 from oauth_agent_grant g where g.client_id = c.id);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function oauth_clients_clear() from public;
grant execute on function oauth_clients_clear() to tracker_worker;
