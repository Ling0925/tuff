/*
 * The free plan is Duo, and holds 250 MB.
 *
 * Its name was Solo and it has always been two people, which the name said
 * against. The key stays `solo`: it is in a check constraint, the operators'
 * log and every subscription Polar knows about, and nobody sees it.
 *
 * A gigabyte was more than a free workspace needs to see what Tuff is, and
 * storage is the one thing here that costs per byte whatever the plan says.
 * A workspace already above the new line keeps everything; it takes no more
 * until it is under — "Over the line is not under it".
 */
create or replace function plan_bytes(p text) returns bigint
language sql immutable set search_path = public as $$
  select case p
    when 'solo'      then 262144000::bigint            -- 250 MB
    when 'team'      then 26843545600::bigint          -- 25 GB
    when 'company'   then 107374182400::bigint         -- 100 GB
    when 'unlimited' then 1099511627776::bigint        -- 1 TB
  end
$$;
