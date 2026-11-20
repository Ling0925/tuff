/*
 * 208's review.
 *
 * **A claim takes no password it did not just see chosen.** A stranger
 * signs up first with the owner's address and a password of their own; a
 * confirmation link goes to the owner's inbox. The owner signs up after,
 * is told by mail the address has an account, and follows the first
 * letter's link instead — which confirmed the address, claimed the server,
 * and left the stranger's password on the owner's account. With
 * `OWNER_EMAIL` empty it is the same for whoever first confirms.
 *
 * So when `instance_confirming` claims the server and the same update does
 * not also set the password — a link followed, not a reset — the password
 * goes, with every way in it opened: sessions, tokens, pushes, provider
 * sign-ins, a second factor. `/auth/verify` then hands whoever followed
 * the link a reset ticket, and the screen asks them to choose a password.
 * A reset sets the password in the same update, so it claims and keeps it.
 * 206 and `auth_claim_email` answer the same way for the machine and for a
 * provider.
 *
 * And the owner's own sign-up keeps no password: on an unclaimed server
 * with `owner_email` set, `register_owner` stores none for that address,
 * and the route sends the letter that confirms and asks for a password in
 * one step. Whoever typed a password into the form with the owner's
 * address never had it kept.
 *
 * **Only the app's start writes the address.** 208 gave `instance_started`
 * a default of null, and `edition.migrated` — the migrate command too —
 * called it without one, so migrating from a shell without the variable
 * cleared it. Now it takes `p_write_owner`, without defaults: the start
 * that serves says true, migrating says false and leaves `owner_email` as
 * it was. An unclaimed server whose address goes from set to none says so
 * (`owner_dropped`), for the start to log loudly.
 *
 * **The machine may name the owner's address** on an unclaimed server even
 * when that account is not an applicant — one made before 202, or
 * confirmed with no workspace. It still loses its password and gets the
 * printed reset link.
 */

drop function instance_started(citext);
create function instance_started(p_owner_email citext, p_write_owner boolean) returns json
language plpgsql security definer set search_path = public as $$
declare
  s instance_setting;
  v_given citext := nullif(btrim(p_owner_email::text), '')::citext;
  v_owner citext;
  v_actor uuid;
  v_email text;
  v_dropped boolean := false;
begin
  select * into s from instance_setting where id for update;
  if p_write_owner then
    v_owner := v_given;
    v_dropped := s.claimed_at is null and s.owner_email is not null and v_owner is null;
    update instance_setting set community = true, owner_email = v_owner where id;
  else
    v_owner := coalesce(v_given, s.owner_email);
    update instance_setting set community = true where id;
  end if;
  if not s.community and s.claimed_at is null and not exists (select 1 from instance_owner) then
    select u.actor_id, u.email::text into v_actor, v_email
    from app_user u
    where u.email_verified_at is not null
      and u.email <> 'dev@example.com'
      and (v_owner is null or u.email = v_owner)
      and exists (
        select 1 from membership m join workspace w on w.id = m.workspace_id
        where m.actor_id = u.actor_id and m.deleted_at is null and m.joined_at is not null
          and w.deleted_at is null
      )
    order by u.created_at, u.actor_id
    limit 1;
    if v_actor is not null then
      insert into instance_owner (actor_id) values (v_actor);
      update instance_setting set claimed_at = now(), updated_at = now() where id;
      return json_build_object('named', v_actor, 'email', v_email);
    end if;
  end if;
  if (s.claimed_at is not null or exists (select 1 from instance_owner)) and instance_usable_owners() = 0 then
    return json_build_object('ownerless', true);
  end if;
  if v_dropped then
    return json_build_object('owner_dropped', true);
  end if;
  return '{}'::json;
end $$;
revoke all on function instance_started(citext, boolean) from public;

create or replace function instance_confirming() returns trigger
language plpgsql security definer set search_path = public as $$
declare s instance_setting;
begin
  if not exists (select 1 from instance_applicant where actor_id = new.actor_id) then
    return new;
  end if;
  select * into s from instance_setting where id for update;
  if s.claimed_at is null then
    if s.owner_email is not null and new.email is distinct from s.owner_email then
      raise exception 'sign_up_closed';
    end if;
    insert into instance_owner (actor_id) values (new.actor_id) on conflict do nothing;
    update instance_setting set claimed_at = now(), updated_at = now() where id;
    /* Whoever chose the password, if it was not chosen in this update,
       it is not the server owner's way in. */
    if new.password_hash is not distinct from old.password_hash then
      new.password_hash := null;
      new.totp_enabled := false;
      new.totp_secret_enc := null;
      delete from recovery_code where actor_id = new.actor_id;
      update refresh_session set revoked_at = coalesce(revoked_at, now()), ended_at = now()
      where actor_id = new.actor_id and ended_at is null;
      update api_token set revoked_at = now() where actor_id = new.actor_id and revoked_at is null;
      delete from push_subscription where actor_id = new.actor_id;
      delete from auth_identity where actor_id = new.actor_id;
    end if;
  elsif not s.sign_up_open and not exists (
    select 1 from invite i
    join workspace w on w.id = i.workspace_id and w.deleted_at is null
    join membership m on m.workspace_id = i.workspace_id and m.actor_id = i.created_by
      and m.deleted_at is null and m.joined_at is not null
    where i.email = new.email and i.used_at is null and i.deleted_at is null and i.expires_at > now()
  ) then
    raise exception 'sign_up_closed';
  end if;
  delete from instance_applicant where actor_id = new.actor_id;
  return new;
