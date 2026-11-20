/*
 * A password changed from Account, by somebody already signed in.
 *
 * Until now the only way to a new password was the link a forgotten one
 * sends, which signs every device out, this one included. Changing it from
 * inside keeps the device asking and signs out the rest: the other devices
 * are the ones a new password is usually about.
 *
 * A password link still out stops working with it — whoever asked for that
 * link is not the person who just chose a password — and the change is a
 * line in the security log of every workspace the person is in, as a change
 * of address is. Answers how many devices were signed out.
 */
create function auth_change_password(p_actor uuid, p_hash text, p_keep uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  update app_user set password_hash = p_hash, updated_at = now() where actor_id = p_actor;
  update auth_ticket set used_at = now()
  where actor_id = p_actor and kind = 'reset' and used_at is null;
  insert into security_event (id, workspace_id, actor_id, kind)
  select gen_random_uuid(), m.workspace_id, p_actor, 'password_changed'
  from membership m
  where m.actor_id = p_actor and m.deleted_at is null and m.joined_at is not null;
  select auth_revoke_others(p_actor, p_keep) into n;
  return n;
end $$;

grant execute on function auth_change_password(uuid, text, uuid) to tracker_app;
