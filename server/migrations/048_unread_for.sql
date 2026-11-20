/*
 * What is unread, for the number on the icon.
 *
 * A copy of the product kept in the dock or on a home screen has an icon,
 * and the Badging API puts a number on it. The only number the product has
 * that belongs there is the unread count: what is addressed to you and not
 * yet read.
 *
 * Across actors, for the same reason as everything else the sender asks: it
 * has none, and asking as nobody returns nothing — which is a check that
 * reads as working and does not. Counted at the moment of sending rather
 * than kept anywhere, because it is the same question the inbox answers and
 * a second copy of a count is a count that disagrees.
 *
 */
create function unread_for(p_workspace uuid, p_actor uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from notification
  where workspace_id = p_workspace and actor_id = p_actor
    and read_at is null and deleted_at is null
$$;

grant execute on function unread_for to tracker_app;