end $$;

/* 208's, and the owner's own sign-up keeps no password. */
create or replace function register_owner(
  p_actor_id      uuid,
  p_name          text,
  p_email         citext,
  p_password_hash text,
  p_workspace_id  uuid,
  p_ws_name       text,
  p_ws_slug       citext,
  p_confirmed     boolean default true,
  p_asked         boolean default true
) returns void
language plpgsql security definer set search_path = public as $$
declare
  s instance_setting;
  v_hash text := p_password_hash;
begin
  select * into s from instance_setting where id;
  if s.community then
    select * into s from instance_setting where id for update;
    if p_asked and s.claimed_at is not null and not s.sign_up_open then
      raise exception 'sign_up_closed';
    end if;
    if p_asked and p_confirmed and s.claimed_at is null then
      raise exception 'sign_up_closed';
    end if;
    if p_asked and s.claimed_at is null and s.owner_email is not null then
      if p_email is distinct from s.owner_email then
        raise exception 'sign_up_closed';
      end if;
      v_hash := null;
    end if;
  end if;

  insert into actor (id, name) values (p_actor_id, p_name);
  insert into app_user (actor_id, email, password_hash, email_verified_at)
    values (p_actor_id, p_email, v_hash, case when p_confirmed then now() end);
  insert into workspace (id, name, slug) values (p_workspace_id, p_ws_name, p_ws_slug);
  insert into membership (id, workspace_id, actor_id, role, joined_at)
    values (gen_random_uuid(), p_workspace_id, p_actor_id, 'owner', now());
  insert into security_event (id, workspace_id, actor_id, kind)
    values (gen_random_uuid(), p_workspace_id, p_actor_id, 'register');
  perform starting_labels(p_workspace_id);

  if s.community and p_asked and not p_confirmed then
    insert into instance_applicant (actor_id) values (p_actor_id);
  end if;
end $$;

/* 206's, and on an unclaimed server the account at `owner_email` may be
   named whether or not it is an applicant. */
create or replace function instance_name_owner(p_email citext, p_reset_hash text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  s instance_setting;
  v_actor uuid;
  v_recovery boolean;
begin
  select * into s from instance_setting where id for update;
  if not s.community then raise exception 'not_community'; end if;
  select actor_id into v_actor from app_user where email = p_email;
  if v_actor is null then return null; end if;
  if p_email = 'dev@example.com' then raise exception 'dev_account'; end if;
  v_recovery := s.claimed_at is not null and instance_usable_owners() = 0;
  if s.claimed_at is not null and not v_recovery then
    raise exception 'instance_claimed';
  end if;
  if not v_recovery
     and not exists (select 1 from instance_applicant where actor_id = v_actor)
     and (s.owner_email is null or p_email is distinct from s.owner_email) then
    raise exception 'not_asked';
  end if;
  if coalesce(length(p_reset_hash), 0) < 20 then raise exception 'no_ticket'; end if;

  insert into instance_owner (actor_id) values (v_actor) on conflict do nothing;
  update instance_setting set claimed_at = coalesce(claimed_at, now()), updated_at = now() where id;
  delete from instance_applicant where actor_id = v_actor;

  update app_user
  set password_hash = null, email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
  where actor_id = v_actor;
  update refresh_session set revoked_at = coalesce(revoked_at, now()), ended_at = now()
  where actor_id = v_actor and ended_at is null;
  update api_token set revoked_at = now() where actor_id = v_actor and revoked_at is null;
  delete from push_subscription where actor_id = v_actor;
  delete from auth_identity where actor_id = v_actor;
  update auth_ticket set used_at = now() where actor_id = v_actor and used_at is null;
  insert into auth_ticket (token_hash, kind, actor_id, workspace_id, expires_at)
  values (p_reset_hash, 'reset', v_actor, null, now() + interval '1 hour');
  insert into security_event (id, workspace_id, actor_id, kind)
  select gen_random_uuid(), m.workspace_id, v_actor, 'password_reset'
  from membership m
  where m.actor_id = v_actor and m.deleted_at is null and m.joined_at is not null;
  return v_actor;
end $$;
