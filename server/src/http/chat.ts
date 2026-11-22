import { Hono } from 'hono'
import { z } from 'zod'
import { RichBody } from './body.js'
import { v7 as uuidv7 } from 'uuid'
import { generateKeyBetween } from 'fractional-indexing'
import { withActor, type Tx } from '../db.js'
import { faced, facedAs } from '../storage.js'
import { allow, allowIn, type AuthContext } from '../auth/context.js'
import { record } from './activity.js'
import { apart, forbidden, missing, mayEditSaid } from './objects.js'
import { publish, publishMany } from '../realtime.js'
import { owesCount } from '../push.js'
import { LINES, claimFiles, doer, notify, veilDocrefs } from '../notify.js'
import { env } from '../env.js'
import { MAX_FILE_BYTES } from '@tracker/shared-schema'
import { put, remove } from '../storage.js'
import { fits, roomFor } from '../ceilings.js'
import { pageSize, timeCursor } from './limits.js'
import { used } from './used.js'
import { listTaker } from './tasks.js'

type Vars = { ctx: AuthContext }
export const chat = new Hono<{ Variables: Vars }>()

/**
 * Chat around the work, not instead of it.
 *
 * A project channel and a direct conversation are one type. What differs is
 * whether `project_id` is set, which is also what decides who can see it: a
 * project channel follows the project, a direct one follows its members.
 */

type RoomRow = { project_id: string | null; channel: boolean; created_by: string | null }

/**
 * What somebody may do to one room.
 *
 * A project's channel answers to that project's rights: whoever may open a
 * channel there may rename one and say who is in it, and throwing one away
 * is its own right. A channel outside every project answers to the
 * workspace: anybody in it who may open channels may rename it and change
 * who is in it, and only the one who made it, or the owner, throws it away.
 * A direct conversation is nobody's to administer.
 */
function roomCan(ctx: AuthContext, r: RoomRow): ('edit' | 'delete')[] {
  if (!r.channel) return []
  if (r.project_id) {
    return [
      ...(allowIn(ctx, 'channel.create', r.project_id) ? (['edit'] as const) : []),
      ...(allowIn(ctx, 'channel.delete', r.project_id) ? (['delete'] as const) : []),
    ]
  }
  return [
    ...(allow(ctx, 'channel.create.workspace') ? (['edit'] as const) : []),
    /* Never through a token: a workspace channel deleted by a tool has no
       way back. */
    /* The owner's — asked of `can()`, outside every project — or whoever made it. */
    ...(allow(ctx, 'channel.delete', { inProject: false }) || (!ctx.viaMcp && r.created_by === ctx.actorId) ? (['delete'] as const) : []),
  ]
}

/**
 * A channel's name, the way Slack writes one: lower case, a hyphen for a
 * space, no leading hash. The project's own name is put in front of it
 * where it is shown, so it is never part of what is stored.
 */
export function channelName(raw: string): string {
  return raw
    .replace(/^[\s#]+/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

const ChannelName = z
  .string()
  .max(200)
  .transform(channelName)
  .refine((n) => n.length > 0)

chat.get('/conversations', async (c) => {
  const ctx = c.get('ctx')
  const rows = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      tx`select c.id, c.project_id, c.name, c.created_at, c.channel, c.created_by,
              c.chosen,
              p.slug as project_slug,
              /* Put away with its project: still the project's to open, no
                 longer a place in the list. */
              p.archived_at is not null as project_archived,
              /* How loud this room is for the reader, and how many times they
                 were named in it and have not looked — the count that is red.
                 No backticks in here. */
              /* Put away under More chats by this reader -- sidebar-hide.md. */
              exists (select 1 from conversation_member cm7
                      where cm7.conversation_id = c.id and cm7.actor_id = current_actor()
                        and cm7.deleted_at is null and cm7.hidden_at is not null) as hidden,
              /* An open channel this reader left. */
              exists (select 1 from conversation_member cm9
                      where cm9.conversation_id = c.id and cm9.actor_id = current_actor()
                        and cm9.deleted_at is null and cm9.left_at is not null) as "left",
              coalesce((select cm6.notify from conversation_member cm6
                        where cm6.conversation_id = c.id and cm6.actor_id = current_actor()
                          and cm6.deleted_at is null), 'all') as notify,
              (select count(*) from notification n
               where n.actor_id = current_actor() and n.object_type = 'conversation'
                 and n.object_id = c.id and n.reason = 'mentioned'
                 and n.read_at is null and n.deleted_at is null
                 and n.deliver_after <= now()) as mentions,
              /*
               * What arrived since this person last looked, and never their
               * own words: a room does not become unread because you spoke
               * in it.
               *
               * Counted to a hundred and no further, from where the reading
               * stopped — the time worked out first, below, so the count is
               * a walk along the room's index from there. Worked out inside
               * the count, the time bounded nothing: every message of the
               * room was read to find the new ones, a million for a reader
               * who had looked a minute ago. The badge says 99+ past it.
               */
              (select count(*) from (
                 select 1 from message m
                 where m.conversation_id = c.id and m.deleted_at is null
                   and m.author_id <> current_actor()
                   and m.created_at > s.since
                 /* In the order of the room's own index, so it is the one
                    walked: without it the planner, guessing a third of a
                    million-message table is this room's, read the whole
                    table for fifteen unread — 300 ms on the load table. */
                 order by m.created_at desc
                 limit 100) x) as unread,
              /*
               * Who else is in a direct conversation, because it has no name
               * of its own and "Direct" three times in a sidebar names
               * nothing. A project channel has a name, so it does not pay
               * for this.
               */
              (select string_agg(a.name, ', ' order by a.name)
               from conversation_member cm3 join actor a on a.id = cm3.actor_id
               where cm3.conversation_id = c.id and cm3.deleted_at is null
                 and cm3.actor_id <> current_actor()
                 and not c.channel) as others,
              /*
               * And where that count starts, so the screen can draw the
               * line -- docs/specs/history.md. No backticks in here: this is
               * inside a template literal, and one ends it. The very time
               * the count is made from, so the two cannot disagree about
               * where "since you last looked" is.
               */
              s.since as read_through,
              /*
               * And who that is, when it is one person, so the row can show
               * their avatar tinted the way it is everywhere else -- the tint
               * is taken from the id, and a name is not one. A group has no
               * single face, so it gets none.
               */
              (select case when count(*) = 1 then (array_agg(cm4.actor_id))[1] end
               from conversation_member cm4
               where cm4.conversation_id = c.id and cm4.deleted_at is null
                 and cm4.actor_id <> current_actor()
                 and not c.channel) as other_id,
              /*
               * And how that one person is -- docs/specs/presence.md.
               *
               * A direct conversation is a person in the sidebar, and
               * whether they are here is what somebody wants to know before
               * typing. A channel is not a person and gets none.
               */
              (select case when count(*) = 1
                                /* Nobody removed: a green dot said they
                                   were here when they were active
                                   somewhere else. */
                                and bool_and(exists (select 1 from membership mp
                                                     where mp.workspace_id = c.workspace_id
                                                       and mp.actor_id = cm5.actor_id
                                                       and mp.deleted_at is null))
                      then presence_of(max(a5.seen_at), max(a5.presence)) end
               from conversation_member cm5
               join actor a5 on a5.id = cm5.actor_id
               where cm5.conversation_id = c.id and cm5.deleted_at is null
                 and cm5.actor_id <> current_actor()
                 and not c.channel) as other_presence,
              /*
               * Whether everybody else in a direct conversation has been
               * removed from the workspace -- docs/specs/removing-someone.md.
               * It stays readable and takes no more: what was written to
               * them would reach nobody.
               */
              (select bool_and(not exists (select 1 from membership mg
                                           where mg.workspace_id = c.workspace_id
                                             and mg.actor_id = cm9.actor_id
                                             and mg.deleted_at is null))
               from conversation_member cm9
               where cm9.conversation_id = c.id and cm9.deleted_at is null
                 and cm9.actor_id <> current_actor()
                 and not c.channel) as others_gone,
              /* And their picture, for the row in the column: a direct
                 conversation is that person, and the column drew their
                 initials where every other place drew their face. */
              (select case when count(*) = 1 then max(a6.avatar_key) end
               from conversation_member cm6b
               join actor a6 on a6.id = cm6b.actor_id
               where cm6b.conversation_id = c.id and cm6b.deleted_at is null
                 and cm6b.actor_id <> current_actor()
                 and not c.channel) as other_avatar
       from conversation c
       left join project p on p.id = c.project_id
       /* Where this person keeps it in their own sidebar, if they have ever
          said -- docs/specs/sidebar-order.md. No backticks in here: this is
          inside a template literal, and one ends it. */
       left join sidebar_place sp
         on sp.object_id = c.id and sp.kind = 'conversation'
        and sp.actor_id = current_actor() and sp.workspace_id = c.workspace_id
       /*
        * Since when the room is new to this reader. With no mark yet the
        * room is not "all unread" -- somebody who has never opened a channel
        * with four hundred messages in it does not need a four hundred
        * beside it. Offset 0 keeps it a value the count is bounded by,
        * rather than an expression folded back into its filter.
        */
       cross join lateral (
         select coalesce(
           (select cm2.last_read_at from conversation_member cm2
            where cm2.conversation_id = c.id and cm2.actor_id = current_actor()
              and cm2.deleted_at is null),
           (select cm2.created_at from conversation_member cm2
            where cm2.conversation_id = c.id and cm2.actor_id = current_actor()
              and cm2.deleted_at is null),
           /* No row of their own, which is everybody on a project whose
              channel was made with the project: it is reached through the
              project, and nothing was ever inserted. So it falls back to
              the project, where the right to see the channel comes from. */
           (select pm.created_at from project_member pm
            where pm.project_id = c.project_id and pm.actor_id = current_actor()
              and pm.deleted_at is null),
           /* And for anything else, when they joined the workspace --
              nobody arrives to four hundred unread. */
           (select m2.joined_at from membership m2
            where m2.workspace_id = c.workspace_id and m2.actor_id = current_actor()
              and m2.deleted_at is null)
         ) as since
         offset 0
       ) s
       where c.deleted_at is null
         /*
          * A channel belongs to its project, and is listed only while that
          * project is one this person can see.
          *
          * The test is that the join found a row, not that the row it found
          * has a null deleted_at. Row-level security hides the project, so
          * the left join yields nothing — and "deleted_at is null" is true of
          * nothing, which let every channel of every deleted project back
          * into the list. The same shape as every other bug in this codebase
          * where emptiness was read as permission.
          */
         and (c.project_id is null or p.id is not null)
       /* A room that came back out because something was said in it stands
          at the head, newest first, until the reader arranges the list --
          the same order places.ts writes down on the first drag. */
       order by (select cm8.surfaced_at from conversation_member cm8
                 where cm8.conversation_id = c.id and cm8.actor_id = current_actor()
                   and cm8.deleted_at is null) desc nulls last,
                sp.sort_key nulls last, c.project_id nulls first, c.created_at`,
  )
  /* What this reader may do to each room, decided here so no client works
     it out from a role. */
  return c.json({
    conversations: rows.map((r) => ({
      ...facedAs(r as Record<string, unknown>, 'other_avatar', 'other_avatar_url'),
      can: [
        ...roomCan(ctx, r as unknown as RoomRow),
        /* Its incoming webhooks. A channel's
           only, never through a token. */
        ...((r as unknown as RoomRow).channel &&
        !ctx.viaMcp &&
        ((r as unknown as RoomRow).project_id
          ? allowIn(ctx, 'hook.manage', (r as unknown as RoomRow).project_id)
          : allow(ctx, 'hook.manage', { inProject: false }))
          ? (['hooks'] as const)
          : []),
        /* A channel is anybody's to leave, in person. */
        ...((r as unknown as RoomRow).channel && allow(ctx, 'channel.leave') ? (['leave'] as const) : []),
      ],
    })),
  })
})

chat.post('/projects/:projectId/conversations', async (c) => {
  const ctx = c.get('ctx')
  const projectId = c.req.param('projectId')
  // Its own permission on this project. Making a room is how the chat gets
  // divided, and who may divide it is a decision about one person at a time.
  if (!allowIn(ctx, 'channel.create', projectId)) return c.json(forbidden, 403)

  const body = z
    .object({
      name: ChannelName,
      /*
       * Who is in it. Left out, the channel belongs to the whole project —
       * which is what the team's own channel is, and what most extra ones
       * want to be. Given, it belongs to those people and nobody else, and
       * that rule lives in the policy rather than here.
       */
      member_ids: z.array(z.uuid()).optional(),
    })
    .safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)

  const id = uuidv7()
  const made = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [ok] = await tx<{ ok: boolean }[]>`select in_project(${projectId}) as ok`
    if (!ok?.ok) return false
    // Extra channels are created inside a project and do not live apart from
    // it: there is no place in the product where a channel exists on its own.
    await tx`
      insert into conversation (id, workspace_id, project_id, name, created_by, chosen)
      values (${id}, ${ctx.workspaceId}, ${projectId}, ${body.data.name}, ${ctx.actorId},
              ${Boolean(body.data.member_ids?.length)})`

    if (body.data.member_ids?.length) {
      /*
       * Chosen from the project, and the chooser is always in.
       *
       * Taken through a join on `project_member` rather than trusted as sent:
       * an id that is not on this project would otherwise open the room to
       * somebody the project itself has not let in. And whoever made it is
       * added whether they listed themselves or not — a room you cannot see
       * is not a room, it is a mistake with a name.
       */
      const wanted = [...new Set([...body.data.member_ids, ctx.actorId])]
      const put = await tx`
        insert into conversation_member
          (id, workspace_id, conversation_id, actor_id, joined_at)
        select gen_random_uuid(), ${ctx.workspaceId}, ${id}, pm.actor_id, now()
        from project_member pm
        where pm.project_id = ${projectId} and pm.deleted_at is null
          and pm.actor_id = any(${wanted}::uuid[])`
      /* Chosen for nobody on the project — an owner not on it naming people
         who are not either — is a room nobody could open: refused, and
         nothing made. */
      if (put.count === 0) throw new NobodyChosen()
    }

    await record(tx, ctx, 'conversation.create', { projectId, objectType: 'conversation', objectId: id })
    return true
  }).catch((e: unknown) => {
    if (e instanceof NobodyChosen) return 'nobody' as const
    throw e
  })
  if (made === 'nobody') {
    return c.json({ error: { code: 'invalid', message: 'Choose at least one person on this project.' } }, 400)
  }
  return made ? c.json({ id }, 201) : c.json(missing, 404)
})

