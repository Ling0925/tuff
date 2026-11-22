/*
 * A new address is confirmed by the account that asked for it,
 * Found by the
 * independent review of.
 *
 * 1. Mallory, signed in to her own account, asks to change its address to
 *    `bob@gmail.com`. The link goes to Bob.
 * 2. The page the link opens confirmed the change the moment it loaded,
 *    for whoever opened it, signed in or not. `auth_email_change` set
 *    `email_verified_at` and kept Mallory's password, sessions, tokens and
 *    memberships — the account had been proved before, so 212's trigger
 *    had nothing to take.
 * 3. Later Bob signs in with Google. `knownActor` finds a proved account at
 *    his address and signs him into it: Mallory's, which she still holds,
 *    and where she reads everything he does.
 *
 * Opening the link proved Bob's inbox and nothing about who asked. Now the
 * change is made only by a press in a browser signed in to the account the
 * change belongs to — the person who asked, proving the new inbox is
 * theirs too. The route asks for the session (`POST /api/me/email/confirm`,
 * `http/address.ts`); this makes the database ask as well, so no other
 * caller of the sign-in role can make the change from a token alone:
 *
 * - `auth_email_confirm(token_hash, session)` takes an `email` ticket that
 *   is still good and the id of the session pressing. Unless that session
 *   is the ticket's own account's and has not ended, it answers
 *   `not_this_account` and changes nothing — the ticket is not spent, so
 *   the person can sign in to the right account and press again. Otherwise
 *   it spends the ticket and makes the change in the same transaction, and
 *   answers what `auth_email_change` answers, with the account, the new
 *   address and the old one for the note the server sends.
 * - `auth_email_change` is nobody's to run any more: it trusts the actor it
 *   is handed, and is called only from the function above, as its owner.
 *
 * **An account nobody proved, or proved only by a link handed over**
 * (`email_by_hand`), has no way to sign in on another device — signing in
 * refuses an unproved address and mails the letter that chooses a password
 * instead — so asking it for a session would leave the person who opened
 * the letter elsewhere nothing to do. For those the press alone confirms,
 * with no session or anybody's, and the previous holder is put out, as
 * every other proof of such an address does (`auth_claim_email`,
 * `auth_set_password`, 212's `app_user_proved`): the password, the second
 * factor and its codes, sessions, tokens, push devices, provider sign-ins,
 * a linked GitHub and open tickets go, and `before_proof_held` holds every
 * workspace for the person's Join or Leave. For an unproved account
 * `app_user_proved` does it already as the address is confirmed; a by-hand
 * one was proved before, so the trigger does not fire and it is done here.
 * Pressed from the by-hand account's own session, it is the holder proving
 * an inbox of their own, and nothing is taken. `put_out` says whether the
 * previous holder went — the server then mails the new address the letter
 * that chooses a password, since the password went with them.
 *
 * The approval an account with no password is asked through its current
 * address (`approve`) is unchanged here: it proves the old inbox, which is
 * the account, and makes no change — it sends the link this function then
 * asks a session for. The server now takes it only from a press as well.
 *
 * Letters already out still work for their day: the same ticket, confirmed
 * by the same press, from the account's session.
 */

create function auth_email_confirm(p_hash text, p_session uuid)
returns table (said text, actor_id uuid, email citext, old citext, put_out boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t auth_ticket%rowtype;
  v_old citext;
  v_unproved boolean;
  v_by_hand boolean;
  v_theirs boolean;
  v_said text;
begin
  select * into t from auth_ticket k
  where k.token_hash = p_hash and k.kind = 'email' and k.used_at is null and k.expires_at > now()
  for update;
  if not found then
    return query select 'gone'::text, null::uuid, null::citext, null::citext, false;
    return;
  end if;
  select u.email, u.email_verified_at is null, u.email_by_hand into v_old, v_unproved, v_by_hand
  from app_user u where u.actor_id = t.actor_id
  for update;
  if not found then
    return query select 'gone'::text, null::uuid, null::citext, null::citext, false;
    return;
  end if;
  v_theirs := p_session is not null and exists (
    select 1 from refresh_session s
    where s.id = p_session and s.actor_id = t.actor_id and s.ended_at is null
  );
  if not v_theirs and not (v_unproved or v_by_hand) then
    return query select 'not_this_account'::text, null::uuid, null::citext, null::citext, false;
    return;
  end if;
  update auth_ticket set used_at = now() where token_hash = p_hash;
  v_said := auth_email_change(t.actor_id, t.email);
  if v_said = 'changed' and not v_theirs then
    /* Proved by the press alone: whoever held the account goes. For an
       unproved one `app_user_proved` has done this as the address was
       confirmed, and doing it again changes nothing. */
    update app_user set password_hash = null, totp_enabled = false, totp_secret_enc = null, updated_at = now()
    where app_user.actor_id = t.actor_id;
    delete from recovery_code r where r.actor_id = t.actor_id;
    update refresh_session s set revoked_at = coalesce(s.revoked_at, now()), ended_at = now()
    where s.actor_id = t.actor_id and s.ended_at is null;
    update api_token a set revoked_at = now() where a.actor_id = t.actor_id and a.revoked_at is null;
    delete from push_subscription p where p.actor_id = t.actor_id;
    delete from auth_identity i where i.actor_id = t.actor_id;
    delete from github_person g where g.actor_id = t.actor_id;
    update auth_ticket k set used_at = now() where k.actor_id = t.actor_id and k.used_at is null;
    perform before_proof_held(t.actor_id);
  end if;
  return query select v_said, t.actor_id, t.email, v_old,
    v_said = 'changed' and (v_unproved or not v_theirs);
end $$;
revoke all on function auth_email_confirm(text, uuid) from public;
grant execute on function auth_email_confirm(text, uuid) to tracker_auth;

revoke execute on function auth_email_change(uuid, citext) from public, tracker_app, tracker_auth;
