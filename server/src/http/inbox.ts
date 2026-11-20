import { Hono } from 'hono'
import { z } from 'zod'
import { withActor, withActorEverywhere, type Tx } from '../db.js'
import { facedAs } from '../storage.js'
import { allow, type AuthContext } from '../auth/context.js'
import { pageSize } from './limits.js'
import { readsAudit } from './audit.js'
import { publish } from '../realtime.js'
import { owesCount } from '../push.js'

type Vars = { ctx: AuthContext }
export const inbox = new Hono<{ Variables: Vars }>()

/**
 * One inbox, split by why it arrived rather than by what it was about.
 *
 * "Mentioned", "assigned", "subscribed" is a division somebody can act on —
 * the first two are addressed to you, the third is you keeping an eye on
 * something. A split by object type would be a filter, and a filter is a thing
 * people set once and forget.
 */
/*
 * Only notes about something still there — `docs/specs/inbox.md`.
 *
 * A note about a task, an announcement or a file that went to the bin, or
 * whose project did, opened onto "Can't find this task"; and an unread one
 * was a count on the bell that reading could never clear. Asked of the row
 * itself, under the reader's own policies, so what is listed is what opens.
 */
const standing = (tx: Tx) => tx`(
  n.object_type not in ('task', 'post', 'file', 'conversation')
  /* A room's note, to somebody who may open the room: a channel with
     chosen people is nobody else's to hear of. */
  or (n.object_type = 'conversation' and n.object_id in (select visible_conversations()))
  or exists (select 1 from task x join project xp on xp.id = x.project_id
             where n.object_type = 'task' and x.id = n.object_id and x.deleted_at is null and xp.deleted_at is null)
  or exists (select 1 from post x join project xp on xp.id = x.project_id
             where n.object_type = 'post' and x.id = n.object_id and x.deleted_at is null and xp.deleted_at is null)
  or exists (select 1 from file x left join project xp on xp.id = x.project_id
             where n.object_type = 'file' and x.id = n.object_id and x.deleted_at is null and xp.deleted_at is null)
)`

/**
 * What the bell counts — the reasons `GET /inbox` answers `unread` by, and
 * the dot on another workspace's mark asks about. One list, so the dot and
 * the bell cannot come to disagree about what is waiting.
 */
const BELL = [
  'mentioned',
  'assigned',
  'subscribed',
  'joined',
  'posted',
  'replied',
  'due',
  'added',
  'shared',
  'reminder',
  'unblocked',
  'asked',
] as const

/** The notes the bell counts, for this person, in this workspace. */
const ringing = (tx: Tx, actorId: string, workspaceId: string) => tx`
  n.actor_id = ${actorId} and n.workspace_id = ${workspaceId}
  and n.read_at is null and n.deleted_at is null
  and n.deliver_after <= now()
  and n.reason::text = any(${BELL as unknown as string[]})
  and ${standing(tx)}`

/**
 * In which of these workspaces the bell would show anything for this
 * person — the dot on another workspace's mark.
 *
 * One transaction, so one connection, however many workspaces somebody is
 * in: one per workspace at once took the pool's twenty for somebody in
 * twenty, every two minutes. Inside it the session is bound to each
 * workspace in turn, as `withActor` binds a request, so each answer is read
 * under that workspace's own policies; and each asks about this person's
 * own notes by name, answered as one yes or no. The statements are sent
 * together, in order, and the connection runs them in that order.
 *
 * The workspaces are the caller's to have checked: the ones this person is
 * a joined member of. Membership is what the policies read in any case.
 */
