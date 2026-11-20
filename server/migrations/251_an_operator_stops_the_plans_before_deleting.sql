/*
 * The paid subscriptions of the workspaces that would go with an account an
 * operator deletes — the ones it owns and is alone in, as
 * `my_lone_subscriptions` reads them for the account's own deletion — so
 * they are revoked at Polar before anything is deleted, and an account
 * deleted from the admin is not charged again.
 *
 * An operator is in none of those workspaces, so row-level security shows
 * them none of the rows: a definer function that asks `is_operator()`
 * itself, and answers nothing to anybody else.
 */
create function operator_lone_subscriptions(p_actor uuid) returns table (id text)
language sql stable security definer set search_path = public as $$
  select b.id from billing_subscription b
  join membership m on m.workspace_id = b.workspace_id and m.actor_id = p_actor
    and m.role = 'owner' and m.deleted_at is null
  where is_operator()
    and b.ended_at is null and b.status in ('active', 'trialing', 'past_due', 'incomplete')
    and not exists (select 1 from membership o where o.workspace_id = b.workspace_id
                      and o.actor_id <> p_actor and o.deleted_at is null and o.joined_at is not null)
$$;
revoke execute on function operator_lone_subscriptions(uuid) from public;
grant execute on function operator_lone_subscriptions(uuid) to tracker_app;
