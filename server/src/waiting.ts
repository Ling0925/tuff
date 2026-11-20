import type { Tx } from './db.js'

/**
 * The messages waiting in rooms that count every message, for the number on
 * the icon. A mention is a notification and is counted
 * there, so each room counts what arrived beyond its mentions; a room set to
 * mentions or nothing counts nothing here. The same "since you last looked"
 * the sidebar's counts use, run as the reader so the rooms are theirs.
 */
export async function chatWaiting(tx: Tx): Promise<number> {
  const [r] = await tx<{ n: number }[]>`
    select coalesce(sum(greatest(x.unread - x.mentions, 0)), 0)::int as n from (
      select
        coalesce((select cm.notify from conversation_member cm
                  where cm.conversation_id = c.id and cm.actor_id = current_actor()
                    and cm.deleted_at is null), 'all') as notify,
        (select count(*) from notification n
         where n.actor_id = current_actor() and n.object_type = 'conversation'
           and n.object_id = c.id and n.reason in ('mentioned', 'messaged', 'replied')
           and n.read_at is null and n.deleted_at is null) as mentions,
        /* To a hundred, from the time worked out first — the sidebar's
           count, and for the same reason: worked out inside, it read the
           whole room for every push. */
        (select count(*) from (
           select 1 from message m
           where m.conversation_id = c.id and m.deleted_at is null
             and m.author_id <> current_actor()
             and m.created_at > s.since
           limit 100) x) as unread
      from conversation c
      left join project p on p.id = c.project_id
      cross join lateral (
        select coalesce(
          (select cm2.last_read_at from conversation_member cm2
           where cm2.conversation_id = c.id and cm2.actor_id = current_actor() and cm2.deleted_at is null),
          (select cm2.created_at from conversation_member cm2
           where cm2.conversation_id = c.id and cm2.actor_id = current_actor() and cm2.deleted_at is null),
          (select pm.created_at from project_member pm
           where pm.project_id = c.project_id and pm.actor_id = current_actor() and pm.deleted_at is null),
          (select m2.joined_at from membership m2
           where m2.workspace_id = c.workspace_id and m2.actor_id = current_actor() and m2.deleted_at is null)
        ) as since
        offset 0
      ) s
      where c.deleted_at is null and (c.project_id is null or p.id is not null)
    ) x
    where x.notify = 'all'`
  return Number(r?.n ?? 0)
}