export async function bellsWaiting(actorId: string, workspaceIds: readonly string[]): Promise<Set<string>> {
  if (workspaceIds.length === 0) return new Set()
  return withActorEverywhere(actorId, async (tx) => {
    const asked: Promise<{ waits: boolean }[]>[] = []
    for (const ws of workspaceIds) {
      /* Its failure is the transaction's, and the answers after it say so. */
      tx`select set_config('app.workspace_id', ${ws}, true)`.execute().catch(() => {})
      asked.push(
        tx<{ waits: boolean }[]>`select exists (select 1 from notification n where ${ringing(tx, actorId, ws)}) as waits`.execute(),
      )
    }
    const answers = await Promise.all(asked)
    return new Set(workspaceIds.filter((_, i) => answers[i]?.[0]?.waits === true))
  })
}

inbox.get('/inbox', async (c) => {
  const ctx = c.get('ctx')
  const limit = pageSize(c.req.query('limit'), 50, 200)
  const cursor = c.req.query('cursor')
  const unreadOnly = c.req.query('unread') === '1'

  const rows = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      tx<{ id: string; created_at: string }[]>`
      select n.id, n.reason, n.object_type, n.object_id, n.read_at, n.created_at, n.what, n.kind,
             /* Who did it, with their face — docs/specs/inbox.md, "Who, and
                what kind". An agent is an actor like anybody, face and all. */
             n.by_id, doer.name as by_name, doer.avatar_key as by_avatar,
             /* What a comment said, for a note about one: read here under
                the reader's own policies, so it is only ever a comment they
                could open. Never in a push, which is drawn on a lock screen. */
             remark.text as excerpt,
             coalesce(p.title, t.title, f.name, ja.name, op.name) as title,
             coalesce(p.project_id, t.project_id, f.project_id, cv.project_id, op.id) as project_id,
             /* Enough to say what it is about without opening it, and to
                go there — docs/specs/inbox.md. No backticks in here. */
             pj.name as project_name, pj.key as project_key, pj.slug as project_slug,
             t.number as task_number,
             cv.name as room_name, cv.channel as room_channel,
             (select string_agg(a.name, ', ' order by a.name)
              from conversation_member cm join actor a on a.id = cm.actor_id
              where cm.conversation_id = cv.id and cm.deleted_at is null
                and cm.actor_id <> ${ctx.actorId} and not cv.channel) as room_others,
             said.author as said_by, said.text as said,
             /* The message itself and the thread it is in, so an answer
                can go where the question was — an agent's, through MCP. */
             said.id as said_id, coalesce(said.parent_id, said.id) as said_thread,
             /* The files in it, by id, for an agent to be handed links to —
                each one still asked of the reader's own policies then. */
             said.files as said_files
      /* The page first, then what each line is about: everything below was
         worked out for every note the person had ever had, read or not, and
         fifty of them kept. */
      from (
        select * from notification n
        where n.actor_id = ${ctx.actorId} and n.workspace_id = ${ctx.workspaceId}
          and n.deleted_at is null
          and ${standing(tx)}
          /* A direct message is read in its conversation; its notification
             is for the phone. */
          and n.reason <> 'messaged'
          and n.deliver_after <= now()
          ${unreadOnly ? tx`and n.read_at is null` : tx``}
          ${cursor ? tx`and n.created_at < ${cursor}` : tx``}
        order by n.created_at desc
        limit ${limit}
      ) n
      left join post p on p.id = n.object_id and n.object_type = 'post'
      left join task t on t.id = n.object_id and n.object_type = 'task'
      left join file f on f.id = n.object_id and n.object_type = 'file'
      left join conversation cv on cv.id = n.object_id and n.object_type = 'conversation'
      left join actor doer on doer.id = n.by_id
      left join lateral (
        select (select string_agg(x #>> '{}', '') from jsonb_path_query(cm.body, 'strict $.**.text') x) as text
        from comment cm
        where n.kind in ('commented', 'asked') and n.by_id is not null
          and cm.object_type = n.object_type and cm.object_id = n.object_id
          and cm.author_id = n.by_id and cm.deleted_at is null
          /* Written in the same transaction as the note, so at the same
             moment; a later comment is the next note's to quote. */
          and cm.created_at <= n.created_at
        order by cm.created_at desc
        limit 1
      ) remark on true
      /* Somebody who followed your invitation, by name. */
      left join actor ja on ja.id = n.object_id and n.object_type = 'actor'
      /* A project somebody was put on, by name. */
      left join project op on op.id = n.object_id and n.object_type = 'project'
      left join project pj on pj.id = coalesce(p.project_id, t.project_id, f.project_id, cv.project_id, op.id)
      /* What was said, for a mention in a room: the latest message there
         naming this person by the time they were told. */
      left join lateral (
        select a.name as author, m.id, m.parent_id,
               (select string_agg(x #>> '{}', '') from jsonb_path_query(m.body, 'strict $.**.text') x) as text,
               (select array_agg(distinct x #>> '{}') from jsonb_path_query(m.body, 'strict $.**.fileId') x
                where jsonb_typeof(x) = 'string') as files
        from message m join actor a on a.id = m.author_id
        where n.object_type = 'conversation' and n.reason = 'mentioned'
          and m.conversation_id = n.object_id and m.deleted_at is null
          and m.author_id <> ${ctx.actorId}
          and m.created_at <= n.created_at + interval '5 seconds'
          /* Said when they were told, give or take: a mention whose
             message was taken away walked back through the whole room
             looking for it. */
          and m.created_at >= n.created_at - interval '10 minutes'
          /* Naming them — or, in a conversation of two, any line of the
             other's: a message to an agent there is its mention without
             its name (notify.ts). */
          and (m.body::text like ${'%' + ctx.actorId + '%'}
               or (not cv.channel and cv.project_id is null
                   and (select count(*) from conversation_member x
                        where x.conversation_id = cv.id and x.deleted_at is null and x.joined_at is not null) = 2))
        order by m.created_at desc
        limit 1
      ) said on true
      /* This workspace's notes only, chosen above. Bounded by the person
         alone, a mention in one company's room was listed in the other
         company's inbox — as "A conversation", since nothing about the room
         could be read from here, but listed. */
      order by n.created_at desc`,
  )
  const counted = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      tx<{ reason: string; n: string }[]>`
      select n.reason::text as reason, count(*) as n
      from notification n
      where ${ringing(tx, ctx.actorId, ctx.workspaceId)}
      group by n.reason`,
  )
  /*
   * Needs you: the questions still open
   * that were asked of this person, newest first, read under their own
   * policies, so a task in the bin or out of sight is not among them. With
   * the first page only: they are the head of the inbox, not a page of it.
   */
  const questions = cursor
    ? []
    : await withActor(
        ctx.actorId,
        ctx.workspaceId,
        (tx) =>
          tx`
      select c.id, c.object_id as task_id, c.body, c.choices, c.created_at,
             (select string_agg(x #>> '{}', '') from jsonb_path_query(c.body, 'strict $.**.text') x) as excerpt,
             c.author_id as by_id, a.name as by_name, a.avatar_key as by_avatar,
             t.title, t.number as task_number, t.project_id,
             pj.name as project_name, pj.key as project_key, pj.slug as project_slug
      from comment c
      join task t on t.id = c.object_id and t.deleted_at is null
      join project pj on pj.id = t.project_id and pj.deleted_at is null
      join actor a on a.id = c.author_id
      where c.asked @> array[${ctx.actorId}]::uuid[]
        and c.choices is not null and c.answered_at is null and c.deleted_at is null
        and c.object_type = 'task' and c.workspace_id = ${ctx.workspaceId}
      order by c.created_at desc
      limit 50`,
      )
  return c.json({
    notifications: rows.map((r) => facedAs(r as Record<string, unknown>, 'by_avatar', 'by_avatar_url')),
    questions: questions.map((r) => facedAs(r as Record<string, unknown>, 'by_avatar', 'by_avatar_url')),
    /* Every reason the bell counts, as a string as it always was, '0'
       where nothing is waiting. */
    unread: Object.fromEntries(BELL.map((r) => [r, String(counted.find((x) => x.reason === r)?.n ?? '0')])),
    next_cursor: rows.length === limit ? rows[rows.length - 1]!.created_at : null,
  })
})

