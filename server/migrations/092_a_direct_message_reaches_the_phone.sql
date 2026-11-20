/*
 * A direct message is a push.
 *
 * Only a mention, an assignment or something followed made a notification,
 * and a push is sent only for a notification: a direct message reached
 * nobody whose app was closed, and the icon's number never moved for one.
 * `messaged` is the reason a person in a direct conversation is told about
 * what was said there. It is not the inbox's — a conversation is read in the
 * conversation — so the inbox leaves it out and the push is what it is for.
 */
alter type notify_reason add value if not exists 'messaged';

/*
 * And nothing already read is pushed. A message read in the open window
 * before the worker came round to it is a notification about something the
 * person has just seen — which is every message of a conversation somebody
 * is in the middle of.
 */
create or replace function due_notifications(p_limit int, p_workspace uuid default null)
returns table (
  id uuid,
  workspace_id uuid,
  actor_id uuid,
  reason notify_reason,
  object_type object_kind,
  object_id uuid
)
language sql volatile security definer set search_path = public as $$
  select n.id, n.workspace_id, n.actor_id, n.reason, n.object_type, n.object_id
  from notification n
  where n.delivered_at is null and n.deleted_at is null and n.read_at is null
    and n.deliver_after <= now()
    and (p_workspace is null or n.workspace_id = p_workspace)
    and exists (
      select 1 from push_subscription s
      where s.actor_id = n.actor_id and s.workspace_id = n.workspace_id
        and s.deleted_at is null
    )
  order by n.deliver_after
  limit p_limit
$$;
