/*
 * A guess at a password or a code is counted before it is checked, and
 * given back when it was right, the
 * review of ways to sign in.
 *
 * It was peeked at, checked, and counted only when wrong: a burst of
 * requests sent at once all passed the peek before any of them counted,
 * so the ceiling of ten was a ceiling of however many arrived together.
 * Counted first, the eleventh of a burst is refused like the eleventh of
 * a quarter of an hour.
 */

-- One attempt: counted at once, whether it is within the allowance, and
-- the window it was counted in. A refused one is counted too; whoever
-- refuses it gives it back, since nothing was checked.
create function rate_take(p_key text, p_allowance integer, p_seconds integer)
returns table (ok boolean, at timestamptz) language plpgsql security definer set search_path = public as $$
declare
  bucket timestamptz := to_timestamp(floor(extract(epoch from now()) / p_seconds) * p_seconds);
  n integer;
begin
  insert into rate_window (key, window_start, hits)
  values (p_key, bucket, 1)
  on conflict (key, window_start) do update set hits = rate_window.hits + 1
  returning hits into n;
  return query select n <= p_allowance, bucket;
end $$;

-- Given back to the window it was taken from, which may not be now's.
create function rate_give_back(p_key text, p_window timestamptz)
returns void language sql security definer set search_path = public as $$
  update rate_window set hits = greatest(hits - 1, 0)
  where key = p_key and window_start = p_window
$$;

grant execute on function rate_take(text, integer, integer) to tracker_app;
grant execute on function rate_give_back(text, timestamptz) to tracker_app;
