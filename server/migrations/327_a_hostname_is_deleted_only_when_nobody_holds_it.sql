/*
 * What the re-review of 326 found.
 *
 * 1. A Cloudflare hostname is deleted only when no row holds its id, asked
 *    under a lock on that id which every write that sets an id takes too:
 *    the delete and an adoption can no longer cross.
 * 2. A miss counts once in twenty-four hours since the last one counted,
 *    not once a calendar day.
 * 3. Whether a browser already holds a live code for an address on a name,
 *    so asking again from it is never refused by a ceiling somebody else
 *    can spend.
 */

/* ---------------------------------------------------- 1. one id, one lock */

create function domain_cf_free(p_cloudflare_id text) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtext('domain_cf:' || p_cloudflare_id));
  return not exists (select 1 from workspace_domain d where d.cloudflare_id = p_cloudflare_id);
end $$;
revoke execute on function domain_cf_free(text) from public;
grant execute on function domain_cf_free(text) to tracker_app, tracker_worker;

create or replace function domain_take(p_id uuid)
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
  select max(d.cloudflare_id) into v_cf from workspace_domain d
  where d.hostname = v_row.hostname and d.id <> p_id and d.status <> 'waiting';
  if v_cf is not null then
    perform pg_advisory_xact_lock(hashtext('domain_cf:' || v_cf));
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

/* ------------------------------------------------- 2. one miss a day, by the clock */

alter table workspace_domain add column if not exists missed_at timestamptz;

create or replace function domain_note(p_id uuid, p_status text, p_cloudflare_id text, p_problem text, p_missed boolean)
returns smallint
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_misses smallint;
  v_counts boolean;
begin
  if p_cloudflare_id is not null then
    perform pg_advisory_xact_lock(hashtext('domain_cf:' || p_cloudflare_id));
  end if;
  select p_missed is true and (d.missed_at is null or d.missed_at <= now() - interval '24 hours') into v_counts
  from workspace_domain d where d.id = p_id;
  update workspace_domain d
  set status = p_status,
      cloudflare_id = p_cloudflare_id,
      problem = left(p_problem, 400),
      misses = case
        when p_missed is null then d.misses
        when not p_missed then 0
        when v_counts then d.misses + 1
        else d.misses end,
      missed_at = case when v_counts then now() when p_missed is false then null else d.missed_at end,
      checked_at = now(),
      status_at = case when d.status = p_status then d.status_at else now() end,
      connected_at = case when p_status = 'connected' and d.status <> 'connected' then now() else d.connected_at end
  where d.id = p_id and domain_mine(d.workspace_id)
  returning d.misses into v_misses;
  return v_misses;
end $$;

alter table workspace_domain drop column if exists missed_on;

/* ------------------------------------------------ 3. a live code of one's own */

create function host_code_live(p_domain uuid, p_email citext, p_browser text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from host_code c
                 where c.domain_id = p_domain and c.email = p_email and c.browser = p_browser
                   and c.spent_at is null and c.expires_at > now())
$$;
revoke execute on function host_code_live(uuid, citext, text) from public;
grant execute on function host_code_live(uuid, citext, text) to tracker_auth;
