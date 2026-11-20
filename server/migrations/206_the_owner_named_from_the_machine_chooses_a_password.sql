/*
 * The owner named from the command line chooses their own password.
 * 205's review.
 *
 * 205 confirmed the address of the account it named, and with it the
 * password that account had. On a server with no mail that password may be
 * somebody else's: a stranger signs up first with `admin@…`, the real admin
 * signs up after and is answered as everybody is (202, and a letter that
 * goes nowhere), runs the command for their own address — and the stranger
 * is the owner, with the stranger's password. The web path already knows
 * this (`sendAlreadyHere`: an unconfirmed account is confirmed only by
 * choosing a new password); this is the same answer for the machine.
 *
 * So naming an owner now also takes the account back from whoever made it:
 * the password is cleared, sessions, tokens, pushes and provider sign-ins
 * end, every open ticket is spent, and a fresh reset ticket — its hash
 * given by the command, which alone holds the token and prints it to the
 * terminal — is the one way in. The address is confirmed, as before.
 *
 * And it is narrowed again:
 *
 * - only where the database is a server of one's own (`not_community`);
 * - never `dev@example.com`, whose password the repository holds
 *   (`dev_account`), as `instance_started` passes it by;
 * - on a server not yet claimed, only an account that asked to sign up and
 *   never confirmed — an applicant (`not_asked` otherwise: one made on
 *   somebody's behalf is not a sign-up);
 * - on a claimed server, only when no owner can sign in, the way back 202
 *   made (`instance_claimed` otherwise: owners add owners in Server
 *   settings, and letting a colleague in is not making them the server's).
 */
drop function instance_name_owner(citext);
create function instance_name_owner(p_email citext, p_reset_hash text) returns uuid
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
  if not v_recovery and not exists (select 1 from instance_applicant where actor_id = v_actor) then
    raise exception 'not_asked';
  end if;
  if coalesce(length(p_reset_hash), 0) < 20 then raise exception 'no_ticket'; end if;

  insert into instance_owner (actor_id) values (v_actor) on conflict do nothing;
  update instance_setting set claimed_at = coalesce(claimed_at, now()), updated_at = now() where id;
  /* Before the address is confirmed, so `instance_confirming` takes it
     for the machine's word rather than a sign-up to let in or refuse. */
  delete from instance_applicant where actor_id = v_actor;

  /* Whoever chose the password, it is not the way in any more. */
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
revoke all on function instance_name_owner(citext, text) from public;
