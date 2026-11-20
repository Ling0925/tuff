/*
 * The instance owner, and sign-up closed on your own server.
 *
 * Both editions run this. The database is told it is a server of one's
 * own by the community edition itself, after migrating, as the table owner
 * (`instance_started`, `instance_setting.community`); the service never
 * says so, and every rule below is off where it is false. The server is
 * then never claimed, nobody is an owner, and `register_owner` and the
 * confirmation of an address behave as they did.
 *
 * None of these tables is a workspace's. Row-level security is on with no
 * policy and nothing is granted, as `operator` is: the application role
 * reaches them only through the definer functions here, and each of those
 * asks for itself whether the caller may.
 *
 * The rules are the database's, not the callers':
 *
 * - `register_owner` refuses an account asked for on a closed server;
 * - the server is claimed when an address is **confirmed** — by a trigger
 *   on `app_user`, whichever way it was confirmed — and only by an account
 *   that asked to sign up (`instance_applicant`), never one made on
 *   somebody's behalf;
 * - an applicant whose address is confirmed after the server was claimed
 *   is refused while sign-up is closed, unless an invitation waits for
 *   their address;
 * - the last owner is never deleted, by any path (`instance_owner_stays`).
 */

create table instance_setting (
  /* One row, and only one: the key can be nothing but true. */
  id boolean primary key default true check (id),
  /* Whether this database is a server of one's own. Set only by the
     community edition after migrating; never by the service. */
  community boolean not null default false,
  sign_up_open boolean not null default false,
  /* When the first confirmed account made the server its own. Once set,
     signing up never makes an owner again. */
  claimed_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references actor(id) on delete set null
);
insert into instance_setting default values;
alter table instance_setting enable row level security;
revoke all on instance_setting from public, tracker_app, tracker_worker;

create table instance_owner (
  actor_id uuid primary key references actor(id) on delete cascade,
  added_by uuid references actor(id) on delete set null,
  added_at timestamptz not null default now()
);
alter table instance_owner enable row level security;
revoke all on instance_owner from public, tracker_app, tracker_worker;

/* Somebody who asked to sign up on a server of one's own and has not
   confirmed their address yet. Written only by `register_owner`; read and
   cleared when the address is confirmed. */
create table instance_applicant (
  actor_id uuid primary key references actor(id) on delete cascade,
  asked_at timestamptz not null default now()
);
alter table instance_applicant enable row level security;
revoke all on instance_applicant from public, tracker_app, tracker_worker;

/*
 * The last owner stays, whatever deletes the row — a removal, an account
 * deleted, an actor swept, a cascade. The settings row is locked first, so
 * two deletions at once are taken one after the other and the second finds
 * itself the last. Only where the database is a server of one's own; the
 * service has no rows to keep.
 */
create function instance_owner_stays() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from instance_setting where id for update;
  if (select community from instance_setting where id)
     and (select count(*) from instance_owner) <= 1 then
    raise exception 'last_owner';
  end if;
  return old;
end $$;
revoke all on function instance_owner_stays() from public;
create trigger instance_owner_stays before delete on instance_owner
  for each row execute function instance_owner_stays();

/*
 * An address confirmed — by its link, by a provider vouching for it, by a
 * reset link, or by anything else that sets `email_verified_at` — of an
 * account that asked to sign up:
 *
 * - on a server nobody has claimed, it claims it;
 * - on a claimed one, it is let in while sign-up is open, or when an
 *   invitation waits for that address — unused, unexpired, in a live
 *   workspace, from somebody still in it; otherwise `sign_up_closed`, and
 *   the address stays unconfirmed.
 *
 * Under the settings row's lock, so two confirmations at once make one
 * owner. Nothing the application role calls can make anybody else an owner
 * this way: only `register_owner` writes an applicant, and only for an
 * account it is making.
 */
