-- Two things the design asks for by name and nothing answered.

/*
 * The sessions a person has open, and ending one.
 *
 * `refresh_session` is not selectable by the application role — a session row
 * is a credential — so both go through definer functions, scoped to the actor
 * asking. "End the one on the laptop I left at the office" is the whole point,
 * and it cannot work if you cannot see the list.
 */
create function auth_sessions(p_actor uuid)
returns table (id uuid, user_agent text, ip text, created_at timestamptz,
               last_used_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.user_agent, s.ip, s.created_at, s.last_used_at, s.expires_at
  from refresh_session s
  where s.actor_id = p_actor and s.revoked_at is null and s.expires_at > now()
  order by s.created_at desc
$$;

create function auth_revoke_session(p_actor uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare hit uuid;
begin
  -- Scoped to the caller: ending somebody else's session is not something
  -- this endpoint can be talked into.
  update refresh_session set revoked_at = now()
  where id = p_id and actor_id = p_actor and revoked_at is null
  returning id into hit;
  return hit is not null;
end $$;

grant execute on function auth_sessions, auth_revoke_session to tracker_app;

/*
 * The clear-out.
 *
 * Soft delete with a window and then a real one: the design asks for both and
 * only the first half existed, so "deleted" meant "kept forever and hidden",
 * which is the answer no privacy request accepts.
 *
 * Runs as the owner, on rows already soft-deleted longer than the window.
 * Children go before parents by the same retry as the load script uses, for
 * the same reason: an order written out here goes stale the first time a
 * table is added, and it goes stale silently.
 */
create function purge_deleted(p_days int default 30)
returns integer language plpgsql security definer set search_path = public as $$
declare
  t text;
  todo text[];
  left_over text[];
  moved boolean;
  n integer;
  total integer := 0;
begin
  select array_agg(table_name::text) into todo
  from information_schema.columns
  where table_schema = 'public' and column_name = 'deleted_at';

  loop
    moved := false;
    left_over := '{}';
    foreach t in array todo loop
      begin
        execute format(
          'delete from %I where deleted_at is not null and deleted_at < now() - $1', t)
          using (p_days || ' days')::interval;
        get diagnostics n = row_count;
        total := total + n;
        moved := true;
      exception when foreign_key_violation then
        left_over := left_over || t;
      end;
    end loop;
    todo := left_over;
    exit when cardinality(todo) = 0;
    if not moved then
      raise exception 'could not clear: %', todo;
    end if;
  end loop;
  return total;
end $$;
