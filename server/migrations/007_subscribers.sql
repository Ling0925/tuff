-- Notifying the people watching something means reading *their* subscriptions,
-- and a subscription is visible only to the person who made it. So the lookup
-- ran as the person doing the thing, saw only their own, and quietly decided
-- nobody was watching — the "subscribed" half of the inbox could never have
-- fired in production.
--
-- Same shape as the preferences lookup: a cross-actor read under the caller's
-- own row-level security returns emptiness, and emptiness reads as "nothing to
-- do" rather than as an error.
--
-- It returns only actors who are members of the workspace the object is in, so
-- the function cannot be used to discover who exists elsewhere.
create function subscribers(p_workspace uuid, p_type object_kind, p_object uuid)
returns table (actor_id uuid)
language sql stable security definer set search_path = public as $$
  select s.actor_id from subscription s
  join membership m on m.actor_id = s.actor_id and m.workspace_id = p_workspace
    and m.deleted_at is null and m.joined_at is not null
  where s.workspace_id = p_workspace
    and s.object_type = p_type and s.object_id = p_object
    and s.deleted_at is null
$$;

grant execute on function subscribers to tracker_app;