create function instance_confirming() returns trigger
language plpgsql security definer set search_path = public as $$
declare s instance_setting;
begin
  if not exists (select 1 from instance_applicant where actor_id = new.actor_id) then
    return new;
  end if;
  select * into s from instance_setting where id for update;
  if s.claimed_at is null then
    insert into instance_owner (actor_id) values (new.actor_id) on conflict do nothing;
    update instance_setting set claimed_at = now(), updated_at = now() where id;
  elsif not s.sign_up_open and not exists (
    select 1 from invite i
    join workspace w on w.id = i.workspace_id and w.deleted_at is null
    join membership m on m.workspace_id = i.workspace_id and m.actor_id = i.created_by
      and m.deleted_at is null and m.joined_at is not null
    where i.email = new.email and i.used_at is null and i.deleted_at is null and i.expires_at > now()
  ) then
    raise exception 'sign_up_closed';
  end if;
  delete from instance_applicant where actor_id = new.actor_id;
  return new;
end $$;
revoke all on function instance_confirming() from public;
create trigger instance_confirming before update of email_verified_at on app_user
  for each row when (old.email_verified_at is null and new.email_verified_at is not null)
  execute function instance_confirming();

/*
 * The account, the workspace and the owner membership — 106's — and on a
 * server of one's own, the rules:
 *
 * - `p_asked` (somebody signing up, the default) on a claimed server with
 *   sign-up closed: `sign_up_closed`, and nothing is made;
 * - asked and already confirmed (a provider vouched) on a server nobody
 *   has claimed: the server's first owner;
 * - asked and not confirmed: an applicant, let in or refused when the
 *   address is confirmed (`instance_confirming`);
 * - not asked (the seed, `pnpm dev:account`, a script): made, and never an
 *   owner.
 *
 * The default is `true` so that a caller who forgets is refused, not let
 * in.
 */
drop function register_owner(uuid, text, citext, text, uuid, text, citext, boolean);
create function register_owner(
  p_actor_id      uuid,
  p_name          text,
  p_email         citext,
  p_password_hash text,
  p_workspace_id  uuid,
  p_ws_name       text,
  p_ws_slug       citext,
  p_confirmed     boolean default true,
  p_asked         boolean default true
) returns void
language plpgsql security definer set search_path = public as $$
declare s instance_setting;
begin
  select * into s from instance_setting where id;
  if s.community then
    select * into s from instance_setting where id for update;
    if p_asked and s.claimed_at is not null and not s.sign_up_open then
      raise exception 'sign_up_closed';
    end if;
  end if;

  insert into actor (id, name) values (p_actor_id, p_name);
  insert into app_user (actor_id, email, password_hash, email_verified_at)
    values (p_actor_id, p_email, p_password_hash, case when p_confirmed then now() end);
  insert into workspace (id, name, slug) values (p_workspace_id, p_ws_name, p_ws_slug);
  insert into membership (id, workspace_id, actor_id, role, joined_at)
    values (gen_random_uuid(), p_workspace_id, p_actor_id, 'owner', now());
  insert into security_event (id, workspace_id, actor_id, kind)
    values (gen_random_uuid(), p_workspace_id, p_actor_id, 'register');
  perform starting_labels(p_workspace_id);

  if s.community and p_asked then
    if not p_confirmed then
      insert into instance_applicant (actor_id) values (p_actor_id);
    elsif s.claimed_at is null then
      insert into instance_owner (actor_id) values (p_actor_id);
      update instance_setting set claimed_at = now(), updated_at = now() where id;
    end if;
  end if;
end $$;
revoke all on function register_owner(uuid, text, citext, text, uuid, text, citext, boolean, boolean) from public;
grant execute on function register_owner(uuid, text, citext, text, uuid, text, citext, boolean, boolean) to tracker_app;

/* Whether somebody without an invitation may make an account — the
   sign-up screen asks before drawing its form. Always on the service;
   on a server of one's own, until it is claimed, and after that by the
   switch. */
create function instance_sign_up_open() returns boolean
language sql stable security definer set search_path = public as $$
  select not community or claimed_at is null or sign_up_open from instance_setting where id
$$;
revoke all on function instance_sign_up_open() from public;
grant execute on function instance_sign_up_open() to tracker_app;

/* Whether whoever is asking is one. Every function below asks this itself. */
create function is_instance_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from instance_owner where actor_id = current_actor())
$$;
revoke all on function is_instance_owner() from public;
grant execute on function is_instance_owner() to tracker_app;

