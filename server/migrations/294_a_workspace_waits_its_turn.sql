/*
 * The webhook queue goes round the workspaces,
 * and the security audit spec, the night audit
 * (9).
 *
 * The worker took the fifty oldest deliveries of the whole instance a
 * pass, and sent them five at a time with ten seconds each to answer. A
 * workspace with sixty slow receivers filled every pass, and everybody
 * else's events and agent wakes waited behind its backlog.
 *
 * Now a pass takes at most `p_each` (ten) of any one workspace, and hands
 * them back round the workspaces: every workspace's oldest first, then
 * every workspace's second, so one with a single delivery due is among the
 * first five sent whatever another has queued. The workspaces asked are
 * those with a live webhook turned on — few, and bounded below — and each
 * is read off its own slice of a partial index, so a backlog in one costs
 * the others nothing to step past.
 *
 * And a workspace has twenty webhooks of its own at most, on or off: each
 * is a copy of every event, and the copies were the multiplier. A trigger,
 * so no path round it; an agent's webhook is not counted — there is one an
 * agent, twenty agents a person (`agent_connect`), and it is sent only
 * what is addressed to its agent.
 *
 * Written to run again harmlessly, should its number change.
 */

create index if not exists webhook_delivery_due_by_workspace
  on webhook_delivery (workspace_id, deliver_after) where delivered_at is null;

drop function if exists due_webhook_deliveries(int, uuid);
create or replace function due_webhook_deliveries(p_limit int, p_workspace uuid default null, p_each int default 10)
returns table (
  id uuid, url text, secret text, auth_enc text, shape text, event text, payload jsonb, attempts int
)
language sql volatile security definer set search_path = public, pg_temp as $$
  with spaces as (
    select distinct w.workspace_id from webhook w
    where w.enabled and w.deleted_at is null
      and (p_workspace is null or w.workspace_id = p_workspace)
  ), chosen as (
    select x.id, x.deliver_after, x.turn
    from spaces s
    cross join lateral (
      select d.id, d.deliver_after, row_number() over (order by d.deliver_after) as turn
      from webhook_delivery d join webhook w on w.id = d.webhook_id
      where d.workspace_id = s.workspace_id and d.delivered_at is null
        and d.deliver_after <= now() and d.attempts < 10 and w.enabled
      order by d.deliver_after
      limit greatest(p_each, 1)
    ) x
    order by x.turn, x.deliver_after
    limit p_limit
  ), picked as (
    select d.id, c.turn, c.deliver_after
    from webhook_delivery d join chosen c on c.id = d.id
    where d.delivered_at is null and d.deliver_after <= now()
    for update of d skip locked
  ), claimed as (
    update webhook_delivery d set deliver_after = now() + interval '5 minutes'
    from picked where d.id = picked.id
    returning d.id, d.webhook_id, d.event, d.payload, d.attempts
  )
  select c.id, w.url, w.secret_enc, w.authorization_enc, w.shape, c.event, c.payload, c.attempts
  from claimed c
  join picked p on p.id = c.id
  join webhook w on w.id = c.webhook_id
  order by p.turn, p.deliver_after
$$;
revoke all on function due_webhook_deliveries(int, uuid, int) from public;
grant execute on function due_webhook_deliveries(int, uuid, int) to tracker_app;

/* Twenty of a workspace's own, counted under a lock on the workspace so
   two made at once cannot both be the twentieth. */
create or replace function webhook_within_cap() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.agent_id is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('webhooks:' || new.workspace_id::text, 0));
  if (select count(*) from webhook h
      where h.workspace_id = new.workspace_id and h.agent_id is null and h.deleted_at is null) >= 20 then
    raise exception 'a workspace has twenty webhooks at most'
      using errcode = '23514', constraint = 'webhook_too_many';
  end if;
  return new;
end $$;
revoke all on function webhook_within_cap() from public;

drop trigger if exists webhook_within_cap on webhook;
create trigger webhook_within_cap before insert on webhook
  for each row execute function webhook_within_cap();
