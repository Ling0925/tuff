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
 * **An account nobody proved** (`email_verified_at` null) has no way to
 * sign in on another device — signing in refuses an unproved address and
 * mails the letter that chooses a password instead — so asking it for a
 * session would leave the person who opened the letter elsewhere nothing
 * to do. For it the press alone confirms, with no session or anybody's, and
 * the previous holder is put out, as every other proof of such an address
 * does: 212's `app_user_proved` fires as the address is confirmed and takes
 * the password, the second factor and its codes, sessions, tokens, push
 * devices, provider sign-ins, a linked GitHub and open tickets, and
 * `before_proof_held` holds every workspace for the person's Join or Leave.
 * The sessions and tokens are ended once more at the end, on purpose: a
 * refresh in flight that wrote a new session after the trigger's statement
 * began is not seen by it, and is by a statement that starts later.
 * `put_out` says the holder went — the server then mails the new address
 * the letter that chooses a password, since the password went with them.
 *
 * An account proved only by a link handed over (`email_by_hand`) is not
 * one of these. Its address is marked proved, so it signs in on any device
 * like any other; it needs its own session, and nothing is taken from it.
 * Without a session, whoever read a mistyped or shared new inbox would take
 * the account and its roles.
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
  select u.email, u.email_verified_at is null into v_old, v_unproved
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
  if not v_theirs and not v_unproved then
    return query select 'not_this_account'::text, null::uuid, null::citext, null::citext, false;
    return;
  end if;
  update auth_ticket set used_at = now() where token_hash = p_hash;
  /* For an unproved account, confirming fires `app_user_proved`, which puts
     the previous holder out. */
  v_said := auth_email_change(t.actor_id, t.email);
  if v_said = 'changed' and v_unproved then
    /* Again, on purpose, in statements of their own: one that began after
       a refresh in flight committed sees the session it wrote, which the
       trigger's own statement, waiting behind that refresh's lock, does not. */
    update refresh_session s set revoked_at = coalesce(s.revoked_at, now()), ended_at = now()
    where s.actor_id = t.actor_id and s.ended_at is null;
    update api_token a set revoked_at = now() where a.actor_id = t.actor_id and a.revoked_at is null;
  end if;
  return query select v_said, t.actor_id, t.email, v_old, v_said = 'changed' and v_unproved;
end $$;
revoke all on function auth_email_confirm(text, uuid) from public;
grant execute on function auth_email_confirm(text, uuid) to tracker_auth;

revoke execute on function auth_email_change(uuid, citext) from public, tracker_app, tracker_auth;
