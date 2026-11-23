import { Hono } from 'hono'
import { z } from 'zod'
import { RichBody } from './body.js'
import { v7 as uuidv7 } from 'uuid'
import { withActor } from '../db.js'
import { facedAs } from '../storage.js'
import { allow, type AuthContext } from '../auth/context.js'
import { record } from './activity.js'
import { LINES, claimFiles, doer, linkMentionedObjects, notify, veilDocrefs } from '../notify.js'
import {
  addComment,
  agentsConnector,
  commentCursor,
  commentsIn,
  follow,
  mayEditAgentsAnnouncement,
  forbidden,
  isInProject,
  listComments,
  mayEditSaid,
  mayTakeBack,
  missing,
  subscribe,
} from './objects.js'
import { pageSize, timeCursor } from './limits.js'

type Vars = { ctx: AuthContext }
export const posts = new Hono<{ Variables: Vars }>()

/*
 * Who may change an announcement, and take it away — the read's `may_edit`
 * and `may_delete`, PATCH and DELETE all ask this. The posts spec and "Taking one away".
 *
 * The narrower rule (`mayEditSaid`): its author; the owner and whoever runs
 * the project — not every member the workspace's edit switch lets change
 * others' documents, since rewriting an announcement, or emptying it, is
 * taking away what somebody said to everybody and leaving their name on
 * it; and, for an announcement an agent wrote, whoever connected that
 * agent, while they are on the project and the agent is live (`connector`,
 * from `agentsConnector`).
 *
 * Somebody else's never through a token — an agent or a person's tool —
 * nor by GitHub or an import acting as somebody, as deleting one is not:
 * emptying it is the same act. One's own stays a
 * token's to change, which is what `update_post` is for.
 */
function mayChange(ctx: AuthContext, authorId: string, projectId: string, connector: string | null): boolean {
  /* Somebody else's never through a tool of any kind — a token, GitHub,
     an import writing as somebody. */
  if (authorId !== ctx.actorId && (ctx.viaMcp || ctx.viaGithub || ctx.viaImport)) return false
  return mayEditSaid(ctx, authorId, projectId) || mayEditAgentsAnnouncement(ctx, connector, projectId)
}

const Body = z.object({
  title: z.string().min(1).max(300),
  body: RichBody.default({}),
  category: z.string().max(100).nullish(),
  /** An RRULE-shaped string turns a post into a recurring check-in. */
  schedule: z.string().max(200).nullish(),
  publish: z.boolean().default(true),
})

posts.get('/projects/:projectId/posts', async (c) => {
  const ctx = c.get('ctx')
  const limit = pageSize(c.req.query('limit'), 50, 200)
  const cursor = c.req.query('cursor')
  const from = cursor === undefined ? null : timeCursor(cursor)
  if (cursor !== undefined && !from) return c.json({ error: { code: 'invalid' } }, 400)
  const rows = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      tx<{ id: string; created_at: string; at_key: string }[]>`
      select p.id, p.number, p.title, p.category, p.schedule, p.published_at,
             p.author_id, a.name as author_name, a.avatar_key as author_avatar,
             p.created_at,
             to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at_key,
             /*
              * The whole body, not its first line.
              *
              * It was an excerpt, on the grounds that the whole body would
              * make the index the reading screen — which is what the index
              * of a project's announcements should be. There are a few a
              * month; each one being a door made the screen that holds them
              * the one nobody read. The replies stay behind the door, and
              * how many there are is said on it.
              */
             p.body,
             (select count(*)::int from comment c
              where c.object_type = 'post' and c.object_id = p.id
                and c.deleted_at is null) as reply_count
      from post p join actor a on a.id = p.author_id
      where p.project_id = ${c.req.param('projectId')} and p.deleted_at is null
        /* <moment>_<id>, the time as text to the microsecond and the id
           for posts of one moment: A bare
           moment, from before, reads to the end of its millisecond. */
        ${
          !from
            ? tx``
            : from.id
              ? tx`and p.created_at <= ${from.at}::text::timestamptz
                   and (p.created_at < ${from.at}::text::timestamptz or p.id < ${from.id}::uuid)`
              : tx`and p.created_at < ${from.at}::text::timestamptz + interval '1 millisecond'`
        }
      order by p.created_at desc, p.id desc
      limit ${limit}`,
  )
  const last = rows[rows.length - 1]
  return c.json({
    posts: rows.map(({ at_key: _, ...r }) => facedAs(r, 'author_avatar', 'author_avatar_url')),
    next_cursor: rows.length === limit && last ? `${last.at_key}_${last.id}` : null,
  })
})

