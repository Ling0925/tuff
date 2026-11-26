/*
 * An invitation proves an address only when the server mailed it there.
 *
 * The review's MEDIUM 2 from. `tracker_app` inserts invitations — `inv_write` asks
 * `is_member(workspace_id)`, and the actor is the application role's to
 * set — with any `token_hash`, any `email` and, until now, any `by_hand`.
 * SQL run as the application (an injection, a bug) could plant an
 * invitation to `victim@corp.example` whose token it knew; the public
 * `POST /auth/invite/:token/accept` then made the account, and
 * `auth_confirm_if_invited` confirmed the address because the invitation
 * named it. When the real owner of the address later arrived through
 * Google or Apple, `knownActor` found an account at their address already
 * confirmed, and `auth_claim_email` — which takes an account only when its
 * address was never proved, or proved by hand — let them into it with the
 * planter's password still working. A takeover of the person, not only of
 * the address.
 *
 * What an invitation said about an address was written by whoever wrote
 * the row. Now it is written only by the sign-in role, at the moment the
 * server delivers the link:
 *
 * - `invite.mailed_to` — the address the server mailed this invitation's
 *   link to, set by `auth_invite_delivered(token_hash, email, false)` once
 *   the letter has gone (`mailInvite` in `http/invites.ts`, on the sign-in
 *   connection). Bound to the token's hash, which only the request that
 *   made the link and the letter hold: a row planted or swapped as the
 *   application has a token the server never mailed, and is never stamped.
 * - `invite.by_hand` — taken from what the application may insert, and set
 *   by `auth_invite_delivered(token_hash, email, true)` where the route
 *   decided the link is handed over (`handsOver`: a server of one's own
 *   with no mail). Still the weak proof 210 made it.
 *
 * And an account made by following an invitation is confirmed only by
 * what those two say, decided in `accept_invite` as the row is written —
 * not confirmed first and taken back by a second statement, which a crash
 * between the two would have left confirmed:
 *
 * - mailed to the address it is followed with: confirmed;
 * - handed over by hand, to that address: confirmed weakly
 *   (`email_by_hand`), as 210 has it — a provider or a reset takes it;
 * - anything else — a link with no address, a mailed link followed with
 *   another address, an invitation nobody delivered: not confirmed, and
 *   the choose-a-password letter goes to the address (the route).
 *
 * A new account made through a provider (no password, `joinByProvider`)
 * is confirmed as before: the provider vouched for the address, which the
 * route asked before calling.
 *
 * `auth_confirm_if_invited` answers by the same rule, and asks that the
 * invitation was taken by that account (`used_by`).
 *
 * Nothing is backfilled. An invitation mailed before this deploy and
 * followed after it makes an unconfirmed account and sends the letter: one
 * more step for somebody already in, rather than trusting rows that may
 * have been written by the hole this closes.
 *
 * **Addresses are compared as ASCII, folding only A–Z** —
 * `lower(x::text collate "C")`, never `citext`'s `=`. `citext` folds by
 * the database's locale, so `'vİctim@corp.example'` equals
 * `'victim@corp.example'` and the Kelvin sign equals `k`: a letter mailed
 * to an address that only looks like the victim's would have confirmed
 * the victim's (the independent review's L1). The route mails only
 * addresses `z.email()` accepts, which are ASCII — sending again included,
 * which read the address back from the row unchecked until now.
 *
 * Invitations stay the application's to insert, by the columns it writes.
 * A definer that made them would trust the same forged actor `inv_write`
 * does, and what an invitation gives without a delivery — an unconfirmed
 * account in a workspace, as a link with no address gives — SQL run as the
 * application already reads and writes directly (`auth-role.md`). The
 * memberships such an account gathers stay when a provider later claims
 * it; that is not this migration's (the review's M1, a task of its own).
 */

alter table invite add column mailed_to citext;

/* The columns the route writes, and nothing a delivery, a following or a time says. */
revoke insert on invite from tracker_app;
grant insert (id, workspace_id, email, role, project_ids, rights, token_hash,
              created_by, expires_at)
  on invite to tracker_app;
/* Not `created_at`: `accept_invite` keeps out somebody removed after an
   invitation was made by comparing with it, and a forged one would let
   them back (the review's note). Nor `updated_at`; both are the defaults. */

/*
 * The server delivered this invitation's link to its address — mailed it
 * (`p_by_hand` false) or handed it to the inviter to pass on (true). Once
 * per invitation, while it is open, and only to the address it names.
 * Whether it was marked.
 */
create function auth_invite_delivered(p_token_hash text, p_email citext, p_by_hand boolean) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_token_hash is null or p_email is null or p_by_hand is null then
    return false;
  end if;
  update invite
  set mailed_to = case when p_by_hand then null else p_email end,
      by_hand = p_by_hand
  where token_hash = p_token_hash
    and lower(email::text collate "C") = lower(p_email::text collate "C")
    and used_at is null and deleted_at is null and expires_at > now()
    and mailed_to is null and not by_hand;
  return found;
end $$;
revoke all on function auth_invite_delivered(text, citext, boolean) from public;
grant execute on function auth_invite_delivered(text, citext, boolean) to tracker_auth;

/* 212's, with the new account's confirmation decided by the delivery — see the head. */
create or replace function accept_invite(
  p_token_hash text,
  p_actor_id uuid,
  p_name text,
  p_email citext,
  p_password_hash text,
  p_must_be_new boolean default false
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

/*
 * Whether an account made by following an invitation is confirmed by it —
 * 210's, by the rule above: the invitation was taken by this account and
 * delivered by the server to its address, by mail or (weakly) by hand.
 * An account it does not confirm is left unconfirmed; one handed over is
 * marked so. It never confirms what was not confirmed: `accept_invite`
 * did that, or nothing did.
 */
create or replace function auth_confirm_if_invited(p_actor uuid, p_token_hash text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_mailed boolean;
  v_hand boolean;
begin
  select coalesce(lower(i.email::text collate "C") = lower(u.email::text collate "C")
                  and lower(i.mailed_to::text collate "C") = lower(u.email::text collate "C"), false),
         coalesce(lower(i.email::text collate "C") = lower(u.email::text collate "C") and i.by_hand, false)
    into v_mailed, v_hand
  from app_user u, invite i
  where u.actor_id = p_actor and i.token_hash = p_token_hash and i.used_by = p_actor;
  if not (coalesce(v_mailed, false) or coalesce(v_hand, false)) then
    update app_user set email_verified_at = null
    where actor_id = p_actor and email_verified_at is not null;
    return false;
  end if;
  if not v_mailed then
    update app_user set email_by_hand = true where actor_id = p_actor and not email_by_hand;
  end if;
  return exists (select 1 from app_user where actor_id = p_actor and email_verified_at is not null);
end $$;
