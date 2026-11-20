/*
 * An app's start is good once.
 * What the security review of 184 found.
 *
 * Written to run on a database that already has these objects from an
 * earlier draft of 184, so every statement here can run twice.
 */

/*
 * Connect: the challenge is in the start's address — an edge log, a
 * history — and a start replayed by somebody else left a `linked` ticket
 * for their provider account bound to the victim's link. One start per
 * link ticket, and the callback and the finish ask which.
 */
alter table auth_ticket add column if not exists started text;

create or replace function auth_ticket_start(p_hash text, p_kind text, p_mark text) returns boolean
language sql security definer set search_path = public as $$
  with started as (
    update auth_ticket set started = p_mark
    where token_hash = p_hash and kind = p_kind and used_at is null and expires_at > now() and started is null
    returning 1
  )
  select exists (select 1 from started)
$$;

create or replace function auth_ticket_started(p_hash text, p_kind text) returns text
language sql stable security definer set search_path = public as $$
  select started from auth_ticket
  where token_hash = p_hash and kind = p_kind and used_at is null and expires_at > now()
$$;

/*
 * A sign-in from an app: a challenge starts one. There is nobody yet to
 * hang a ticket on, so the challenges are kept by themselves — an hour,
 * which is longer than any app waits to trade (the ticket lives two
 * minutes, an Android app keeps its secret ten) and short enough that
 * anybody filling the table fills it with an hour's worth, under the
 * start's own ceiling per address. The worker's clear-out takes the rest,
 * never the request.
 */
create table if not exists auth_app_start (
  challenge text primary key,
  created_at timestamptz not null default now()
);
create index if not exists auth_app_start_age on auth_app_start (created_at);
alter table auth_app_start enable row level security;
revoke all on auth_app_start from tracker_app;

create or replace function auth_app_start_once(p_challenge text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  /* One left from more than an hour ago is as good as gone. */
  insert into auth_app_start (challenge) values (p_challenge)
  on conflict (challenge) do update set created_at = now()
    where auth_app_start.created_at < now() - interval '1 hour';
  return found;
end $$;

create or replace function auth_app_start_clear() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from auth_app_start where created_at < now() - interval '1 hour';
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function auth_ticket_start(text, text, text) to tracker_app;
grant execute on function auth_ticket_started(text, text) to tracker_app;
grant execute on function auth_app_start_once(text) to tracker_app;
revoke execute on function auth_app_start_clear() from public, tracker_app;
grant execute on function auth_app_start_clear() to tracker_worker;
