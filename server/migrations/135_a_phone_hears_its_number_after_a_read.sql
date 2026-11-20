/*
 * A phone hears its number after a read.
 *
 * Something read on the laptop left the phone's icon saying what it said
 * before, until the next push or until the app was opened. Now a read marks
 * the person's phones in that workspace as owing a number (`recount_at`),
 * and the worker's next pass tells each of them once, however many reads
 * came between: a push with the number and nothing else.
 *
 * `told_unread` is the number a phone was last told, by any push, so one
 * that would say the same is not sent. A room is marked read on the way in
 * and on the way out, and opening one with nothing in it changes nothing.
 */
alter table push_subscription
  add column recount_at timestamptz,
  add column told_unread int;

create index push_subscription_recount on push_subscription (recount_at)
  where recount_at is not null and deleted_at is null;

/*
 * The phones owed a number, for the process that tells them — across
 * actors, so a definer like `push_targets`. Taken as they are read: a read
 * after this marks the row again for the next pass, and two workers do not
 * both send it.
 */
create function push_recounts(p_limit int)
returns table (id uuid, workspace_id uuid, actor_id uuid, endpoint text, told_unread int)
language sql volatile security definer set search_path = public as $$
  update push_subscription s set recount_at = null
  where s.id in (
    select d.id from push_subscription d
    where d.recount_at is not null and d.deleted_at is null and d.kind = 'apns'
    order by d.recount_at
    limit p_limit
    for update skip locked)
  returning s.id, s.workspace_id, s.actor_id, s.endpoint, s.told_unread
$$;

/* Written to, and what its icon was told. */
create function push_told(p_id uuid, p_unread int) returns void
language sql volatile security definer set search_path = public as $$
  update push_subscription
  set told_unread = p_unread, last_used_at = now(), updated_at = now()
  where id = p_id
$$;

grant execute on function push_recounts(int), push_told(uuid, int) to tracker_app;
