/*
 * A workspace joined before the proof is asked about,
 * The independent review of's M1.
 *
 * Mallory follows a link invitation of her own as `bob@gmail.com`: an
 * unconfirmed account with her password, a member of her workspace. When
 * the real Bob later proves the address — Google vouching
 * (`auth_claim_email`), the letter that chooses a password or a reset
 * (`auth_set_password`), an old confirmation link (`app_user_proved`) —
 * her password, sessions, tokens and ways in go, and the membership
 * stayed. Bob owns no workspace, so `firstWorkspace` landed him in hers.
 *
 * A stranger's membership cannot be told from a person's — the person who
 * followed a link meant for them and confirms later is the common case —
 * so nothing is removed. Each workspace the account was in with anybody
 * else waits for the person's own Join or Leave:
 *
 * 1. `membership.unconfirmed_at`, and `joined_at` emptied. A membership
 *    with no `joined_at` is not joined to every check that decides access
 *    already (`is_member`, `auth_context`, `firstWorkspace`, `login`, a
 *    refresh, entering, the switcher), so it opens nothing, by the same
 *    predicate that opened it. `member_alive`, which an open socket asks,
 *    asks it too now.
 * 2. `before_proof_held(actor)`: what the previous holder gathered, held —
 *    the open invitations it made, the Slack channels it chose, and every
 *    membership above but one: the workspace `register_owner` made for
 *    this account, while nobody else has ever been in it (no other row,
 *    live or ended). Nobody had a session for that one before the proof;
 *    any other workspace — one the account was handed, one it made — may
 *    have been arranged by whoever held it, so it is asked about. Nobody's
 *    to run: called from the four that put the previous holder out, each
 *    replaced below with that one line (`instance_name_owner` among them).
 * 3. `memberships_unconfirmed()`: the person's own, by name, for the
 *    question. The application's, about `current_actor()`.
 * 4. `auth_membership_answer(actor, workspace, join)`: Join confirms the
 *    row, Leave ends it as leaving does (`workspace_member_end`). The
 *    sign-in role's alone — joining is a way in.
 * 5. `accept_invite` (313's) takes `p_pressed`: only a press the person
 *    made on the invitation's own page — joining as themselves, taking it
 *    from No workspaces, or typing their password beside it — confirms a
 *    row that waits. Anything else (a provider's sign-in carrying the
 *    link) finds the row waiting, gives the invitation back unspent and
 *    raises `membership_waiting`.
 * 6. A waiting member is nobody the workspace watches: `colleague_card`
 *    answers an address and a time zone only between joined members, and
 *    the routes show a waiting row no presence and no title.
 * 7. A workspace is handed only between addresses proved for real —
 *    `transfer_workspace` refuses an unproved or by-hand giver or
 *    receiver, and `auth_email_by_hand` tells `can()` so.
 *
 * Not backfilled: an account taken this way before now cannot be told
 * from one that was always its owner's.
 */

/* A new column on a table every request reads: wait a moment for its
   lock, not behind a long transaction while every request waits behind
   this one. Set back at the end of this file. */
set local lock_timeout = '10s';

alter table membership add column unconfirmed_at timestamptz;

/* 1. A socket asks whether its person is still in: joined, not only a row. */
create or replace function member_alive(p_actor uuid, p_workspace uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from membership
    where workspace_id = p_workspace and actor_id = p_actor
      and deleted_at is null and joined_at is not null
  )
$$;

