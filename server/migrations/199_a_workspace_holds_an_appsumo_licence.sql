/*
 * A lifetime Team from AppSumo.
 *
 * AppSumo keeps the licence keys and tells us by a signed webhook what
 * happens to each; the buyer proves which key is theirs through AppSumo's
 * OAuth, which this server trades for a claim; the workspace's owner applies
 * the claim with a press. Three tables, none of them the application role's
 * to read or write: the webhooks write through `appsumo_hear` (there is no
 * actor behind one), the redeeming through `appsumo_redeem`, the press
 * through `appsumo_apply`, which checks on the rows who is asking.
 */

/* Every key AppSumo told us about, or that its Licensing API vouched for. */
create table appsumo_licence (
  license_key      text primary key check (length(license_key) between 1 and 100),
  status           text not null check (status in ('inactive', 'active', 'deactivated')),
  tier             int,
  prev_license_key text,
  /* The key an upgrade or a downgrade put in this one's place. */
  replaced_by      text,
  workspace_id     uuid references workspace(id) on delete set null,
  applied_at       timestamptz,
  applied_by       uuid references actor(id) on delete set null,
  /* The newest event applied, as AppSumo orders them: its `created_at`,
     and on a tie how far along a key's life the event is. Null for a key
     learned from the Licensing API, which any event then moves. */
  heard_at         timestamptz,
  heard_rank       int,
  /* The worker's daily word from the Licensing API on a key that holds a
     workspace: when it last asked, and since when AppSumo has not known
     the key — once is a hiccup, twice a day apart is an end. */
  checked_at       timestamptz,
  missing_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
/* Codes do not stack: one live key per workspace, said by the schema. */
create unique index appsumo_licence_holds on appsumo_licence (workspace_id)
  where workspace_id is not null and status = 'active';
create index appsumo_licence_due on appsumo_licence (checked_at nulls first)
  where workspace_id is not null and status = 'active';
alter table appsumo_licence enable row level security;
revoke all on appsumo_licence from tracker_app;

/* Every delivery believed, kept — AppSumo asks for all of it. A retry of
   the same event is the same row. */
create table appsumo_event (
  id          uuid primary key default gen_random_uuid(),
  license_key text not null,
  event       text not null,
  happened_at timestamptz not null,
  sent_at     timestamptz,
  test        boolean not null default false,
  outcome     text not null check (outcome in ('applied', 'older', 'test', 'ignored')),
  body        jsonb not null,
  received_at timestamptz not null default now()
);
create unique index appsumo_event_once on appsumo_event (license_key, event, happened_at, test);
create index appsumo_event_key on appsumo_event (license_key, happened_at desc);
alter table appsumo_event enable row level security;
revoke all on appsumo_event from tracker_app;

/* A key proved by AppSumo's OAuth, waiting for the press: its hash, for an
   hour, for one key. The secret itself is only ever in the browser. */
create table appsumo_claim (
  hash        text primary key check (hash ~ '^[0-9a-f]{64}$'),
  license_key text not null references appsumo_licence(license_key) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index appsumo_claim_expires on appsumo_claim (expires_at);
alter table appsumo_claim enable row level security;
revoke all on appsumo_claim from tracker_app;

/*
 * What a workspace's plan is, now that a key holds it or stopped holding
 * it — the one place that decides, called by everything below and by
 * `billing_apply`.
 *
 * A live Polar subscription decides by itself — a lifetime Team may be
 * paid up to Company or Unlimited on top, and the key stays bound under
 * it. A gift is the operator's business: the plan stays, and what it goes
 * back to (`before`) is the key's Team while a key holds the workspace,
 * Duo when none does. Without either, the key's Team — whatever a Polar
 * plan that just ended had raised it to — or Duo.
 */
create function appsumo_settle(p_workspace uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_holds boolean;
  v_plan text;
begin
  v_holds := exists (
    select 1 from appsumo_licence where workspace_id = p_workspace and status = 'active'
  );
  if not exists (
    select 1 from billing_subscription where workspace_id = p_workspace and billing_live(status)
  ) then
    if exists (select 1 from plan_gift where workspace_id = p_workspace) then
      update plan_gift set before = case when v_holds then 'team' else 'solo' end
      where workspace_id = p_workspace;
    elsif v_holds then
      update workspace set plan = 'team', updated_at = now()
      where id = p_workspace and plan <> 'team';
    else
      update workspace set plan = 'solo', updated_at = now()
      where id = p_workspace and plan in ('team', 'company', 'unlimited');
    end if;
  end if;
  select plan into v_plan from workspace where id = p_workspace;
  return v_plan;
end $$;
revoke all on function appsumo_settle(uuid) from public;

/*
 * What AppSumo's webhook said, applied — believed already: the handler
 * checked the signature. Answers what became of it: `applied`, `older`
 * (a newer event for the key is already in), `repeat` (a retry of one
 * already kept), `test` or `ignored`.
 */
create function appsumo_hear(
  p_key text, p_prev text, p_event text, p_happened timestamptz, p_sent timestamptz,
  p_tier int, p_test boolean, p_body jsonb
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_rank int := case p_event when 'purchase' then 0 when 'deactivate' then 2 else 1 end;
  v_row appsumo_licence%rowtype;
  v_prev appsumo_licence%rowtype;
  v_ws uuid;
  v_outcome text;
begin
  v_outcome := case
    when p_test then 'test'
    when p_event in ('purchase', 'activate', 'upgrade', 'downgrade', 'deactivate') then 'applied'
    else 'ignored' end;
  insert into appsumo_event (license_key, event, happened_at, sent_at, test, outcome, body)
  values (p_key, p_event, p_happened, p_sent, coalesce(p_test, false), v_outcome, p_body)
  on conflict (license_key, event, happened_at, test) do nothing;
  if not found then return 'repeat'; end if;
  if v_outcome <> 'applied' then return v_outcome; end if;

  insert into appsumo_licence (license_key, status, tier, prev_license_key)
  values (p_key, 'inactive', p_tier, p_prev)
  on conflict (license_key) do nothing;
  if p_event in ('upgrade', 'downgrade') and p_prev is not null and p_prev <> p_key then
    insert into appsumo_licence (license_key, status) values (p_prev, 'deactivated')
    on conflict (license_key) do nothing;
  end if;
  /* Locks in one order everywhere: the keys, by key, then the workspace
     (`appsumo_settle` writes it) — as `appsumo_apply` takes the key before
     the workspace, so the two never wait on each other in a ring. */
  perform 1 from appsumo_licence
  where license_key = p_key
     or (p_event in ('upgrade', 'downgrade') and license_key = p_prev)
  order by license_key
  for update;
  select * into v_row from appsumo_licence where license_key = p_key;
  if v_row.heard_at is not null and (v_row.heard_at, v_row.heard_rank) > (p_happened, v_rank) then
    update appsumo_event set outcome = 'older'
    where license_key = p_key and event = p_event and happened_at = p_happened and not test;
    return 'older';
  end if;

  update appsumo_licence set
    heard_at = p_happened, heard_rank = v_rank,
    tier = coalesce(p_tier, tier),
    prev_license_key = coalesce(p_prev, prev_license_key),
    status = case p_event when 'purchase' then status when 'deactivate' then 'deactivated' else 'active' end,
    /* A key ended and live again, whose workspace has taken another key
       since: it lets the workspace go rather than hold it twice. */
    workspace_id = case
      when p_event in ('activate', 'upgrade', 'downgrade') and status <> 'active' and workspace_id is not null
           and exists (select 1 from appsumo_licence o
                       where o.workspace_id = appsumo_licence.workspace_id and o.status = 'active'
                         and o.license_key <> p_key)
      then null else workspace_id end,
    updated_at = now()
  where license_key = p_key
  returning * into v_row;

  /* A new key in the old one's place, on the same workspace — unless that
     workspace has taken another key since, which keeps it. The old key is
     over either way: it is AppSumo's no longer, so it is ended here rather
     than left live until its own `deactivate`, which may come late or not
     at all — a live key held by nobody is one a second claim for it could
     still apply, and one the new key held elsewhere would double. Its own
     `deactivate` then changes nothing. */
  if p_event in ('upgrade', 'downgrade') and p_prev is not null and p_prev <> p_key then
    select * into v_prev from appsumo_licence where license_key = p_prev;
    if v_row.workspace_id is null and v_prev.workspace_id is not null and not exists (
      select 1 from appsumo_licence
      where workspace_id = v_prev.workspace_id and status = 'active' and license_key <> p_prev
    ) then
      update appsumo_licence set workspace_id = null, updated_at = now()
      where license_key = p_prev;
      update appsumo_licence set workspace_id = v_prev.workspace_id, applied_at = now(),
                                 applied_by = v_prev.applied_by, updated_at = now()
      where license_key = p_key
      returning * into v_row;
      insert into security_event (id, workspace_id, actor_id, kind, meta)
      values (gen_random_uuid(), v_row.workspace_id, null, 'appsumo.replace',
              jsonb_build_object('key', right(p_key, 8), 'was', right(p_prev, 8), 'event', p_event));
      v_prev.workspace_id := null;
    end if;
    update appsumo_licence set
      status = 'deactivated', replaced_by = coalesce(replaced_by, p_key),
      heard_rank = case when heard_at is null or (heard_at, heard_rank) < (p_happened, 2) then 2 else heard_rank end,
      heard_at = case when heard_at is null or (heard_at, heard_rank) < (p_happened, 2) then p_happened else heard_at end,
      updated_at = now()
    where license_key = p_prev;
    /* Not moved — the new key went to another workspace, or this one took
       another key — so the workspace the old key held loses it now. */
    if v_prev.workspace_id is not null and v_prev.status = 'active' then
      perform appsumo_settle(v_prev.workspace_id);
      insert into security_event (id, workspace_id, actor_id, kind, meta)
      values (gen_random_uuid(), v_prev.workspace_id, null, 'appsumo.end',
              jsonb_build_object('key', right(p_prev, 8), 'event', p_event));
    end if;
  end if;

  v_ws := v_row.workspace_id;
  if v_ws is not null then
    perform appsumo_settle(v_ws);
    if p_event = 'deactivate' then
      insert into security_event (id, workspace_id, actor_id, kind, meta)
      values (gen_random_uuid(), v_ws, null, 'appsumo.end', jsonb_build_object('key', right(p_key, 8)));
    end if;
  end if;
  return 'applied';
end $$;
revoke all on function appsumo_hear(text, text, text, timestamptz, timestamptz, int, boolean, jsonb) from public;
grant execute on function appsumo_hear(text, text, text, timestamptz, timestamptz, int, boolean, jsonb) to tracker_app;

/* What we know of a key, for the redeeming to decide whether to ask
   AppSumo's Licensing API: null when we never heard of it. */
create function appsumo_status(p_key text) returns text
language sql stable security definer set search_path = public as $$
  select status from appsumo_licence where license_key = p_key
$$;
revoke all on function appsumo_status(text) from public;
grant execute on function appsumo_status(text) to tracker_app;

/*
 * A key proved by AppSumo's OAuth, made into a claim — `p_hash` is the
 * claim's hash, the claim itself never reaches the database. `p_learned`
 * is what the Licensing API said when our row was missing or still
 * inactive, null when it was not asked or did not answer.
 *
 * Answers `{ status }`: `ready` with the claim kept for an hour; `used`
 * with the workspace that holds the key, by name; `inactive`; `unknown`.
 */
create function appsumo_redeem(p_key text, p_hash text, p_learned text, p_tier int) returns json
language plpgsql security definer set search_path = public as $$
declare
  v appsumo_licence%rowtype;
  w record;
begin
  delete from appsumo_claim where expires_at < now() - interval '1 day';
  select * into v from appsumo_licence where license_key = p_key for update;
  if not found then
    if p_learned is null then return json_build_object('status', 'unknown'); end if;
    if p_learned <> 'active' then return json_build_object('status', 'inactive'); end if;
    /* A webhook that has not arrived yet is not a refusal: AppSumo's own
       word on the key stands in for it, and the webhook moves it after. */
    insert into appsumo_licence (license_key, status, tier) values (p_key, 'active', p_tier)
    on conflict (license_key) do nothing;
    select * into v from appsumo_licence where license_key = p_key for update;
  elsif v.status = 'inactive' and p_learned = 'active' then
    update appsumo_licence set status = 'active', tier = coalesce(p_tier, tier), updated_at = now()
    where license_key = p_key
    returning * into v;
  end if;
  if v.status <> 'active' then return json_build_object('status', 'inactive'); end if;
  if v.workspace_id is not null then
    select name, slug::text as slug into w from workspace where id = v.workspace_id;
    return json_build_object('status', 'used', 'workspace', json_build_object('name', w.name, 'slug', w.slug));
  end if;
  insert into appsumo_claim (hash, license_key, expires_at) values (p_hash, p_key, now() + interval '1 hour');
  return json_build_object('status', 'ready');
end $$;
revoke all on function appsumo_redeem(text, text, text, int) from public;
grant execute on function appsumo_redeem(text, text, text, int) to tracker_app;

/*
 * The press: a claim applied to a workspace, by whoever is asking
 * (`current_actor()`), every condition checked here on the rows and under
 * locks rather than in the handler. Answers `{ ok: true, plan }` or
 * `{ ok: false, why }` — `claim` (missing, used or out of time),
 * `not_found` (not the asker's to own, gone, or a board's), `inactive`,
 * `used`, `stacked` (the workspace holds a key already) or `paying` (a
 * live Polar subscription — it would be paying twice).
 */
create function appsumo_apply(p_hash text, p_workspace uuid, p_ip text, p_agent text) returns json
language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_actor();
  c appsumo_claim%rowtype;
  v appsumo_licence%rowtype;
begin
  if me is null then return json_build_object('ok', false, 'why', 'not_found'); end if;
  select * into c from appsumo_claim where hash = p_hash for update;
  if not found or c.used_at is not null or c.expires_at <= now() then
    return json_build_object('ok', false, 'why', 'claim');
  end if;
  /* The key before the workspace, as `appsumo_hear` takes them. */
  select * into v from appsumo_licence where license_key = c.license_key for update;
  perform 1 from workspace w
  join membership m on m.workspace_id = w.id
  where w.id = p_workspace and w.deleted_at is null and not w.scratch
    and m.actor_id = me and m.role = 'owner' and m.deleted_at is null and m.joined_at is not null
  for update of w;
  if not found then return json_build_object('ok', false, 'why', 'not_found'); end if;

  if v.status <> 'active' then return json_build_object('ok', false, 'why', 'inactive'); end if;
  if v.workspace_id is not null then return json_build_object('ok', false, 'why', 'used'); end if;
  if exists (select 1 from appsumo_licence where workspace_id = p_workspace and status = 'active') then
    return json_build_object('ok', false, 'why', 'stacked');
  end if;
  if exists (select 1 from billing_subscription where workspace_id = p_workspace and billing_live(status)) then
    return json_build_object('ok', false, 'why', 'paying');
  end if;

  update appsumo_licence set workspace_id = p_workspace, applied_at = now(), applied_by = me, updated_at = now()
  where license_key = v.license_key;
  /* Every claim for the key is spent, not only this one: a key is applied
     once, and a copy kept back is not a second chance at it. One another
     press holds is skipped rather than waited for — that press finds the
     key held, and waiting would cross its locks. */
  update appsumo_claim set used_at = now()
  where hash in (select hash from appsumo_claim
                 where license_key = v.license_key and used_at is null
                 for update skip locked);
  perform appsumo_settle(p_workspace);
  insert into security_event (id, workspace_id, actor_id, kind, ip, user_agent, meta)
  values (gen_random_uuid(), p_workspace, me, 'appsumo.apply', p_ip, p_agent,
          jsonb_build_object('key', right(v.license_key, 8)));
  return json_build_object('ok', true, 'plan', (select plan from workspace where id = p_workspace));
end $$;
revoke all on function appsumo_apply(text, uuid, text, text) from public;
grant execute on function appsumo_apply(text, uuid, text, text) to tracker_app;

/* The owner's view of the key that holds their workspace, for Billing:
   when it was applied, and nothing of the key itself. */
create function appsumo_of(p_workspace uuid) returns table (since timestamptz)
language sql stable security definer set search_path = public as $$
  select l.applied_at from appsumo_licence l
  where l.workspace_id = p_workspace and l.status = 'active' and role_in(p_workspace) = 'owner'
  limit 1
$$;
revoke all on function appsumo_of(uuid) from public;
grant execute on function appsumo_of(uuid) to tracker_app;

/*
 * The worker's daily look at every key that holds a workspace — a refund
 * whose webhook never came still ends the key. `appsumo_due` names the
 * keys not asked about for a day, oldest first; `appsumo_checked` takes
 * what the Licensing API said: `active` is fine, `deactivated` ends the key
 * as AppSumo's own `deactivate` would (through `appsumo_hear`, written to
 * the log), and `missing` ends it only when AppSumo did not know it a day
 * ago either. The worker's role only.
 */
create function appsumo_due(p_limit int) returns setof text
language sql stable security definer set search_path = public as $$
  select license_key from appsumo_licence
  where workspace_id is not null and status = 'active'
    and (checked_at is null or checked_at < now() - interval '1 day')
  order by checked_at nulls first, license_key
  limit least(greatest(p_limit, 1), 100)
$$;
revoke all on function appsumo_due(int) from public;
grant execute on function appsumo_due(int) to tracker_worker;

create function appsumo_checked(p_key text, p_said text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v appsumo_licence%rowtype;
begin
  select * into v from appsumo_licence where license_key = p_key for update;
  if not found or v.status <> 'active' then return 'gone'; end if;
  if p_said = 'deactivated'
     or (p_said = 'missing' and v.missing_at is not null and v.missing_at < now() - interval '20 hours') then
    update appsumo_licence set checked_at = now() where license_key = p_key;
    perform appsumo_hear(p_key, null, 'deactivate', clock_timestamp(), null, null, false,
                         jsonb_build_object('source', 'licensing_check', 'said', p_said));
    return 'ended';
  end if;
  /* `unsure`: AppSumo did not know the key, but did not know the one it
     still knew yesterday either — a wrong key, a moved path, an error page
     — so the 404 says nothing about this key, and is not counted. */
  update appsumo_licence set
    checked_at = now(),
    missing_at = case p_said when 'missing' then coalesce(missing_at, now())
                             when 'unsure' then missing_at else null end
  where license_key = p_key;
  return case when p_said in ('missing', 'unsure') then p_said else 'active' end;
end $$;
revoke all on function appsumo_checked(text, text) from public;
grant execute on function appsumo_checked(text, text) to tracker_worker;

/* Another key AppSumo knew at its last check, asked whenever one comes
   back 404: if AppSumo does not know that one either, the 404 is the
   Licensing API's, not the key's. */
create function appsumo_canary(p_key text) returns text
language sql stable security definer set search_path = public as $$
  select license_key from appsumo_licence
  where workspace_id is not null and status = 'active' and license_key <> p_key
    and checked_at is not null and missing_at is null
  order by checked_at desc
  limit 1
$$;
revoke all on function appsumo_canary(text) from public;
grant execute on function appsumo_canary(text) to tracker_worker;

/*
 * `billing_apply` as migration 110 wrote it, with its last step handed to
 * `appsumo_settle`: a Polar subscription that ends leaves the key's Team
 * where a key holds the workspace, not Duo.
 */
create or replace function billing_apply(
  p_id text, p_workspace uuid, p_customer text, p_product text, p_plan text, p_period text,
  p_status text, p_period_end timestamptz, p_cancel boolean, p_ended timestamptz, p_modified timestamptz
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_live record;
begin
  if not exists (select 1 from workspace where id = p_workspace and deleted_at is null) then
    return null;
  end if;
  insert into billing_subscription as b
    (id, workspace_id, customer_id, product_id, plan, period, status,
     current_period_end, cancel_at_period_end, ended_at, modified_at)
  values (p_id, p_workspace, p_customer, p_product, p_plan, p_period, p_status,
          p_period_end, coalesce(p_cancel, false), p_ended, p_modified)
  on conflict (id) do update set
    product_id = excluded.product_id, plan = excluded.plan, period = excluded.period,
    status = excluded.status, current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end, ended_at = excluded.ended_at,
    modified_at = excluded.modified_at, updated_at = now()
  where b.modified_at <= excluded.modified_at and b.workspace_id = excluded.workspace_id;
  if not found then
    return null;
  end if;

  select * into v_live from billing_subscription
  where workspace_id = p_workspace and billing_live(status)
  order by modified_at desc limit 1;

  if v_live.id is not null then
    delete from plan_gift where workspace_id = p_workspace;
    update workspace set plan = v_live.plan, updated_at = now() where id = p_workspace;
    return v_live.plan;
  end if;
  -- Nothing paid for any more: a gift's plan, the key's Team, or Duo.
  return appsumo_settle(p_workspace);
end $$;

/* The operators' list, as migration 192 left it, and the key that holds
   each workspace — for support. */
drop function operator_workspaces(text, timestamptz, uuid, integer, uuid);
create function operator_workspaces(p_q text, p_before_at timestamptz, p_before_id uuid, p_limit integer, p_only uuid default null)
returns table(id uuid, name text, slug text, plan text, created_at timestamptz, mark_icon text, mark_tint smallint, icon_key text,
              owner_id uuid, owner_name text, owner_email text, people integer, projects integer, bytes bigint,
              gift_until timestamptz, gifted boolean, appsumo_key text, appsumo_since timestamptz)
language sql stable security definer set search_path = public as $$
  select w.id, w.name, w.slug::text, w.plan, w.created_at,
         w.mark_icon, w.mark_tint, w.icon_key,
         o.actor_id, a.name, u.email::text,
         workspace_people(w.id),
         (select count(*)::int from project p where p.workspace_id = w.id and p.deleted_at is null),
         workspace_storage_bytes(w.id),
         g.until, g.workspace_id is not null,
         k.license_key, k.applied_at
  from workspace w
  left join lateral (
    select m.actor_id from membership m
    where m.workspace_id = w.id and m.role = 'owner' and m.deleted_at is null
    order by m.created_at limit 1
  ) o on true
  left join actor a on a.id = o.actor_id
  left join app_user u on u.actor_id = o.actor_id
  left join plan_gift g on g.workspace_id = w.id
  left join appsumo_licence k on k.workspace_id = w.id and k.status = 'active'
  where is_operator() and w.deleted_at is null and not w.scratch
    and (p_only is null or w.id = p_only)
    and (p_q is null
         or w.name ilike '%' || p_q || '%' or w.slug::text ilike '%' || p_q || '%'
         or a.name ilike '%' || p_q || '%' or u.email::text ilike '%' || p_q || '%'
         or k.license_key = p_q)
    and (p_before_at is null or (w.created_at, w.id) < (p_before_at, p_before_id))
  order by w.created_at desc, w.id desc
  limit least(greatest(p_limit, 1), 100)
$$;
revoke all on function operator_workspaces(text, timestamptz, uuid, integer, uuid) from public;
grant execute on function operator_workspaces(text, timestamptz, uuid, integer, uuid) to tracker_app;

/* `/appsumo` is the page AppSumo sends a buyer to, so it is refused as a
   workspace's address — the list as migration 192 left it, and one word. */
create or replace function workspace_slug_allowed(p_slug text) returns boolean
language sql immutable set search_path = public as $$
  select p_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
     and p_slug not in (
       'api', 'auth', 'mcp', 'health', 'assets', 'static', 'files', 'cdn',
       'invite', 'join', 'welcome', 'signup', 'signin', 'sign-in', 'sign-up',
       'login', 'logout', 'forgot', 'reset', 'oauth', 'admin', 'settings',
       'notifications', 'members', 'chat', 'search', 'projects', 'new',
       'help', 'about', 'pricing', 'blog', 'docs', 'status', 'www', 'app',
       'tuff', 'usetuff', 'sw', 'manifest', 'favicon', 'robots', 'sitemap',
       'privacy', 'terms', 'legal', 'verify',
       'compare', 'for', 'refunds', 'alternatives',
       'agent-board', 'appsumo')
$$;

/*
 * The plan's own functions, callable by whoever could call them until now —
 * every role, through `public`, which Postgres grants a function by
 * default. Only the application calls them: Polar's webhook and the
 * owner's Billing (`billing_apply`, `billing_payer`, `billing_of`,
 * `billing_customer_of_actor`) and the operators' admin (`operator_gift`,
 * `operator_end_gift`). The worker calls none; `end_gifts` is its own
 * since migration 153.
 */
revoke execute on function billing_apply(text, uuid, text, text, text, text, text, timestamptz, boolean, timestamptz, timestamptz) from public;
grant execute on function billing_apply(text, uuid, text, text, text, text, text, timestamptz, boolean, timestamptz, timestamptz) to tracker_app;
revoke execute on function billing_payer(text, uuid) from public;
grant execute on function billing_payer(text, uuid) to tracker_app;
revoke execute on function billing_of(uuid) from public;
grant execute on function billing_of(uuid) to tracker_app;
revoke execute on function billing_customer_of_actor(uuid) from public;
grant execute on function billing_customer_of_actor(uuid) to tracker_app;
revoke execute on function operator_gift(uuid, text, timestamptz) from public;
grant execute on function operator_gift(uuid, text, timestamptz) to tracker_app;
revoke execute on function operator_end_gift(uuid) from public;
grant execute on function operator_end_gift(uuid) to tracker_app;
