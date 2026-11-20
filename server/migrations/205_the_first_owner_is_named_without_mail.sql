/*
 * A server of one's own with no mail can be claimed.
 *
 * In production a confirmation link is never written to the log (`mail.ts`:
 * a reset link in a log is a reset link for whoever reads it), and an
 * address not confirmed cannot sign in. So the first person to sign up on a
 * server with no mail was left unconfirmed, the server unclaimed, and the
 * command meant to mend it — `instance_name_owner`, 202's — named the owner
 * without confirming them, which left them still outside.
 *
 * Now the command confirms the address it names, since whoever runs it
 * holds the machine — the same proof a link would have given. And it is
 * narrowed to the cases it exists for, so it is not a second way to make
 * somebody an owner of a server that has one:
 *
 * - the server is not claimed yet;
 * - or the account is an applicant — it asked to sign up, and its address
 *   was never confirmed;
 * - or the server is claimed and has no owner who can sign in — 202's way
 *   back, kept.
 *
 * Anything else raises `instance_claimed`: on a server with an owner who can
 * sign in, owners are added from Server settings.
 *
 * The applicant row goes before the address is confirmed, so
 * `instance_confirming` takes the confirmation for what it is — the machine's
 * word — rather than a sign-up to let in or refuse.
 */
drop function instance_name_owner(citext);
create function instance_name_owner(p_email citext) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  s instance_setting;
  v_actor uuid;
begin
  select * into s from instance_setting where id for update;
  select actor_id into v_actor from app_user where email = p_email;
  if v_actor is null then return null; end if;
  if s.claimed_at is not null
     and not exists (select 1 from instance_applicant where actor_id = v_actor)
     and instance_usable_owners() > 0 then
    raise exception 'instance_claimed';
  end if;
  insert into instance_owner (actor_id) values (v_actor) on conflict do nothing;
  update instance_setting set claimed_at = coalesce(claimed_at, now()), updated_at = now() where id;
  delete from instance_applicant where actor_id = v_actor;
  update app_user set email_verified_at = now()
  where actor_id = v_actor and email_verified_at is null;
  return v_actor;
end $$;
revoke all on function instance_name_owner(citext) from public;
