/*
 * A phone is a device.
 *
 * The apps take notifications from the same queue and the same row as a
 * browser does; what differs is the last hop. A browser hands over two keys
 * to encrypt the payload with, and Apple's service carries it over TLS and
 * has none — so the keys are a browser's only, and `kind` says which hop.
 *
 * The endpoint is the address the worker posts to in both cases. For an app
 * the server builds it from the token, so an app never names an address.
 */
alter table push_subscription
  add column kind text not null default 'web' check (kind in ('web', 'apns'));
alter table push_subscription alter column p256dh drop not null;
alter table push_subscription alter column auth drop not null;
alter table push_subscription add constraint push_subscription_keys
  check (kind <> 'web' or (p256dh is not null and auth is not null));

/* Where to send it, and how: the sender picks the hop by `kind`. */
drop function push_targets(uuid, uuid);
create function push_targets(p_workspace uuid, p_actor uuid)
returns table (id uuid, kind text, endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = public as $$
  select s.id, s.kind, s.endpoint, s.p256dh, s.auth
  from push_subscription s
  where s.workspace_id = p_workspace and s.actor_id = p_actor
    and s.deleted_at is null
$$;

/*
 * Whoever presents an endpoint holds the device.
 *
 * Registering replaced a row only when it was the registering person's own,
 * because row-level security showed it nothing else — so somebody signing
 * in on a phone or a browser somebody else had registered was answered with
 * a unique violation, for as long as the other person's row stood. Knowing
 * an endpoint is enough to take it, and not enough to send to it.
 */
create function push_claim(p_endpoint text) returns void
language sql volatile security definer set search_path = public as $$
  update push_subscription set deleted_at = now(), updated_at = now()
  where endpoint = p_endpoint and deleted_at is null
$$;

grant execute on function push_targets(uuid, uuid), push_claim(text) to tracker_app;
