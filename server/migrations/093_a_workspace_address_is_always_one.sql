-- Every workspace address has the shape an address can have, and is never
-- one of the words the app's own pages stand at — on every way a workspace
-- is made, not only the window. Registration took any three to forty
-- characters, and an address of `/evil.example` turned a notification's
-- link into `//evil.example/…`.
--
-- Not valid for what exists: an old address is left as it is rather than
-- refused on the next unrelated update; every new or changed one is held to it.
alter table workspace
  add constraint workspace_slug_shape check (workspace_slug_allowed(lower(slug::text))) not valid;

-- Whether a key is still under its allowance, without spending any of it:
-- failed sign-ins are counted, and the next attempt asks first.
create function rate_peek(p_key text, p_allowance integer, p_seconds integer default 60)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select hits from rate_window
    where key = p_key
      and window_start = to_timestamp(floor(extract(epoch from now()) / p_seconds) * p_seconds)
  ), 0) < p_allowance
$$;
grant execute on function rate_peek to tracker_app;
