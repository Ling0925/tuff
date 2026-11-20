/*
 * The ticket a provider's callback hands over is good only where the
 * sign-in began. `binding` is what the exchange
 * must bring: `web:` and the hash of the browser's cookie, or `app:` and
 * the SHA-256 of the app's secret. Null for a ticket made for an app
 * installed before this, until those are gone.
 */

alter table auth_ticket add column binding text;

create function auth_ticket_make_bound(p_hash text, p_kind text, p_actor uuid, p_workspace uuid, p_ttl interval, p_binding text)
returns void
language sql security definer set search_path = public as $$
  insert into auth_ticket (token_hash, kind, actor_id, workspace_id, expires_at, binding)
  values (p_hash, p_kind, p_actor, p_workspace, now() + p_ttl, p_binding)
$$;

-- What a ticket that is still good was bound to.
create function auth_ticket_binding(p_hash text, p_kind text) returns text
language sql stable security definer set search_path = public as $$
  select binding from auth_ticket
  where token_hash = p_hash and kind = p_kind and used_at is null and expires_at > now()
$$;

grant execute on function auth_ticket_make_bound(text, text, uuid, uuid, interval, text) to tracker_app;
grant execute on function auth_ticket_binding(text, text) to tracker_app;
