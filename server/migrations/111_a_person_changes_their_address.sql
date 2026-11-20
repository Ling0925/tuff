/*
 * A person's address, changed by them.
 *
 * The address an account was made with was its address for good: leaving
 * the company whose inbox it was meant leaving the account behind with it.
 * Changing it takes three things — that it is the person asking, that the
 * new address is theirs, and the old address told once it is done — and
 * these are the database's half of that.
 */

-- The address a ticket is about: the one an account is moving to. `approve`
-- goes to the old address for a yes; `email` goes to the new one.
alter table auth_ticket add column email citext;
alter table auth_ticket drop constraint auth_ticket_kind_check;
alter table auth_ticket add constraint auth_ticket_kind_check
  check (kind in ('reset', 'handoff', 'verify', 'bind', 'approve', 'email'));

create function auth_email_ticket(p_hash text, p_kind text, p_actor uuid, p_email citext, p_ttl interval)
returns void
language sql security definer set search_path = public as $$
  insert into auth_ticket (token_hash, kind, actor_id, email, expires_at)
  values (p_hash, p_kind, p_actor, p_email, now() + p_ttl)
$$;

-- One that is still good, with the address it carries.
create function auth_email_ticket_peek(p_hash text)
returns table (kind text, actor_id uuid, email citext)
language sql stable security definer set search_path = public as $$
  select kind, actor_id, email from auth_ticket
  where token_hash = p_hash and kind in ('approve', 'email')
    and used_at is null and expires_at > now()
$$;

-- The change waiting on a link, if there is one: the newest still good.
create function auth_email_pending(p_actor uuid)
returns table (kind text, email citext)
language sql stable security definer set search_path = public as $$
  select kind, email from auth_ticket
  where actor_id = p_actor and kind in ('approve', 'email')
    and used_at is null and expires_at > now()
  order by created_at desc
  limit 1
$$;

-- Called off, or asked again: whatever was waiting stops working.
create function auth_email_cancel(p_actor uuid) returns void
language sql security definer set search_path = public as $$
  update auth_ticket set used_at = now()
  where actor_id = p_actor and kind in ('approve', 'email') and used_at is null
$$;

/*
 * The change itself: 'changed', or 'taken' when the address has an account
 * of its own by now — asked in the statement that writes it, and the unique
 * index has the last word, so two links followed at once cannot both win.
 *
 * Every link still out goes with the old address. A password link sent
 * there an hour ago would otherwise still set the password of an account
 * that address no longer names.
 */
create function auth_email_change(p_actor uuid, p_email citext) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_old citext;
begin
  select email into v_old from app_user where actor_id = p_actor for update;
  if v_old is null then
    return 'gone';
  end if;
  if v_old = p_email then
    return 'changed';
  end if;
  if exists (select 1 from app_user where email = p_email) then
    return 'taken';
  end if;
  update app_user
  set email = p_email, email_verified_at = now(), updated_at = now()
  where actor_id = p_actor;
  update auth_ticket set used_at = now()
  where actor_id = p_actor and kind in ('approve', 'email', 'reset', 'verify') and used_at is null;
  -- A line in the security log of every workspace the person is in.
  insert into security_event (id, workspace_id, actor_id, kind)
  select gen_random_uuid(), m.workspace_id, p_actor, 'email_changed'
  from membership m
  where m.actor_id = p_actor and m.deleted_at is null and m.joined_at is not null;
  return 'changed';
exception when unique_violation then
  return 'taken';
end $$;

grant execute on function auth_email_ticket(text, text, uuid, citext, interval) to tracker_app;
grant execute on function auth_email_ticket_peek(text) to tracker_app;
grant execute on function auth_email_pending(uuid) to tracker_app;
grant execute on function auth_email_cancel(uuid) to tracker_app;
grant execute on function auth_email_change(uuid, citext) to tracker_app;
