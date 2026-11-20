-- Which product a workspace pays for, to the owner's view of it: a plan
-- moved up is charged now and one moved down later, and which is which
-- is the price of the one paid for against the one chosen.
drop function billing_of(uuid);
create function billing_of(p_workspace uuid)
returns table (id text, customer_id text, payer_id uuid, product_id text, plan text, period text, status text,
               current_period_end timestamptz, cancel_at_period_end boolean, ended_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.id, b.customer_id, b.payer_id, b.product_id, b.plan, b.period, b.status, b.current_period_end,
         b.cancel_at_period_end, b.ended_at
  from billing_subscription b
  where b.workspace_id = p_workspace and role_in(p_workspace) = 'owner'
  order by billing_live(b.status) desc, b.modified_at desc
  limit 1
$$;
grant execute on function billing_of(uuid) to tracker_app;