posts.post('/projects/:projectId/posts', async (c) => {
  const ctx = c.get('ctx')
  const projectId = c.req.param('projectId')
  if (!allow(ctx, 'content.create', { inProject: true })) return c.json(forbidden, 403)

  const body = Body.safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)

  // Publishing to a client is its own permission, and it is one a token may

  const id = uuidv7()
  const made = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    if (!(await isInProject(tx, projectId))) return false
    await tx`
      insert into post (id, workspace_id, project_id, author_id, title, body, category,
                        schedule, published_at)
      values (${id}, ${ctx.workspaceId}, ${projectId}, ${ctx.actorId}, ${body.data.title},
              ${tx.json((await veilDocrefs(tx, body.data.body)) as never)}, ${body.data.category ?? null},
              ${body.data.schedule ?? null},
              ${body.data.publish ? tx`now()` : null})`
    await subscribe(tx, ctx, 'post', id)
    await linkMentionedObjects(tx, ctx, { type: 'post', id }, body.data.body)
    /* An announcement is somebody deciding to tell people something, and it
       told nobody but the people it named. Published, it reaches everybody
       on the project who may read it — `docs/specs/notifications.md`. */
    const audience = body.data.publish ? (await tx<{ actor_id: string }[]>`select * from post_audience(${id})`).map((r) => r.actor_id) : []
    const who = await doer(tx, ctx.actorId)
    await notify(tx, ctx, {
      objectType: 'post',
      objectId: id,
      body: body.data.body,
      what: (l) => LINES(l).posted(who(l)),
      kind: 'posted',
      also: { ids: audience, reason: 'posted' },
    })
    await record(tx, ctx, 'post.create', { projectId, objectType: 'post', objectId: id })
    return true
  })
  return made ? c.json({ id }, 201) : c.json(missing, 404)
})

