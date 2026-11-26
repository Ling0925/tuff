/*
 * Whoever held the account keeps nothing,
 * 
 * found by the independent reviews of, and of this
 * file's first draft.
 *
 * Every path that puts an account's previous holder out — 212's
 * `app_user_proved`, `auth_claim_email`, `auth_set_password` for an
 * unproved or by-hand address, `instance_name_owner` for one, and through
 * the trigger `auth_email_confirm` — took what it found in the tables at
 * that moment. Two kinds of thing were not there to find:
 *
 * 1. What was in flight. A refresh that had spent session A and written B,
 *    uncommitted, was invisible to the put-out's `update refresh_session`.
 *    So was anything a request of the holder's wrote after it was let in —
 *    a webhook, a room hook, an agent, a webhook turned back on — and the
 *    holder chooses how long that takes: a body sent slowly is read after
 *    the request was let in, and a new password is hashed after the old one
 *    was read. Now the account's hold orders them (`account_hold`, a
 *    transaction-level advisory lock on the person — no transaction id, no
 *    multixact, granted in the order asked):
 *    - `put_out` holds it exclusively, and every path that puts a holder
 *      out takes it before it writes the account's row (an old confirmation
 *      link too, `auth_confirm_email`); it sets `sessions_after` last;
 *    - every transaction made inside a signed-in request — as its person,
 *      as anybody, as nobody, on either connection — asks
 *      `auth_still_in(actor, session, token)` first (`db.ts`): the hold,
 *      shared (an agent's token: its connector's), then a refusal (`28000`,
 *      answered 401) when the session or token the request came with was
 *      begun at or before `sessions_after`. A request first: the put-out
 *      waits for it and sees what it wrote. The put-out first: the request
 *      waits, and is refused;
 *    - what is written with no such request — a sign-in's session, a token
 *      an OAuth exchange mints, a ticket, an OAuth code — goes through
 *      `credential_after_put_out`, a trigger taking the hold shared and
 *      writing the row spent when it was begun at or before
 *      `sessions_after` (`created_at`, which the server dates from the
 *      check it was made on when that came earlier); a provider's callback
 *      asks `auth_not_put_out_since` before its ticket, and a password is
 *      read under the hold (`auth_hold_account`);
 *    - `auth_spend_refresh` takes the hold before it spends;
 *    - a password is changed, and a second factor turned on, only over the
 *      password and the secret that were checked.
 *    316's second round of ends in `auth_email_confirm` is taken out.
 *
 * 2. What it left running. `put_out(actor, row)` is the one step every path
 *    calls — what 315 and before took, and:
 *    - webhooks it made turned off and marked (`webhook.stopped_at`), the
 *      receiver's key it gave taken off; Turn on gives a new secret;
 *    - room hooks it made stopped (`room_hook.stopped_at`); a new URL
 *      starts one again with a secret the holder never saw;
 *    - agents it connected stopped (`agent.stopped_at`), every token of
 *      theirs revoked; their webhooks off and marked as above, address
 *      kept but secret and key emptied, so a new token never sends to the
 *      holder's receiver — only the agent's reach set again does, with a
 *      new secret, on a screen that names the address;
 *    - its GitHub links stopped (`linker_unproved`) as its Slack links are,
 *      and documents it wrote shared to the web in a workspace now waiting
 *      for the person's word unshared;
 *    - the OAuth codes it was given spent, and the factor's times cleared.
 *
 * 3. `account_deletion` takes the account's hold first, so a refresh or a
 *    request in flight is waited for, not deadlocked with.
 *
 * Rows: none changed or deleted here — four nullable columns with no
 * default (the catalogue alone), functions, triggers. Not backfilled.
 * Locks: ACCESS EXCLUSIVE on `app_user`, `room_hook`, `agent` and `webhook`
 * for the columns, SHARE ROW EXCLUSIVE on `refresh_session`, `api_token`,
 * `auth_ticket` and `oauth_code` for the triggers, each until this file
 * commits, which is the moment its functions take to write. `lock_timeout`
 * so that a long transaction holding one of them fails the deploy rather
 * than stopping every request behind this file.
 */

set local lock_timeout = '3s';