/** Thrown to take back a channel made for nobody on its project. */
class NobodyChosen extends Error {}

/*
 * A project's channel of chosen people whose people have all gone.
 * Nobody can open it, and
 * it is still somebody's to end: the owner's, and whoever may delete the
 * project's channels. By name only; what was said in it stays shut.
 */
chat.get('/projects/:projectId/empty-channels', async (c) => {
  const ctx = c.get('ctx')
  const projectId = c.req.param('projectId')
  if (!allowIn(ctx, 'channel.delete', projectId)) return c.json({ channels: [] })
  const rows = await withActor(ctx.actorId, ctx.workspaceId, (tx) => tx`select id, name, created_at from empty_rooms(${projectId})`)
  return c.json({ channels: rows })
})

/**
 * Ends a room nobody is in, if this asker may: handed back to the project,
 * or deleted. `null` when it is not such a room or not theirs to end, which
 * the caller answers as the room not being there.
 */
async function endEmptyRoom(ctx: AuthContext, id: string, open: boolean): Promise<string | null> {
  return withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [r] = await tx<{ p: string | null }[]>`select empty_room_project(${id}) as p`
    const projectId = r?.p ?? null
    if (!projectId || !allowIn(ctx, 'channel.delete', projectId)) return null
    const [done] = await tx<{ ok: boolean }[]>`select empty_room_end(${id}, ${open}) as ok`
    if (!done?.ok) return null
    await record(tx, ctx, open ? 'conversation.members' : 'conversation.delete', {
      projectId,
      objectType: 'conversation',
      objectId: id,
    })
    return projectId
  })
}

/**
 * A channel outside every project.
 *
 * Who is in it is written as rows, the way a direct conversation's people
 * are: left out, that is everybody in the workspace now; given, those
 * people. Whoever opened it is in it either way.
 */
chat.post('/conversations/channels', async (c) => {
  const ctx = c.get('ctx')
  if (!allow(ctx, 'channel.create.workspace')) return c.json(forbidden, 403)
  const body = z.object({ name: ChannelName, member_ids: z.array(z.uuid()).optional() }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)

  const id = uuidv7()
  await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    await tx`
      insert into conversation (id, workspace_id, project_id, name, channel, created_by)
      values (${id}, ${ctx.workspaceId}, null, ${body.data.name}, true, ${ctx.actorId})`
    const wanted = body.data.member_ids ? [...new Set([...body.data.member_ids, ctx.actorId])] : null
    /* Through the membership, so an id from outside the workspace is not
       let in — anybody the members list shows, which is the list the
       boxes were ticked from. Not only those who have signed in yet: the
       people somebody picked were silently dropped and the channel was
       made with its maker alone. */
    await tx`
      insert into conversation_member (id, workspace_id, conversation_id, actor_id, joined_at)
      select gen_random_uuid(), ${ctx.workspaceId}, ${id}, m.actor_id, now()
      from membership m
      where m.workspace_id = ${ctx.workspaceId} and m.deleted_at is null
        and (${wanted}::uuid[] is null or m.actor_id = any(${wanted}::uuid[]))`
    await record(tx, ctx, 'conversation.create', { objectType: 'conversation', objectId: id })
  })
  return c.json({ id }, 201)
})

/** The room as `roomCan` needs it, read as the asker — not readable is not there. */
async function roomOf(ctx: AuthContext, id: string): Promise<RoomRow | null> {
  const [row] = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      tx<RoomRow[]>`
      select project_id, channel, created_by from conversation
      where id = ${id} and deleted_at is null`,
  )
  return row ?? null
}

/** A channel's name, changed. */
chat.patch('/conversations/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const room = await roomOf(ctx, id)
  if (!room) return c.json(missing, 404)
  if (!roomCan(ctx, room).includes('edit')) return c.json(forbidden, 403)
  const body = z.object({ name: ChannelName }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    await tx`update conversation set name = ${body.data.name}, updated_at = now() where id = ${id}`
    await record(tx, ctx, 'conversation.rename', {
      projectId: room.project_id,
      objectType: 'conversation',
      objectId: id,
      meta: { name: body.data.name },
    })
  })
  await publish(room.project_id ? `project:${room.project_id}` : `conversation:${id}`, 'conversation', { id })
  return c.json({ ok: true, name: body.data.name })
})

/**
 * Who is in a channel, said whole.
 *
 * The full list rather than add and remove, because the screen shows the
 * full list with boxes in it. On a project's channel, null hands it back to
 * the project — everyone on it, now and later. Somebody taken out keeps
 * their row with no `joined_at`: their place in the history stays, their
 * way in does not.
 */
