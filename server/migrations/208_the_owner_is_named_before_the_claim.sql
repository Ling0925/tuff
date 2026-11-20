/*
 * The server's owner is named before anybody claims it — `OWNER_EMAIL`,
 * "Who is an instance owner".
 *
 * 202 let the first account to confirm its address own a server nobody had
 * claimed, and 207 took providers out of that. What was left, and said
 * plainly in the spec: on a server with mail, a stranger who reaches it
 * before its admin signs up with their own address, confirms it, and owns
 * it. A mailbox proves somebody has one, not that they are the admin.
 *
 * So whoever installs the server says whose it is. `scripts/setup.sh` asks
 * for the owner's address and writes `OWNER_EMAIL`; the community edition
 * hands it to the database on every start, as the table owner, through
 * `instance_started` — the same call that sets `community`, so the setting
 * reaches the database the one way the others do and no request can write
 * it. Unset or empty, it is null, and everything is as it was.
 *
 * While the server is unclaimed and the address is set:
 *
 * - `register_owner` refuses an account somebody asks for with any other
 *   address — `sign_up_closed`, nothing made, the answer sign-up already
 *   gives on a closed server;
 * - `instance_confirming` refuses to confirm any other applicant's address,
 *   for an account that asked before the address was set — the same
 *   refusal, the address left unconfirmed. Only the named address claims.
 *
 * Addresses are `citext`, so the comparison ignores case, as signing up
 * and signing in do; the application trims and lowercases it as sign-up
 * lowercases what it is given.
 *
 * Once the server is claimed, the address means nothing: owners add owners
 * in Server settings. The machine's way back (`instance_name_owner`, 205
 * and 206) is not narrowed by it — whoever runs the command holds the
 * machine, and could change the setting as easily.
 *
 * `instance_claimed()` is new, for the application role: whether anybody
 * owns the server yet. The sign-in screen draws no Google, Apple or GitHub
 * button until somebody does — none of them can claim it (207), and a
 * button that answers "closed" is worse than none.
 *
 * Nothing changes on the service: it never calls `instance_started`, so
 * `community` stays false and `owner_email` null.
 */

alter table instance_setting add column owner_email citext;

/* 202's start, told the owner's address — null for none — every time. The
   first start on an old database names its oldest confirmed account as
   before, but where an address is named, only that account. */
drop function instance_started();
create function instance_started(p_owner_email citext default null) returns json
language plpgsql security definer set search_path = public as $$
declare
  s instance_setting;
  v_owner citext := nullif(btrim(p_owner_email::text), '')::citext;
  v_actor uuid;
  v_email text;
begin
  select * into s from instance_setting where id for update;
  update instance_setting set community = true, owner_email = v_owner where id;
  if not s.community and s.claimed_at is null and not exists (select 1 from instance_owner) then
    select u.actor_id, u.email::text into v_actor, v_email
    from app_user u
    where u.email_verified_at is not null
      and u.email <> 'dev@example.com'
      and (v_owner is null or u.email = v_owner)
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
revoke all on function instance_started(citext) from public;

/* 202's trigger, with the named address: on an unclaimed server, only it
   claims. */
create or replace function instance_confirming() returns trigger
language plpgsql security definer set search_path = public as $$
declare s instance_setting;
begin
  if not exists (select 1 from instance_applicant where actor_id = new.actor_id) then
    return new;
  end if;
  select * into s from instance_setting where id for update;
  if s.claimed_at is null then
    if s.owner_email is not null and new.email is distinct from s.owner_email then
      raise exception 'sign_up_closed';
    end if;
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

/* 207's, with the named address: on an unclaimed server, nobody else may
   ask for an account. */
create or replace function register_owner(
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
    if p_asked and p_confirmed and s.claimed_at is null then
      raise exception 'sign_up_closed';
    end if;
    if p_asked and s.claimed_at is null and s.owner_email is not null
       and p_email is distinct from s.owner_email then
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

  if s.community and p_asked and not p_confirmed then
    insert into instance_applicant (actor_id) values (p_actor_id);
  end if;
end $$;

/* Whether anybody owns the server yet. Says nothing about who. */
create function instance_claimed() returns boolean
language sql stable security definer set search_path = public as $$
  select claimed_at is not null from instance_setting where id
$$;
revoke all on function instance_claimed() from public;
grant execute on function instance_claimed() to tracker_app;