alter table app_user add column sessions_after timestamptz;
comment on column app_user.sessions_after is
  'When the account''s previous holder was put out: a session, token, ticket or code begun at or before it is dead, and a request that came with one is refused.';

alter table webhook add column stopped_at timestamptz;
comment on column webhook.stopped_at is
  'Turned off because its maker''s account changed hands; turning it on gives it a new secret.';
grant select (stopped_at) on webhook to tracker_app;

alter table room_hook add column stopped_at timestamptz;
comment on column room_hook.stopped_at is
  'Stopped because its maker''s account changed hands; a new URL starts it again.';
grant select (stopped_at) on room_hook to tracker_app;

alter table agent add column stopped_at timestamptz;
comment on column agent.stopped_at is
  'Stopped because its connector''s account changed hands: its tokens revoked; a new token starts it again.';

/* ------------------------------------------------------------ 1. in flight */

/*
 * The account's hold: a transaction-level advisory lock on the person,
 * shared by whatever runs as them (a request's transactions, a refresh, a
 * sign-in's session) and exclusive for whatever puts their previous holder
 * out or deletes them. Not a lock on the `app_user` row: a row lock taken
 * by every request gave every read transaction an id and a multixact, and
 * row-lock waiters do not queue in order, so a stream of overlapping
 * requests could keep a put-out waiting for good. Advisory locks take no
 * transaction id and are granted in the order asked. The two-number form,
 * with 31800 first, is a key space of its own: every other advisory lock
 * here takes one bigint (`hashtext…`, the migrations' 7295000295).
 * Exclusive waits at most three seconds, then the put-out fails and is
 * pressed again, rather than holding a sign-in connection.
 * Nobody's to run but the functions below.
 */
create function account_hold(p_person uuid, p_exclusive boolean) returns void
language plpgsql volatile set search_path = public, pg_temp as $$
declare
  v_was text;
begin
  if p_person is null then
    return;
  end if;
  if p_exclusive then
    /* Three seconds for this wait alone: the transaction's own setting
       comes back once the hold is granted, so the row locks after it are
       waited for as they always were. */
    v_was := current_setting('lock_timeout');
    perform set_config('lock_timeout', '3s', true);
    perform pg_advisory_xact_lock(31800, hashtext(p_person::text));
    perform set_config('lock_timeout', v_was, true);
  else
    perform pg_advisory_xact_lock_shared(31800, hashtext(p_person::text));
  end if;
end $$;
revoke all on function account_hold(uuid, boolean) from public;

/*
 * Whether a signed-in request may go on: asked first in every transaction
 * made inside it (`db.ts`), with who it is and the session or token it came
 * with. Holds the account (an agent's: its connector's) until the
 * transaction ends, so a put-out of that account either waits for this
 * transaction and then sees what it wrote, or has committed and this is
 * refused. The application's (and so the sign-in role's, its member).
 */
create function auth_still_in(p_actor uuid, p_session uuid, p_token uuid) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_person uuid;
  v_after timestamptz;
  v_begun timestamptz;
begin
  if p_actor is null or (p_session is null and p_token is null) then
    return true;
  end if;
  v_person := coalesce((select g.created_by from agent g where g.actor_id = p_actor), p_actor);
  perform account_hold(v_person, false);
  select u.sessions_after into v_after from app_user u where u.actor_id = v_person;
  if v_after is null then
    return true;
  end if;
  if p_session is not null then
    select s.created_at into v_begun from refresh_session s where s.id = p_session;
  else
    select t.created_at into v_begun from api_token t where t.id = p_token;
  end if;
  if v_begun is not null and v_begun <= v_after then
    raise exception 'put_out' using errcode = '28000';
  end if;
  return true;
end $$;
revoke all on function auth_still_in(uuid, uuid, uuid) from public;
grant execute on function auth_still_in(uuid, uuid, uuid) to tracker_app;

/*
 * What is written with no signed-in request to ask — a sign-in's session,
 * a token an OAuth exchange mints, a ticket, an OAuth code — under the same
 * lock, and written spent when the account was put out at or after it was
 * begun. Nobody's to run: a trigger.
 */
create function credential_after_put_out() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_who uuid;
  v_after timestamptz;
