import type postgres from 'postgres'

/*
 * The database's own rights, said again on every start of your own server
 * — the statements of migration 298 that are about the database rather
 * than anything in it: nobody but the tables' owner makes temporary
 * tables, the application, the worker and the sign-in role may connect, and nobody makes
 * anything in `public`.
 *
 * A dump does not carry a database's rights unless it is restored with
 * `--create`, and a migration runs once: a database restored any other
 * way, or made again by hand, would keep Postgres's defaults — `TEMPORARY`
 * for everybody — for good. Said on every start, they come back with the
 * next one. As the table owner, which may grant them.
 *
 * Each only when it is missing, read from the ACL (Postgres's default when
 * there is none), so an ordinary start writes nothing. Two starts at once
 * that both find something missing can still meet on the same catalogue
 * row ("tuple concurrently updated"); the one that loses says so and goes
 * on, since the other has said it.
 */
export async function sayDatabaseRights(sql: postgres.Sql): Promise<void> {
  try {
    await sql.unsafe(`do $$
declare
  d record;
begin
  select datname, coalesce(datacl, acldefault('d', datdba)) as acl into d
  from pg_database where datname = current_database();
  if exists (select 1 from aclexplode(d.acl) a where a.grantee = 0 and a.privilege_type = 'TEMPORARY') then
    execute format('revoke temporary on database %I from public', d.datname);
  end if;
  if not exists (select 1 from aclexplode(d.acl) a where a.grantee = 'tracker_app'::regrole and a.privilege_type = 'CONNECT')
     or not exists (select 1 from aclexplode(d.acl) a where a.grantee = 'tracker_worker'::regrole and a.privilege_type = 'CONNECT') then
    execute format('grant connect on database %I to tracker_app, tracker_worker', d.datname);
  end if;
  /* The sign-in role once migration 308 has made it — asked by name, so a
     database not yet there says nothing. */
  if exists (select 1 from pg_roles where rolname = 'tracker_auth') then
    if not exists (
      select 1 from aclexplode(d.acl) a join pg_roles r on r.oid = a.grantee
      where r.rolname = 'tracker_auth' and a.privilege_type = 'CONNECT'
    ) then
      execute format('grant connect on database %I to tracker_auth', d.datname);
    end if;
  end if;
  if not has_database_privilege(current_user, d.datname, 'TEMPORARY') then
    execute format('grant temporary on database %I to %I', d.datname, current_user);
  end if;
  if exists (
    select 1 from pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
    where n.nspname = 'public' and a.grantee = 0 and a.privilege_type = 'CREATE'
  ) then
    revoke create on schema public from public;
  end if;
end $$`)
  } catch (e) {
    if (!/tuple concurrently updated/i.test(e instanceof Error ? e.message : String(e))) throw e
    console.log('[instance] Another start was saying the database’s rights at the same moment; it has said them.')
  }
}
