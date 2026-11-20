-- Ceilings that hold across processes.
--
-- The counters lived in the API process, which was honest while there was one
-- and stopped being honest the moment a worker joined it. Two processes with
-- private counters let through twice the traffic, and the limit goes on
-- reporting that it is enforcing the number written on it.
--
-- Postgres rather than Redis: it is already here, the row is tiny, and the
-- increment is one statement. If this ever becomes the hot path it can move,
-- and `limits.ts` is the only file that would change.
-- Unlogged: a restart losing the counters gives everybody a fresh minute,
-- which is a better trade than writing WAL for every request.
create unlogged table rate_window (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

/*
 * Spend one, and say whether it was there to spend.
 *
 * The insert-on-conflict is the whole lock: two processes arriving at once
 * serialise on the row rather than on anything we have to remember to take,
 * and the count returned is the count after this call.
 */
create function rate_spend(p_key text, p_allowance integer, p_seconds integer default 60)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  bucket timestamptz := to_timestamp(floor(extract(epoch from now()) / p_seconds) * p_seconds);
  n integer;
begin
  insert into rate_window (key, window_start, hits)
  values (p_key, bucket, 1)
  on conflict (key, window_start) do update set hits = rate_window.hits + 1
  returning hits into n;
  return n <= p_allowance;
end $$;

/* Rows stop being written to when a caller goes quiet; nothing else clears them. */
create function rate_sweep(p_older_than interval default '10 minutes')
returns void language sql security definer set search_path = public as $$
  delete from rate_window where window_start < now() - p_older_than
$$;

-- Reached only through the functions. The table itself is nobody's business.
revoke all on rate_window from tracker_app;
grant execute on function rate_spend, rate_sweep to tracker_app;
