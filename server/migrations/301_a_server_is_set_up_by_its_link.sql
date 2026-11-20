/*
 * The first opening of your own server.
 *
 * A one-time setup link, made by `setup.sh` (`SETUP_TOKEN`), opens a
 * screen that sets up mail and makes the owner's account — confirmed,
 * owner, signed in — with no letter and no command line. And mail set up
 * from Server settings, its secrets sealed here.
 *
 * Both editions run this; the service never arms a token and never writes
 * mail here, so every function below refuses or answers nothing there.
 *
 * The rules are the database's:
 *
 * - only the armed token's hash, compared here, sets a server up, and only
 *   while nobody owns it — `instance_setup_owner`, `instance_mail_write`;
 * - the setup that makes the owner clears the hash, and every other claim
 *   is seen by `claimed_at`;
 * - with a token armed and no `owner_email`, signing up neither makes an
 *   account nor claims the server: the first comer no longer owns a fresh
 *   server whose installer named nobody.
 */

alter table instance_setting
  /* SHA-256, hex, of `SETUP_TOKEN` as the last serving start read it. */
  add column setup_token_hash text check (setup_token_hash ~ '^[0-9a-f]{64}$');

create table instance_mail (
  id boolean primary key default true check (id),
  via text not null check (via in ('smtp', 'resend')),
  smtp_host text check (length(smtp_host) between 1 and 253),
  smtp_port integer check (smtp_port in (25, 465, 587, 2525)),
  smtp_security text check (smtp_security in ('tls', 'starttls', 'none')),
  smtp_user text check (length(smtp_user) between 1 and 254),
  /* Sealed by the application (`auth/seal.ts`, `mail`); never returned. */
  smtp_password_enc text,
  resend_key_enc text,
  sender text not null check (length(sender) between 3 and 320),
  updated_at timestamptz not null default now(),
  updated_by uuid references actor(id) on delete set null,
  check (via <> 'smtp' or (smtp_host is not null and smtp_port is not null and smtp_security is not null)),
  check (via <> 'resend' or resend_key_enc is not null),
  /* A password goes with a user; no password crosses in the clear. */
  check (smtp_password_enc is null or smtp_user is not null),
  check (smtp_security is distinct from 'none' or (smtp_user is null and smtp_password_enc is null))
);
alter table instance_mail enable row level security;
revoke all on instance_mail from public, tracker_app, tracker_worker;

/* What the serving start read: the token's hash, or null for none. As the
   table owner only. */
