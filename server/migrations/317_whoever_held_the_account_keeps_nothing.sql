/*
 * Whoever held the account keeps nothing,
 * 
 * found by the independent reviews of.
 *
 * Every path that puts an account's previous holder out — 212's
 * `app_user_proved`, `auth_claim_email`, `auth_set_password` for an
 * unproved or by-hand address, `instance_name_owner` for one, and through
 * the trigger `auth_email_confirm` — took what it found in the tables at
 * that moment. Two kinds of thing were not there to find:
 *
 * 1. What was in flight. A refresh that had spent session A and written B,
 *    uncommitted, was invisible to the put-out's `update refresh_session`;
 *    it waited on A, ended A, and B went live at the refresh's commit. The
 *    same for a sign-in, a switch or a token. Now:
 *    - `app_user.sessions_after`, the moment the holder was put out —
 *      `clock_timestamp()`, the put-out's last step;
 *    - `credential_after_put_out`, a trigger on every write of a session,
 *      a token, a webhook, a room hook (and a room hook given a new URL)
 *      and an agent: it takes a share lock on the account's row (an
 *      agent's token and an agent: its connector's) and writes the row
 *      ended, revoked, turned off or stopped when the account was put out
 *      at or after the row was begun (`created_at`, or the transaction's
 *      start for a new URL). The lock orders it with the put-out, whose
 *      update of the same row comes before everything it ends: first, the
 *      put-out's statements see it and end it; second, it reads the time;
 *    - `auth_spend_refresh` takes the lock before it spends, so a refresh
 *      never holds A while waiting for the row the put-out holds while
 *      waiting for A.
 *    316's second round of ends in `auth_email_confirm` is taken out: it
 *    caught a refresh committed by the time it ran, and this catches both.
 *
 * 2. What it left running: webhooks it made went on delivering the
 *    workspace's events, room hooks posting, agents it connected working
 *    with tokens it held, and the account said two-factor was on since a
 *    time. Now `put_out(actor, row)` is the one step every path calls —
 *    what 315 and before took, and: webhooks it made turned off, room
 *    hooks stopped (`room_hook.stopped_at`, started again by a new URL),
 *    agents it connected stopped (`agent.stopped_at`: every token revoked,
 *    their webhooks off with the rest, started again by a new token), the
 *    OAuth codes it was given spent, and the factor's times cleared.
 *    Nothing deleted: an admin turns a webhook on, the hook's maker gives
 *    it a new URL, the agent's connector gives it a new token.
 *
 * Rows: none changed or deleted here — three nullable columns with no
 * default (the catalogue alone), functions, triggers. Not backfilled.
 * Locks: ACCESS EXCLUSIVE on `app_user`, `room_hook` and `agent` for the
 * columns, SHARE ROW EXCLUSIVE on `refresh_session`, `api_token` and
 * `webhook` for the triggers, each until this file commits, which is the
 * moment its functions take to write. `lock_timeout` so that a long
 * transaction holding one of them fails the deploy rather than stopping
 * every request behind this file.
 */

set local lock_timeout = '10s';

alter table app_user add column sessions_after timestamptz;
comment on column app_user.sessions_after is
  'When the account''s previous holder was put out: a session, token, webhook, room hook or agent begun at or before it is written ended, revoked, off or stopped.';

alter table room_hook add column stopped_at timestamptz;
comment on column room_hook.stopped_at is
  'Stopped because its maker''s account changed hands; a new URL starts it again.';
grant select (stopped_at) on room_hook to tracker_app;

alter table agent add column stopped_at timestamptz;
comment on column agent.stopped_at is
  'Stopped because its connector''s account changed hands: its tokens revoked, its webhook off; a new token starts it again.';

/* ------------------------------------------------------------ 1. in flight */

/*
 * Written under a share lock on the account the row acts for, and written
 * dead when that account was put out at or after the row was begun.
 * Nobody's to run: a trigger.
 */
create function credential_after_put_out() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_who uuid;
  v_begun timestamptz;
  v_after timestamptz;