chat.put('/conversations/:id/members', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const room = await roomOf(ctx, id)
  if (!room) {
    /* A room nobody is in can be handed back to the project, and only that. */
    const raw = (await c.req.json().catch(() => ({}))) as { member_ids?: unknown }
    const projectId = raw.member_ids === null ? await endEmptyRoom(ctx, id, true) : null
    if (!projectId) return c.json(missing, 404)
    await publish(`project:${projectId}`, 'conversation', { id })
    return c.json({ ok: true })
  }
  if (!roomCan(ctx, room).includes('edit')) return c.json(forbidden, 403)
  const body = z.object({ member_ids: z.array(z.uuid()).min(1).nullable() }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const ids = body.data.member_ids
  if (ids === null && !room.project_id) return c.json({ error: { code: 'invalid' } }, 400)

  await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    if (ids === null) {
      /* Only here does a room go back to the project: its people leaving
         never does -- migration 240. First, while the room is still the
         asker's to see and so to write. */
      await tx`update conversation set chosen = false, updated_at = now() where id = ${id}`
      await tx`
        update conversation_member set joined_at = null, updated_at = now()
        where conversation_id = ${id} and deleted_at is null and joined_at is not null`
      return
    }
    /* Only people who could be in it: the project's, or the workspace's. */
    const allowed = room.project_id
      ? await tx<{ actor_id: string }[]>`
          select actor_id from project_member
          where project_id = ${room.project_id} and deleted_at is null and actor_id = any(${ids}::uuid[])`
      : await tx<{ actor_id: string }[]>`
          select actor_id from membership
          where workspace_id = ${ctx.workspaceId} and deleted_at is null
            and actor_id = any(${ids}::uuid[])`
    /* Whoever is saying it stays in — a room is not left from its own
       settings by unticking yourself, which is how somebody running a room
       locked themselves out of it. Only if they are in it now: an owner
       who is not on the project is not added by editing its room. */
    const [self] = room.project_id
      ? await tx<{ in: boolean }[]>`
          select exists (select 1 from project_member where project_id = ${room.project_id}
            and actor_id = ${ctx.actorId} and deleted_at is null) as in`
      : await tx<{ in: boolean }[]>`
          select exists (select 1 from conversation_member where conversation_id = ${id}
            and actor_id = ${ctx.actorId} and deleted_at is null and joined_at is not null) as in`
    const keep = [...new Set([...allowed.map((r) => r.actor_id), ...(self?.in ? [ctx.actorId] : [])])]
    if (keep.length === 0) return
    await tx`
      update conversation_member set joined_at = coalesce(joined_at, now()), updated_at = now()
      where conversation_id = ${id} and deleted_at is null and actor_id = any(${keep}::uuid[])`
    await tx`
      insert into conversation_member (id, workspace_id, conversation_id, actor_id, joined_at)
      select gen_random_uuid(), ${ctx.workspaceId}, ${id}, a, now()
      from unnest(${keep}::uuid[]) a
      where not exists (
        select 1 from conversation_member cm
        where cm.conversation_id = ${id} and cm.actor_id = a and cm.deleted_at is null)`
    /* Taking people out last: whoever is saying this may be one of them, and
       after that the room is not theirs to change. */
    await tx`
      update conversation_member set joined_at = null, updated_at = now()
      where conversation_id = ${id} and deleted_at is null and joined_at is not null
        and not (actor_id = any(${keep}::uuid[]))`
  })
  await withActor(ctx.actorId, ctx.workspaceId, (tx) =>
    record(tx, ctx, 'conversation.members', { projectId: room.project_id, objectType: 'conversation', objectId: id }),
  ).catch(() => {})
  await publish(room.project_id ? `project:${room.project_id}` : `conversation:${id}`, 'conversation', { id })
  return c.json({ ok: true })
})

/*
 * Where a row made only to keep a setting says its reader had read to: the
 * same place the list counts from while there is no row — when they came
 * onto the project, or into the workspace. Without it the row's own
 * `created_at` became "since you last looked", and turning a room down
 * marked everything in it read.
 */
function readFrom(tx: Parameters<Parameters<typeof withActor>[2]>[0], ctx: { actorId: string; workspaceId: string }, id: string) {
  return tx`(select coalesce(
      (select pm.created_at from project_member pm join conversation c on c.project_id = pm.project_id
       where c.id = ${id} and pm.actor_id = ${ctx.actorId} and pm.deleted_at is null),
      (select m2.joined_at from membership m2
       where m2.workspace_id = ${ctx.workspaceId} and m2.actor_id = ${ctx.actorId} and m2.deleted_at is null)))`
}

/**
 * How loud this room is for the one asking.
 *
 * Kept on their own row in it, made here if reading never made one: with no
 * `joined_at`, which is a place to keep a setting and not a way in.
 */
chat.put('/conversations/:id/notify', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const body = z.object({ notify: z.enum(['all', 'mentions', 'none']) }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const room = await roomOf(ctx, id)
  if (!room) return c.json(missing, 404)
  await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [had] = await tx`
      update conversation_member set notify = ${body.data.notify}, updated_at = now()
      where conversation_id = ${id} and actor_id = ${ctx.actorId} and deleted_at is null
      returning id`
    if (!had) {
      await tx`
        insert into conversation_member (id, workspace_id, conversation_id, actor_id, notify, last_read_at)
        values (${uuidv7()}, ${ctx.workspaceId}, ${id}, ${ctx.actorId}, ${body.data.notify}, ${readFrom(tx, ctx, id)})`
    }
  })
  return c.json({ ok: true })
})

/**
 * A room put away under "More chats", or brought back — your own sidebar
 * and nobody else's. `docs/specs/sidebar-hide.md`.
 */
chat.put('/conversations/:id/hidden', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const body = z.object({ hidden: z.boolean() }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const room = await roomOf(ctx, id)
  if (!room) return c.json(missing, 404)
  const at = body.data.hidden ? new Date() : null
  await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    /* Shown again, a channel somebody left is theirs again as a room
       starts: out of the drawer and loud. */
    const [had] = await tx`
      update conversation_member set hidden_at = ${at}, surfaced_at = null, updated_at = now(),
        notify = case when ${at === null} and left_at is not null then 'all' else notify end,
        left_at = case when ${at === null} then null else left_at end
      where conversation_id = ${id} and actor_id = ${ctx.actorId} and deleted_at is null
      returning id`
    if (!had) {
      await tx`
        insert into conversation_member (id, workspace_id, conversation_id, actor_id, hidden_at, last_read_at)
        values (${uuidv7()}, ${ctx.workspaceId}, ${id}, ${ctx.actorId}, ${at}, ${readFrom(tx, ctx, id)})`
    }
  })
  return c.json({ ok: true })
})

/**
 * Leaving a channel.
 *
 * Anybody's who can see it, in person (`channel.leave`): never through a
 * token and never by an agent. A direct conversation is not left — it is
 * hidden; its people are who it is with.
 *
 * - A room of chosen people, or a channel outside every project, is its
 *   rows: leaving ends your place, as being unticked does. You stop seeing
 *   it; anybody who may change who is in it can put you back. The last
 *   one in a channel outside every project cannot leave it — nobody could
 *   then see it to end it — and is told to delete it instead.
 * - An open project channel is everybody on the project, so there is no
 *   place to end. Leaving puts it away and quiets it to mentions — a name,
 *   a reply in your thread, a question for you still reach you — and it
 *   stays put away when somebody speaks in it (`left_at`). Showing it
 *   again undoes both.
 */
chat.post('/conversations/:id/leave', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  if (!allow(ctx, 'channel.leave')) return c.json(forbidden, 403)
  const result = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [room] = await tx<{ project_id: string | null; channel: boolean; chosen: boolean }[]>`
      select project_id, channel, chosen from conversation where id = ${id} and deleted_at is null`
    if (!room) return 'missing' as const
    if (!room.channel) return 'direct' as const
    if (!room.project_id || room.chosen) {
      if (!room.project_id) {
        const [n] = await tx<{ others: number }[]>`
          select count(*)::int as others from conversation_member
          where conversation_id = ${id} and actor_id <> ${ctx.actorId}
            and joined_at is not null and deleted_at is null`
        if (!n?.others) return 'last' as const
      }
      /* The line first, while the room is still theirs to see. */
      await record(tx, ctx, 'conversation.leave', { projectId: room.project_id, objectType: 'conversation', objectId: id })
      await tx`
        update conversation_member set joined_at = null, hidden_at = null, surfaced_at = null, updated_at = now()
        where conversation_id = ${id} and actor_id = ${ctx.actorId}
          and joined_at is not null and deleted_at is null`
      return { projectId: room.project_id, kind: 'out' as const }
    }
    const [had] = await tx`
      update conversation_member set hidden_at = now(), surfaced_at = null, left_at = now(),
        notify = 'mentions', updated_at = now()
      where conversation_id = ${id} and actor_id = ${ctx.actorId} and deleted_at is null
      returning id`
    if (!had) {
      await tx`
        insert into conversation_member (id, workspace_id, conversation_id, actor_id, hidden_at, left_at, notify, last_read_at)
        values (${uuidv7()}, ${ctx.workspaceId}, ${id}, ${ctx.actorId}, now(), now(), 'mentions', ${readFrom(tx, ctx, id)})`
    }
    return { projectId: room.project_id, kind: 'muted' as const }
  })
  if (result === 'missing') return c.json(missing, 404)
  if (result === 'direct') {
    return c.json({ error: { code: 'invalid', message: 'You can’t leave a direct message, but you can hide it.' } }, 400)
  }
  if (result === 'last') {
    return c.json({ error: { code: 'last', message: 'You’re the only one in this channel. Delete it instead.' } }, 409)
  }
  /* The rooms' lists read again, as a room's people changing has them. */
  if (result.kind === 'out') {
    await publish(result.projectId ? `project:${result.projectId}` : `conversation:${id}`, 'conversation', { id })
  }
  return c.json({ ok: true, left: result.kind })
})