/** Marking all read is one action, because the alternative is a chore. */
inbox.post('/inbox/read', async (c) => {
  const ctx = c.get('ctx')
  const body = z.object({ id: z.uuid().optional() }).safeParse(await c.req.json().catch(() => ({})))
  const id = body.success ? body.data.id : undefined

  await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    if (id) {
      await tx`
        update notification set read_at = now()
        where id = ${id} and actor_id = ${ctx.actorId} and read_at is null`
    } else {
      await tx`
        update notification set read_at = now()
        where actor_id = ${ctx.actorId} and workspace_id = ${ctx.workspaceId}
          and read_at is null and deliver_after <= now()`
    }
    await owesCount(tx, ctx.actorId, ctx.workspaceId)
  })
  /*
   * Said to the person's other windows and devices, as a room read is: the
   * contract promised a count cleared on one clears on the others, and an
   * inbox read on the phone left the laptop's bell — and its notifications
   * on the screen — where they were.
   */
  await publish(`actor:${ctx.actorId}`, 'read', id ? { id, workspace_id: ctx.workspaceId } : { workspace_id: ctx.workspaceId })
  return c.json({ ok: true })
})

/**
 * The one preference there is, plus quiet hours.
 *
 * Chat is separable from the rest because a busy channel otherwise drowns the
 * assignments and the inbox stops being read. Everything else has a sensible
 * default and is not offered as a choice.
 */