create function instance_setup_armed(p_hash text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update instance_setting set setup_token_hash = nullif(p_hash, '') where id
$$;
revoke all on function instance_setup_armed(text) from public;

/* Whether this token, by its hash, may set the server up now: a server of
   one's own, nobody owns it, and it is the armed one. */
create function instance_setup_may(p_hash text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select community and claimed_at is null and setup_token_hash is not null and setup_token_hash = p_hash
  from instance_setting where id
$$;
revoke all on function instance_setup_may(text) from public;
grant execute on function instance_setup_may(text) to tracker_app;

/* What the setup screen and the start need to know: armed, claimed, and
   the named address. Nothing secret. */
create function instance_setup_state() returns json
language sql stable security definer set search_path = public, pg_temp as $$
  select json_build_object(
    'community', community,
    'armed', setup_token_hash is not null,
    'claimed', claimed_at is not null,
    'owner_email', owner_email)
  from instance_setting where id
$$;
revoke all on function instance_setup_state() from public;
grant execute on function instance_setup_state() to tracker_app;

/*
 * The owner, made by the setup screen. Under the settings row's lock, so
 * two at once make one owner and the second is told the server is set up.
 *
 * An address with no account gets one, confirmed, with its workspace and
 * owner membership as `register_owner` makes them. An address that has
 * one — somebody signed up with it first — is taken back as the command
 * line takes it back (`instance_name_owner`): the password chosen here,
 * the address confirmed, and every way in it had gone. Whoever holds the
 * token holds the machine.
 */
create function instance_setup_owner(
  p_hash          text,
  p_actor_id      uuid,
  p_name          text,
  p_email         citext,
  p_password_hash text,
  p_workspace_id  uuid,
  p_ws_name       text,
  p_ws_slug       citext
) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s instance_setting;
  v_actor uuid;
  v_ws uuid;
  v_made boolean := false;
  v_ws_made boolean := false;
begin
  select * into s from instance_setting where id for update;
  if not s.community then raise exception 'not_community'; end if;
  if s.claimed_at is not null then raise exception 'setup_done'; end if;
  if s.setup_token_hash is null or p_hash is distinct from s.setup_token_hash then
    raise exception 'bad_token';
  end if;
  if s.owner_email is not null and p_email is distinct from s.owner_email then
    raise exception 'owner_email';
  end if;
  if p_email = 'dev@example.com' then raise exception 'dev_account'; end if;
  if coalesce(length(p_password_hash), 0) < 20 then raise exception 'no_password'; end if;

  select actor_id into v_actor from app_user where email = p_email;
  if v_actor is null then
    v_actor := p_actor_id;
    v_made := true;
    insert into actor (id, name) values (v_actor, p_name);
    insert into app_user (actor_id, email, password_hash, email_verified_at)
      values (v_actor, p_email, p_password_hash, now());
  else
    /* Not an applicant any more, before its address is confirmed below:
       the claim is this function's, not the trigger's. */
    delete from instance_applicant where actor_id = v_actor;
    update app_user
    set password_hash = p_password_hash,
        email_verified_at = coalesce(email_verified_at, now()),
        totp_enabled = false,
        totp_secret_enc = null,
        updated_at = now()
    where actor_id = v_actor;
    delete from recovery_code where actor_id = v_actor;
    update refresh_session set revoked_at = coalesce(revoked_at, now()), ended_at = now()
    where actor_id = v_actor and ended_at is null;
    update api_token set revoked_at = now() where actor_id = v_actor and revoked_at is null;
    delete from push_subscription where actor_id = v_actor;
    delete from auth_identity where actor_id = v_actor;
    delete from github_person where actor_id = v_actor;
    update auth_ticket set used_at = now() where actor_id = v_actor and used_at is null;
    select m.workspace_id into v_ws
    from membership m join workspace w on w.id = m.workspace_id
    where m.actor_id = v_actor and m.deleted_at is null and m.joined_at is not null and w.deleted_at is null
    order by (m.role = 'owner') desc, m.created_at
    limit 1;
  end if;

  if v_ws is null then
    v_ws := p_workspace_id;
    v_ws_made := true;
    insert into workspace (id, name, slug) values (v_ws, p_ws_name, p_ws_slug);
    insert into membership (id, workspace_id, actor_id, role, joined_at)
      values (gen_random_uuid(), v_ws, v_actor, 'owner', now());
    perform starting_labels(v_ws);
  end if;

  insert into security_event (id, workspace_id, actor_id, kind)
    values (gen_random_uuid(), v_ws, v_actor, case when v_made then 'register' else 'password_reset' end);

  insert into instance_owner (actor_id) values (v_actor) on conflict do nothing;
  update instance_setting
  set claimed_at = now(), setup_token_hash = null, updated_at = now(), updated_by = v_actor
  where id;

  return json_build_object('actor_id', v_actor, 'workspace_id', v_ws, 'made', v_made, 'workspace_made', v_ws_made);
end $$;
revoke all on function instance_setup_owner(text, uuid, text, citext, text, uuid, text, citext) from public;
grant execute on function instance_setup_owner(text, uuid, text, citext, text, uuid, text, citext) to tracker_app;

/* Who may write the server's mail: an owner, or the token while nobody
   owns the server. */
create function instance_mail_may(p_hash text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select (select community from instance_setting where id)
     and (is_instance_owner() or coalesce(instance_setup_may(p_hash), false))
$$;
revoke all on function instance_mail_may(text) from public;

/*
 * The server's mail, saved. A secret left null with `p_keep` keeps the one
 * stored — the SMTP password only for the same host and user, so a changed
 * server never receives the old password; the Resend key only while it is
 * still Resend. 'forbidden', 'secret_needed' or 'saved'.
 */
create function instance_mail_write(
  p_hash         text,
  p_via          text,
  p_host         text,
  p_port         integer,
  p_security     text,
  p_user         text,
  p_password_enc text,
  p_key_enc      text,
  p_keep         boolean,
  p_sender       text
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  was instance_mail;
  v_password text := p_password_enc;
  v_key text := p_key_enc;
begin
  if not coalesce(instance_mail_may(p_hash), false) then return 'forbidden'; end if;
  select * into was from instance_mail where id for update;
  if p_via = 'smtp' then
    v_key := null;
    if v_password is null and p_user is not null and p_keep then
      if was.via = 'smtp' and was.smtp_host = p_host and was.smtp_user = p_user and was.smtp_password_enc is not null then
        v_password := was.smtp_password_enc;
      else
        return 'secret_needed';
      end if;
    end if;
    if p_user is null then v_password := null; end if;
  elsif p_via = 'resend' then
    v_password := null;
    if v_key is null then
      if p_keep and was.via = 'resend' and was.resend_key_enc is not null then
        v_key := was.resend_key_enc;
      else
        return 'secret_needed';
      end if;
    end if;
  else
    return 'forbidden';
  end if;

  insert into instance_mail as m (id, via, smtp_host, smtp_port, smtp_security, smtp_user,
                                  smtp_password_enc, resend_key_enc, sender, updated_at, updated_by)
  values (true, p_via,
          case when p_via = 'smtp' then p_host end,
          case when p_via = 'smtp' then p_port end,
          case when p_via = 'smtp' then p_security end,
          case when p_via = 'smtp' then p_user end,
          v_password, v_key, p_sender, now(), current_actor())
  on conflict (id) do update set
    via = excluded.via, smtp_host = excluded.smtp_host, smtp_port = excluded.smtp_port,
    smtp_security = excluded.smtp_security, smtp_user = excluded.smtp_user,
    smtp_password_enc = excluded.smtp_password_enc, resend_key_enc = excluded.resend_key_enc,
    sender = excluded.sender, updated_at = now(), updated_by = excluded.updated_by;
  return 'saved';
end $$;
revoke all on function instance_mail_write(text, text, text, integer, text, text, text, text, boolean, text) from public;
grant execute on function instance_mail_write(text, text, text, integer, text, text, text, text, boolean, text) to tracker_app;

create function instance_mail_clear(p_hash text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not coalesce(instance_mail_may(p_hash), false) then return false; end if;
  delete from instance_mail where id;
  return true;
end $$;
revoke all on function instance_mail_clear(text) from public;
grant execute on function instance_mail_clear(text) to tracker_app;

/* The row to send with, sealed as it is — the application and the worker
   open it with the key they already hold. Nothing on the service, which
   never writes it. */
create function instance_mail_sealed() returns table (
  via text, smtp_host text, smtp_port integer, smtp_security text, smtp_user text,
  smtp_password_enc text, resend_key_enc text, sender text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.via, m.smtp_host, m.smtp_port, m.smtp_security, m.smtp_user,
         m.smtp_password_enc, m.resend_key_enc, m.sender
  from instance_mail m join instance_setting s on s.id and s.community
  where m.id
$$;
revoke all on function instance_mail_sealed() from public;
grant execute on function instance_mail_sealed() to tracker_app, tracker_worker;

/* 202's: with a token armed and nobody named, the form is not offered —
   the setup link claims this server. */
create or replace function instance_sign_up_open() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select not community
      or (claimed_at is null and (owner_email is not null or setup_token_hash is null))
      or (claimed_at is not null and sign_up_open)
  from instance_setting where id
$$;

/* 212's, and the same: armed with nobody named, sign-up makes no account. */
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
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s instance_setting;
  v_hash text := case when p_asked and not p_confirmed then null else p_password_hash end;
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
    if p_asked and s.claimed_at is null and s.owner_email is null and s.setup_token_hash is not null then
      raise exception 'sign_up_closed';
    end if;
  end if;

  insert into actor (id, name) values (p_actor_id, p_name);
  insert into app_user (actor_id, email, password_hash, email_verified_at)
    values (p_actor_id, p_email, v_hash, case when p_confirmed then now() end);
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

/* 212's, and the same: armed with nobody named, a confirmation does not
   claim — an applicant from before the token was armed stays one. */
create or replace function instance_confirming() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
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
    if s.owner_email is null and s.setup_token_hash is not null then
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
