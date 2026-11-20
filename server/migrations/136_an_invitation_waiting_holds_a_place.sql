/*
 * An invitation waiting holds a place.
 *
 * The ceiling counted the people in a workspace and nobody on the way in,
 * so Duo — two people — took invitations to as many addresses as the
 * owner typed: one person, room for one more, every invitation made. The
 * first to accept took the place, and the rest were turned away at the
 * door a week later, by a link that had said they were welcome.
 *
 * An invitation to an address, not yet used, revoked or run out, is a
 * place held for that person. A link is not: it names nobody, and it may
 * let in several — `accept_invite` stops it at the ceiling, as before.
 */
create function workspace_held(ws uuid) returns integer
language sql stable security definer set search_path = public as $$
  select workspace_people(ws) + (
    select count(*)::integer from invite
    where workspace_id = ws and email is not null
      and used_at is null and deleted_at is null and expires_at > now())
$$;

grant execute on function workspace_held to tracker_app;