/**
 * What is already set, so the screen can show it.
 *
 * There was only a way to write these. A form that cannot read its own values
 * shows the defaults every time and quietly loses whatever was chosen last.
 */
inbox.get('/inbox/settings', async (c) => {
  const ctx = c.get('ctx')
  const row = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [r] = await tx`
      select notify_chat, quiet_from, quiet_to, timezone, email_digest
      from app_user where actor_id = ${ctx.actorId}`
    return r
  })
  return c.json(row ?? { notify_chat: true, quiet_from: null, quiet_to: null, timezone: 'UTC', email_digest: true })
})

inbox.patch('/inbox/settings', async (c) => {
  const ctx = c.get('ctx')
  const body = z
    .object({
      notify_chat: z.boolean().optional(),
      /* The day's email of what was not read — `docs/specs/notifications.md`. */
      email_digest: z.boolean().optional(),
      quiet_from: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .nullish(),
      quiet_to: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .nullish(),
      timezone: z.string().max(64).optional(),
    })
    .safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)

  const d = body.data
  /* A zone the database knows, or none: "Berlin" was kept as typed, and
     every notification to its owner then failed inside the transaction of
     whoever was writing to them — a comment, a message, a moved card. */
  if (d.timezone !== undefined) {
    const [known] = await withActor(ctx.actorId, ctx.workspaceId, (tx) => tx`select 1 from pg_timezone_names where name = ${d.timezone!}`)
    if (!known) return c.json({ error: { code: 'invalid', message: 'Choose a valid time zone.' } }, 400)
  }
  await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    await tx`
      update app_user set
        notify_chat = coalesce(${d.notify_chat ?? null}, notify_chat),
        email_digest = coalesce(${d.email_digest ?? null}, email_digest),
        quiet_from = ${d.quiet_from === undefined ? tx`quiet_from` : (d.quiet_from ?? null)},
        quiet_to = ${d.quiet_to === undefined ? tx`quiet_to` : (d.quiet_to ?? null)},
        timezone = coalesce(${d.timezone ?? null}, timezone)
      where actor_id = ${ctx.actorId}`
  })
  return c.json({ ok: true })
})

/** Whether somebody's own workspace lines are theirs to read here: in a
    session of their own, not through a token or a tool acting as them. */
const ownLines = (ctx: AuthContext): boolean => Boolean(ctx.sessionId) && !ctx.viaMcp && !ctx.viaGithub && !ctx.viaImport