begin
  if tg_table_name = 'refresh_session' then
    v_who := new.actor_id;
  elsif tg_table_name = 'api_token' then
    /* An agent's token acts for whoever connected the agent. */
    v_who := coalesce((select g.created_by from agent g where g.actor_id = new.actor_id), new.actor_id);
  else
    v_who := new.created_by;
  end if;
  v_begun := case when tg_op = 'UPDATE' then now() else new.created_at end;

  /* Held until this transaction ends: a put-out of the same account waits
     for this write and then sees it, or this waits for the put-out and
     reads its time. An actor with no account (an agent, a page) has none. */
  select u.sessions_after into v_after from app_user u where u.actor_id = v_who for share;
  if v_after is null or v_begun > v_after then
    return new;
  end if;

  if tg_table_name = 'refresh_session' then
    new.revoked_at := coalesce(new.revoked_at, now());
    new.ended_at := coalesce(new.ended_at, now());
  elsif tg_table_name = 'api_token' then
    new.revoked_at := coalesce(new.revoked_at, now());
    new.refresh_hash := null;
  elsif tg_table_name = 'webhook' then
    new.enabled := false;
  else
    -- room_hook, agent
    new.stopped_at := coalesce(new.stopped_at, now());
  end if;
  return new;
end $$;
revoke all on function credential_after_put_out() from public;

create trigger credential_after_put_out before insert on refresh_session
  for each row execute function credential_after_put_out();
create trigger credential_after_put_out before insert on api_token
  for each row execute function credential_after_put_out();
create trigger credential_after_put_out before insert on webhook
  for each row execute function credential_after_put_out();
create trigger credential_after_put_out before insert or update of created_by on room_hook
  for each row execute function credential_after_put_out();
create trigger credential_after_put_out before insert on agent
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
  perform 1 from app_user u where u.actor_id = v_actor for share;
  return query
    update refresh_session s set revoked_at = now()
    where s.token_hash = p_hash and s.revoked_at is null and s.expires_at > now()
    returning s.id, s.actor_id, s.workspace_id;
end $$;

/* --------------------------------------------------------- 2. one put-out */

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
  /* The webhooks it made, agents' among them: off, kept. */
  update webhook set enabled = false, updated_at = now()
  where created_by = p_actor and enabled and deleted_at is null;
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

/* 315's, with the shared step. */
create or replace function auth_claim_email(p_actor uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from instance_setting where id and community and claimed_at is null)
     and exists (select 1 from instance_applicant where actor_id = p_actor) then
    raise exception 'sign_up_closed';
  end if;
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
  select actor_id, email_verified_at is null or email_by_hand into v_actor, v_weak from app_user where email = p_email;
  if v_actor is null then return null; end if;
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
  insert into auth_ticket (token_hash, kind, actor_id, workspace_id, expires_at)
  values (p_reset_hash, 'reset', v_actor, null, now() + interval '1 hour');
  insert into security_event (id, workspace_id, actor_id, kind)
  select gen_random_uuid(), m.workspace_id, v_actor, 'password_reset'
  from membership m
  where m.actor_id = v_actor and m.deleted_at is null and m.joined_at is not null;
  return v_actor;
end $$;

/* 316's, without the second round of ends: the trigger's put-out and a
   refresh in flight are ordered on the account's row now. */
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
  /* The presser's account before the hook, as the trigger below will want
     it: a put-out holds the account and then the account's hooks, and
     taking them the other way round would deadlock with it. */
  perform 1 from app_user u where u.actor_id = current_actor() for share;
  update room_hook h set secret_hash = p_hash, turned_at = now(), created_by = current_actor(), stopped_at = null
  where h.id = p_id and h.deleted_at is null
    and h.workspace_id = current_workspace()
    and can_see_conversation(h.conversation_id);
  get diagnostics n = row_count;
  return n = 1;
end $$;

/*
 * A new token starts a stopped agent again: 269's, and when the agent was
 * stopped, its webhook turned back on and the mark cleared — its
 * connector's one press, the new token shown to them once. An agent not
 * stopped is as before: a webhook off for any other reason stays off.
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
  if found then
    update webhook set enabled = true, updated_at = now()
    where workspace_id = current_workspace() and agent_id = p_agent and deleted_at is null and not enabled;
  end if;
  return true;
end $$;

set local lock_timeout to default;
