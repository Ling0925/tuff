/*
 * Revoking a refresh token, which nothing has ever managed to do.
 *
 * Both places that end a session did the same thing: look the row up through
 * `auth_lookup_refresh`, then `update refresh_session set revoked_at = now()
 * where id = …`. The update ran as the application role with no actor set,
 * and `sess_own` — the SELECT policy, `actor_id = current_actor()` — applies
 * to an UPDATE that carries a `where`. With no current actor the row is not
 * visible, so the statement matched nothing, reported success and changed
 * nothing.
 *
 * Two consequences, and the second is the serious one:
 *
 *   - Signing out left the refresh token working for its whole life. The
 *     browser drops its own copy and shows the sign-in screen, so it looked
 *     exactly like signing out. (`POST /auth/logout` also answered 500 for
 *     its whole life, for a different reason in the same family — it matched
 *     on `token_hash`, a column the role may not read. That is why the 500
 *     was visible and this was not.)
 *   - Rotation never rotated. `refresh` issues a new token and revokes the
 *     old one; the revoking is this statement. So a refresh token could be
 *     replayed for as long as it lived, which is the property the whole
 *     rotate-on-use design exists to prevent.
 *
 * One definer function does both halves at once. `update … returning` is
 * atomic, so two requests racing on the same token get one row between them
 * — the replay window is closed by the statement rather than by a check
 * above it. The hash goes in and no hash comes out, so the role still cannot
 * read the column.
 */

create function auth_spend_refresh(p_hash text)
returns table (session_id uuid, actor_id uuid)
language sql security definer set search_path = public as $$
  update refresh_session s set revoked_at = now()
  where s.token_hash = p_hash and s.revoked_at is null and s.expires_at > now()
  returning s.id, s.actor_id
$$;

grant execute on function auth_spend_refresh to tracker_app;

/* Nothing looks a refresh token up without spending it any more, and a
   lookup that leaves the row usable is the shape the bug came in. */
drop function if exists auth_lookup_refresh(text);