/** A direct conversation: one to one, or a group, outside any project. */
chat.post('/conversations/direct', async (c) => {
  const ctx = c.get('ctx')
  /* An agent works in the projects it was given; it does not start
     conversations with people. Nor does a token
     made for some projects: a direct conversation is in none of them, and
     it could not read the one it made. */
  if (ctx.agent || ctx.tokenProjectIds.length > 0) return c.json({ error: { code: 'forbidden' } }, 403)
  const body = z
    .object({ actor_ids: z.array(z.uuid()).min(1), name: z.string().max(200).nullish() })
    .safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)

  /*
   * The one there already, if these people have one.
   *
   * Pressing Message on somebody you have talked to before opened a second
   * conversation beside the first, and the sidebar listed the same person
   * twice with half the history in each. The same people, exactly — a
   * conversation with Bruno is not the one with Bruno and Ada.
   */
  const everyone = [...new Set([ctx.actorId, ...body.data.actor_ids])]
  /* Only people in this workspace: any id was taken, and somebody outside
     it was made a member of the room and told about every message in it —
     an id that was nobody's at all was a 500. */
  const [inside] = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) => tx<{ n: number }[]>`
    select count(distinct m.actor_id)::int as n from membership m
    where m.workspace_id = ${ctx.workspaceId} and m.deleted_at is null and m.joined_at is not null
      and m.actor_id = any(${everyone}::uuid[])`,
  )
  if ((inside?.n ?? 0) !== everyone.length) return c.json(missing, 404)
  const [had] = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) => tx<{ id: string }[]>`
    select c.id from conversation c
    where c.workspace_id = ${ctx.workspaceId} and c.project_id is null and not c.channel
      and c.deleted_at is null
      and (select array_agg(cm.actor_id order by cm.actor_id) from conversation_member cm
           where cm.conversation_id = c.id and cm.deleted_at is null and cm.joined_at is not null)
          = (select array_agg(a order by a) from unnest(${everyone}::uuid[]) a)
    order by c.created_at
    limit 1`,
  )
  if (had) return c.json({ id: had.id }, 200)

  const id = uuidv7()
  await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    await tx`
      insert into conversation (id, workspace_id, project_id, name)
      values (${id}, ${ctx.workspaceId}, null, ${body.data.name ?? null})`
    for (const actorId of [...new Set([ctx.actorId, ...body.data.actor_ids])]) {
      /* `joined_at`, because for a direct room the membership is the access
         rule — there is no project to fall back on. Without it the room is
         one nobody can see, including the person who opened it. */
      await tx`
        insert into conversation_member (id, workspace_id, conversation_id, actor_id, joined_at)
        values (${uuidv7()}, ${ctx.workspaceId}, ${id}, ${actorId}, now())`
    }
  })
  return c.json({ id }, 201)
})

/**
 * History, newest first, by cursor.
 *
 * The load table has a million messages in one channel, so this is
 * keyset paged from the first line rather than the first complaint: offset
 * skips rows when somebody writes while you page.
 */
/**
 * Up to here.
 *
 * Sent by the screen when it shows a room, rather than inferred from the read
 * itself: an agent listing messages through a token has not read anything,
 * and marking them read on its behalf is how somebody misses a mention. Nor
 * has the sidebar, which fetches a room's first page when the pointer passes
 * over it so the room opens at once — and when that fetch was the mark,
 * running the mouse down the list cleared every count on it.
 *
 * `mark_read` also makes the reader a member if they were not one, which is
 * how somebody who reaches a project's channel through the project gets a
 * mark of their own.
 */
chat.post('/conversations/:id/read', async (c) => {
  const ctx = c.get('ctx')
  if (ctx.viaMcp) return c.json({ ok: true })
  await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    await tx`select mark_read(${c.req.param('id')}, ${ctx.actorId}, ${ctx.workspaceId})`
    /*
     * And what the inbox holds about this room. A mention read in the room
     * has been read; left in the inbox it is a second count for the one
     * thing, and the one that does not clear is the one people stop
     * trusting. Only what has already arrived: a notification held by quiet
     * hours is about something said after now, as far as this person knows.
     */
    await tx`
      update notification set read_at = now()
      where actor_id = ${ctx.actorId} and object_type = 'conversation'
        and object_id = ${c.req.param('id')} and read_at is null
        /* A direct message waits a few seconds before it may be pushed;
           read in that time, it is read, and no phone is told about it. */
        and (deliver_after <= now() or reason = 'messaged')`
    /* And the phones' icons, which no socket reaches in a pocket. */
    await owesCount(tx, ctx.actorId, ctx.workspaceId)
  })
  /*
   * And the count goes away where it is drawn.
   *
   * The sidebar is not refetched by opening a room — it is refetched by
   * hearing something — so without this the number stays beside a room that
   * has just been read. Addressed to the person rather than to the room,
   * which also means the phone in a pocket stops showing a three for
   * something read on a laptop.
   */
  await publish(`actor:${ctx.actorId}`, 'read', { conversation_id: c.req.param('id'), workspace_id: ctx.workspaceId })
  return c.json({ ok: true })
})

/**
 * Who is in this room.
 *
 * Through the definer function, because the answer is about other people:
 * `actor` is readable only through the workspace, so asking plainly returns
 * emptiness — and emptiness here reads as an empty room rather than as a
 * question the caller was not allowed to ask.
 */
chat.get('/conversations/:id/members', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const { rows, chosen } = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    /* With what the list of them shows when opened — what each does and
       whether they are here — `docs/specs/room-people.md`. */
    const rows = await tx`
      select cm.*, a.title, case when m.actor_id is not null then presence_of(a.seen_at, a.presence) end as presence, m.role
      from channel_members(${id}) cm
      join actor a on a.id = cm.actor_id
      left join membership m on m.actor_id = cm.actor_id
        and m.workspace_id = ${ctx.workspaceId} and m.deleted_at is null
      /* Not a feedback page's actor, which is on the project only to file
         requests: nobody to mention or count. */
      where not page_actor(cm.actor_id)
      order by a.name`
    /* Whether these people were chosen or are simply the project's. The
       screen cannot tell the two apart by counting — a channel chosen for
       everyone looks the same — and the difference is what it has to say. */
    const [c2] = await tx<{ chosen: boolean }[]>`
      select chosen or project_id is null as chosen from conversation where id = ${id}`
    return { rows, chosen: c2?.chosen === true }
  })
  return c.json({
    members: rows.map((r) => faced(r as { avatar_key?: string | null })),
    chosen,
  })
})

/**
 * Throwing a channel away.
 *
 * There was a permission for this and no way to do it: `channel.delete` sat
 * in the project's settings, could be given and taken back, and granted
 * access to an endpoint nobody had written. A control that decides nothing
 * is worse than a missing one — somebody withholds it and believes they
 * have withheld something.
 *
 * A project's channel only. A direct conversation is not a room anybody
 * owns: you leave it, and leaving it for everyone else is not a thing one of
 * two people gets to decide.
 *
 * Marked, not removed. The clear-out in the worker is what finally takes it,
 * and until then it is a room that can be brought back by hand — the same
 * bargain every other object here makes.
 */
chat.delete('/conversations/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')

  const result = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [row] = await tx<RoomRow[]>`
      select project_id, channel, created_by from conversation where id = ${id} and deleted_at is null`
    // Not readable and not there look the same from outside: that a room
    // exists is information.
    if (!row) return 'missing' as const
    if (!row.channel) return 'direct' as const
    if (!roomCan(ctx, row).includes('delete')) return 'forbidden' as const

    /* Who did it, for Undo. */
    await tx`update conversation set deleted_at = now(), deleted_by = ${ctx.actorId} where id = ${id}`
    await record(tx, ctx, 'conversation.delete', {
      projectId: row.project_id,
      objectType: 'conversation',
      objectId: id,
    })
    return 'ok' as const
  })
  if (result === 'missing') {
    /* Or a room nobody is in, ended by whoever may. */
    const projectId = await endEmptyRoom(ctx, id, false)
    if (!projectId) return c.json(missing, 404)
    await publish(`project:${projectId}`, 'conversation', { id })
    return c.json({ ok: true })
  }
  if (result === 'direct') {
    return c.json({ error: { code: 'invalid', message: 'You can’t delete a direct conversation, but you can leave it.' } }, 400)
  }
  if (result === 'forbidden') return c.json(forbidden, 403)
  return c.json({ ok: true })
})

/*
 * A channel put back, which is what the toast's Undo presses.
 *
 * The question deleting asked: whoever may delete the project's channels,
 * or a workspace channel's maker. Never through a token. Only while the row
 * is still there, to whoever could see the room while it stood — its people
 * when they were chosen — and `404` for anybody else, as for a room that
 * never was. Back as it was: its name, its people, every message in it.
 */
chat.post('/conversations/:id/restore', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const result = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [row] = await tx<(RoomRow & { deleted_by: string | null })[]>`
      select project_id, channel, created_by, deleted_by from deleted_room(${id})`
    if (!row?.channel) return 'missing' as const
    if (ctx.viaMcp || ctx.viaGithub || ctx.viaImport || !roomCan(ctx, row).includes('delete')) return 'forbidden' as const
    const [back] = await tx<{ ok: boolean }[]>`select room_back(${id}) as ok`
    if (!back?.ok) return 'missing' as const
    /* No name in the line: the feed names a room only to whoever may see
       it (`conversation_seen`), and a room of chosen people is sent to no
       webhook (`queue_webhooks`) — as its delete was not. */
    await record(tx, ctx, 'conversation.restore', {
      projectId: row.project_id,
      objectType: 'conversation',
      objectId: id,
    })
    return { projectId: row.project_id }
  })
  if (result === 'missing') return c.json(missing, 404)
  if (result === 'forbidden') return c.json(forbidden, 403)
  /* The rooms' lists read again, as a room's people changing has them. */
  await publish(result.projectId ? `project:${result.projectId}` : `conversation:${id}`, 'conversation', { id })
  return c.json({ ok: true })
})

/*
 * A room's history, brought across from Slack.
 *
 * Batches of a thousand, oldest first; each answers the ids it gave, so a
 * reply in a later batch names its parent directly. Only into a room nobody
 * has said anything in yet, by whoever may make channels in its project,
 * and never through a token: somebody else's history landing in a room
 * with nobody having looked is what an import through a tool would be.
 */
const Imported = z.object({
  messages: z
    .array(
      z.object({
        key: z.string().min(1).max(64),
        name: z.string().min(1).max(200),
        email: z.string().max(320).optional(),
        text: z.string().max(40_000).default(''),
        /* Said in Slack, so said already: a line dated next week is not history. */
        at: z.iso.datetime({ offset: true }).refine((at) => Date.parse(at) <= Date.now()),
        parent_key: z.string().max(64).optional(),
        parent_id: z.uuid().optional(),
        /* Files already brought by `/import/file`, drawn under the words. */
        files: z
          .array(
            z.object({
              id: z.uuid(),
              name: z.string().max(300),
              kind: z.enum(['image', 'video', 'file']),
              pixelWidth: z.number().int().positive().optional(),
              pixelHeight: z.number().int().positive().optional(),
            }),
          )
          .max(20)
          .optional(),
      }),
    )
    .min(1)
    .max(1000),
})

