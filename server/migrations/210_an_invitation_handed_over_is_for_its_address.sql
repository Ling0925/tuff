/*
 * An invitation's link handed over by hand, where the server sends no mail.
 *
 * On a server of one's own with no mail, an invitation to an address was
 * never delivered: the link went nowhere, the inviter was not shown it, and
 * somebody who joined by a link with no address on it was in for that
 * session and never again, because their address could never be confirmed.
 *
 * Now the inviter is shown the invitation's own link and passes it on
 * themselves, and an account made by following it is confirmed, as one made
 * by a mailed invitation to its own address is (`auth_confirm_if_invited`).
 *
 * **But it is a weak proof, and kept as one.** A mailed link reached the
 * address; a handed one reached whoever the inviter gave it to — the
 * inviter included. Followed by the inviter with a password of their own,
 * it made a confirmed account at somebody else's address, and when the
 * real owner later arrived through Google, `auth_claim_email` found an
 * account already confirmed and let them into it with the inviter's
 * password still working. So:
 *
 * - `app_user.email_by_hand` says the address was proved only by a handed
 *   link. Signing in by password works as for any confirmed account.
 * - `auth_claim_email` treats such an account as unconfirmed: a provider
 *   vouching for the address takes it, and the password, second factor,
 *   sessions, tokens and push go, as for an address nobody confirmed.
 * - A real proof clears it: a password reset by a mailed link
 *   (`auth_set_password`, which also clears a second factor nobody proved
 *   the address for), a change of address by its mailed link
 *   (`auth_email_change`), or a provider (`auth_claim_email`).
 * - `instance_add_owner` answers `unconfirmed` for it: an address only an
 *   inviter's handed link vouched for is not somebody to hand the server
 *   to. ('s 208 and 209 change the claim and `instance_name_owner`,
 *   not this function; this is 202's, with that one condition.)
 * - Such a link is good for its address only: taken with another address —
 *   by a password, as somebody signed in, or through a provider — it is
 *   given back unspent and refused with `invite_for_another_address`.
 *
 * A mailed invitation is unchanged, and the service never makes one of
 * these (`by_hand` is set only where the edition is a server of one's own
 * and no mail is set up — `http/invites.ts`). Neither new column is granted
 * to the application role: the functions that read them run as definer.
 *
 * And the application role's UPDATE on `invite`, which was the whole table
 * (`002_rls.sql`), is cut to what it writes: `deleted_at` when an invitation
 * is revoked, and `updated_at`. Everything else on the row — `used_at`,
 * `used_by`, `by_hand`, `email`, `token_hash` — is written by definer
 * functions or at insert, and an update by the role could otherwise have
 * turned a mailed invitation into a handed one, or the reverse.
 */
alter table invite add column by_hand boolean not null default false;

create or replace function accept_invite(
  p_token_hash text,
  p_actor_id uuid,
  p_name text,
  p_email citext,
  p_password_hash text
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

alter table app_user add column email_by_hand boolean not null default false;

/*
 * An account made by following an invitation is confirmed only when the
 * invitation was to that address — and when its link was handed over by
 * hand, confirmed weakly (above). Answers whether it is confirmed.
 */
create or replace function auth_confirm_if_invited(p_actor uuid, p_token_hash text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_ok boolean;
  v_hand boolean;
begin
  select coalesce(i.email = u.email, false), i.by_hand into v_ok, v_hand
  from app_user u, invite i
  where u.actor_id = p_actor and i.token_hash = p_token_hash;
  if not coalesce(v_ok, false) then
    update app_user set email_verified_at = null where actor_id = p_actor;
  elsif v_hand then
    update app_user set email_by_hand = true where actor_id = p_actor;
  end if;
  return coalesce(v_ok, false);
end $$;

/*
 * A provider vouches for an address — 207's, with an address proved only by
 * a handed link taken as one nobody proved.
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
  end if;
end $$;

/* A reset by its mailed link — 137's, with a handed proof counted as none. */
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
  end if;
  insert into security_event (id, workspace_id, actor_id, kind)
  select gen_random_uuid(), m.workspace_id, p_actor, 'password_reset'
  from membership m
  where m.actor_id = p_actor and m.deleted_at is null and m.joined_at is not null;
end $$;

/* A new address by its mailed link — 111's, and that link is a real proof. */
create or replace function auth_email_change(p_actor uuid, p_email citext) returns text
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
  set email = p_email, email_verified_at = now(), email_by_hand = false, updated_at = now()
  where actor_id = p_actor;
  update auth_ticket set used_at = now()
  where actor_id = p_actor and kind in ('approve', 'email', 'reset', 'verify') and used_at is null;
  insert into security_event (id, workspace_id, actor_id, kind)
  select gen_random_uuid(), m.workspace_id, p_actor, 'email_changed'
  from membership m
  where m.actor_id = p_actor and m.deleted_at is null and m.joined_at is not null;
  return 'changed';
exception when unique_violation then
  return 'taken';
end $$;

revoke update on invite from tracker_app;
grant update (deleted_at, updated_at) on invite to tracker_app;

/* Another owner — 202's, with a handed proof counted as none. */
create or replace function instance_add_owner(p_email citext) returns text
language plpgsql security definer set search_path = public as $$
declare v_actor uuid;
begin
  if not is_instance_owner() then return 'forbidden'; end if;
  select actor_id into v_actor from app_user where email = p_email;
  if v_actor is null then return 'not_found'; end if;
  /* An address nobody has proved is not somebody to hand the server to —
     nor one only an inviter's handed link vouched for. */
  if not exists (select 1 from app_user where actor_id = v_actor
                 and email_verified_at is not null and not email_by_hand) then
    return 'unconfirmed';
  end if;
  insert into instance_owner (actor_id, added_by) values (v_actor, current_actor())
  on conflict (actor_id) do nothing;
  return case when found then 'added' else 'already' end;
end $$;