/**
 * The feed, for the workspace or for one person.
 *
 * A client is never served it. Not filtered — not served; row-level security
 * refuses the table outright, so there is no select list to get wrong.
 */
inbox.get('/activity', async (c) => {
  const ctx = c.get('ctx')
  if (!allow(ctx, 'activity.read')) return c.json({ error: { code: 'forbidden' } }, 403)

  const limit = pageSize(c.req.query('limit'), 50, 200)
  const cursor = c.req.query('cursor')
  const actorId = c.req.query('actor')
  const projectId = c.req.query('project')
  /* Somebody else's lines across every project are their page's history,
     and where the owner keeps the Members screen to themselves that
     history is theirs too. */
  if (actorId && actorId !== ctx.actorId && !projectId && !allow(ctx, 'members.read')) {
    return c.json({ error: { code: 'forbidden' } }, 403)
  }
  /* One object's own history, for the panel beside it — the task screen asks
     this and the project's feed does not. */
  const objectId = c.req.query('object')
  /* The lines whose thing or whose person says these words —
     `docs/specs/find.md`. */
  const words = (c.req.query('q') ?? '').trim()
  const like = `%${words.replace(/[\\%_]/g, (x) => `\\${x}`)}%`
  /* Which tab the lines happened in. Read from
     the action, as the screen reads its place. */
  const IN: Record<string, string[]> = {
    tasks: ['task.%', 'list.%', 'cycle.%', 'time.%'],
    posts: ['post.%'],
    files: ['file.%'],
    messages: ['conversation.%', 'message.%'],
    settings: ['project.%'],
  }
  const where = IN[c.req.query('in') ?? ''] ?? null

  const rows = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      tx<{ id: string; at: string }[]>`
      select e.id, e.action, e.object_type, e.object_id, e.origin, e.at,
             /* A copy says where it came from only to whoever can see
                that project: its id and number are not the others' to have. */
             case when e.action = 'task.copy'
                       and not ((e.meta->>'from_project_id')::uuid in (select visible_projects()))
                  then e.meta - 'from_project_id' - 'from_number' - 'from_task_id'
                  else e.meta end as meta,
             e.actor_id, a.name as actor_name, a.avatar_key as actor_avatar,
             e.project_id, p.name as project_name,
             p.slug as project_slug, p.key as project_key,
             /*
              * What it happened to, by name.
              *
              * "Dev moved a task on" is a record that cannot say what it
              * happened to, which is the entire question.
              * No backticks in here: this is inside a
              * template literal, and one ends it.
              *
              * Joined here rather than looked up per row by the screen: one
              * query and one round trip, and the join runs under the same
              * row-level security as everything else, so a name from a
              * project the reader is not on is not withheld by the screen —
              * it is not there.
              */
             /* A thing removed since is named as it was when it went —
                its own row is gone from the reader's sight; a file deleted
                forever too. */
             coalesce(o.title, case when e.action like '%.delete' or e.action = 'file.purge' then e.meta->>'title' end) as object_title,
             o.number as object_number
      from activity_event e
      join actor a on a.id = e.actor_id
      left join project p on p.id = e.project_id
      left join lateral (
        select t.title, t.number from task t
        where e.object_type = 'task' and t.id = e.object_id and t.deleted_at is null
        union all
        select s.title, s.number from post s
        where e.object_type = 'post' and s.id = e.object_id and s.deleted_at is null
        union all
        -- A file's name is its title; one shape for the caller to read.
        select f.name, f.number from file f
        where e.object_type = 'file' and f.id = e.object_id and f.deleted_at is null
        union all
        -- A room by its name, to whoever may see it; removed, still to them.
        select conversation_seen(e.object_id), null::int
        where e.object_type = 'conversation'
      ) o on true
      where e.workspace_id = ${ctx.workspaceId}
        -- Nothing about a room somebody may not see — not even that it was
        -- opened: a private channel's existence is its members' business.
        and (e.object_type is distinct from 'conversation' or o.title is not null)
        -- The workspace's own lines -- a switch turned, rights given,
        -- somebody removed, an integration or a webhook's host -- are the
        -- audit log's, and read by whoever reads that: the owner, in their
        -- own session. Anybody else in theirs, their own doing only; a
        -- token or a tool, none. Migration 241 says the same in the policy.
        ${
          readsAudit(ctx)
            ? tx``
            : tx`and (e.project_id is not null or e.object_type = 'conversation'
                      or (${ownLines(ctx)} and e.actor_id = ${ctx.actorId}))`
        }
        -- "Copied to …" on the original, only to whoever can see the copy.
        and (e.action <> 'task.copied' or (e.meta->>'to_project_id')::uuid in (select visible_projects()))
        ${where ? tx`and e.action like any(${where})` : tx``}
        ${where && c.req.query('in') === 'settings' ? tx`and e.action not in ('project.create', 'project.copy', 'project.import')` : tx``}
        ${actorId ? tx`and e.actor_id = ${actorId}` : tx``}
        ${projectId ? tx`and e.project_id = ${projectId}` : tx``}
        ${objectId ? tx`and e.object_id = ${objectId}` : tx``}
        ${words ? tx`and (o.title ilike ${like} or a.name ilike ${like})` : tx``}
        ${cursor ? tx`and e.at < ${cursor}` : tx``}
      order by e.at desc
      limit ${limit}`,
  )
  return c.json({
    events: rows.map((r) => facedAs(r as Record<string, unknown>, 'actor_avatar', 'actor_avatar_url')),
    next_cursor: rows.length === limit ? rows[rows.length - 1]!.at : null,
  })
})

