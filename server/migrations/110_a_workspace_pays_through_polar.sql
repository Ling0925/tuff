/*
 * A workspace pays for its plan through Polar.
 *
 * Polar holds the card, the tax and the invoices; this holds what it said
 * last about each subscription, and the workspace's plan follows from that.
 * Written only by Polar's signed webhooks, through `billing_apply` — there
 * is no actor behind one — and read only by the workspace's owner, through
 * `billing_of`. The application role can neither read nor write the table.
 */
create table billing_subscription (
  id                   text primary key,
  workspace_id         uuid not null references workspace(id) on delete cascade,
  customer_id          text not null,
  product_id           text not null,
  plan                 text not null check (plan in ('team', 'company', 'unlimited')),
  period               text not null check (period in ('month', 'year')),
  status               text not null,
  current_period_end   timestamptz,
  cancel_at_period_end boolean not null default false,
  ended_at             timestamptz,
  modified_at          timestamptz not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index billing_subscription_ws on billing_subscription (workspace_id, modified_at desc);
alter table billing_subscription enable row level security;
revoke all on billing_subscription from tracker_app;

/* What counts as paid for: being paid, a trial, and a payment that failed
   and is being tried again — Polar revokes it if that never succeeds. */
create function billing_live(p_status text) returns boolean
language sql immutable as $$
  select p_status in ('active', 'trialing', 'past_due')
$$;

/*
 * What Polar said about a subscription, applied.
 *
 * Deliveries can arrive out of order and more than once, so a state older
 * than the one kept is ignored, and the same one twice changes nothing.
 * Then the workspace's plan follows: the newest live subscription's plan
 * — and a plan given as a gift ends, since it is now paid for — or, with
 * none live, Solo, if what ended was a paid plan. Answers the plan it
 * leaves the workspace on, or null for a delivery that was older.
 */
create function billing_apply(
  p_id text, p_workspace uuid, p_customer text, p_product text, p_plan text, p_period text,
  p_status text, p_period_end timestamptz, p_cancel boolean, p_ended timestamptz, p_modified timestamptz
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_live record;
  v_plan text;
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
  -- Nothing paid for any more: back to the free plan, unless a gift holds it.
  if not exists (select 1 from plan_gift where workspace_id = p_workspace) then
    update workspace set plan = 'solo', updated_at = now()
    where id = p_workspace and plan in ('team', 'company', 'unlimited');
  end if;
  select plan into v_plan from workspace where id = p_workspace;
  return v_plan;
end $$;
grant execute on function billing_apply(text, uuid, text, text, text, text, text, timestamptz, boolean, timestamptz, timestamptz) to tracker_app;

/* The owner's view of what this workspace pays: its newest subscription. */
create function billing_of(p_workspace uuid)
returns table (id text, customer_id text, plan text, period text, status text,
               current_period_end timestamptz, cancel_at_period_end boolean, ended_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.id, b.customer_id, b.plan, b.period, b.status, b.current_period_end, b.cancel_at_period_end, b.ended_at
  from billing_subscription b
  where b.workspace_id = p_workspace and role_in(p_workspace) = 'owner'
  order by billing_live(b.status) desc, b.modified_at desc
  limit 1
$$;
grant execute on function billing_of(uuid) to tracker_app;

/* Who pays for a person's other workspaces: one Polar customer per person. */
create function billing_customer_of_actor(p_actor uuid) returns text
language sql stable security definer set search_path = public as $$
  select b.customer_id from billing_subscription b
  join membership m on m.workspace_id = b.workspace_id and m.actor_id = p_actor and m.role = 'owner'
  where p_actor = current_actor()
  order by b.modified_at desc limit 1
$$;
grant execute on function billing_customer_of_actor(uuid) to tracker_app;
