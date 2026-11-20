/*
 * A refresh refused because its person was removed says so —
 * `docs/specs/removing-someone.md`, "On their devices".
 *
 * Removal ends the person's sessions in that workspace (172), and the next
 * refresh from one of their devices was answered `401 unauthorized`, the
 * same as a token that had run out. So a removed person was put back at the
 * sign-in with no word of why, and a device that had held a session from
 * before 172 was handed one in their oldest other workspace instead, under
 * the old workspace's address.
 *
 * Two questions, both asked with no actor set, so security definer:
 *
 * - `auth_removed_from(actor, workspace)`: the workspace's name, when this
 *   person was in it and is not now, and it still stands. A workspace
 *   deleted is not somebody removed from it; somebody invited back is in.
 * - `auth_removed_by(hash)`: the same, for the refresh token a removal
 *   ended. Only the token that was live when it happened — its `revoked_at`
 *   is the removal's own `now()`, the `coalesce` in `remove_from_workspace`
 *   — and not one spent long before and ended with it: an old copy of a
 *   token learns nothing it did not know.
 */
create function auth_removed_from(p_actor uuid, p_workspace uuid) returns text
language sql stable security definer set search_path = public as $$
  select w.name from workspace w
  where w.id = p_workspace and w.deleted_at is null
    and exists (
      select 1 from membership m
      where m.workspace_id = p_workspace and m.actor_id = p_actor and m.deleted_at is not null)
    and not exists (
      select 1 from membership m
      where m.workspace_id = p_workspace and m.actor_id = p_actor and m.deleted_at is null)
$$;
revoke execute on function auth_removed_from(uuid, uuid) from public;
grant execute on function auth_removed_from(uuid, uuid) to tracker_app;

create function auth_removed_by(p_hash text)
returns table (workspace_id uuid, workspace_name text)
language sql stable security definer set search_path = public as $$
  select s.workspace_id, n.name
  from refresh_session s
  cross join lateral (select auth_removed_from(s.actor_id, s.workspace_id) as name) n
  where s.token_hash = p_hash
    and s.workspace_id is not null
    and s.ended_at is not null
    and s.revoked_at = s.ended_at
    and s.expires_at > now()
    and n.name is not null
    and exists (
      select 1 from membership m
      where m.workspace_id = s.workspace_id and m.actor_id = s.actor_id
        and m.deleted_at is not null and m.deleted_at <= s.ended_at)
$$;
revoke execute on function auth_removed_by(text) from public;
grant execute on function auth_removed_by(text) to tracker_app;
