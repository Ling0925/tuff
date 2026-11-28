/*
 * What the review of 325 found.
 *
 * 1. A session made on a name ends when the name stops answering for its
 *    workspace: released, paused, dropped, or taken by another workspace's
 *    proof. A trigger, so no path that changes a row can forget.
 * 2. DNS is the truth: a claim whose own target the CNAME names takes the
 *    name from any other workspace's row, whatever its status, and a
 *    waiting claim for a name held elsewhere is allowed — it holds nothing.
 *    The take answers whose workspaces lost the name, with their owners'
 *    addresses, for the letter.
 * 3. A missed DNS check counts at most once a day, and never when neither
 *    resolver answered.
 * 4. A code is one browser's: asking again from another browser does not
 *    erase it.
 * 5. A Cloudflare hostname whose row went by any way — the purge included —
 *    is queued for the worker to delete, unless another row holds it.
 */

/* ------------------------------------------- 1. sessions end with the name */

create function domain_sessions_end() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.status = 'connected' and (tg_op = 'DELETE' or new.status <> 'connected') then
    update refresh_session set revoked_at = coalesce(revoked_at, now()), ended_at = now()
    where host = old.hostname and workspace_id = old.workspace_id and ended_at is null;
  end if;
  return null;
end $$;
revoke execute on function domain_sessions_end() from public;
create trigger workspace_domain_sessions_end
  after update of status or delete on workspace_domain
  for each row execute function domain_sessions_end();

/* --------------------------------------------- 5. a hostname to delete later */

create table domain_gone (
  cloudflare_id text primary key,
  at            timestamptz not null default now()
);
alter table domain_gone enable row level security;
/* No policy and no grant: the trigger fills it, the worker's functions drain it. */

create function domain_gone_queue() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.cloudflare_id is not null
     and not exists (select 1 from workspace_domain d where d.cloudflare_id = old.cloudflare_id and d.id <> old.id) then
    insert into domain_gone (cloudflare_id) values (old.cloudflare_id) on conflict do nothing;
  end if;
  return old;
end $$;
revoke execute on function domain_gone_queue() from public;
create trigger workspace_domain_gone
  before delete on workspace_domain
  for each row execute function domain_gone_queue();

create function domains_gone(p_limit int) returns table (cloudflare_id text)
language sql stable security definer set search_path = public, pg_temp as $$
  select g.cloudflare_id from domain_gone g
  where session_user = 'tracker_worker'
    and not exists (select 1 from workspace_domain d where d.cloudflare_id = g.cloudflare_id)
  order by g.at limit p_limit
$$;
revoke execute on function domains_gone(int) from public;
grant execute on function domains_gone(int) to tracker_worker;

create function domain_gone_done(p_cloudflare_id text) returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  delete from domain_gone where cloudflare_id = p_cloudflare_id and session_user = 'tracker_worker'
$$;
revoke execute on function domain_gone_done(text) from public;
grant execute on function domain_gone_done(text) to tracker_worker;

/* ----------------------------------------------------- 2. DNS is the truth */

create or replace function domain_claim(p_workspace uuid, p_id uuid, p_hostname text, p_target text)
returns table (id uuid, dropped text[])
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_dropped text[];
begin
  if not (p_workspace in (select owned_workspaces())) then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('workspace_domain:ws:' || p_workspace::text));
  if exists (select 1 from workspace_domain d
             where d.workspace_id = p_workspace and d.status in ('connected', 'paused')) then
    raise exception 'domain_exists';
  end if;
  with gone as (
    delete from workspace_domain d
    where d.workspace_id = p_workspace
      and (d.status in ('waiting', 'issuing') or (d.status = 'released' and d.hostname = p_hostname))
    returning d.cloudflare_id
  )
  select coalesce(array_agg(cloudflare_id) filter (where cloudflare_id is not null), '{}') into v_dropped from gone;
  insert into workspace_domain (id, workspace_id, hostname, target, created_by)
  values (p_id, p_workspace, p_hostname, p_target, current_actor());
  return query select p_id, v_dropped;
end $$;

/* Who loses the name, and how to tell them: answered by the take itself,
   one row an owner of a workspace that lost it. The hostname at Cloudflare
   it took over is on this claim's own row afterwards. */
drop function domain_take(uuid);
create function domain_take(p_id uuid)
returns table (cloudflare_id text, workspace_id uuid, workspace_name text, actor_id uuid, email text)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_row workspace_domain;
  v_cf text;
begin
  select * into v_row from workspace_domain d where d.id = p_id and domain_mine(d.workspace_id);
  if v_row.id is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('workspace_domain:' || v_row.hostname));
  /* The hostname at Cloudflare is this row's before the others go, so the
     queue of hostnames to delete never takes it. */
  select max(d.cloudflare_id) into v_cf from workspace_domain d
  where d.hostname = v_row.hostname and d.id <> p_id and d.status <> 'waiting';
  if v_cf is not null then
    update workspace_domain d set cloudflare_id = v_cf where d.id = p_id;
  end if;
  return query
    with lost as (
      select d.workspace_id as ws from workspace_domain d
      where d.hostname = v_row.hostname and d.id <> p_id and d.status <> 'waiting'
    )
    select v_cf, w.id, w.name, m.actor_id, u.email::text
    from lost l join workspace w on w.id = l.ws
    join membership m on m.workspace_id = w.id and m.role = 'owner' and m.deleted_at is null and m.joined_at is not null
    join app_user u on u.actor_id = m.actor_id;
  delete from workspace_domain d
  where d.hostname = v_row.hostname and d.id <> p_id and d.status <> 'waiting';
  update workspace_domain d set problem = 'taken', checked_at = now()
  where d.hostname = v_row.hostname and d.id <> p_id and d.status = 'waiting';