/* The screen's whole: the switch and the owners. Null for anybody else. */
create function instance_read() returns json
language sql stable security definer set search_path = public as $$
  select case when is_instance_owner() then json_build_object(
    'sign_up_open', (select sign_up_open from instance_setting where id),
    'owners', coalesce((
      select json_agg(json_build_object(
               'actor_id', o.actor_id, 'name', a.name, 'email', u.email, 'added_at', o.added_at)
             order by o.added_at, o.actor_id)
      from instance_owner o
      join actor a on a.id = o.actor_id
      left join app_user u on u.actor_id = o.actor_id
    ), '[]'::json))
  end
$$;
revoke all on function instance_read() from public;
grant execute on function instance_read() to tracker_app;

create function instance_set_sign_up(p_open boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not is_instance_owner() then return false; end if;
  update instance_setting
  set sign_up_open = p_open, updated_at = now(), updated_by = current_actor()
  where id;
  return true;
end $$;
revoke all on function instance_set_sign_up(boolean) from public;
grant execute on function instance_set_sign_up(boolean) to tracker_app;

/* Another owner: an account that exists and has confirmed its address,
   found by that address. */
create function instance_add_owner(p_email citext) returns text
language plpgsql security definer set search_path = public as $$
declare v_actor uuid;
begin
  if not is_instance_owner() then return 'forbidden'; end if;
  select actor_id into v_actor from app_user where email = p_email;
  if v_actor is null then return 'not_found'; end if;
  /* An address nobody has proved is not somebody to hand the server to. */
  if not exists (select 1 from app_user where actor_id = v_actor and email_verified_at is not null) then
    return 'unconfirmed';
  end if;
  insert into instance_owner (actor_id, added_by) values (v_actor, current_actor())
  on conflict (actor_id) do nothing;
  return case when found then 'added' else 'already' end;
end $$;
revoke all on function instance_add_owner(citext) from public;
grant execute on function instance_add_owner(citext) to tracker_app;

/*
 * One taken off, never the last. The lock and the count are asked here for
 * a plain answer; `instance_owner_stays` asks them again for every other
 * way a row could go.
 */
create function instance_remove_owner(p_actor uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from instance_setting where id for update;
  if not is_instance_owner() then return 'forbidden'; end if;
  if not exists (select 1 from instance_owner where actor_id = p_actor) then return 'not_found'; end if;
  if (select count(*) from instance_owner) <= 1 then return 'last'; end if;
  delete from instance_owner where actor_id = p_actor;
  return 'removed';
end $$;
revoke all on function instance_remove_owner(uuid) from public;
grant execute on function instance_remove_owner(uuid) to tracker_app;

/*
 * An owner who can still get in: a confirmed address and a live
 * membership in a live workspace — signing in lands somebody in their
 * first such workspace, and with none it lands them nowhere. `p_without`
 * leaves one workspace out, for the question of what deleting it would
 * leave.
 */
create function instance_usable_owners(p_without uuid default null) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from instance_owner o
  join app_user u on u.actor_id = o.actor_id and u.email_verified_at is not null
  where exists (
    select 1 from membership m join workspace w on w.id = m.workspace_id
    where m.actor_id = o.actor_id and m.deleted_at is null and m.joined_at is not null
      and w.deleted_at is null and w.id is distinct from p_without
  )
$$;
revoke all on function instance_usable_owners(uuid) from public;

/*
 * The community edition starting — after migrating, and again before it
 * serves, every start, as the table owner; granted to nobody else.
 *
 * It says the database is a server of one's own. The first time it says
 * so on a database that already has accounts and was never claimed — one
 * that ran before this — the oldest confirmed account still in a live
 * workspace is named owner, but never `dev@example.com`, the account
 * `pnpm dev:account` makes with a password the repository holds. On every
 * other start it names nobody: a fresh server is claimed by its first
 * confirmed sign-up, and a claimed server with no owner who can sign in is
 * answered `ownerless`, for the server to say loudly, and mended by
 * `instance_name_owner` from the command line.
 */
create function instance_started() returns json
language plpgsql security definer set search_path = public as $$
declare
  s instance_setting;
  v_actor uuid;
  v_email text;
begin
  select * into s from instance_setting where id for update;
  update instance_setting set community = true where id;
  if not s.community and s.claimed_at is null and not exists (select 1 from instance_owner) then
    select u.actor_id, u.email::text into v_actor, v_email
    from app_user u
    where u.email_verified_at is not null
      and u.email <> 'dev@example.com'
      and exists (
        select 1 from membership m join workspace w on w.id = m.workspace_id
        where m.actor_id = u.actor_id and m.deleted_at is null and m.joined_at is not null
          and w.deleted_at is null
      )
    order by u.created_at, u.actor_id
    limit 1;
    if v_actor is not null then
      insert into instance_owner (actor_id) values (v_actor);
      update instance_setting set claimed_at = now(), updated_at = now() where id;
      return json_build_object('named', v_actor, 'email', v_email);
    end if;
  end if;
  if (s.claimed_at is not null or exists (select 1 from instance_owner)) and instance_usable_owners() = 0 then
    return json_build_object('ownerless', true);
  end if;
  return '{}'::json;
end $$;
revoke all on function instance_started() from public;

/* Whether the database has been told it is a server of one's own — a
   community server asks, and takes "no" as closed. */
create function instance_community() returns boolean
language sql stable security definer set search_path = public as $$
  select community from instance_setting where id
$$;
revoke all on function instance_community() from public;
grant execute on function instance_community() to tracker_app;

/* An owner named by whoever runs the machine — `pnpm --filter
   @tracker/server instance:owner <email>`, as the table owner; granted to
   nobody else. The way back for a server left with no owner. */
create function instance_name_owner(p_email citext) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_actor uuid;
begin
  perform 1 from instance_setting where id for update;
  select actor_id into v_actor from app_user where email = p_email;
  if v_actor is null then return null; end if;
  insert into instance_owner (actor_id) values (v_actor) on conflict do nothing;
  update instance_setting set claimed_at = coalesce(claimed_at, now()), updated_at = now() where id;
  delete from instance_applicant where actor_id = v_actor;
  return v_actor;
end $$;
revoke all on function instance_name_owner(citext) from public;

/*
 * Who is asking, now with whether they own the server — `can` answers
 * `instance` from it, as it answers `operator`. The return type grows, so
 * the function is made again; its body is 178's with one column more.
 */
drop function auth_context(uuid, uuid);
create function auth_context(p_actor uuid, p_workspace uuid)
returns table (role text, settings jsonb, rights json,
               may_create_projects boolean, may_create_channels boolean,
               operator boolean, plan text,
               may_see_members boolean, may_invite_people boolean,
               may_connect_agents boolean, agent boolean,
               instance_owner boolean)
language sql stable security definer set search_path = public as $$
  select m.role::text, w.settings,
         coalesce((
           select json_agg(json_build_object('p', pm.project_id, 'r', pm.rights))
           from project_member pm
           where pm.actor_id = m.actor_id and pm.workspace_id = m.workspace_id
             and pm.deleted_at is null
         ), '[]'),
         m.may_create_projects, m.may_create_channels,
         exists (select 1 from operator o where o.actor_id = p_actor),
         w.plan,
         m.may_see_members, m.may_invite_people,
         m.may_connect_agents,
         exists (select 1 from agent g where g.actor_id = p_actor and g.deleted_at is null),
         exists (select 1 from instance_owner i where i.actor_id = p_actor)
  from membership m join workspace w on w.id = m.workspace_id
  where m.actor_id = p_actor and m.workspace_id = p_workspace
    and m.deleted_at is null and m.joined_at is not null
    and w.deleted_at is null
$$;
grant execute on function auth_context(uuid, uuid) to tracker_app;

/*
 * The last owner of a server of one's own does not delete their account:
 * the server would be left with nobody to open sign-up or name another
 * owner. Asked under the settings row's lock, so two owners deleting
 * themselves at once, or one removing the other while deleting their own,
 * are taken one after the other. Only where the database is a server of
 * one's own: on the service the rows are never written, and this does not
 * lean on that. Any other owner's row goes with their account.
 */
create or replace function delete_my_account(p_dry boolean) returns json
language plpgsql security definer set search_path = public as $$
declare
  v json;
  v_community boolean;
begin
  if current_actor() is null then
    return json_build_object('ok', false, 'why', 'not_found');
  end if;
  if exists (select 1 from operator where actor_id = current_actor()) then
    return json_build_object('ok', false, 'why', 'operator');
  end if;
  select community into v_community from instance_setting where id;
  if v_community then
    perform 1 from instance_setting where id for update;
    if exists (select 1 from instance_owner where actor_id = current_actor())
       and (select count(*) from instance_owner) <= 1 then
      return json_build_object('ok', false, 'why', 'last_instance_owner');
    end if;
  end if;
  v := account_deletion(current_actor(), p_dry);
  if v_community and not p_dry and (v->>'ok')::boolean then
    delete from instance_owner where actor_id = current_actor();
  end if;
  return v;
end $$;

/*
 * A workspace deleted does not take the server's last owner who can sign
 * in with it: an owner with no live membership left signs in to nowhere,
 * and then nobody can reach the server's settings. 178's function is kept
 * whole under another name, reachable only through this one, which asks
 * first — where the database is a server of one's own — whether the
 * server has an owner who can sign in now and would have none after.
 * Under the settings row's lock, as every other question about the last
 * owner is.
 */
alter function delete_workspace(boolean) rename to workspace_deletion;
revoke all on function workspace_deletion(boolean) from public, tracker_app;

create function delete_workspace(p_dry boolean) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  if (select community from instance_setting where id) then
    perform 1 from instance_setting where id for update;
    if instance_usable_owners() > 0 and instance_usable_owners(current_workspace()) = 0
       and exists (
         select 1 from membership m
         where m.workspace_id = current_workspace() and m.actor_id = current_actor() and m.role = 'owner'
           and m.deleted_at is null and m.joined_at is not null) then
      return jsonb_build_object('ok', false, 'why', 'last_instance_owner');
    end if;
  end if;
  return workspace_deletion(p_dry);
end $$;
revoke all on function delete_workspace(boolean) from public;
grant execute on function delete_workspace(boolean) to tracker_app;

/*
 * The sweep of actors with no membership left — 155's — passes over an
 * instance owner: owning the server is not having nothing left.
 */
create or replace function purge_orphan_actors()
returns integer language plpgsql security definer set search_path = public as $$
declare
  todo text[];
  left_over text[];
  t text;
  moved boolean;
  n integer;
begin
  create temporary table orphan on commit drop as
  select a.id from actor a
  where not exists (select 1 from membership m where m.actor_id = a.id)
    and not exists (select 1 from instance_owner o where o.actor_id = a.id);

  /* Not anybody named as the author of something that is still here. */
  for t in
    select table_name::text from information_schema.columns
    where table_schema = 'public' and column_name = 'author_id'
  loop
    execute format('delete from orphan where id in (select author_id from %I)', t);
  end loop;

  select count(*) into n from orphan;
  if n = 0 then return 0; end if;

  select array_agg(table_name::text) into todo
  from information_schema.columns
  where table_schema = 'public' and column_name = 'actor_id';

  loop
    moved := false;
    left_over := '{}';
    foreach t in array todo loop
      begin
        execute format('delete from %I where actor_id in (select id from orphan)', t);
        moved := true;
      exception when foreign_key_violation then
        left_over := left_over || t;
      end;
    end loop;
    todo := left_over;
    exit when cardinality(todo) = 0;
    if not moved then
      raise exception 'could not clear actors: %', todo;
    end if;
  end loop;

  delete from actor where id in (select id from orphan);
  return n;
end $$;

/*
 * `instance` is a screen now — the owner's, at `/:ws/instance` — so it is
 * refused as a project's slug, as the nine before it are, and a project
 * already called that moves aside as 099 moved `account`. On the service
 * too: the addresses are one list for both editions.
 */
do $$
declare row record;
begin
  for row in select id, workspace_id from project where slug = 'instance' loop
    update project p set slug = (
      select 'instance-' || n from generate_series(2, 1000) n
      where not exists (
        select 1 from project o
        where o.workspace_id = row.workspace_id and o.slug = ('instance-' || n)::citext
      )
      order by n limit 1
    ) where p.id = row.id;
  end loop;
end $$;

create or replace function is_a_screen(said text) returns boolean
language sql immutable strict as $$
  select said in ('notifications', 'members', 'chat', 'settings', 'search', 'projects', 'more', 'admin', 'account', 'instance')
$$;