chat.post('/conversations/:id/import', async (c) => {
  const ctx = c.get('ctx')
  if (ctx.viaMcp) return c.json(forbidden, 403)
  const id = c.req.param('id')
  const body = Imported.safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)

  const result = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [room] = await tx<{ project_id: string | null; channel: boolean }[]>`
      select project_id, channel from conversation where id = ${id} and deleted_at is null`
    if (!room) return 'missing' as const
    /* Whoever may make rooms like it: a project's, the workspace's — and a
       direct conversation is its own people's, who are the only ones who
       can see it to ask. */
    const may = room.project_id
      ? allowIn(ctx, 'channel.create', room.project_id)
      : room.channel
        ? allow(ctx, 'channel.create.workspace')
        : true
    if (!may) return 'forbidden' as const
    const [said] = await tx`
      select 1 from message where conversation_id = ${id} and origin <> 'import' limit 1`
    if (said) return 'said' as const

    const emails = [...new Set(body.data.messages.map((m) => m.email?.toLowerCase()).filter(Boolean))] as string[]
    const byEmail = new Map<string, string>()
    if (emails.length) {
      for (const r of await tx<{ email: string; actor_id: string }[]>`
        select email, actor_id from members_by_email(${emails})`)
        byEmail.set(r.email, r.actor_id)
    }
    /*
     * Whose face a line is drawn with. Whoever brings the room across is
     * the author of their own lines; somebody else's are theirs only when
     * the one bringing them may change what other people said — the owner,
     * whoever runs the project — and only for somebody who can read the
     * room. Everybody else keeps the name they were said under, *from
     * Slack* beside it. A member could otherwise put any colleague's face
     * on any line, in a room that colleague would never open.
     */
    const vouches = allowIn(ctx, 'content.edit.said', room.project_id, { isAuthor: false })
    const others = [...new Set(byEmail.values())].filter((a) => a !== ctx.actorId)
    const here = new Set(
      vouches && others.length
        ? (
            await tx<{ id: string }[]>`
            select a as id from unnest(${others}::uuid[]) as a where sees_conversation(${id}, a)`
          ).map((r) => r.id)
        : [],
    )
    for (const [email, actor] of byEmail) if (actor !== ctx.actorId && !here.has(actor)) byEmail.delete(email)

    const ids: Record<string, string> = {}
    for (const m of body.data.messages) {
      const who = m.email ? byEmail.get(m.email.toLowerCase()) : undefined
      const parent = m.parent_id ?? (m.parent_key ? ids[m.parent_key] : undefined) ?? null
      const made = uuidv7()
      const paragraphs: unknown[] = m.text
        ? m.text.split(/\n/).map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }))
        : []
      /* The node a sent file is: `fileId`, as the editor and the renderer
         read it — named `id` here, the pictures came across and drew as
         empty frames of their size. */
      for (const { id: fileId, ...f } of m.files ?? []) paragraphs.push({ type: 'attachment', attrs: { fileId, ...f } })
      /* Through `import_message`: written in a colleague's name, the
         insert policy refused it — it asks that the writer is the author. */
      await tx`
        select import_message(${made}, ${ctx.workspaceId}, ${id}, ${who ?? ctx.actorId}, ${parent},
                              ${tx.json({ type: 'doc', content: paragraphs } as never)},
                              ${who ? null : m.name}, ${m.at})`
      ids[m.key] = made
      if (m.files?.length) await claimFiles(tx, { type: 'message', id: made }, { content: paragraphs })
    }
    await tx`select mark_read(${id}, ${ctx.actorId}, ${ctx.workspaceId})`
    await record(tx, ctx, 'conversation.import', {
      projectId: room.project_id,
      objectType: 'conversation',
      objectId: id,
      meta: { count: body.data.messages.length, from: 'slack' },
    })
    return { ids, project: room.project_id }
  })
  if (result === 'missing') return c.json(missing, 404)
  if (result === 'forbidden') return c.json(forbidden, 403)
  if (result === 'said') {
    return c.json({ error: { code: 'invalid', message: 'You can only import into an empty chat.' } }, 409)
  }
  await publish(result.project ? `project:${result.project}` : `conversation:${id}`, 'conversation', { id })
  return c.json({ ids: result.ids })
})

/*
 * One file a Slack message carried, fetched by the server and kept as a file
 * of the room's home.
 *
 * Only from Slack's file host, and only while the importing room is still
 * the importer's to fill: an address the server will fetch on somebody's
 * say-so is a way to make it ask anything, so the host is fixed and checked
 * again after any redirect. The link's own key is what lets it through;
 * without one Slack answers its sign-in page, which is said, not stored.
 */
const SLACK_HOSTS = /(^|\.)(slack\.com|slack-edge\.com)$/

chat.post('/conversations/:id/import/file', async (c) => {
  const ctx = c.get('ctx')
  if (ctx.viaMcp) return c.json(forbidden, 403)
  const id = c.req.param('id')
  const body = z.object({ url: z.url(), name: z.string().min(1).max(300) }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const asked = new URL(body.data.url)
  if (asked.protocol !== 'https:' || asked.hostname !== 'files.slack.com') {
    return c.json({ error: { code: 'invalid', message: 'Only files from Slack can be imported.' } }, 400)
  }

  const room = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [r] = await tx<{ project_id: string | null; channel: boolean }[]>`
      select project_id, channel from conversation where id = ${id} and deleted_at is null`
    if (!r) return null
    const may = r.project_id ? allowIn(ctx, 'channel.create', r.project_id) : r.channel ? allow(ctx, 'channel.create.workspace') : true
    const [said] = await tx`select 1 from message where conversation_id = ${id} and origin <> 'import' limit 1`
    return may && !said ? r : 'refused'
  })
  if (!room) return c.json(missing, 404)
  if (room === 'refused') return c.json(forbidden, 403)

  /* Redirects followed by hand, each checked before it is asked: followed
     by `fetch`, the hop to wherever would be made before anything looked. */
  let got: Response | null = null
  let at = asked
  for (let hop = 0; hop < 4; hop++) {
    got = await fetch(at, { redirect: 'manual', signal: AbortSignal.timeout(30_000) }).catch(() => null)
    const next = got && got.status >= 300 && got.status < 400 ? got.headers.get('location') : null
    if (!next) break
    at = new URL(next, at)
    if (at.protocol !== 'https:' || !SLACK_HOSTS.test(at.hostname)) {
      got = null
      break
    }
  }
  const type = got?.headers.get('content-type') ?? ''
  if (!got || !got.ok || type.startsWith('text/html')) {
    return c.json({ error: { code: 'gone', message: 'Couldn’t get that file from Slack.' } }, 422)
  }
  if (Number(got.headers.get('content-length') ?? 0) > MAX_FILE_BYTES) {
    return c.json({ error: { code: 'too_large' } }, 413)
  }
  /* Read up to the ceiling and no further: without a length said, the whole
     answer was held in memory before its size was asked. */
  const parts: Uint8Array[] = []
  let size = 0
  const reader = got.body?.getReader()
  while (reader) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_FILE_BYTES) {
      await reader.cancel().catch(() => {})
      return c.json({ error: { code: 'too_large' } }, 413)
    }
    parts.push(value)
  }
  const bytes = new Uint8Array(size)
  let at2 = 0
  for (const part of parts) {
    bytes.set(part, at2)
    at2 += part.byteLength
  }

  const fileId = uuidv7()
  const made = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    if (!(await fits(tx, ctx.workspaceId, bytes.byteLength))) return null
    const stored = await put(ctx.workspaceId, bytes, type || 'application/octet-stream')
    if (!(await roomFor(tx, ctx.workspaceId, stored.size))) {
      await remove(stored.key).catch(() => {})
      return null
    }
    /* A project's room keeps its files in the project's Docs, and names
       itself on them, so a channel with chosen people keeps them to its
       people; any other room keeps its own. */
    await tx`
      insert into file (id, workspace_id, project_id, conversation_id, author_id, name, storage_key,
                        content_type, size_bytes, uploaded_at)
      values (${fileId}, ${ctx.workspaceId}, ${room.project_id}, ${id},
              ${ctx.actorId}, ${body.data.name}, ${stored.key}, ${stored.contentType}, ${stored.size}, now())`
    return stored
  })
  if (!made) return c.json({ error: { code: 'limit', message: 'This workspace is out of storage.' } }, 413)
  return c.json({ id: fileId, name: body.data.name, content_type: made.contentType, size: made.size })
})