end $$;
revoke execute on function domain_take(uuid) from public;
grant execute on function domain_take(uuid) to tracker_app, tracker_worker;

/* A workspace's owners and their addresses, for the letter about its own
   domain — asked by its owner or the worker only. */
create function domain_owners(p_id uuid)
returns table (workspace_id uuid, workspace_name text, actor_id uuid, email text)
language sql stable security definer set search_path = public, pg_temp as $$
  select w.id, w.name, m.actor_id, u.email::text
  from workspace_domain d join workspace w on w.id = d.workspace_id
  join membership m on m.workspace_id = w.id and m.role = 'owner' and m.deleted_at is null and m.joined_at is not null
  join app_user u on u.actor_id = m.actor_id
  where d.id = p_id and domain_mine(d.workspace_id)
$$;
revoke execute on function domain_owners(uuid) from public;
grant execute on function domain_owners(uuid) to tracker_app, tracker_worker;

/* ------------------------------------------- 3. one miss a day, at most */

alter table workspace_domain add column if not exists missed_on date;

/*
 * `p_missed`: true when our lookup found no CNAME naming the target, false
 * when it did, null when neither resolver answered — which counts nothing.
 * A miss counts once a day. Answers the misses as written.
 */
drop function domain_note(uuid, text, text, text, smallint);
create function domain_note(p_id uuid, p_status text, p_cloudflare_id text, p_problem text, p_missed boolean)
returns smallint
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_misses smallint;
begin
  update workspace_domain d
  set status = p_status,
      cloudflare_id = p_cloudflare_id,
      problem = left(p_problem, 400),
      misses = case
        when p_missed is null then d.misses
        when not p_missed then 0
        when d.missed_on is distinct from current_date then d.misses + 1
        else d.misses end,
      missed_on = case when p_missed then current_date when p_missed is false then null else d.missed_on end,
      checked_at = now(),
      status_at = case when d.status = p_status then d.status_at else now() end,
      connected_at = case when p_status = 'connected' and d.status <> 'connected' then now() else d.connected_at end
  where d.id = p_id and domain_mine(d.workspace_id)
  returning d.misses into v_misses;
  return v_misses;
end $$;
revoke execute on function domain_note(uuid, text, text, text, boolean) from public;
grant execute on function domain_note(uuid, text, text, text, boolean) to tracker_app, tracker_worker;

/* ------------------------------------------------ 4. a code is one browser's */

alter table host_code drop constraint if exists host_code_domain_id_email_key;
alter table host_code add constraint host_code_one_browser unique (domain_id, email, browser);

create or replace function host_code_make(p_id uuid, p_domain uuid, p_email citext, p_browser text, p_code_hash text)
returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_workspace uuid;
  v_actor uuid;
begin
  select workspace_id into v_workspace from host_domain(p_domain);
  if v_workspace is null then
    return null;
  end if;
  select u.actor_id into v_actor from app_user u
  join membership m on m.actor_id = u.actor_id
  where u.email = p_email and u.email_verified_at is not null and m.workspace_id = v_workspace
    and m.deleted_at is null and m.joined_at is not null and m.role in ('owner', 'member')
  limit 1;
  /* This browser's earlier code for this address, and nobody else's. */
  delete from host_code c where c.domain_id = p_domain and c.email = p_email and c.browser = p_browser;
  insert into host_code (id, domain_id, email, browser, code_hash, actor_id, expires_at)
  values (p_id, p_domain, p_email, p_browser, p_code_hash, v_actor, now() + interval '10 minutes')
  on conflict on constraint host_code_one_browser do update
    set id = excluded.id, code_hash = excluded.code_hash, actor_id = excluded.actor_id,
        tries = 0, spent_at = null, expires_at = excluded.expires_at, created_at = now();
  return v_actor;
end $$;

create or replace function host_code_try(p_domain uuid, p_email citext, p_browser text, p_code_hash text)
returns table (actor_id uuid, ok boolean)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_row host_code;
begin
  select * into v_row from host_code c
  where c.domain_id = p_domain and c.email = p_email and c.browser = p_browser
    and c.spent_at is null and c.expires_at > now()
  for update;
  if v_row.id is null then
    return;
  end if;
  if v_row.code_hash = p_code_hash and v_row.actor_id is not null then
    return query select v_row.actor_id, true;
    return;
  end if;
  update host_code c set tries = c.tries + 1,
         spent_at = case when c.tries + 1 >= 5 then now() else null end
  where c.id = v_row.id;
  return query select null::uuid, false;
end $$;

drop function host_code_spend(uuid, citext, text);
create function host_code_spend(p_domain uuid, p_email citext, p_browser text, p_code_hash text) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  n int;
begin
  update host_code c set spent_at = now()
  where c.domain_id = p_domain and c.email = p_email and c.browser = p_browser and c.code_hash = p_code_hash
    and c.spent_at is null and c.expires_at > now();
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function host_code_spend(uuid, citext, text, text) from public;
grant execute on function host_code_spend(uuid, citext, text, text) to tracker_auth;
