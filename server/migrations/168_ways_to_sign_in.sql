/*
 * Ways to sign in, added and taken off from Account settings.
 */

-- The ticket that carries "link this provider to this account" from the
-- re-ask to the provider's callback.
alter table auth_ticket drop constraint auth_ticket_kind_check;
alter table auth_ticket add constraint auth_ticket_kind_check
  check (kind in ('reset', 'handoff', 'verify', 'bind', 'approve', 'email', 'reauth', 'link'));

-- What an account signs in with besides its password.
create function auth_identities_of(p_actor uuid)
returns table (id uuid, provider text, email citext, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select id, provider, email, created_at from auth_identity
  where actor_id = p_actor
  order by created_at
$$;

/*
 * One taken off, unless it is the last way in: no password and nothing
 * else. The account's row is locked first, so two removals at once cannot
 * each see the other's identity and both go.
 */
create function auth_identity_remove(p_actor uuid, p_id uuid)
returns table (outcome text, provider text, email citext)
language plpgsql volatile security definer set search_path = public as $$
declare
  gone auth_identity%rowtype;
begin
  perform 1 from app_user where actor_id = p_actor for update;
  select * into gone from auth_identity where id = p_id and actor_id = p_actor;
  if not found then
    return query select 'gone'::text, null::text, null::citext;
    return;
  end if;
  if not exists (select 1 from app_user where actor_id = p_actor and password_hash is not null)
     and not exists (select 1 from auth_identity where actor_id = p_actor and id <> p_id) then
    return query select 'last'::text, gone.provider, gone.email;
    return;
  end if;
  delete from auth_identity where id = p_id;
  return query select 'ok'::text, gone.provider, gone.email;
end $$;

-- Where a callback with no session sends somebody back to.
create function auth_workspace_slug(p_workspace uuid) returns citext
language sql stable security definer set search_path = public as $$
  select slug from workspace where id = p_workspace
$$;

grant execute on function auth_identities_of(uuid) to tracker_app;
grant execute on function auth_identity_remove(uuid, uuid) to tracker_app;
grant execute on function auth_workspace_slug(uuid) to tracker_app;
