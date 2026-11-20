/*
 * A password comes after the proof.
 *
 * Signing up kept the password typed into the form on an account nobody
 * had confirmed. A stranger registered somebody's address with a password
 * of their own; when the owner pressed "Confirm your email" in a letter
 * they never asked for, the account was confirmed and the stranger still
 * knew the password — and whatever they had added while it was theirs.
 * 209 closed it for the claim of a server of one's own, `auth_claim_email`
 * for a provider, `sendAlreadyHere` for a second sign-up. The cause was
 * the same each time: a password kept before the proof.
 *
 * **No confirmation keeps a password set before it.** When
 * `email_verified_at` goes from null to a time and the same update does
 * not set the password, the password goes, and with it everything it may
 * have opened: the second factor and its recovery codes, sessions, API
 * tokens, push subscriptions, provider sign-ins and every open ticket.
 * That is 209's branch of `instance_confirming`, for every confirmation —
 * an old confirmation link (`auth_confirm_email`), a provider vouching
 * (which also clears it itself, and links the provider after), a change of
 * address, the machine. A reset by mailed link sets the password in the
 * same update (`auth_set_password`), so it keeps the one just chosen.
 *
 * **Nobody who asked for an account and has not proved it holds a
 * password.** `register_owner` stores none for an account somebody asks
 * for unconfirmed, whatever the caller passes — 209 did this for the
 * owner's address alone. The letter asks for one.
 *
 * And from the review:
 *
 * - **An invitation asked to make an account makes one or nothing.**
 *   `accept_invite` takes `p_must_be_new`: a caller that looked and found
 *   no account says so, and if one appeared since — a sign-up racing the
 *   invitation — the invitation is given back unspent and `account_exists`
 *   raised, rather than the invitation joined to an account whose password
 *   nobody checked.
 * - **What an unconfirmed account gathered before this deploy goes now**:
 *   provider sign-ins, a linked GitHub account, recovery codes and
 *   second-factor secrets, its live sessions and its API tokens. Each was
 *   added by whoever held a session for an address they never proved; a
 *   real person signing in again is sent the letter that chooses a password.
 *   In a workspace whose owner is unconfirmed, open invitations are revoked
 *   and webhooks switched off (`enabled = false`, kept): either could be a
 *   stranger's door, and neither is anything a person made there would
 *   miss before they prove the address. Members and content stay.
 * - **A linked GitHub account goes with every weak proof**, as provider
 *   sign-ins do: `app_user_proved` above, and `auth_claim_email` and
 *   `auth_set_password` below (211's, with that one line) — a GitHub linked
 *   by whoever held the account comments as its owner afterwards.
 */

create function app_user_proved() returns trigger
language plpgsql security definer set search_path = public as $$
begin
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
    delete from github_person where actor_id = new.actor_id;
    update auth_ticket set used_at = now() where actor_id = new.actor_id and used_at is null;
  end if;
  return new;
end $$;
revoke all on function app_user_proved() from public;
create trigger app_user_proved before update of email_verified_at on app_user
  for each row when (old.email_verified_at is null and new.email_verified_at is not null)
  execute function app_user_proved();

/* 209's, without its own copy of the above. */
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

/* 209's, and no sign-up keeps a password — not only the owner's. */
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
  v_hash text := case when p_asked and not p_confirmed then null else p_password_hash end;
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
    if p_asked and s.claimed_at is null and s.owner_email is not null
       and p_email is distinct from s.owner_email then
      raise exception 'sign_up_closed';
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

/* 210's, with `p_must_be_new` — see the head. */
drop function accept_invite(text, uuid, text, citext, text);
create function accept_invite(
  p_token_hash text,
  p_actor_id uuid,
  p_name text,
  p_email citext,
  p_password_hash text,
  p_must_be_new boolean default false
) returns table (workspace_id uuid, actor_id uuid, created_account boolean)
language plpgsql security definer set search_path = public as $$
declare
  inv     record;
  v_actor uuid;
  v_new   boolean := false;
  p       uuid;
  v_cap   integer;
