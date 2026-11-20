/*
 * A paid plan revoked at Polar is marked so here at once.
 *
 * Deleting a workspace or an account revokes its plans first and deletes
 * after. Until Polar's own word arrives (`subscription.revoked`, through
 * `billing_apply`) the row still read as live, so a deletion that failed
 * between the two listed the plan again on the next press, asked Polar to
 * revoke it a second time, and was refused for one that was already gone.
 * `revoked_at` is the moment this server revoked it; every list of what to
 * stop first passes over it, and Polar's word still ends it as before.
 */
alter table billing_subscription add column revoked_at timestamptz;

/*
 * Stamped by whoever just revoked them: the owner of the workspace each is
 * for, or an operator. Anybody else stamps nothing — a stamp is a plan no
 * deletion stops, so it is not anybody's to write.
 */
create function billing_revoked(p_ids text[]) returns integer
language sql volatile security definer set search_path = public as $$
  with done as (
    update billing_subscription b set revoked_at = now(), updated_at = now()
    where b.id = any(p_ids) and b.revoked_at is null
      and (is_operator() or exists (
        select 1 from membership m
        where m.workspace_id = b.workspace_id and m.actor_id = current_actor()
          and m.role = 'owner' and m.deleted_at is null and m.joined_at is not null))
    returning 1)
  select count(*)::int from done
$$;
revoke execute on function billing_revoked(text[]) from public;
grant execute on function billing_revoked(text[]) to tracker_app;

/* The lists, passing over a plan already revoked and a workspace already
   deleted, as `account_deletion` passes over the latter. */
create or replace function my_lone_subscriptions() returns table (id text)
language sql stable security definer set search_path = public as $$
  select b.id from billing_subscription b
  join workspace ws on ws.id = b.workspace_id and ws.deleted_at is null
  join membership m on m.workspace_id = b.workspace_id and m.actor_id = current_actor()
    and m.role = 'owner' and m.deleted_at is null
  where b.ended_at is null and b.revoked_at is null
    and b.status in ('active', 'trialing', 'past_due', 'incomplete')
    and not exists (select 1 from membership o where o.workspace_id = b.workspace_id
                      and o.actor_id <> current_actor() and o.deleted_at is null and o.joined_at is not null)
$$;

create or replace function operator_lone_subscriptions(p_actor uuid) returns table (id text)
language sql stable security definer set search_path = public as $$
  select b.id from billing_subscription b
  join workspace ws on ws.id = b.workspace_id and ws.deleted_at is null
  join membership m on m.workspace_id = b.workspace_id and m.actor_id = p_actor
    and m.role = 'owner' and m.deleted_at is null
  where is_operator()
    and b.ended_at is null and b.revoked_at is null
    and b.status in ('active', 'trialing', 'past_due', 'incomplete')
    and not exists (select 1 from membership o where o.workspace_id = b.workspace_id
                      and o.actor_id <> p_actor and o.deleted_at is null and o.joined_at is not null)
$$;

/* And the workspace's own dry run, whose list is what its deletion stops. */
create or replace function delete_workspace(p_dry boolean) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v jsonb;
begin
  if (select community from instance_setting where id) then
    perform 1 from instance_setting where id for update;
    if instance_usable_owners() > 0 and instance_usable_owners(current_workspace()) = 0
       and exists (
         select 1 from membership m
         where m.workspace_id = current_workspace() and m.actor_id = current_actor() and m.role = 'owner'
           and m.deleted_at is null and m.joined_at is not null) then
      return jsonb_build_object('ok', false, 'why', 'last_instance_owner');
    end if;
  end if;
  v := workspace_deletion(p_dry);
  if p_dry and v ? 'subscriptions' then
    v := jsonb_set(v, '{subscriptions}', coalesce((
      select jsonb_agg(s.id) from jsonb_array_elements_text(v->'subscriptions') as s(id)
      join billing_subscription b on b.id = s.id
      where b.revoked_at is null), '[]'::jsonb));
  end if;
  return v;
end $$;
