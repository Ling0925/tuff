/*
 * After an update, a server of one's own tells its owners — the versions,
 * where the backup taken before migrating is (or why none was), and how
 * many migrations ran. The backup before migrating spec.
 *
 * Nullable columns on the one settings row, and nothing written: no row
 * changes. Both editions run this; the service never calls the two
 * writers below (its edition does not), so its row keeps nulls nobody asks
 * for, and `instance_update()` answers only an instance owner, whom the
 * service has none of.
 */

alter table instance_setting
  /* The version the last serving start ran — the "from" of the next
     update, and of the next backup's name. */
  add column ran_version text
    check (ran_version ~ '^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$'),
  /* When a start last served. A backup taken after it is this update's,
     and a migrating start that fails and is started again uses it rather
     than taking another; one taken before it is not. */
  add column ran_at timestamptz,
  /* The update the owners have not dismissed yet; `update_to` null is none. */
  add column update_from text
    check (update_from ~ '^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$'),
  add column update_to text
    check (update_to ~ '^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$'),
  add column update_at timestamptz,
  /* The dump's path inside the app's container; null when none was taken. */
  add column update_backup text
    check (length(update_backup) between 1 and 1024 and update_backup !~ '[[:cntrl:]]'),
  /* Why migrations ran with no backup: SKIP_PRE_MIGRATION_BACKUP, no
     BACKUP_DIR, a folder that is not a volume, or a Postgres newer than
     the image's pg_dump. Null when one was taken or nothing migrated. */
  add column update_no_backup text
    check (update_no_backup in ('skipped', 'no_folder', 'not_a_volume', 'postgres_newer')),
  add column update_migrations integer check (update_migrations between 0 and 100000);

/*
 * What the migrating start did, as the table owner: the version it
 * migrated to, the backup it took or used (or null, and why), and how
 * many migrations it applied. From is the version that last served.
 * Only on a server of one's own; a later update replaces an earlier one
 * nobody dismissed.
 */
create function instance_migrated(p_to text, p_backup text, p_no_backup text, p_migrations integer) returns void
language sql security definer set search_path = public, pg_temp as $$
  update instance_setting
  set update_from = ran_version,
      update_to = p_to,
      update_at = now(),
      update_backup = p_backup,
      update_no_backup = case when p_backup is null then p_no_backup end,
      update_migrations = greatest(coalesce(p_migrations, 0), 0)
  where id and community
$$;
revoke all on function instance_migrated(text, text, text, integer) from public;

/*
 * Every serving start, as the table owner: the version it runs. When it
 * is not the one that ran last and no notice for it is there — nothing to
 * migrate, so the migrating step wrote none — the owners are told of the
 * update all the same, with no backup because nothing changed. Then the
 * version is remembered, and when. A first start tells nobody.
 */
create function instance_ran(p_version text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update instance_setting
  set update_from = ran_version,
      update_to = p_version,
      update_at = now(),
      update_backup = null,
      update_no_backup = null,
      update_migrations = 0
  where id and community
    and ran_version is not null
    and ran_version is distinct from p_version
    and update_to is distinct from p_version;
  update instance_setting set ran_version = p_version, ran_at = now() where id and community;
end $$;
revoke all on function instance_ran(text) from public;

/* The update an owner has not dismissed, for an owner; null for anybody
   else and when there is none. */
create function instance_update() returns json
language sql stable security definer set search_path = public, pg_temp as $$
  select case when is_instance_owner() and update_to is not null then json_build_object(
    'from', update_from,
    'to', update_to,
    'at', update_at,
    'backup', update_backup,
    'no_backup', update_no_backup,
    'migrations', coalesce(update_migrations, 0))
  end
  from instance_setting where id
$$;
revoke all on function instance_update() from public;
grant execute on function instance_update() to tracker_app;

/* Dismissed, for every owner, by an owner. False for anybody else. */
create function instance_update_dismiss() returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_instance_owner() then return false; end if;
  update instance_setting
  set update_from = null, update_to = null, update_at = null, update_backup = null,
      update_no_backup = null, update_migrations = null,
      updated_at = now(), updated_by = current_actor()
  where id;
  return true;
end $$;
revoke all on function instance_update_dismiss() from public;
grant execute on function instance_update_dismiss() to tracker_app;