begin
  if tg_table_name = 'api_token' then
    /* An agent's token acts for whoever connected the agent. */
    v_who := coalesce((select g.created_by from agent g where g.actor_id = new.actor_id), new.actor_id);
  else
    v_who := new.actor_id;
  end if;
  if v_who is null then
    return new;
  end if;
  perform account_hold(v_who, false);
  select u.sessions_after into v_after from app_user u where u.actor_id = v_who;
  if v_after is null or new.created_at > v_after then
    return new;
  end if;
  if tg_table_name = 'refresh_session' then
    new.revoked_at := coalesce(new.revoked_at, now());
    new.ended_at := coalesce(new.ended_at, now());
  elsif tg_table_name = 'api_token' then
    new.revoked_at := coalesce(new.revoked_at, now());
    new.refresh_hash := null;
  else
    -- auth_ticket, oauth_code
    new.used_at := coalesce(new.used_at, now());
  end if;
  return new;
end $$;
revoke all on function credential_after_put_out() from public;

create trigger credential_after_put_out before insert on refresh_session
  for each row execute function credential_after_put_out();
create trigger credential_after_put_out before insert on api_token
  for each row execute function credential_after_put_out();
create trigger credential_after_put_out before insert on auth_ticket
  for each row execute function credential_after_put_out();
create trigger credential_after_put_out before insert on oauth_code
  for each row execute function credential_after_put_out();

/* 061's, with the account's row held first — before the spend, so a
   refresh never holds the session while waiting for the row. */