begin
  update invite set used_at = now()
  where token_hash = p_token_hash
    and used_at is null
    and deleted_at is null
    and expires_at > now()
  returning * into inv;

  if inv is null then
    return;
  end if;

  /*
   * A link handed over by hand is for its address and nobody else's
   * (migration 210). Given back rather than burned: the person it was for
   * can still use it.
   */
  if inv.by_hand and inv.email is distinct from p_email then
    update invite set used_at = null where id = inv.id;
    raise exception 'invite_for_another_address' using errcode = 'check_violation';
  end if;

  select u.actor_id into v_actor from app_user u where u.email = p_email;

  /*
   * Asked for a new account, and the address has one by now — a sign-up
   * that landed between the caller's look and this statement. Joining it here would hand a session to an account whose
   * password nobody checked. Given back unspent; the caller says so.
   */
  if p_must_be_new and v_actor is not null then
    update invite set used_at = null where id = inv.id;
    raise exception 'account_exists' using errcode = 'unique_violation';
  end if;

  /*
   * Somebody removed after this invitation was made does not come back on
   * it — a link they posted in a channel, or one somebody kept. Only an
   * invitation made since they were removed brings them back. Given back
   * rather than burned: it may be meant for somebody else.
   * `docs/specs/removing-someone.md`.
   */
  if v_actor is not null and exists (
    select 1 from membership m
    where m.workspace_id = inv.workspace_id and m.actor_id = v_actor
      and m.deleted_at is not null and m.deleted_at > inv.created_at
  ) and not exists (
    select 1 from membership m
    where m.workspace_id = inv.workspace_id and m.actor_id = v_actor and m.deleted_at is null
  ) then
    update invite set used_at = null where id = inv.id;
    return;
  end if;

  /*
   * The ceiling, before anything is written and after the invite is known
   * to be good.
   *
   * Only for somebody who is not already in: accepting a second invite to a
   * a workspace you are in adds no row, and refusing it would lock a member
   * out of their own workspace for being the eleventh person to be invited.
   */
  select plan_people(w.plan) into v_cap from workspace w where w.id = inv.workspace_id;
  if v_cap is not null
     and not exists (select 1 from membership m
                     where m.workspace_id = inv.workspace_id
                       and m.actor_id = v_actor and m.deleted_at is null)
     and workspace_people(inv.workspace_id) >= v_cap then
    -- The invite is given back rather than burned: the owner upgrades and
    -- the same link works, instead of having to issue it again.
    update invite set used_at = null where id = inv.id;
    raise exception 'workspace_full' using errcode = 'check_violation';
  end if;

  if v_actor is null then
    v_actor := p_actor_id;
    v_new := true;
    insert into actor (id, name) values (v_actor, p_name);
    insert into app_user (actor_id, email, password_hash, email_verified_at)
      values (v_actor, p_email, p_password_hash, now());
  end if;

  insert into membership (id, workspace_id, actor_id, role, invited_by, joined_at)
  values (gen_random_uuid(), inv.workspace_id, v_actor, inv.role, inv.created_by, now())
  on conflict do nothing;

  foreach p in array inv.project_ids
  loop
    insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
    values (gen_random_uuid(), inv.workspace_id, p, v_actor, inv.created_by, inv.rights)
    on conflict do nothing;
  end loop;

  update invite set used_by = v_actor where id = inv.id;

  insert into security_event (id, workspace_id, actor_id, kind, meta)
  values (gen_random_uuid(), inv.workspace_id, v_actor, 'invite_accepted',
          jsonb_build_object('role', inv.role, 'rights', inv.rights));

  return query select inv.workspace_id, v_actor, v_new;
end $$;

/* What unconfirmed accounts gathered before this deploy. */
delete from auth_identity where actor_id in (select actor_id from app_user where email_verified_at is null);
delete from recovery_code where actor_id in (select actor_id from app_user where email_verified_at is null);
update app_user set totp_enabled = false, totp_secret_enc = null
where email_verified_at is null and (totp_enabled or totp_secret_enc is not null);

/* What else unconfirmed accounts gathered before this deploy — see the head. */
delete from github_person where actor_id in (select actor_id from app_user where email_verified_at is null);
update refresh_session set revoked_at = coalesce(revoked_at, now()), ended_at = now()
where ended_at is null and actor_id in (select actor_id from app_user where email_verified_at is null);
update api_token set revoked_at = now()
where revoked_at is null and actor_id in (select actor_id from app_user where email_verified_at is null);
create temporary table unproved_owned on commit drop as
  select distinct m.workspace_id from membership m
  join app_user u on u.actor_id = m.actor_id
  where m.role = 'owner' and m.deleted_at is null and u.email_verified_at is null;
update invite set deleted_at = now(), updated_at = now()
where used_at is null and deleted_at is null and expires_at > now()
  and workspace_id in (select workspace_id from unproved_owned);
update webhook set enabled = false
where enabled and deleted_at is null and workspace_id in (select workspace_id from unproved_owned);

/* 211's, and a linked GitHub account goes with the rest. */
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
    delete from github_person where actor_id = p_actor;
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
    delete from github_person where actor_id = p_actor;
    update auth_ticket set used_at = now() where actor_id = p_actor and used_at is null;
  end if;
  insert into security_event (id, workspace_id, actor_id, kind)
  select gen_random_uuid(), m.workspace_id, p_actor, 'password_reset'
  from membership m
  where m.actor_id = p_actor and m.deleted_at is null and m.joined_at is not null;
end $$;