posts.get('/posts/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const row = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [p] = await tx`
      select p.*, a.name as author_name, a.avatar_key as author_avatar,
             /* Whether the reader follows it. */
             exists (select 1 from subscription s
                     where s.object_type = 'post' and s.object_id = p.id
                       and s.actor_id = current_actor() and s.deleted_at is null) as subscribed,
             /* Whether an agent wrote it: the screen offers Edit on an
                agent's to whoever may change it, and on a person's to its
                author alone. */
             exists (select 1 from agent g where g.actor_id = p.author_id
                     and g.workspace_id = p.workspace_id) as author_agent
      from post p join actor a on a.id = p.author_id
      where p.id = ${id} and p.deleted_at is null`
    if (!p) return null
    return { ...p, connector: await agentsConnector(tx, ctx, p.author_id) }
  })
  if (!row) return c.json(missing, 404)
  // `said` is the search index's, not the contract's — the body is here.
  const { said: _said, connector, ...post } = row as Record<string, unknown> & { connector: string | null }
  const author = String(post.author_id)
  const projectId = String(post.project_id)
  const said = await listComments(ctx, 'post', id)
  return c.json({
    post: {
      ...facedAs(post, 'author_avatar', 'author_avatar_url'),
      /* What PATCH and DELETE would answer, asked of the same rule — the
         screen hides what these say no to, and the server still decides. */
      may_edit: mayChange(ctx, author, projectId, connector),
      may_delete: mayChange(ctx, author, projectId, connector) && !ctx.viaMcp,
    },
    comments: said.comments,
    /* Where the comments not carried here start. */
    comments_earlier: said.earlier,
  })
})

/* Following it, and stopping. */
posts.post('/posts/:id/subscription', async (c) =>
  (await follow(c.get('ctx'), 'post', c.req.param('id'), true)) ? c.json({ ok: true }) : c.json(missing, 404),
)
posts.delete('/posts/:id/subscription', async (c) => {
  await follow(c.get('ctx'), 'post', c.req.param('id'), false)
  return c.json({ ok: true })
})

/* The replies before the ones the read carried — `comments_earlier`. */
posts.get('/posts/:id/comments', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const before = c.req.query('before') ?? null
  if (before !== null && !commentCursor(before)) return c.json({ error: { code: 'invalid' } }, 400)
  const page = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [p] = await tx`select 1 from post where id = ${id} and deleted_at is null`
    return p ? commentsIn(tx, 'post', id, before) : null
  })
  if (!page) return c.json(missing, 404)
  return c.json({ comments: page.comments, next_cursor: page.earlier })
})

posts.patch('/posts/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  /* Not `Body.partial()`: zod applies a default inside a partial, so a
     change of title alone arrived with `body: {}` and emptied the
     announcement — MCP's update_post with only a title did exactly that. */
  const body = Body.omit({ body: true, publish: true })
    .partial()
    .extend({ body: RichBody.optional() })
    .safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)

  const result = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [row] = await tx<{ author_id: string; project_id: string }[]>`
      select author_id, project_id from post where id = ${id} and deleted_at is null`
    if (!row) return 'missing' as const
    if (!mayChange(ctx, row.author_id, row.project_id, await agentsConnector(tx, ctx, row.author_id))) return 'forbidden' as const

    await tx`
      update post set
        title = coalesce(${body.data.title ?? null}, title),
        body = coalesce(${body.data.body ? tx.json((await veilDocrefs(tx, body.data.body)) as never) : null}, body),
        category = coalesce(${body.data.category ?? null}, category)
      where id = ${id}`
    /* What it shows now is named by it. */
    if (body.data.body) await claimFiles(tx, { type: 'post', id }, body.data.body)
    await record(tx, ctx, 'post.update', {
      projectId: row.project_id,
      objectType: 'post',
      objectId: id,
    })
    return 'ok' as const
  })
  if (result === 'missing') return c.json(missing, 404)
  if (result === 'forbidden') return c.json(forbidden, 403)
  return c.json({ ok: true })
})

posts.delete('/posts/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const result = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [row] = await tx<{ author_id: string; project_id: string; title: string }[]>`
      select author_id, project_id, title from post where id = ${id} and deleted_at is null`
    if (!row) return 'missing' as const
    /* The same people who may change it (`mayChange`): emptying it is
       deleting it, and a right to delete held back from somebody who may
       empty it would read as protection and be none. */
    if (!mayChange(ctx, row.author_id, row.project_id, await agentsConnector(tx, ctx, row.author_id))) return 'forbidden' as const
    /* Never through a token, one's own included, as a task is not:
       removing is one of the things a tool acting for somebody does not do. */
    if (ctx.viaMcp) return 'forbidden' as const
    /* Soft: the row stays until the clear-out takes it, and remembers who
       did it — Undo is theirs, or whoever may take anybody's away. */
    await tx`update post set deleted_at = now(), deleted_by = ${ctx.actorId} where id = ${id}`
    await record(tx, ctx, 'post.delete', {
      projectId: row.project_id,
      objectType: 'post',
      objectId: id,
      meta: { title: row.title },
    })
    return 'ok' as const
  })
  if (result === 'missing') return c.json(missing, 404)
  if (result === 'forbidden') return c.json(forbidden, 403)
  return c.json({ ok: true })
})

/*
 * An announcement put back, which is what the toast's Undo presses.
 * Whoever deleted it, or whoever may take anybody's
 * away (`content.edit.said`: the owner, whoever runs the project) — not its
 * author after somebody else took it down. Never through a token. Only
 * while the row is there and its project stands; `404` for what the asker
 * cannot see. Back as it was, its replies with it.
 */
posts.post('/posts/:id/restore', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const result = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [row] = await tx<{ deleted_by: string | null; project_id: string; title: string }[]>`
      select s.deleted_by, s.project_id, s.title from post s
      join project p on p.id = s.project_id and p.deleted_at is null
      where s.id = ${id} and s.workspace_id = ${ctx.workspaceId} and s.deleted_at is not null
      for update of s`
    if (!row) return 'missing' as const
    if (!mayTakeBack(ctx, row.deleted_by, row.project_id, 'content.edit.said')) return 'forbidden' as const
    await tx`update post set deleted_at = null, deleted_by = null where id = ${id}`
    await record(tx, ctx, 'post.restore', {
      projectId: row.project_id,
      objectType: 'post',
      objectId: id,
      meta: { title: row.title },
    })
    return 'ok' as const
  })
  if (result === 'missing') return c.json(missing, 404)
  if (result === 'forbidden') return c.json(forbidden, 403)
  return c.json({ ok: true })
})

posts.post('/posts/:id/comments', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const body = z.object({ body: RichBody, parent_id: z.uuid().nullish() }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)

  const projectId = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [row] = await tx<{ project_id: string }[]>`
      select project_id from post where id = ${id} and deleted_at is null`
    return row?.project_id ?? null
  })
  if (!projectId) return c.json(missing, 404)

  const made = await addComment(ctx, 'post', id, projectId, body.data.body, body.data.parent_id ?? null)
  return made ? c.json(made, 201) : c.json(forbidden, 403)
})
