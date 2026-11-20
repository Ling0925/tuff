/*
 * An address is confirmed before the account it names can sign in.
 *
 * `email_verified_at` has been a column since the first migration, and every
 * way of making an account set it to now(): a sign-up with somebody else's
 * address was in at once, and kept that address from its owner — who, when
 * they later came through Google with it, was handed the account the
 * stranger had made, password and all.
 */

-- Everybody already here keeps signing in as they did.
update app_user set email_verified_at = created_at where email_verified_at is null;

-- A confirmation link is a ticket like a reset is.
alter table auth_ticket drop constraint auth_ticket_kind_check;
alter table auth_ticket add constraint auth_ticket_kind_check
  check (kind in ('reset', 'handoff', 'verify'));

/*
 * Whether the address is confirmed is now the caller's to say: a sign-up
 * with a password is not, until its link is followed; a provider that
 * vouches for the address is. Defaulting to confirmed keeps every script
 * and fixture that makes an account on somebody's behalf as it was.
 */
drop function register_owner(uuid, text, citext, text, uuid, text, citext);
create function register_owner(
  p_actor_id      uuid,
  p_name          text,
  p_email         citext,
  p_password_hash text,
  p_workspace_id  uuid,
  p_ws_name       text,
  p_ws_slug       citext,
  p_confirmed     boolean default true
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into actor (id, name) values (p_actor_id, p_name);
  insert into app_user (actor_id, email, password_hash, email_verified_at)
    values (p_actor_id, p_email, p_password_hash, case when p_confirmed then now() end);
  insert into workspace (id, name, slug) values (p_workspace_id, p_ws_name, p_ws_slug);
  insert into membership (id, workspace_id, actor_id, role, joined_at)
    values (gen_random_uuid(), p_workspace_id, p_actor_id, 'owner', now());
  insert into security_event (id, workspace_id, actor_id, kind)
    values (gen_random_uuid(), p_workspace_id, p_actor_id, 'register');
  perform starting_labels(p_workspace_id);
end $$;
grant execute on function register_owner(uuid, text, citext, text, uuid, text, citext, boolean) to tracker_app;

create function auth_email_confirmed(p_actor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select email_verified_at is not null from app_user where actor_id = p_actor
$$;

-- The link was followed: the address is theirs.
create function auth_confirm_email(p_actor uuid) returns void
language sql security definer set search_path = public as $$
  update app_user set email_verified_at = now(), updated_at = now()
  where actor_id = p_actor and email_verified_at is null
$$;

/*
 * A provider vouches for an address nobody here has confirmed.
 *
 * The provider's word is the first proof anybody has given that the address
 * is theirs, so the account is: confirmed, and without the password that
 * whoever typed the address chose, or any session that password opened.
 * Otherwise a stranger signs up with your address, waits, and is let into
 * the account the day you arrive through Google.
 */
create function auth_claim_email(p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from app_user where actor_id = p_actor and email_verified_at is null) then
    update app_user set email_verified_at = now(), password_hash = null, updated_at = now()
    where actor_id = p_actor;
    update refresh_session set revoked_at = now() where actor_id = p_actor and revoked_at is null;
  end if;
end $$;

/*
 * An account made by following an invitation is confirmed only when the
 * invitation was sent to that address. A link handed round lets its holder
 * into the workspace; it says nothing about whose the address they typed is.
 * Answers whether it is confirmed.
 */
create function auth_confirm_if_invited(p_actor uuid, p_token_hash text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_ok boolean;
begin
  select coalesce(i.email = u.email, false) into v_ok
  from app_user u, invite i
  where u.actor_id = p_actor and i.token_hash = p_token_hash;
  if not coalesce(v_ok, false) then
    update app_user set email_verified_at = null where actor_id = p_actor;
  end if;
  return coalesce(v_ok, false);
end $$;

-- A reset link came to the address too, so setting a password by one
-- confirms it.
create or replace function auth_set_password(p_actor uuid, p_hash text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update app_user
  set password_hash = p_hash, email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
  where actor_id = p_actor;
  update refresh_session set revoked_at = now() where actor_id = p_actor and revoked_at is null;
end $$;

grant execute on function auth_email_confirmed(uuid) to tracker_app;
grant execute on function auth_confirm_email(uuid) to tracker_app;
grant execute on function auth_claim_email(uuid) to tracker_app;
grant execute on function auth_confirm_if_invited(uuid, text) to tracker_app;

-- `/verify/…` is the confirmation link's address.
create or replace function workspace_slug_allowed(p_slug text) returns boolean
language sql immutable set search_path = public as $$
  select p_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
     and p_slug not in (
       'api', 'auth', 'mcp', 'health', 'assets', 'static', 'files', 'cdn',
       'invite', 'join', 'welcome', 'signup', 'signin', 'sign-in', 'sign-up',
       'login', 'logout', 'forgot', 'reset', 'oauth', 'admin', 'settings',
       'notifications', 'members', 'chat', 'search', 'projects', 'new',
       'help', 'about', 'pricing', 'blog', 'docs', 'status', 'www', 'app',
       'tuff', 'usetuff', 'sw', 'manifest', 'favicon', 'robots', 'sitemap',
       'privacy', 'terms', 'legal', 'verify')
$$;