chat.get('/conversations/:id/messages', async (c) => {
  const ctx = c.get('ctx')
  const limit = pageSize(c.req.query('limit'), 50, 200)
  const cursor = c.req.query('cursor')
  /* `<moment>_<id>`, or a bare moment from before (`id` null), read to the
     end of its millisecond; anything else is a 400, not a cast the
     database refuses with a 500. */
  const from = cursor === undefined ? null : timeCursor(cursor)
  if (cursor !== undefined && !from) return c.json({ error: { code: 'invalid' } }, 400)
  const parent = c.req.query('thread') ?? null
  /*
   * The room's messages that say these words — replies in threads too,
   * newest first, on the same cursor. `said` is the body's words, drawn out
   * by the database and trigram-indexed: `docs/specs/find.md`.
   */
  const words = (c.req.query('q') ?? '').trim()
  if (words) {
    if (words.length < 2) return c.json({ messages: [], next_cursor: null })
    /* Through `search_room`, which can use the words' index: under the
       room's row-level security `ilike` cannot, and every message of the
       room was read for every search. */
    /* On the room history's cursor, the moment sent as text: as the
       function's timestamp it went through a Date, to the millisecond,
       and the messages of one moment past a page were never found
       (migration 304). */
    const found = await withActor(
      ctx.actorId,
      ctx.workspaceId,
      (tx) =>
        tx<{ id: string; created_at: string; at_key: string }[]>`
        select f.*, to_char(f.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at_key
        from search_room(${c.req.param('id')}, ${words},
          ${
            !from
              ? tx`null::timestamptz`
              : from.id
                ? tx`${from.at}::text::timestamptz`
                : tx`${from.at}::text::timestamptz + interval '1 millisecond'`
          },
          ${from?.id ?? null}::uuid, ${Math.min(limit, 30)}) f`,
    )
    const last = found[found.length - 1]
    return c.json({
      messages: found.map(({ at_key: _, ...r }) => facedAs(r, 'author_avatar', 'author_avatar_url')),
      next_cursor: found.length === Math.min(limit, 30) && last ? `${last.at_key}_${last.id}` : null,
    })
  }

  const rows = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      tx<{ id: string; created_at: string; total: number; at_key: string }[]>`
      /* The page as before, and then no more of it than 4 MB of bodies —
         at least one — so rows written before there was a ceiling cannot
         make an answer of gigabytes: Weighed in
         the page alone, never across the room. */
      with page as (
        select m.id, m.created_at, octet_length(m.body::text) as weight from message m
        where m.conversation_id = ${c.req.param('id')}
          -- A deleted message stays as a line while it has answers, so the
          -- thread has something to hang off: docs/specs/message-edit.md.
          and (m.deleted_at is null or (${parent === null} and exists (
            select 1 from message r where r.parent_id = m.id and r.deleted_at is null)))
          ${parent ? tx`and m.parent_id = ${parent}` : tx`and (m.parent_id is null or m.also_in_room)`}
          ${
            /* `<moment>_<id>`, so a page cut inside messages written in one
               moment neither skips nor repeats them; a bare moment is the
               cursor this answered before, and still read. */
            !from
              ? tx``
              : from.id
                ? tx`and (m.created_at, m.id) < (${from.at}::text::timestamptz, ${from.id}::uuid)`
                : tx`and m.created_at < ${from.at}::text::timestamptz + interval '1 millisecond'`
          }
        order by m.created_at desc, m.id desc
        limit ${limit}
      ), kept as (
        select id, row_number() over (order by created_at desc, id desc)::int as n,
               sum(weight) over (order by created_at desc, id desc)::bigint as running,
               count(*) over ()::int as total
        from page
      )
      select m.id, m.body, k.total,
             to_char(m.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at_key,
             /* Somebody brought across by name has no one here to be:
                no id, no face, the name they were said under. */
             case when m.said_as is null then m.author_id end as author_id,
             coalesce(m.said_as, a.name) as author_name, m.said_as,
             case when m.said_as is null then a.avatar_key end as author_avatar,
             m.parent_id,
             m.origin, m.created_at, m.edited_at, m.deleted_at,
             -- A reply also said in the room, and the words of the
             -- message its thread hangs from: docs/specs/chat-threads.md.
             m.also_in_room,
             -- The incoming webhook it came through:
             m.hook_id,
             case when m.also_in_room and ${parent === null} then
               (select substr(p.said, 1, 140) from message p
                where p.id = m.parent_id and p.deleted_at is null)
             end as thread_said,
             (select count(*) from message r
              where r.parent_id = m.id and r.deleted_at is null) as replies,
             -- Who answered, the latest first, four at most, and when the
             -- last answer came: drawn under the message as faces.
             (select max(r.created_at) from message r
              where r.parent_id = m.id and r.deleted_at is null) as last_reply_at,
             (select json_agg(json_build_object('id', w.id, 'name', w.name, 'avatar_key', w.avatar_key)
                              order by w.at desc)
              -- Somebody brought across from Slack by name is that name,
              -- not the person who ran the import.
              from (select coalesce(case when r.said_as is null then ra.id::text end, 'as:' || r.said_as) as id,
                           coalesce(r.said_as, ra.name) as name,
                           case when r.said_as is null then ra.avatar_key end as avatar_key,
                           max(r.created_at) as at
                    from message r join actor ra on ra.id = r.author_id
                    where r.parent_id = m.id and r.deleted_at is null
                    group by 1, 2, 3
                    order by max(r.created_at) desc limit 4) w) as repliers,
             -- Each emoji once, with who put it there, in the order they
             -- first arrived: docs/specs/chat-threads.md.
             coalesce((
               select json_agg(json_build_object('emoji', g.emoji, 'actors', g.actors)
                               order by g.first)
               from (select x.emoji, array_agg(x.actor_id order by x.created_at) as actors,
                            min(x.created_at) as first
                     from message_reaction x where x.message_id = m.id
                     group by x.emoji) g
             ), '[]'::json) as reactions,
             -- The task it was made into, drawn under it as the task's
             -- card: docs/specs/chat-threads.md. Through the task, so one
             -- deleted or not the reader's to see is not there to draw.
             (select l.from_id from object_link l
              join task t on t.id = l.from_id and t.deleted_at is null
              where l.to_id = m.id and l.to_type = 'message' and l.from_type = 'task'
                and l.deleted_at is null
              order by l.created_at limit 1) as promoted_task_id
      from kept k
      join message m on m.id = k.id
      join actor a on a.id = m.author_id
      where k.n = 1 or k.running <= ${MESSAGE_BYTES_MOST}
      order by m.created_at desc, m.id desc`,
  )
  /* Cut short by weight, the rest are the next page's; else as before. */
  const more = rows.length > 0 && (rows.length < rows[0]!.total || rows.length === limit)
  return c.json({
    messages: rows
      .map(({ total: _total, at_key: _at, ...r }) => r)
      .slice()
      .reverse()
      .map((r) => facedAs(r, 'author_avatar', 'author_avatar_url'))
      .map((r) => {
        const row = r as Record<string, unknown>
        const repliers = (row.repliers as { id: string; name: string; avatar_key: string | null }[] | null) ?? []
        return { ...row, repliers: repliers.map((p) => faced(p)) }
      })
      /* Nothing of what a deleted message said travels: not its words, its
         files or who reacted to it. */
      .map((r) => {
        const row = r as Record<string, unknown>
        return row.deleted_at ? { ...row, body: null, reactions: [], deleted: true } : row
      }),
    next_cursor: more ? `${rows[rows.length - 1]!.at_key}_${rows[rows.length - 1]!.id}` : null,
  })
})

/** How much of message bodies one page carries. */
export const MESSAGE_BYTES_MOST = 4 * 1024 * 1024

/**
 * A GIF in a message is KLIPY's address and nothing else — `docs/specs/gifs.md`.
 * The body is drawn by every reader's browser, so a node that could point
 * anywhere would be a way to make all of them fetch it.
 */
export function onlyKlipy(body: unknown): boolean {
  const walk = (n: unknown): boolean => {
    if (!n || typeof n !== 'object') return true
    const node = n as { type?: unknown; attrs?: { url?: unknown }; content?: unknown }
    if (node.type === 'gif' && !(typeof node.attrs?.url === 'string' && /^https:\/\/static\d*\.klipy\.com\//.test(node.attrs.url)))
      return false
    return Array.isArray(node.content) ? node.content.every(walk) : true
  }
  return walk(body)
}

/** The deployment's KLIPY key, for the browser to ask KLIPY with — its
    terms want the asking done there, not through us. Null: no GIFs here. */
chat.get('/gifs/key', (c) => c.json({ key: env.klipyApiKey || null }))

chat.post('/conversations/:id/messages', async (c) => {
  const ctx = c.get('ctx')
  const conversationId = c.req.param('id')
  const body = z
    .object({
      body: RichBody,
      /** A thread hangs off a message rather than the channel being one river. */
      parent_id: z.uuid().nullish(),
      /**
       * Chosen by the sender, so the row it drew and the row stored here are
       * one row. The screen puts the message up
       * before this request goes out, and the merge that folds the real one
       * in matches on id.
       *
       * Safe because the id names the row and decides nothing about it: the
       * conversation comes from the path, the author from the token, the
       * workspace from the session. An id already taken fails the primary
       * key below, which is the right answer and the only one.
       */
      id: z.uuid().optional(),
      /**
       * A reply said in the room as well — Slack's "Also send to #channel",
       * `docs/specs/chat-threads.md`. One message with this on it, never a
       * copy; ignored on a message that is not a reply.
       */
      also_in_room: z.boolean().optional(),
    })
    .safeParse(await c.req.json().catch(() => ({})))
  if (!body.success || !onlyKlipy(body.data.body)) return c.json({ error: { code: 'invalid' } }, 400)

  const id = body.data.id ?? uuidv7()
  const alsoInRoom = Boolean(body.data.parent_id && body.data.also_in_room)
  let made: { project_id: string | null } | 'gone' | null
  try {
    made = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
      const [conv] = await tx<{ project_id: string | null; channel: boolean; gone: boolean | null }[]>`
        select project_id, channel,
               /* A direct conversation whose everybody else was removed:
                  what is written there reaches nobody. */
               (select bool_and(not exists (select 1 from membership mg
                                            where mg.workspace_id = c.workspace_id
                                              and mg.actor_id = cm.actor_id
                                              and mg.deleted_at is null))
                from conversation_member cm
                where cm.conversation_id = c.id and cm.deleted_at is null
                  and cm.actor_id <> ${ctx.actorId} and not c.channel) as gone
        from conversation c
        where id = ${conversationId} and deleted_at is null`
      if (!conv) return null
      if (conv.gone) return 'gone' as const
      /* Said in a channel or directly. */
      if (!conv.channel) used(c, 'dm.send')
      await tx`
        insert into message (id, workspace_id, conversation_id, author_id, parent_id, body, origin, also_in_room)
        values (${id}, ${ctx.workspaceId}, ${conversationId}, ${ctx.actorId},
                ${body.data.parent_id ?? null}, ${tx.json((await veilDocrefs(tx, body.data.body)) as never)},
                ${ctx.viaMcp ? 'mcp' : 'web'}::origin_kind, ${alsoInRoom})`
      /* A room somebody put away comes back out when something is said in
         it, and stands at the head of their list — sidebar-hide.md. Not
         for whoever said it: their own words are not news to them, though
         speaking in a room is reason enough to have it back. */
      await tx`
        update conversation_member
        set hidden_at = null,
            surfaced_at = case when actor_id = ${ctx.actorId} then surfaced_at else now() end,
            updated_at = now()
        where conversation_id = ${conversationId} and deleted_at is null and hidden_at is not null
          /* Not a room somebody left: it stays put away -- leaving.md. */
          and left_at is null`
      // Chat is the one thing separable from the rest of the inbox: a busy
      // channel otherwise drowns the assignments and nobody reads either.
      /* A reply reaches the thread's people — whoever started it and
         whoever has answered — named or not. `docs/specs/notifications.md`. */
      const thread = body.data.parent_id
        ? (await tx<{ actor_id: string }[]>`select * from thread_people(${body.data.parent_id})`).map((r) => r.actor_id)
        : []
      const who = thread.length ? await doer(tx, ctx.actorId) : null
      await notify(tx, ctx, {
        objectType: 'conversation',
        objectId: conversationId,
        body: body.data.body,
        isChat: true,
        ...(who
          ? {
              also: { ids: thread, reason: 'replied' as const },
              kind: 'replied' as const,
              whatFor: { replied: (l) => LINES(l).replied(who(l)) },
            }
          : {}),
      })
      // What was sent with it says it was sent here — docs/specs/docs.md.
      await claimFiles(tx, { type: 'message', id }, body.data.body)
      return conv
    })
  } catch (e) {
    /*
     * An id already used, which is the one way a sender-chosen id can fail.
     * The primary key refuses it and nothing is
     * written, so the message that is there stays as it was.
     *
     * 409 and not 500: the request was understood and declined. It says
     * nothing about whose message holds that id, because a uuid v7 the
     * caller guessed told it that already.
     *
     * On `23505` and not on anything that went wrong in here. A bare `catch`
     * would answer "that id is taken" to a notification that failed for its
     * own reasons, which is a wrong diagnosis handed to the one client in a
     * position to believe it.
     */
    if ((e as { code?: string }).code !== '23505') throw e
    return c.json({ error: { code: 'conflict', message: 'That id is taken' } }, 409)
  }
  if (!made) return c.json(missing, 404)
  if (made === 'gone') {
    return c.json({ error: { code: 'gone', message: 'They’re no longer in this workspace.' } }, 409)
  }

  await told(ctx.actorId, ctx.workspaceId, conversationId, id, ctx.tab ?? null)
  return c.json({ id }, 201)
})

