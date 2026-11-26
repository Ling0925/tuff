/*
 * A workspace's own address.
 *
 * One row a claim, `workspace_domain`: a name the owner typed and a target
 * only this claim was ever given. Nothing is exclusive until DNS says so,
 * so any number of workspaces may wait on one name; only a row past
 * `waiting` holds it. Read by the workspace's people under the policies;
 * written only through the functions below, which ask that the one asking
 * owns the workspace — or is the worker, which keeps the clock.
 *
 * Across workspaces, a request reaches a row only by the name that opens
 * it (`host_workspace`) or, for a provider's hand-off, by the id it sealed
 * itself (`host_domain`).
 *
 * And the two things a session made on that name needs: the name, kept on
 * its refresh row through every refresh, and the one-time codes that are
 * the only way to sign in there without a provider — no password is ever
 * typed on a host.
 */

create table workspace_domain (
  id             uuid primary key,
  workspace_id   uuid not null references workspace(id) on delete cascade,
  hostname       text not null check (hostname ~ '^[a-z0-9.-]{4,253}$'),
  /* `ws-` and twelve random characters: never given twice. */
  target         text not null unique check (target ~ '^ws-[a-z0-9]{12}$'),
  status         text not null default 'waiting'
                 check (status in ('waiting', 'issuing', 'connected', 'paused', 'released')),
  cloudflare_id  text,
  /* Cloudflare's, or our check's, in words a person reads. */
  problem        text check (char_length(problem) <= 400),
  /* The checks running that did not find our CNAME — three, and it goes. */
  misses         smallint not null default 0,
  icon_key       text,
  touch_icon_key text,
  created_by     uuid not null references actor(id),
  created_at     timestamptz not null default now(),
  checked_at     timestamptz,
  connected_at   timestamptz,
  status_at      timestamptz not null default now()
);
/* One name is one custom hostname in the zone: held by one row past waiting. */
create unique index workspace_domain_held on workspace_domain (hostname) where status <> 'waiting';
/* One claim a workspace, but the released one still redirecting. */
create unique index workspace_domain_one on workspace_domain (workspace_id) where status <> 'released';
create index workspace_domain_name on workspace_domain (hostname);

alter table workspace_domain enable row level security;
create policy wd_read on workspace_domain for select to tracker_app
  using (workspace_id in (select staff_workspaces())
         and (current_workspace() is null or workspace_id = current_workspace()));
grant select on workspace_domain to tracker_app;

/* Whoever may write a row: the workspace's owner, or the worker. */
create function domain_mine(p_workspace uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select session_user = 'tracker_worker' or p_workspace in (select owned_workspaces())
$$;
revoke execute on function domain_mine(uuid) from public;

/*
 * A claim: a waiting row with its target, replacing this workspace's claim
 * that is not yet connected. `hostname_in_use` when another workspace holds
 * the name past waiting; `domain_exists` while this one is connected or
 * paused. Answers the new row's id and the Cloudflare ids of the claims it
 * replaced, for the server to delete there.
 */
create function domain_claim(p_workspace uuid, p_id uuid, p_hostname text, p_target text)
returns table (id uuid, dropped text[])
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_dropped text[];
begin
  if not (p_workspace in (select owned_workspaces())) then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('workspace_domain:' || p_hostname));
  if exists (select 1 from workspace_domain d
             where d.hostname = p_hostname and d.status <> 'waiting' and d.workspace_id <> p_workspace) then
    raise exception 'hostname_in_use';
  end if;
  if exists (select 1 from workspace_domain d
             where d.workspace_id = p_workspace and d.status in ('connected', 'paused')) then
    raise exception 'domain_exists';
  end if;
  /* The claim it replaces, and a released row of the same name, which a
     claim of it again takes the place of. */
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
revoke execute on function domain_claim(uuid, uuid, text, text) from public;
grant execute on function domain_claim(uuid, uuid, text, text) to tracker_app;

