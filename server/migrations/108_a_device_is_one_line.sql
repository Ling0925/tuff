/*
 * The places you are signed in, as many as there are devices.
 *
 * Every other device, signed out at once, the one asking kept. Scoped to
 * the caller as revoking one is: ending somebody else's sessions is not
 * something this can be talked into.
 */
create function auth_revoke_others(p_actor uuid, p_keep uuid) returns int
language sql security definer set search_path = public as $$
  with ended as (
    update refresh_session set revoked_at = now()
    where actor_id = p_actor and id <> p_keep and revoked_at is null
    returning 1
  )
  select count(*)::int from ended
$$;
grant execute on function auth_revoke_others(uuid, uuid) to tracker_app;
