-- Google, Apple, and a way back in.

-- An account made through a provider has no password until it sets one.
alter table app_user alter column password_hash drop not null;

-- Who somebody is at a provider: one subject there is one actor here.
create table auth_identity (
  id uuid primary key,
  actor_id uuid not null references actor(id),
  provider text not null check (provider in ('google', 'apple')),
  subject text not null,
  email citext,
  created_at timestamptz not null default now(),
  unique (provider, subject)
);

-- Single-use, short-lived, stored hashed: a link to reset a password, and
-- the ticket a provider's callback hands the page to trade for a session.
create table auth_ticket (
  token_hash text primary key,
  kind text not null check (kind in ('reset', 'handoff')),
  actor_id uuid not null references actor(id),
  workspace_id uuid references workspace(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index auth_ticket_recent on auth_ticket (actor_id, kind, created_at desc);

-- Neither is anybody's to read through the application role but these
-- functions: they are what signing in is made of, not workspace data.
alter table auth_identity enable row level security;
alter table auth_ticket enable row level security;

create function auth_identity_actor(p_provider text, p_subject text) returns uuid
language sql stable security definer set search_path = public as $$
  select actor_id from auth_identity where provider = p_provider and subject = p_subject
$$;

create function auth_identity_link(p_actor uuid, p_provider text, p_subject text, p_email citext)
returns void
language sql security definer set search_path = public as $$
  insert into auth_identity (id, actor_id, provider, subject, email)
  values (gen_random_uuid(), p_actor, p_provider, p_subject, p_email)
  on conflict (provider, subject) do nothing
$$;

create function auth_email_of(p_actor uuid) returns citext
language sql stable security definer set search_path = public as $$
  select email from app_user where actor_id = p_actor
$$;

create function auth_ticket_make(p_hash text, p_kind text, p_actor uuid, p_workspace uuid, p_ttl interval)
returns void
language sql security definer set search_path = public as $$
  insert into auth_ticket (token_hash, kind, actor_id, workspace_id, expires_at)
  values (p_hash, p_kind, p_actor, p_workspace, now() + p_ttl)
$$;

-- How many of a kind were made for somebody in the last hour.
create function auth_ticket_recent(p_actor uuid, p_kind text) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from auth_ticket
  where actor_id = p_actor and kind = p_kind and created_at > now() - interval '1 hour'
$$;

-- Read a ticket that is still good, without spending it.
create function auth_ticket_peek(p_hash text, p_kind text)
returns table (actor_id uuid, workspace_id uuid)
language sql stable security definer set search_path = public as $$
  select actor_id, workspace_id from auth_ticket
  where token_hash = p_hash and kind = p_kind and used_at is null and expires_at > now()
$$;

-- Spend it: true once, for the first caller.
create function auth_ticket_spend(p_hash text, p_kind text) returns boolean
language sql security definer set search_path = public as $$
  with spent as (
    update auth_ticket set used_at = now()
    where token_hash = p_hash and kind = p_kind and used_at is null and expires_at > now()
    returning 1
  )
  select exists (select 1 from spent)
$$;

-- A new password, and every session signed out with it.
create function auth_set_password(p_actor uuid, p_hash text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update app_user set password_hash = p_hash, updated_at = now() where actor_id = p_actor;
  update refresh_session set revoked_at = now() where actor_id = p_actor and revoked_at is null;
end $$;

grant execute on function auth_identity_actor(text, text) to tracker_app;
grant execute on function auth_identity_link(uuid, text, text, citext) to tracker_app;
grant execute on function auth_email_of(uuid) to tracker_app;
grant execute on function auth_ticket_make(text, text, uuid, uuid, interval) to tracker_app;
grant execute on function auth_ticket_recent(uuid, text) to tracker_app;
grant execute on function auth_ticket_peek(text, text) to tracker_app;
grant execute on function auth_ticket_spend(text, text) to tracker_app;
grant execute on function auth_set_password(uuid, text) to tracker_app;
