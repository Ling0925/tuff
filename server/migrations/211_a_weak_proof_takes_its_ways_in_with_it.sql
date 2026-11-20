/*
 * A weak proof takes its ways in with it — the re-review of the instance owner’s claim and
 * together.
 *
 * 210 counted an address proved by a handed link as no proof: when a
 * provider vouches for that address, or a mailed reset link is followed,
 * the account's password, second factor, sessions, tokens and push go. Two
 * ways back in stayed. A provider sign-in the squatter had linked while
 * the account was theirs (Account → Ways in) was kept, so they signed in
 * with their own Google to the account the address's owner had just taken;
 * and an open ticket — an address change asked for that day — was still
 * good, to take the address back and reset the password.
 *
 * So in that branch, as 209's claim and `instance_name_owner` already do:
 * every provider sign-in goes and every open ticket is spent. In
 * `auth_claim_email` this runs before the caller links the provider that
 * vouched, so the owner's own sign-in is attached after it.
 */
create or replace function auth_claim_email(p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from instance_setting where id and community and claimed_at is null)
     and exists (select 1 from instance_applicant where actor_id = p_actor) then
    raise exception 'sign_up_closed';
  end if;
  if exists (select 1 from app_user where actor_id = p_actor
             and (email_verified_at is null or email_by_hand)) then
    update app_user set email_verified_at = now(), email_by_hand = false, password_hash = null,
                        totp_enabled = false, totp_secret_enc = null, updated_at = now()
    where actor_id = p_actor;
    delete from recovery_code where actor_id = p_actor;
    update refresh_session set revoked_at = coalesce(revoked_at, now()), ended_at = now()
    where actor_id = p_actor and ended_at is null;
    update api_token set revoked_at = now() where actor_id = p_actor and revoked_at is null;
    delete from push_subscription where actor_id = p_actor;
    delete from auth_identity where actor_id = p_actor;
    update auth_ticket set used_at = now() where actor_id = p_actor and used_at is null;
  end if;
end $$;

create or replace function auth_set_password(p_actor uuid, p_hash text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_had boolean;
  v_unproved boolean;
begin
  select password_hash is not null, email_verified_at is null or email_by_hand into v_had, v_unproved
  from app_user where actor_id = p_actor;
  update app_user
  set password_hash = p_hash, email_verified_at = coalesce(email_verified_at, now()),
      email_by_hand = false, updated_at = now()
  where actor_id = p_actor;
  update refresh_session set revoked_at = coalesce(revoked_at, now()), ended_at = now()
  where actor_id = p_actor and ended_at is null;
  if v_had or v_unproved then
    update api_token set revoked_at = now() where actor_id = p_actor and revoked_at is null;
    delete from push_subscription where actor_id = p_actor;
  end if;
  if v_unproved then
    update app_user set totp_enabled = false, totp_secret_enc = null, updated_at = now()
    where actor_id = p_actor;
    delete from recovery_code where actor_id = p_actor;
    delete from auth_identity where actor_id = p_actor;
    update auth_ticket set used_at = now() where actor_id = p_actor and used_at is null;
  end if;
  insert into security_event (id, workspace_id, actor_id, kind)
  select gen_random_uuid(), m.workspace_id, p_actor, 'password_reset'
  from membership m
  where m.actor_id = p_actor and m.deleted_at is null and m.joined_at is not null;
end $$;