/**
 * A message is in the room: said round the room's socket, and to everybody
 * who can see the room wherever they are looking. The sender's own words
 * and a hook's alike. `actorId` is who
 * the message was written as; nobody is told of their own.
 */
export async function told(
  actorId: string,
  workspaceId: string,
  conversationId: string,
  id: string,
  tab: string | null,
  /** Who said it, not told of their own words; null for a hook, whose maker is told too. */
  self: string | null = actorId,
): Promise<void> {
  // What travels is the fact, not the row: everyone who hears it fetches
  // through the same endpoint they would have used anyway, so there is one
  // path into the data rather than two that can disagree.
  /* Who said it, so a reader drops them from who is typing at once rather
     than six seconds later. */
  await publish(`conversation:${conversationId}`, 'message', {
    id,
    conversation_id: conversationId,
    tab: tab,
    author_id: self,
  })

  /*
   * And everybody who can see the room, wherever they are looking.
   *
   * The conversation topic only reaches the people with that room open. The
   * sidebar's count is for the people who do not, and it was read once when
   * the shell loaded and never again — a message in a channel nobody was
   * looking at arrived when somebody next pressed reload.
   *
   * Who that is, is the same question as who may read it: the room's own
   * members, or — for a project's channel, which is made with no member rows
   * at all — everybody on the project.
   */
  /* A room of chosen people is theirs alone to hear about: the project's
     everybody was told that something was said in it, which is how a room
     one is not in shows how busy it is. */
  const heard = await withActor(
    actorId,
    workspaceId,
    (tx) => tx<{ actor_id: string }[]>`
    with chosen as (
      /* A room outside projects is only ever its rows. */
      select coalesce((select c.chosen or c.project_id is null
                       from conversation c where c.id = ${conversationId}), true) as yes
    )
    select cm.actor_id from conversation_member cm, chosen
    where cm.conversation_id = ${conversationId} and cm.deleted_at is null
      and (cm.joined_at is not null or not chosen.yes)
      /* Nobody removed from the workspace: a socket of theirs heard the
         room — docs/specs/removing-someone.md. */
      and exists (select 1 from membership m
                  where m.workspace_id = ${workspaceId} and m.actor_id = cm.actor_id
                    and m.deleted_at is null)
    union
    select pm.actor_id from project_member pm
    join conversation c on c.id = ${conversationId} and c.project_id = pm.project_id, chosen
    where pm.deleted_at is null and not chosen.yes`,
  )
  /* One notice for all of them, not one round trip each: a room of a
     thousand made sending wait for a thousand. */
  await publishMany(
    heard.filter((h) => h.actor_id !== self).map((h) => `actor:${h.actor_id}`),
    'message',
    { conversation_id: conversationId, workspace_id: workspaceId },
  )
}

/**
 * Changing what you said, and taking it back — `docs/specs/message-edit.md`.
 *
 * An edit is the author's alone: a message is speech with a name on it.
 * Deleting is the author's too, and in a project's room also whoever may
 * change what is said there (`content.edit.said`). Neither tells anybody;
 * both travel round the room's socket.
 */
async function heldMessage(ctx: AuthContext, id: string) {
  return withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    /* A message brought across under somebody's name is that person's,
       not the importer's — nobody here edits it as their own. */
    const [row] = await tx<{ author_id: string; conversation_id: string; project_id: string | null; hook_id: string | null }[]>`
      select coalesce(case when m.said_as is null then m.author_id end, '00000000-0000-0000-0000-000000000000'::uuid) as author_id,
             m.conversation_id, cv.project_id, m.hook_id
      from message m join conversation cv on cv.id = m.conversation_id
      where m.id = ${id} and m.deleted_at is null`
    return row ?? null
  })
}

chat.patch('/messages/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const body = z.object({ body: RichBody }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success || !onlyKlipy(body.data.body)) return c.json({ error: { code: 'invalid' } }, 400)
  const row = await heldMessage(ctx, id)
  if (!row) return c.json(missing, 404)
  if (row.author_id !== ctx.actorId || !allow(ctx, 'content.edit.own', { inProject: true, isAuthor: true })) {
    return c.json(forbidden, 403)
  }
  await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    await tx`update message set body = ${tx.json((await veilDocrefs(tx, body.data.body)) as never)}, edited_at = now()
       where id = ${id} and author_id = ${ctx.actorId}`
    await claimFiles(tx, { type: 'message', id }, body.data.body)
  })
  await publish(`conversation:${row.conversation_id}`, 'message', { id, conversation_id: row.conversation_id, tab: ctx.tab ?? null })
  return c.json({ ok: true })
})

chat.delete('/messages/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const row = await heldMessage(ctx, id)
  if (!row) return c.json(missing, 404)
  /* Somebody else's only in a project's room: a direct conversation has
     nobody running it. */
  const may =
    row.author_id === ctx.actorId
      ? allow(ctx, 'content.edit.own', { inProject: true, isAuthor: true })
      : (row.project_id !== null && mayEditSaid(ctx, row.author_id, row.project_id)) ||
        /* A webhook's message, by whoever may manage the room's webhooks —
           in a channel outside every project too, where nobody runs
           anything else. */
        (row.hook_id !== null &&
          (row.project_id ? allowIn(ctx, 'hook.manage', row.project_id) : allow(ctx, 'hook.manage', { inProject: false })))
  /* Never through a token, one's own included — as a task is not. */
  if (!may || ctx.viaMcp) return c.json(forbidden, 403)
  await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    // Soft, like everything else, and the clear-out takes it for good.
    await tx`update message set deleted_at = now() where id = ${id}`
    /*
     * And what the message brought with it.
     * Its attachments stayed in the project's Docs, in
     * search and behind `/url`, to people who joined after, and nothing
     * ever cleared them out. Only a file this message is the place of
     * (`origin_type`), sent into this room, and not held by a document: a
     * file that was somewhere first — in Docs, in a task, a picture put
     * into a document — was not the message's to take. The same moment as
     * the message's, and the same deleter, so the two go to the clear-out
     * together and the bin offers the file back to whoever deleted it.
     *
     * Only when its author takes it back, and only what they uploaded: a
     * file is deleted by `file.delete` or by its own uploader, and somebody
     * who may delete others' messages (`content.edit.said`, a hook's
     * manager) holds neither by that — their delete leaves the files where
     * they are, for Docs' own delete.
     */
    const files =
      row.author_id !== ctx.actorId
        ? []
        : await tx<{ id: string; project_id: string | null; name: string; chosen: boolean }[]>`
      update file f set deleted_at = now(), deleted_by = ${ctx.actorId}
      where f.workspace_id = ${ctx.workspaceId} and f.origin_type = 'message' and f.origin_id = ${id}
        and f.author_id = ${ctx.actorId} and f.conversation_id = ${row.conversation_id}
        and f.held_by is null and f.deleted_at is null
      returning f.id, f.project_id, f.name, ${apart(tx)} as chosen`
    /* Named in the feed as a file deleted in Docs is, which also has the
       project's screens read Docs again — not for a room of chosen people,
       which never told its upload either. */
    for (const f of files) {
      if (f.project_id && !f.chosen) {
        await record(tx, ctx, 'file.delete', { projectId: f.project_id, objectType: 'file', objectId: f.id, meta: { title: f.name } })
      }
    }
  })
  await publish(`conversation:${row.conversation_id}`, 'message', { id, conversation_id: row.conversation_id, tab: ctx.tab ?? null })
  return c.json({ ok: true })
})

/**
 * An emoji on a message, and taking it back — `docs/specs/chat-threads.md`.
 *
 * Anyone who can read the room; the policy is what says so, and a message
 * this person cannot read answers 404 like any other object they cannot see.
 * One per person per emoji, so adding twice is the same as adding once.
 * Nobody is notified: a thumbs-up in an inbox is the noise it keeps out.
 */
const Emoji = z
  .string()
  .min(1)
  .max(16)
  .regex(/^[\p{Extended_Pictographic}\p{Emoji_Component}\u200d\ufe0f\u20e3]+$/u)