create or replace function auth_spend_refresh(p_hash text)
returns table (session_id uuid, actor_id uuid, workspace_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid;
begin
  select s.actor_id into v_actor from refresh_session s
  where s.token_hash = p_hash and s.revoked_at is null and s.expires_at > now();
  if v_actor is null then
    return;
  end if;
  perform account_hold(v_actor, false);
  return query
    update refresh_session s set revoked_at = now()
    where s.token_hash = p_hash and s.revoked_at is null and s.expires_at > now()
    returning s.id, s.actor_id, s.workspace_id;
end $$;

/* --------------------------------------------------------- 2. one put-out */

/* 315's, and the GitHub links it chose stop as its Slack links do, and what
   it wrote and shared to the web in a workspace now waiting is unshared. */
create or replace function before_proof_held(p_actor uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if p_actor is null then
    return;
  end if;
  /* Nobody walks in later on a link the previous holder handed out —
     first, so nobody walks in between this and the rows below either. */
  update invite set deleted_at = now(), updated_at = now()
  where created_by = p_actor and used_at is null and deleted_at is null;
  /* Nor does a project keep posting to a Slack channel they chose. */
  update slack_link set stopped_at = now(), stopped = 'linker_unproved'
  where linked_by = p_actor and stopped_at is null and deleted_at is null;
  /* Nor a repository keep acting as them (149's stop, with why). */
  update github_link set stopped_at = now(), stopped_why = 'linker_unproved'
  where linked_by = p_actor and stopped_at is null and deleted_at is null;
  /* Every workspace waits, but the one sign-up made for this account
     (`register_owner` wrote its `register` line there) while nobody else
     has ever had a row in it. */
  update membership m
  set joined_at = null, unconfirmed_at = now(), updated_at = now()
  where m.actor_id = p_actor and m.deleted_at is null and m.joined_at is not null
    and not (
      exists (
        select 1 from security_event e
        where e.workspace_id = m.workspace_id and e.actor_id = p_actor and e.kind = 'register'
      )
      and not exists (
        select 1 from membership o
        where o.workspace_id = m.workspace_id and o.actor_id <> p_actor
      )
    );
  /* And a document they wrote there, shared to the web, stops being: the
     link was theirs to hand out. Sharing it again is a press. */
  update file f set public_token = null
  where f.author_id = p_actor and f.public_token is not null
    and exists (
      select 1 from membership m
      where m.workspace_id = f.workspace_id and m.actor_id = p_actor
        and m.deleted_at is null and m.joined_at is null and m.unconfirmed_at is not null
    );
end $$;

/*
 * The previous holder of an account, put out: everything it held or made
 * that acts as the account, taken back or stopped, and every workspace it
 * was in with somebody else held for the person's word. `p_row`: also the
 * account's own row — the factor and `sessions_after`. False only from
 * `app_user_proved`, a trigger on that row, which writes them on `NEW`.
 * Nobody's to run: called by the paths that put a holder out.
 */
create function put_out(p_actor uuid, p_row boolean) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if p_actor is null then
    return;
  end if;
  /* First (each caller has already, before writing the row): every
     transaction of the holder's still running — a request, a refresh, a
     sign-in — finishes before anything below reads, and none starts until
     this one has committed (`auth_still_in`). */
  perform account_hold(p_actor, true);

  delete from recovery_code where actor_id = p_actor;
  update refresh_session set revoked_at = coalesce(revoked_at, now()), ended_at = now()
  where actor_id = p_actor and ended_at is null;
  update api_token set revoked_at = now(), refresh_hash = null, updated_at = now()
  where actor_id = p_actor and revoked_at is null;
  delete from push_subscription where actor_id = p_actor;
  delete from auth_identity where actor_id = p_actor;
  delete from github_person where actor_id = p_actor;
  update auth_ticket set used_at = now() where actor_id = p_actor and used_at is null;
  /* An agent's or its own OAuth code, given to the account and not yet
     exchanged, would become a token after this. */
  update oauth_code set used_at = now() where actor_id = p_actor and used_at is null;

  /* The agents it connected: stopped, every token of theirs revoked. */
  update agent set stopped_at = now()
  where created_by = p_actor and deleted_at is null and stopped_at is null;
  update api_token t set revoked_at = now(), refresh_hash = null, updated_at = now()
  from agent g
  where g.created_by = p_actor and g.deleted_at is null
    and t.actor_id = g.actor_id and t.workspace_id = g.workspace_id and t.revoked_at is null;
  /* The webhooks it made, off and marked, without the receiver's key it
     gave; an agent's without its secret either — only its reach set again
     sends anything, with a new one. The address is kept, to be shown. */
  update webhook set enabled = false, stopped_at = now(), authorization_enc = null,
                     secret_enc = case when agent_id is not null then '' else secret_enc end,
                     updated_at = now()
  where created_by = p_actor and deleted_at is null and stopped_at is null;
  /* Its room hooks: stopped, kept. */
  update room_hook set stopped_at = now()
  where created_by = p_actor and stopped_at is null and deleted_at is null;

  perform before_proof_held(p_actor);

  /* Last, so it is later than everything above began. */
  if p_row then
    update app_user
    set totp_enabled = false, totp_secret_enc = null, totp_enabled_at = null, totp_begun_at = null,
        sessions_after = clock_timestamp(), updated_at = now()
    where actor_id = p_actor;
  end if;
end $$;
revoke all on function put_out(uuid, boolean) from public;

/* 315's, with the shared step. */
create or replace function app_user_proved() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.password_hash is not distinct from old.password_hash then
    new.password_hash := null;
    perform put_out(new.actor_id, false);
    new.totp_enabled := false;
    new.totp_secret_enc := null;
    new.totp_enabled_at := null;
    new.totp_begun_at := null;
    new.sessions_after := clock_timestamp();
  end if;
  return new;
end $$;

/* 315's, with the shared step; the account held before its row is written,
   so a request of the holder's in flight is waited for, not deadlocked with. */
create or replace function auth_claim_email(p_actor uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from instance_setting where id and community and claimed_at is null)
     and exists (select 1 from instance_applicant where actor_id = p_actor) then
    raise exception 'sign_up_closed';
  end if;
  perform account_hold(p_actor, true);
  if exists (select 1 from app_user where actor_id = p_actor
             and (email_verified_at is null or email_by_hand)) then
    update app_user set email_verified_at = now(), email_by_hand = false, password_hash = null,
                        updated_at = now()
    where actor_id = p_actor;
    perform put_out(p_actor, true);
  end if;
end $$;

/* 315's, with the shared step for an unproved or by-hand address. */
create or replace function auth_set_password(p_actor uuid, p_hash text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_had boolean;
  v_unproved boolean;
  v_fresh boolean;
begin
  perform account_hold(p_actor, true);
  select password_hash is not null, email_verified_at is null or email_by_hand,
         coalesce(totp_enabled and totp_enabled_at > now() - interval '7 days', false)
  into v_had, v_unproved, v_fresh
  from app_user where actor_id = p_actor;
  update app_user
  set password_hash = p_hash, email_verified_at = coalesce(email_verified_at, now()),
      email_by_hand = false, updated_at = now()
  where actor_id = p_actor;
  if v_unproved then
    perform put_out(p_actor, true);
  else
    update refresh_session set revoked_at = coalesce(revoked_at, now()), ended_at = now()
    where actor_id = p_actor and ended_at is null;
    if v_had then
      update api_token set revoked_at = now() where actor_id = p_actor and revoked_at is null;
      delete from push_subscription where actor_id = p_actor;
    end if;
    if v_fresh then
      update app_user set totp_enabled = false, totp_secret_enc = null, totp_enabled_at = null, updated_at = now()
      where actor_id = p_actor;
      delete from recovery_code where actor_id = p_actor;
    end if;
  end if;
  insert into security_event (id, workspace_id, actor_id, kind)
  select gen_random_uuid(), m.workspace_id, p_actor, 'password_reset'
  from membership m
  where m.actor_id = p_actor and m.deleted_at is null and m.joined_at is not null;
end $$;

/* 315's, with the shared step when the account was unproved or by hand. */
create or replace function instance_name_owner(p_email citext, p_reset_hash text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s instance_setting;
  v_actor uuid;
  v_recovery boolean;
  v_weak boolean;
begin
  select * into s from instance_setting where id for update;
  if not s.community then raise exception 'not_community'; end if;
  select actor_id into v_actor from app_user where email = p_email;
  if v_actor is null then return null; end if;
  perform account_hold(v_actor, true);
  select email_verified_at is null or email_by_hand into v_weak from app_user where actor_id = v_actor;
  if p_email = 'dev@example.com' then raise exception 'dev_account'; end if;
  v_recovery := s.claimed_at is not null and instance_usable_owners() = 0;
  if s.claimed_at is not null and not v_recovery then
    raise exception 'instance_claimed';
  end if;
  if not v_recovery
     and not exists (select 1 from instance_applicant where actor_id = v_actor)
     and (s.owner_email is null or p_email is distinct from s.owner_email) then
    raise exception 'not_asked';
  end if;
  if coalesce(length(p_reset_hash), 0) < 20 then raise exception 'no_ticket'; end if;

  insert into instance_owner (actor_id) values (v_actor) on conflict do nothing;
  update instance_setting set claimed_at = coalesce(claimed_at, now()), updated_at = now() where id;
  delete from instance_applicant where actor_id = v_actor;

  update app_user
  set password_hash = null, email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
  where actor_id = v_actor;
  if v_weak then
    perform put_out(v_actor, true);
  else
    update refresh_session set revoked_at = coalesce(revoked_at, now()), ended_at = now()
    where actor_id = v_actor and ended_at is null;
    update api_token set revoked_at = now() where actor_id = v_actor and revoked_at is null;
    delete from push_subscription where actor_id = v_actor;
    delete from auth_identity where actor_id = v_actor;
    update auth_ticket set used_at = now() where actor_id = v_actor and used_at is null;
  end if;
  /* The new owner's ticket, begun after the put-out above by the clock
     (`credential_after_put_out` would spend one dated from this
     transaction's start). */
  insert into auth_ticket (token_hash, kind, actor_id, workspace_id, expires_at, created_at)
  values (p_reset_hash, 'reset', v_actor, null, now() + interval '1 hour', clock_timestamp());
  insert into security_event (id, workspace_id, actor_id, kind)
  select gen_random_uuid(), m.workspace_id, v_actor, 'password_reset'
  from membership m
  where m.actor_id = v_actor and m.deleted_at is null and m.joined_at is not null;
  return v_actor;
end $$;

/* 316's, without the second round of ends: the put-out holds the account's
   row first, and a refresh in flight is ordered by it. */
create or replace function auth_email_confirm(p_hash text, p_session uuid)
returns table (said text, actor_id uuid, email citext, old citext, put_out boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t auth_ticket%rowtype;
  v_old citext;
  v_unproved boolean;
  v_theirs boolean;
  v_said text;
begin
  /* Whose ticket, read without a lock; an unproved account is about to be
     put out, so its hold comes first — before the ticket's row and the
     account's, as every put-out takes it. Locking the ticket first waited
     for the hold while holding a row a request under the hold might want. */
  select * into t from auth_ticket k
  where k.token_hash = p_hash and k.kind = 'email' and k.used_at is null and k.expires_at > now();
  if not found then
    return query select 'gone'::text, null::uuid, null::citext, null::citext, false;
    return;
  end if;
  if exists (select 1 from app_user u where u.actor_id = t.actor_id and u.email_verified_at is null) then
    perform account_hold(t.actor_id, true);
  end if;
  select * into t from auth_ticket k
  where k.token_hash = p_hash and k.kind = 'email' and k.used_at is null and k.expires_at > now()
  for update;
  if not found then
    return query select 'gone'::text, null::uuid, null::citext, null::citext, false;
    return;
  end if;
  select u.email, u.email_verified_at is null into v_old, v_unproved
  from app_user u where u.actor_id = t.actor_id
  for update;
  if not found then
    return query select 'gone'::text, null::uuid, null::citext, null::citext, false;
    return;
  end if;
  v_theirs := p_session is not null and exists (
    select 1 from refresh_session s
    where s.id = p_session and s.actor_id = t.actor_id and s.ended_at is null
  );
  if not v_theirs and not v_unproved then
    return query select 'not_this_account'::text, null::uuid, null::citext, null::citext, false;
    return;
  end if;
  update auth_ticket set used_at = now() where token_hash = p_hash;
  /* For an unproved account, confirming fires `app_user_proved`, which puts
     the previous holder out (`put_out`). */
  v_said := auth_email_change(t.actor_id, t.email);
  return query select v_said, t.actor_id, t.email, v_old, v_said = 'changed' and v_unproved;
end $$;

/* 106's: an old confirmation link confirms an address with no password
   chosen, which puts the previous holder out (`app_user_proved`) — the hold
   first, before the row the trigger fires on. Taken the other way round,
   a request of the holder's that holds the account and then writes its own
   row deadlocked with it, and the put-out was the one aborted. */
create or replace function auth_confirm_email(p_actor uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from app_user where actor_id = p_actor and email_verified_at is null) then
    perform account_hold(p_actor, true);
    update app_user set email_verified_at = now(), updated_at = now()
    where actor_id = p_actor and email_verified_at is null;
  end if;
end $$;

/*
 * 112's, and only over the password that was checked: the route hands the
 * hash it verified, and a password that changed since — a reset, or the
 * account put out and its password taken while the new one was hashed — is
 * not overwritten. -1 for that; the route says the password did not match.
 */
drop function auth_change_password(uuid, text, uuid);
create function auth_change_password(p_actor uuid, p_hash text, p_keep uuid, p_was text) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n int;
begin
  update app_user set password_hash = p_hash, updated_at = now()
  where actor_id = p_actor and password_hash is not distinct from p_was;
  if not found then
    return -1;
  end if;
  update auth_ticket set used_at = now()
  where actor_id = p_actor and kind = 'reset' and used_at is null;
  insert into security_event (id, workspace_id, actor_id, kind)
  select gen_random_uuid(), m.workspace_id, p_actor, 'password_changed'
  from membership m
  where m.actor_id = p_actor and m.deleted_at is null and m.joined_at is not null;
  select auth_revoke_others(p_actor, p_keep) into n;
  return n;
end $$;
revoke all on function auth_change_password(uuid, text, uuid, text) from public;
grant execute on function auth_change_password(uuid, text, uuid, text) to tracker_auth;

/*
 * 243's, and only for the secret the code was checked against: one begun
 * again since — or taken by a put-out and begun by somebody else — is not
 * the one turned on.
 */
drop function auth_totp_enable(uuid);
create function auth_totp_enable(p_actor uuid, p_secret_enc text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from app_user where actor_id = p_actor and totp_enabled) then
    return 'on';
  end if;
  update app_user set totp_enabled = true, totp_enabled_at = now(), totp_begun_at = null, updated_at = now()
  where actor_id = p_actor and totp_secret_enc is not null and totp_secret_enc = p_secret_enc
    and not totp_enabled and totp_begun_at > now() - interval '15 minutes';
  if found then
    return 'ok';
  end if;
  return 'expired';
end $$;
revoke all on function auth_totp_enable(uuid, text) from public;
grant execute on function auth_totp_enable(uuid, text) to tracker_auth;

/*
 * Whether the account was put out at or after a moment — for a sign-in
 * whose way in was read before the session it hands out is written: a
 * provider's callback found the account by its identity, and writes the
 * ticket the exchange redeems. Under the account's hold, so a put-out in
 * flight is waited for; raises `28000` when it was. The sign-in role's.
 */
create function auth_not_put_out_since(p_actor uuid, p_since timestamptz) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if p_actor is null or p_since is null then
    return true;
  end if;
  perform account_hold(p_actor, false);
  if exists (select 1 from app_user u where u.actor_id = p_actor and u.sessions_after >= p_since) then
    raise exception 'put_out' using errcode = '28000';
  end if;
  return true;
end $$;
revoke all on function auth_not_put_out_since(uuid, timestamptz) from public;
grant execute on function auth_not_put_out_since(uuid, timestamptz) to tracker_auth;

/*
 * The account's hold for a password about to be read, so a put-out in
 * flight is waited for and the password read is the one after it — the
 * sign-in role's, for `credentials` (`flows.ts`).
 */
create function auth_hold_account(p_actor uuid) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform account_hold(p_actor, false);
  return true;
end $$;
revoke all on function auth_hold_account(uuid) from public;
grant execute on function auth_hold_account(uuid) to tracker_auth;

/* --------------------------------------------------- 2. started again */

/* A stopped hook takes nothing (217's, and `stopped_at`). */
create or replace function room_hook_take(p_id uuid, p_hash text)
returns table (workspace_id uuid, conversation_id uuid, created_by uuid, name text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return query
    select h.workspace_id, h.conversation_id, h.created_by, h.name
    from room_hook h
    join conversation c on c.id = h.conversation_id
    where h.id = p_id and h.secret_hash = p_hash and h.deleted_at is null and h.stopped_at is null
      and c.deleted_at is null and c.channel
      and may_manage_hooks(h.created_by, h.workspace_id, c.project_id);
end $$;

/* A new URL starts a stopped hook again, with a secret its previous maker
   never saw, made by whoever pressed (217's, and `stopped_at`). */
create or replace function room_hook_turn(p_id uuid, p_hash text) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  n int;
begin
  if current_actor() is null then
    return false;
  end if;
  update room_hook h set secret_hash = p_hash, turned_at = now(), created_by = current_actor(), stopped_at = null
  where h.id = p_id and h.deleted_at is null
    and h.workspace_id = current_workspace()
    and can_see_conversation(h.conversation_id);
  get diagnostics n = row_count;
  return n = 1;
end $$;

/*
 * A new token starts a stopped agent's tokens again: 269's, and the mark
 * cleared. Nothing is sent anywhere by it — a webhook the put-out turned off
 * stays off until the agent's reach is set again (`agent_reach`), and one
 * off for any other reason stays as it was.
 */
create or replace function agent_end_tokens(p_agent uuid) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not agent_may_be_managed(p_agent) then
    return false;
  end if;
  update api_token set revoked_at = now(), refresh_hash = null, updated_at = now()
  where workspace_id = current_workspace() and actor_id = p_agent and revoked_at is null;
  update oauth_code set used_at = now()
  where workspace_id = current_workspace() and agent_id = p_agent and used_at is null;
  update agent set stopped_at = null
  where actor_id = p_agent and workspace_id = current_workspace() and stopped_at is not null;
  return true;
end $$;

/*
 * 268's, and a webhook the put-out stopped counts as moved, whatever
 * address it is given: a new secret, no key, on again, the mark cleared —
 * the press on the agent's page, which shows the address it sends to.
 */
create or replace function agent_reach(p_agent uuid, p_reach text, p_url text, p_shape text, p_secret text)
returns table (
  was_reach text, was_url text, was_shape text, had_key boolean, cleared boolean, hook_id uuid, new_secret boolean
)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  ws uuid := current_workspace();
  g record;
  h record;
  has_hook boolean;
  moved boolean;
  fresh uuid;
begin
  if not agent_may_be_managed(p_agent) or p_reach not in ('mcp', 'webhook')
     or (p_reach = 'webhook') <> (p_url is not null)
     or (p_reach = 'webhook' and (p_shape is null or p_shape not in ('tuff', 'claude_routine'))) then
    return;
  end if;
  select a.reach into g from agent a
  where a.actor_id = p_agent and a.workspace_id = ws and a.deleted_at is null
  for update;
  if not found then
    return;
  end if;
  select w.id, w.url, w.shape, w.authorization_enc is not null as had, w.stopped_at is not null as stopped into h
  from webhook w
  where w.agent_id = p_agent and w.workspace_id = ws and w.deleted_at is null
  for update;
  has_hook := found;

  if p_reach = 'mcp' then
    update agent set reach = 'mcp' where actor_id = p_agent and workspace_id = ws;
    if has_hook then
      /* The columns are not null: emptied rather than nulled. */
      update webhook set enabled = false, deleted_at = now(), authorization_enc = null,
                         url = '', secret_enc = '', updated_at = now()
      where webhook.id = h.id;
      delete from webhook_delivery where webhook_id = h.id and delivered_at is null;
      return query select g.reach, h.url, h.shape, h.had, h.had, h.id, false;
    else
      return query select g.reach, null::text, null::text, false, false, null::uuid, false;
    end if;
    return;
  end if;

  if p_secret is null then
    raise exception 'agent_reach: a webhook needs its secret';
  end if;
  update agent set reach = 'webhook' where actor_id = p_agent and workspace_id = ws;
  if not has_hook then
    fresh := gen_random_uuid();
    insert into webhook (id, workspace_id, url, events, secret_enc, created_by, agent_id, shape)
    values (fresh, ws, p_url, '{}', p_secret, current_actor(), p_agent, p_shape);
    return query select g.reach, null::text, null::text, false, false, fresh, true;
    return;
  end if;
  moved := h.stopped or h.url is distinct from p_url or h.shape is distinct from p_shape;
  if not moved then
    return query select g.reach, h.url, h.shape, h.had, false, h.id, false;
    return;
  end if;
  update webhook set
    url = p_url,
    shape = p_shape,
    authorization_enc = null,
    secret_enc = p_secret,
    enabled = case when h.stopped then true else enabled end,
    stopped_at = null,
    updated_at = now()
  where webhook.id = h.id;
  delete from webhook_delivery where webhook_id = h.id and delivered_at is null;
  return query select g.reach, h.url, h.shape, h.had, h.had, h.id, true;
end $$;

/* What its webhook says, and whether the put-out stopped it — then not
   where it sent, which was the previous holder's to say (268's). */
drop function if exists agent_webhook_said(uuid);
create function agent_webhook_said(p_agent uuid)
returns table (authorization_set boolean, shape text, url text, stopped boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select h.authorization_enc is not null, h.shape,
         case when h.stopped_at is null then h.url end, h.stopped_at is not null
  from webhook h
  where agent_may_be_managed(p_agent)
    and h.agent_id = p_agent and h.workspace_id = current_workspace() and h.deleted_at is null
  limit 1
$$;
revoke all on function agent_webhook_said(uuid) from public;
grant execute on function agent_webhook_said(uuid) to tracker_app;

/* ------------------------------------------- 3. an account deleted, in turn */

/*
 * 298's, behind the account's hold: a refresh or a request of the
 * account's in flight finishes first, rather than meeting the deletion
 * half-way. A dry run holds nothing.
 */
alter function account_deletion(uuid, boolean) rename to account_deletion_rows;
create function account_deletion(p_actor uuid, p_dry boolean) returns json
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not p_dry then
    perform account_hold(p_actor, true);
  end if;
  return account_deletion_rows(p_actor, p_dry);
end $$;
revoke all on function account_deletion(uuid, boolean) from public;

set local lock_timeout to default;