/** What points at this, and what it points at. */
inbox.get('/links/:type/:id', async (c) => {
  const ctx = c.get('ctx')
  /*
   * What points here, by name.
   *
   * It used to answer with a type and a uuid, which the interface then showed
   * as "message 01a0c005-a68c-…" — a link that tells you something is
   * connected and not what. The title comes from whichever table the id is
   * in, and row-level security decides which of them come back at all.
   */
  const rows = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      tx`select l.to_type as type, l.to_id as id,
              coalesce(p.title, t.title, f.name,
                       left(m.body #>> '{content,0,content,0,text}', 80)) as title,
              /*
               * The project of the thing pointed at, not of the link.
               *
               * object_link has no project of its own and this used to
               * select one anyway, so the endpoint answered 500 to every
               * request ever made to it. Nothing caught it: the screen that
               * reads this sets the object first and the links second, so a
               * task still drew and the backlinks were simply never there —
               * which is indistinguishable from a task nothing points at.
               *
               * A message belongs to its conversation, and the conversation
               * to the project; the other three carry it themselves.
               */
              coalesce(p.project_id, t.project_id, f.project_id, cv.project_id) as project_id
       from object_link l
       left join post p on l.to_type = 'post' and p.id = l.to_id and p.deleted_at is null
       left join task t on l.to_type = 'task' and t.id = l.to_id and t.deleted_at is null
       left join file f on l.to_type = 'file' and f.id = l.to_id and f.deleted_at is null
       left join message m on l.to_type = 'message' and m.id = l.to_id and m.deleted_at is null
       left join conversation cv on cv.id = m.conversation_id
       where l.from_type = ${c.req.param('type')}::object_kind
         and l.from_id = ${c.req.param('id')} and l.deleted_at is null
         -- Only from a thing the reader may open: what a draft points at is
         -- its author's business.
         and (l.from_type <> 'file' or exists (select 1 from file fx where fx.id = l.from_id and fx.deleted_at is null))`,
  )
  // A link to something this person cannot read comes back with no title, and
  // that is the answer: it is not shown rather than shown as an id.
  return c.json({ links: rows.filter((r) => (r as { title?: string }).title) })
})