/* 2. What an account gathered before its address was proved, held for its owner's word. */
create function before_proof_held(p_actor uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if p_actor is null then
    return;
  end if;
  /* Nobody walks in later on a link the previous holder handed out —
     first, so nobody walks in between this and the rows below either. */
  update invite set deleted_at = now(), updated_at = now()
  where created_by = p_actor and used_at is null and deleted_at is null;
  /* Nor does a project keep posting to a Slack channel they chose. */
  update slack_link set stopped_at = now(), stopped = 'linker_unproved'
  where linked_by = p_actor and stopped_at is null and deleted_at is null;
  /* Every workspace waits, but the one sign-up made for this account
     (`register_owner` wrote its `register` line there) while nobody else
     has ever had a row in it. */
  update membership m
  set joined_at = null, unconfirmed_at = now(), updated_at = now()
  where m.actor_id = p_actor and m.deleted_at is null and m.joined_at is not null
    and not (
      exists (
        select 1 from security_event e
        where e.workspace_id = m.workspace_id and e.actor_id = p_actor and e.kind = 'register'
      )
      and not exists (
        select 1 from membership o
        where o.workspace_id = m.workspace_id and o.actor_id <> p_actor
      )
    );
end $$;
revoke all on function before_proof_held(uuid) from public;

/* 212's, and what the account gathered is held. */
create or replace function app_user_proved() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
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
    perform before_proof_held(new.actor_id);
  end if;
  return new;
end $$;

/* 212's, and what the account gathered is held. */
create or replace function auth_claim_email(p_actor uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
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
    perform before_proof_held(p_actor);
  end if;
end $$;

/* 242's, and what the account gathered is held when it was unproved. */
create or replace function auth_set_password(p_actor uuid, p_hash text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_had boolean;
  v_unproved boolean;
  v_fresh boolean;
begin
  select password_hash is not null, email_verified_at is null or email_by_hand,
         coalesce(totp_enabled and totp_enabled_at > now() - interval '7 days', false)
  into v_had, v_unproved, v_fresh
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
  if v_unproved or v_fresh then
    update app_user set totp_enabled = false, totp_secret_enc = null, totp_enabled_at = null, updated_at = now()
    where actor_id = p_actor;
    delete from recovery_code where actor_id = p_actor;
  end if;
  if v_unproved then
    delete from auth_identity where actor_id = p_actor;
    delete from github_person where actor_id = p_actor;
    update auth_ticket set used_at = now() where actor_id = p_actor and used_at is null;
    perform before_proof_held(p_actor);
  end if;
  insert into security_event (id, workspace_id, actor_id, kind)
  select gen_random_uuid(), m.workspace_id, p_actor, 'password_reset'
  from membership m
  where m.actor_id = p_actor and m.deleted_at is null and m.joined_at is not null;
end $$;

/* 3. The workspaces waiting for the asker's word, by name — for the question. */
create function memberships_unconfirmed()
returns table (workspace_id uuid, name text, role text)
language sql stable security definer set search_path = public, pg_temp as $$
  select w.id, w.name, m.role::text
  from membership m
  join workspace w on w.id = m.workspace_id and w.deleted_at is null
  where m.actor_id = current_actor()
    and m.deleted_at is null and m.joined_at is null and m.unconfirmed_at is not null
  order by m.created_at, w.id
  limit 50
$$;
revoke all on function memberships_unconfirmed() from public;
grant execute on function memberships_unconfirmed() to tracker_app;

/*
 * 4. The person's answer about one of them: 'joined', 'left', 'owner'
 * (an owner's role is not left — the workspace keeps an owner) or 'none'
 * (no such row waiting, or an address not proved now). The caller is the
 * route that checked the session and the press; this asks the rows again.
 */
create function auth_membership_answer(p_actor uuid, p_workspace uuid, p_join boolean) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  held role_kind;
begin
  if p_actor is null or p_workspace is null or p_join is null then
    return 'none';
  end if;
  if not exists (select 1 from app_user u where u.actor_id = p_actor
                 and u.email_verified_at is not null and not u.email_by_hand) then
    return 'none';
  end if;
  /* Held until this transaction ends: a Join and a Leave pressed at once
     are taken one after the other, and the second finds nothing. */
  select m.role into held
  from membership m
  join workspace w on w.id = m.workspace_id and w.deleted_at is null
  where m.workspace_id = p_workspace and m.actor_id = p_actor
    and m.deleted_at is null and m.joined_at is null and m.unconfirmed_at is not null
  for update of m;
  if not found then
    return 'none';
  end if;
  if p_join then
    update membership set joined_at = now(), unconfirmed_at = null, updated_at = now()
    where workspace_id = p_workspace and actor_id = p_actor and deleted_at is null;
    return 'joined';
  end if;
  if held = 'owner' then
    return 'owner';
  end if;
  perform workspace_member_end(p_workspace, p_actor);
  insert into security_event (id, workspace_id, actor_id, kind)
  values (gen_random_uuid(), p_workspace, p_actor, 'people.leave');
  return 'left';
end $$;
revoke all on function auth_membership_answer(uuid, uuid, boolean) from public;
grant execute on function auth_membership_answer(uuid, uuid, boolean) to tracker_auth;

/*
 * 5. 313's, with `p_pressed`: an invitation taken by the person's own press
 * on its page confirms a row that waits; taken any other way, it is given
 * back unspent and `membership_waiting` raised (H1: a
 * provider's sign-in carrying a link joined a waiting member silently).
 */
drop function accept_invite(text, uuid, text, citext, text, boolean);
create function accept_invite(
  p_token_hash text,
  p_actor_id uuid,
  p_name text,
  p_email citext,
  p_password_hash text,
  p_must_be_new boolean default false,
  p_pressed boolean default false
) returns table (workspace_id uuid, actor_id uuid, created_account boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
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
  if inv.by_hand and lower(inv.email::text collate "C") is distinct from lower(p_email::text collate "C") then
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
   * Waiting for the person's own word since the address was proved (315):
   * only a press on this invitation's page is that word. Given back
   * unspent otherwise — the person may press it.
   */
  if not p_pressed and v_actor is not null and exists (
    select 1 from membership m
    where m.workspace_id = inv.workspace_id and m.actor_id = v_actor
      and m.deleted_at is null and m.unconfirmed_at is not null
  ) then
    update invite set used_at = null where id = inv.id;
    raise exception 'membership_waiting' using errcode = 'check_violation';
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
    /*
     * Confirmed by what proved the address, and by nothing the row's
     * writer could say (313): the provider, when it is a provider's
     * account (no password — the caller asked that it vouched); the
     * server's letter to this address; or, weakly, the link the server
     * handed over for this address. Otherwise unconfirmed, and the
     * route sends the letter that proves it.
     */
    insert into app_user (actor_id, email, password_hash, email_verified_at, email_by_hand)
      values (
        v_actor, p_email, p_password_hash,
        case
          when p_password_hash is null then now()
          when lower(inv.email::text collate "C") = lower(p_email::text collate "C")
               and (lower(inv.mailed_to::text collate "C") = lower(p_email::text collate "C") or inv.by_hand)
            then now()
        end,
        coalesce(p_password_hash is not null
                 and lower(inv.email::text collate "C") = lower(p_email::text collate "C")
                 and inv.by_hand and inv.mailed_to is null, false));
  end if;

  insert into membership (id, workspace_id, actor_id, role, invited_by, joined_at)
  values (gen_random_uuid(), inv.workspace_id, v_actor, inv.role, inv.created_by, now())
  on conflict do nothing;

  /*
   * Waiting since the address was proved (315), and the person pressed Join
   * on this invitation's page — the answer the question asks for (only a
   * press reaches here: see above). Only a row that waits; one that is in
   * stays as it is, and a new account has none.
   */
  if p_pressed then
    update membership set joined_at = now(), unconfirmed_at = null, updated_at = now()
    where membership.workspace_id = inv.workspace_id and membership.actor_id = v_actor
      and membership.deleted_at is null and membership.unconfirmed_at is not null;
  end if;

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
revoke all on function accept_invite(text, uuid, text, citext, text, boolean, boolean) from public;
grant execute on function accept_invite(text, uuid, text, citext, text, boolean, boolean) to tracker_auth;

/* 6. An address and a time zone, between members who are both joined — a
   waiting member is nobody the workspace reads (77's, with `joined_at`). */
create or replace function colleague_card(p_actor uuid)
returns table (email citext, timezone text)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.email, u.timezone
  from app_user u
  where u.actor_id = p_actor
    and current_workspace() is not null
    and exists (select 1 from membership m
                where m.actor_id = p_actor and m.workspace_id = current_workspace()
                  and m.deleted_at is null and m.joined_at is not null)
    and exists (select 1 from membership m
                where m.actor_id = current_actor() and m.workspace_id = current_workspace()
                  and m.deleted_at is null and m.joined_at is not null)
$$;

/* 7. Whether an address is proved only by a link handed over — for `can()`,
   which reads such an address as not proved for handing a workspace over. */
create function auth_email_by_hand(p_actor uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select email_by_hand from app_user where actor_id = p_actor
$$;
revoke all on function auth_email_by_hand(uuid) from public;
grant execute on function auth_email_by_hand(uuid) to tracker_app;

/* 273's, and only between two addresses proved for real: neither unproved
   nor proved by a handed link alone (M2 — a by-hand
   account handed the workspace, its maker gone, was the workspace "with
   nobody else in it" the proof left alone). */
create or replace function transfer_workspace(p_workspace uuid, p_to uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_from uuid := current_actor();
begin
  if v_from is null or p_to = v_from or p_workspace is distinct from current_workspace() then
    return false;
  end if;
  /* An account on either side whose address is unproved, or proved only by
     a handed link. (An actor with no account at all — an import's — was
     never refused here; the route asks for a proved address first.) */
  if exists (select 1 from app_user u
             where u.actor_id in (v_from, p_to) and (u.email_verified_at is null or u.email_by_hand)) then
    return false;
  end if;
  -- Both rows, in one order whoever asks, so two hand-overs cannot deadlock.
  perform 1 from membership
  where workspace_id = p_workspace and actor_id in (v_from, p_to) and deleted_at is null
  order by actor_id
  for update;
  if not exists (
    select 1 from membership
    where workspace_id = p_workspace and actor_id = v_from and role = 'owner'
      and deleted_at is null and joined_at is not null
  ) or not exists (
    select 1 from membership
    where workspace_id = p_workspace and actor_id = p_to
      and deleted_at is null and joined_at is not null
  ) then
    return false;
  end if;
  update membership set role = 'member'
  where workspace_id = p_workspace and actor_id = v_from and deleted_at is null;
  update membership set role = 'owner', may_create_projects = null
  where workspace_id = p_workspace and actor_id = p_to and deleted_at is null and joined_at is not null;
  if not found then
    raise exception 'transfer_workspace: nobody to hand it to';
  end if;
  insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
  select gen_random_uuid(), p_workspace, p.id, v_from, v_from, array['task.create', 'channel.create']
  from project p
  where p.workspace_id = p_workspace and p.deleted_at is null
    and not exists (
      select 1 from project_member pm
      where pm.project_id = p.id and pm.actor_id = v_from and pm.deleted_at is null
    );
  insert into security_event (id, workspace_id, actor_id, kind, meta)
  values (gen_random_uuid(), p_workspace, v_from, 'ownership_transferred', jsonb_build_object('to', p_to));
  return true;
end $$;

/* 209's, and what the account gathered is held when its address was
   unproved or proved by a handed link: the machine naming an owner puts
   the previous holder of the account out as a claim does. */
create or replace function instance_name_owner(p_email citext, p_reset_hash text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s instance_setting;
  v_actor uuid;
  v_recovery boolean;
  v_weak boolean;
begin
  select * into s from instance_setting where id for update;
  if not s.community then raise exception 'not_community'; end if;
  select actor_id, email_verified_at is null or email_by_hand into v_actor, v_weak from app_user where email = p_email;
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
  if v_weak then
    perform before_proof_held(v_actor);
  end if;
  insert into auth_ticket (token_hash, kind, actor_id, workspace_id, expires_at)
  values (p_reset_hash, 'reset', v_actor, null, now() + interval '1 hour');
  insert into security_event (id, workspace_id, actor_id, kind)
  select gen_random_uuid(), m.workspace_id, v_actor, 'password_reset'
  from membership m
  where m.actor_id = v_actor and m.deleted_at is null and m.joined_at is not null;
  return v_actor;
end $$;

set local lock_timeout to default;