async function react(c: { get: (k: 'ctx') => AuthContext; req: { param: (k: string) => string } }, on: boolean) {
  const ctx = c.get('ctx')
  const messageId = c.req.param('id')
  let raw = c.req.param('emoji')
  try {
    raw = decodeURIComponent(raw)
  } catch {
    // Already decoded, or not an escape at all; the schema decides.
  }
  const emoji = Emoji.safeParse(raw)
  if (!emoji.success) return { status: 400 as const }
  const room = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [m] = await tx<{ conversation_id: string }[]>`
      select conversation_id from message where id = ${messageId} and deleted_at is null`
    if (!m) return null
    if (on) {
      await tx`
        insert into message_reaction (id, workspace_id, message_id, actor_id, emoji)
        values (${uuidv7()}, ${ctx.workspaceId}, ${messageId}, ${ctx.actorId}, ${emoji.data})
        on conflict (message_id, actor_id, emoji) do nothing`
    } else {
      await tx`
        delete from message_reaction
        where message_id = ${messageId} and actor_id = ${ctx.actorId} and emoji = ${emoji.data}`
    }
    return m.conversation_id
  })
  if (!room) return { status: 404 as const }
  // Round the room's socket, as a message does: everyone looking sees it.
  await publish(`conversation:${room}`, 'message', { id: messageId, conversation_id: room, tab: ctx.tab ?? null })
  return { status: 204 as const }
}

chat.put('/messages/:id/reactions/:emoji', async (c) => {
  const r = await react(c, true)
  if (r.status === 400) return c.json({ error: { code: 'invalid', message: 'One emoji' } }, 400)
  if (r.status === 404) return c.json(missing, 404)
  return c.body(null, 204)
})

chat.delete('/messages/:id/reactions/:emoji', async (c) => {
  const r = await react(c, false)
  if (r.status === 400) return c.json({ error: { code: 'invalid', message: 'One emoji' } }, 400)
  if (r.status === 404) return c.json(missing, 404)
  return c.body(null, 204)
})

/**
 * The tasks a room can name.
 *
 * A project's room: its project's. A direct conversation: every project all
 * of its people are on — a task one of them cannot open is a card that says
 * nothing to them. Searched by any word of the title, by number (`61`) or by
 * handle (`MYP-61`, `myp61`); open ones first, the newest numbers first.
 * Bounded by what the asker can see like every read.
 */
/**
 * What # can name in some projects: their tasks, by a word of the title, a
 * number or a handle (`MYP-61`), and the documents written there, by name.
 */
async function nameable(tx: Tx, projects: string[], raw: string, only?: string) {
  if (projects.length === 0) return []
  const q = raw.trim().replace(/^#/, '').slice(0, 200)
  const like = `%${q.replace(/[\\%_]/g, (x) => `\\${x}`)}%`
  /* The code as it is being typed — `TRA`, `tra-11`, `TRA 119`, `119` — is
     the start of a handle, so every task whose handle starts with it is
     offered, not only the one that matches whole. */
  const code = q.toUpperCase().replace(/[\s-]+/g, '')
  /* `?kind=` narrows it to one of the two, for the composer's own buttons —
     a task and a doc are each reached by their own. */
  const tasks =
    only === 'doc'
      ? []
      : await tx`
    select t.id, t.number, t.title, t.project_id, t.completed_at, p.key as project_key
    from task t join project p on p.id = t.project_id
    where t.deleted_at is null and p.deleted_at is null
      and t.project_id = any(${projects}::uuid[])
      ${
        q
          ? tx`and (t.title ilike ${like}
               or (upper(p.key) || t.number::text) like ${code + '%'}
               or t.number::text like ${code + '%'})`
          : tx``
      }
    order by (t.completed_at is not null), t.number desc
    limit 50`
  /* And the documents written there, which # names too — a spec or a brief
     is talked about as often as a task. */
  const docs =
    only === 'task'
      ? []
      : await tx`
    select f.id, f.number, f.name as title, f.project_id, p.key as project_key, 'doc' as kind
    from file f join project p on p.id = f.project_id
    where f.deleted_at is null and p.deleted_at is null
      and f.project_id = any(${projects}::uuid[])
      and f.body is not null and f.storage_key is null and f.url is null
      ${q ? tx`and f.name ilike ${like}` : tx``}
    order by f.updated_at desc
    limit ${only === 'doc' ? 50 : q ? 10 : 5}`
  return [...tasks, ...docs]
}

chat.get('/conversations/:id/tasks', async (c) => {
  const ctx = c.get('ctx')
  const room = c.req.param('id')
  const rows = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [conv] = await tx<{ project_id: string | null }[]>`
      select project_id from conversation where id = ${room} and deleted_at is null`
    if (!conv) return null
    /* The projects every one of the room's people is on. */
    const projects = conv.project_id
      ? [conv.project_id]
      : (
          await tx<{ project_id: string }[]>`
            select pm.project_id from project_member pm
            join conversation_member cm on cm.actor_id = pm.actor_id
              and cm.conversation_id = ${room} and cm.deleted_at is null and cm.joined_at is not null
            where pm.deleted_at is null
            group by pm.project_id
            having count(distinct pm.actor_id) = (
              select count(*) from conversation_member
              where conversation_id = ${room} and deleted_at is null and joined_at is not null)`
        ).map((r) => r.project_id)
    return nameable(tx, projects, c.req.query('q') ?? '', c.req.query('kind'))
  })
  if (rows === null) return c.json(missing, 404)
  return c.json({ tasks: rows })
})

/** The same, for a task's comments: what its project can name. */
chat.get('/projects/:id/nameable', async (c) => {
  const ctx = c.get('ctx')
  const rows = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [ok] = await tx<{ ok: boolean }[]>`select in_project(${c.req.param('id')}) as ok`
    if (!ok?.ok) return null
    return nameable(tx, [c.req.param('id')], c.req.query('q') ?? '', c.req.query('kind'))
  })
  if (rows === null) return c.json(missing, 404)
  return c.json({ tasks: rows })
})

/**
 * A message becomes a task or a post in one action, with a link back.
 *
 * This is what keeps the chat around the work rather than instead of it: the
 * thing that was decided in a thread stops living only in the thread.
 */
chat.post('/messages/:id/promote', async (c) => {
  const ctx = c.get('ctx')
  const messageId = c.req.param('id')
  const body = z.object({ to: z.enum(['task', 'post']), title: z.string().min(1).max(300) }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)

  const newId = uuidv7()
  const result = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [m] = await tx<{ conversation_id: string; body: unknown }[]>`
      select conversation_id, body from message
      where id = ${messageId} and deleted_at is null`
    if (!m) return 'missing' as const
    const [conv] = await tx<{ project_id: string | null }[]>`
      select project_id from conversation where id = ${m.conversation_id}`
    const projectId = conv?.project_id
    // A direct conversation belongs to no project, so there is nowhere for the
    // task to live. Telling somebody that is better than guessing a project.
    if (!projectId) return 'no_project' as const
    /* What it is becoming decides which permission is asked for. Turning a
       message into a task is making a task, whatever door it came through —
       a second door with a looser lock is a second permission model. */
    const making = body.data.to === 'task' ? 'task.create' : 'content.create'
    if (!allowIn(ctx, making, projectId)) return 'forbidden' as const

    /* As a task or an announcement is written: a draft it names without
       its title, and its files recorded. */
    const said = await veilDocrefs(tx, m.body)
    if (body.data.to === 'task') {
      /*
       * Where `POST /projects/:id/tasks` would put it: the project's first
       * list, at the head of its column.
       *
       * It went in with no list, and a task in no list is under no heading
       * and in no column — it existed and was nowhere, which is what "Make
       * a task does not work" was. `docs/specs/chat-threads.md`.
       */
      /* Or its Triage, when it has one: said in chat is not yet agreed to. */
      const [first] = await tx<{ id: string }[]>`
        select id from task_list
        where project_id = ${projectId} and deleted_at is null
        order by intake desc, sort_key limit 1`
      const listId = first?.id ?? null
      const [edge] = await tx<{ sort_key: string }[]>`
        select sort_key from task
        where project_id = ${projectId} and deleted_at is null
          and parent_id is null and list_id is not distinct from ${listId}
        order by sort_key asc limit 1`
      /* Into a list an agent takes, given to that agent, as a task made
         with nobody on it is. */
      const taker = await listTaker(tx, ctx, projectId, listId)
      await tx`
        insert into task (id, workspace_id, project_id, author_id, list_id, title, body, sort_key, assignee_ids)
        values (${newId}, ${ctx.workspaceId}, ${projectId}, ${ctx.actorId}, ${listId},
                ${body.data.title}, ${tx.json(said as never)},
                ${generateKeyBetween(null, edge?.sort_key ?? null)}, ${taker ? [taker] : []}::uuid[])`
      if (taker) {
        const who = await doer(tx, ctx.actorId)
        await notify(tx, ctx, {
          objectType: 'task',
          objectId: newId,
          assignees: [taker],
          watchers: false,
          whatFor: { assigned: (l) => LINES(l).gaveYou(who(l)) },
        })
      }
    } else {
      await tx`
        insert into post (id, workspace_id, project_id, author_id, title, body, published_at)
        values (${newId}, ${ctx.workspaceId}, ${projectId}, ${ctx.actorId},
                ${body.data.title}, ${tx.json(said as never)}, now())`
      /* Made from a message, it is still an announcement, and reaches the
         project as one does. */
      const audience = (await tx<{ actor_id: string }[]>`select * from post_audience(${newId})`).map((r) => r.actor_id)
      const who = await doer(tx, ctx.actorId)
      await notify(tx, ctx, {
        objectType: 'post',
        objectId: newId,
        watchers: false,
        what: (l) => LINES(l).posted(who(l)),
        kind: 'posted',
        also: { ids: audience, reason: 'posted' },
      })
    }
    await tx`
      insert into object_link (id, workspace_id, from_type, from_id, to_type, to_id, created_by)
      values (${uuidv7()}, ${ctx.workspaceId}, ${body.data.to}::object_kind, ${newId},
              'message'::object_kind, ${messageId}, ${ctx.actorId})`
    await claimFiles(tx, { type: body.data.to, id: newId }, said)
    await record(tx, ctx, `message.promote.${body.data.to}`, {
      projectId,
      objectType: body.data.to,
      objectId: newId,
    })
    return 'ok' as const
  })
  if (result === 'missing') return c.json(missing, 404)
  if (result === 'forbidden') return c.json(forbidden, 403)
  if (result === 'no_project') {
    return c.json({ error: { code: 'invalid', message: 'Only messages in a project can become tasks or posts.' } }, 400)
  }
  return c.json({ id: newId }, 201)
})