/* A row as the check reads it, with what it needs to know of its workspace. */
create function domain_row(p_id uuid)
returns table (id uuid, workspace_id uuid, hostname text, target text, status text, cloudflare_id text,
               misses smallint, created_at timestamptz, status_at timestamptz,
               workspace_gone boolean, branded boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.id, d.workspace_id, d.hostname, d.target, d.status, d.cloudflare_id, d.misses, d.created_at, d.status_at,
         (w.id is null or w.deleted_at is not null), coalesce(plan_branded(w.plan) and not w.scratch, false)
  from workspace_domain d left join workspace w on w.id = d.workspace_id
  where d.id = p_id and domain_mine(d.workspace_id)
$$;
revoke execute on function domain_row(uuid) from public;
grant execute on function domain_row(uuid) to tracker_app, tracker_worker;

/*
 * What the worker's clock has come round to: waiting and issuing claims
 * every two minutes for their first hour, then every thirty; the rest once
 * a day; and any whose workspace is gone, at once.
 */
create function domains_due(p_limit int)
returns table (id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.id from workspace_domain d left join workspace w on w.id = d.workspace_id
  where session_user = 'tracker_worker'
    and (w.id is null or w.deleted_at is not null
         or d.checked_at is null
         or (d.status in ('waiting', 'issuing') and d.status_at > now() - interval '1 hour'
             and d.checked_at < now() - interval '2 minutes')
         or (d.status in ('waiting', 'issuing') and d.checked_at < now() - interval '30 minutes')
         or d.checked_at < now() - interval '1 day')
  order by d.checked_at nulls first
  limit p_limit
$$;
revoke execute on function domains_due(int) from public;
grant execute on function domains_due(int) to tracker_worker;

/* What a check found, written. The moment of a status is when it changed. */
create function domain_note(p_id uuid, p_status text, p_cloudflare_id text, p_problem text, p_misses smallint)
returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  n int;
begin
  update workspace_domain d
  set status = p_status,
      cloudflare_id = p_cloudflare_id,
      problem = left(p_problem, 400),
      misses = p_misses,
      checked_at = now(),
      status_at = case when d.status = p_status then d.status_at else now() end,
      connected_at = case when p_status = 'connected' and d.status <> 'connected' then now() else d.connected_at end
  where d.id = p_id and domain_mine(d.workspace_id);
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function domain_note(uuid, text, text, text, smallint) from public;
grant execute on function domain_note(uuid, text, text, text, smallint) to tracker_app, tracker_worker;

/*
 * DNS named this claim's own target: the name is this claim's. Another
 * workspace's row past waiting goes — and its custom hostname at Cloudflare
 * is this one's now, since one name is one hostname in the zone — and the
 * other waiting claims are told. Called only after our own lookup saw the
 * CNAME; answers the Cloudflare id taken over, if any.
 */
create function domain_take(p_id uuid) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_row workspace_domain;
  v_cf text;
begin
  select * into v_row from workspace_domain d where d.id = p_id and domain_mine(d.workspace_id);
  if v_row.id is null then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtext('workspace_domain:' || v_row.hostname));
  with gone as (
    delete from workspace_domain d
    where d.hostname = v_row.hostname and d.id <> p_id and d.status <> 'waiting'
    returning d.cloudflare_id
  )
  select max(cloudflare_id) into v_cf from gone;
  update workspace_domain d set problem = 'taken', checked_at = now()
  where d.hostname = v_row.hostname and d.id <> p_id and d.status = 'waiting';
  return v_cf;
end $$;
revoke execute on function domain_take(uuid) from public;
grant execute on function domain_take(uuid) to tracker_app, tracker_worker;

/* Gone, here: answers its Cloudflare id when no other row holds the name. */
create function domain_drop(p_id uuid) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_cf text;
  v_name text;
begin
  delete from workspace_domain d where d.id = p_id and domain_mine(d.workspace_id)
  returning d.cloudflare_id, d.hostname into v_cf, v_name;
  if v_cf is not null and exists (select 1 from workspace_domain d where d.cloudflare_id = v_cf) then
    return null;
  end if;
  return v_cf;
end $$;
revoke execute on function domain_drop(uuid) from public;
grant execute on function domain_drop(uuid) to tracker_app, tracker_worker;

/* The owner's Remove: a name that was answering redirects for a while
   (`released`); one that never answered simply goes. */
create function domain_release(p_workspace uuid)
returns table (released boolean, cloudflare_id text)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_row workspace_domain;
begin
  if not (p_workspace in (select owned_workspaces())) then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  select * into v_row from workspace_domain d where d.workspace_id = p_workspace and d.status <> 'released';
  if v_row.id is null then
    return;
  end if;
  if v_row.status in ('connected', 'paused') then
    update workspace_domain d set status = 'released', status_at = now(), misses = 0 where d.id = v_row.id;
    return query select true, null::text;
  else
    return query select false, domain_drop(v_row.id);
  end if;
end $$;
revoke execute on function domain_release(uuid) from public;
grant execute on function domain_release(uuid) to tracker_app;

/* The two icons Settings drew, by their stored keys. */
create function domain_icons(p_workspace uuid, p_icon text, p_touch text) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  n int;
begin
  update workspace_domain d set icon_key = p_icon, touch_icon_key = p_touch
  where d.workspace_id = p_workspace and d.status = 'connected' and d.workspace_id in (select owned_workspaces());
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function domain_icons(uuid, text, text) from public;
grant execute on function domain_icons(uuid, text, text) to tracker_app;

/*
 * The workspace a name opens, found by the name — as `feedback_page_brand`
 * finds a page by its address. Only a name that was answering (connected,
 * paused or released): `open` only while it is connected, the workspace
 * stands and its plan is branded, read now rather than from the status, so
 * a downgrade turns the host into a redirect at the next request.
 */
create function host_workspace(p_hostname text)
returns table (domain_id uuid, workspace_id uuid, slug text, name text, mark_icon text, mark_tint smallint,
               icon_key text, domain_icon_key text, domain_touch_key text, open boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.id, w.id, w.slug, w.name, w.mark_icon, w.mark_tint, w.icon_key, d.icon_key, d.touch_icon_key,
         d.status = 'connected' and w.deleted_at is null and not w.scratch and plan_branded(w.plan)
  from workspace_domain d join workspace w on w.id = d.workspace_id
  where d.hostname = p_hostname and d.status in ('connected', 'paused', 'released')
  limit 1
$$;
revoke execute on function host_workspace(text) from public;
grant execute on function host_workspace(text) to tracker_app;

/* A connected, branded domain by the id our own server sealed into a
   provider's start — where its ticket may be sent. */
create function host_domain(p_id uuid)
returns table (hostname text, workspace_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.hostname, w.id from workspace_domain d join workspace w on w.id = d.workspace_id
  where d.id = p_id and d.status = 'connected' and w.deleted_at is null and not w.scratch and plan_branded(w.plan)
$$;
revoke execute on function host_domain(uuid) from public;
grant execute on function host_domain(uuid) to tracker_app;

/* A workspace's own address by its id, for the worker's digest only. */
create function workspace_origin(p_workspace uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select d.hostname from workspace_domain d join workspace w on w.id = d.workspace_id
  where d.workspace_id = p_workspace and d.status = 'connected'
    and w.deleted_at is null and not w.scratch and plan_branded(w.plan)
$$;
revoke execute on function workspace_origin(uuid) from public;
grant execute on function workspace_origin(uuid) to tracker_worker;

/* ------------------------------------------------- a session on a host */

/* The name a session was made on, never cleared: every refresh carries it. */
alter table refresh_session add column if not exists host text;

create function auth_session_host(p_session uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select host from refresh_session where id = p_session
$$;
revoke execute on function auth_session_host(uuid) from public;
grant execute on function auth_session_host(uuid) to tracker_auth;

/* The list of devices says where a host's session is. */
drop function auth_sessions(uuid);
create function auth_sessions(p_actor uuid)
returns table (id uuid, device text, user_agent text, ip text, created_at timestamptz,
               last_used_at timestamptz, expires_at timestamptz, sessions int, host text)
language sql stable security definer set search_path = public as $$
  with live as (
    select s.*, coalesce(s.device, s.id::text) as line
    from refresh_session s
    where s.actor_id = p_actor and s.revoked_at is null and s.expires_at > now()
  ),
  newest as (
    select distinct on (line) * from live order by line, created_at desc
  )
  select n.id, n.device, n.user_agent, n.ip, n.created_at, n.last_used_at, n.expires_at,
         (select count(*)::int from live l where l.line = n.line), n.host
  from newest n
  order by n.created_at desc
$$;
revoke execute on function auth_sessions(uuid) from public;
grant execute on function auth_sessions(uuid) to tracker_app;

/* --------------------------------------------- a code to sign in on a host */

/*
 * One a name and an address: asking again replaces it. Bound to the browser
 * that asked (the hash of its `__Host-` cookie) and to the name. `actor_id`
 * is null where the address is nobody this workspace has — the row is made
 * all the same, so the answer and its timing say nothing, and its code was
 * never sent, so nobody can type it.
 */
create table host_code (
  id          uuid primary key,
  domain_id   uuid not null references workspace_domain(id) on delete cascade,
  email       citext not null,
  browser     text not null,
  code_hash   text not null,
  actor_id    uuid references actor(id) on delete cascade,
  tries       smallint not null default 0,
  expires_at  timestamptz not null,
  spent_at    timestamptz,
  created_at  timestamptz not null default now(),
  unique (domain_id, email)
);
alter table host_code enable row level security;
/* No policy and no grant: the functions below are the only way in. */

/*
 * A new code for this address on this name. The account is found here, as
 * the sign-in role finds one: somebody joined to the name's workspace, not
 * an agent. Answers that account, for the server to mail; null for nobody.
 */
create function host_code_make(p_id uuid, p_domain uuid, p_email citext, p_browser text, p_code_hash text)
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
  delete from host_code c where c.domain_id = p_domain and c.email = p_email;
  insert into host_code (id, domain_id, email, browser, code_hash, actor_id, expires_at)
  values (p_id, p_domain, p_email, p_browser, p_code_hash, v_actor, now() + interval '10 minutes');
  return v_actor;
end $$;
revoke execute on function host_code_make(uuid, uuid, citext, text, text) from public;
grant execute on function host_code_make(uuid, uuid, citext, text, text) to tracker_auth;

/*
 * A code typed. Right: the account, the code still good (the second factor
 * may be asked next, with the same code). Wrong: one try counted, and the
 * fifth spends it. Asked of another browser, another name, an expired or a
 * spent code: nothing.
 */
create function host_code_try(p_domain uuid, p_email citext, p_browser text, p_code_hash text)
returns table (actor_id uuid, ok boolean)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_row host_code;
begin
  select * into v_row from host_code c
  where c.domain_id = p_domain and c.email = p_email and c.spent_at is null and c.expires_at > now()
  for update;
  if v_row.id is null or v_row.browser <> p_browser then
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
revoke execute on function host_code_try(uuid, citext, text, text) from public;
grant execute on function host_code_try(uuid, citext, text, text) to tracker_auth;

create function host_code_spend(p_domain uuid, p_email citext, p_code_hash text) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  n int;
begin
  update host_code c set spent_at = now()
  where c.domain_id = p_domain and c.email = p_email and c.code_hash = p_code_hash
    and c.spent_at is null and c.expires_at > now();
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function host_code_spend(uuid, citext, text) from public;
grant execute on function host_code_spend(uuid, citext, text) to tracker_auth;

/* And the clear-out of codes that can no longer be typed. */
create function host_codes_sweep() returns int
language sql volatile security definer set search_path = public, pg_temp as $$
  with gone as (delete from host_code where expires_at < now() - interval '1 day' returning 1)
  select count(*)::int from gone
$$;
revoke execute on function host_codes_sweep() from public;
grant execute on function host_codes_sweep() to tracker_worker;
