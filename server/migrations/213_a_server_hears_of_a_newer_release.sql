/*
 * A server of one's own hears that a newer release is out.
 *
 * Once a day the community edition's worker asks GitHub for the latest
 * release of `usetuff/tuff` and keeps the answer here, on the one settings
 * row: its version, its page, when it was published, and whether it is a
 * security release (a `### Security` section in its notes). The owners'
 * Server settings read it; nobody else does.
 *
 * Both editions run this. The service never calls the worker's function
 * and never reads the owner's: its row keeps nulls nobody asks for.
 *
 * What the worker may write is held to the shape the screen draws: a plain
 * `X.Y.Z`, and a page on GitHub under `usetuff/tuff`'s releases, so a reply
 * that is not what it should be cannot put a link of somebody else's in
 * front of the owner.
 */

alter table instance_setting
  add column release_version text
    check (release_version ~ '^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$'),
  add column release_url text
    check (release_url ~ '^https://github\.com/usetuff/tuff/releases/[A-Za-z0-9._/-]{1,200}$'),
  add column release_published_at timestamptz,
  add column release_security boolean not null default false,
  /* When the worker last asked, whatever came of it — so a worker that
     restarts, or a check that fails, is not a reason to ask again sooner
     than a day. */
  add column release_checked_at timestamptz;

/* Whether the worker should ask now: a server of one's own that has not
   asked in the last day. The hour's slack lets an hourly loop land on it. */
create function instance_release_due() returns boolean
language sql stable security definer set search_path = public as $$
  select community and (release_checked_at is null or release_checked_at < now() - interval '23 hours')
  from instance_setting where id
$$;
revoke all on function instance_release_due() from public;
grant execute on function instance_release_due() to tracker_worker;

/*
 * What the worker heard. A null version is a check that came to nothing —
 * GitHub unreachable, a refusal, an answer it could not read: the time is
 * noted and the last answer kept, since it is still the last thing known.
 */
create function instance_release_heard(
  p_version text, p_url text, p_published_at timestamptz, p_security boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_version is null then
    update instance_setting set release_checked_at = now() where id and community;
  else
    update instance_setting
    set release_version = p_version,
        release_url = p_url,
        release_published_at = p_published_at,
        release_security = coalesce(p_security, false),
        release_checked_at = now()
    where id and community;
  end if;
end $$;
revoke all on function instance_release_heard(text, text, timestamptz, boolean) from public;
grant execute on function instance_release_heard(text, text, timestamptz, boolean) to tracker_worker;

/* The latest release as the worker last heard it, for an owner. Null for
   anybody else, and null where it has never heard of one. */
create function instance_release() returns json
language sql stable security definer set search_path = public as $$
  select case when is_instance_owner() and release_version is not null then json_build_object(
    'version', release_version,
    'url', release_url,
    'published_at', release_published_at,
    'security', release_security)
  end
  from instance_setting where id
$$;
revoke all on function instance_release() from public;
grant execute on function instance_release() to tracker_app;
