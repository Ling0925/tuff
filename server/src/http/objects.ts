import { Hono } from 'hono'
import { z } from 'zod'
import { RichBody } from './body.js'
import { v7 as uuidv7 } from 'uuid'
import type { Tx } from '../db.js'
import { withActor } from '../db.js'
import { facedAs } from '../storage.js'
import { allow, type AuthContext, allowIn } from '../auth/context.js'
import { record } from './activity.js'
import { LINES, doer, linkMentionedObjects, mentionedIds, notify, veilDocrefs } from '../notify.js'
import { publishTo } from '../realtime.js'
import { askedNote, whoIsAsked, type Choice } from '../questions.js'

/**
 * What every object a person creates has in common.
 *
 * The design lists author, subscribers, client visibility and a stable URL once
 * for all four entities rather than per entity. Writing the same endpoint four
 * times is four chances to get the visibility check subtly different, and the
 * one that is wrong is the one facing the client.
 */

export const missing = { error: { code: 'not_found' } } as const
export const forbidden = { error: { code: 'forbidden' } } as const

export type ObjectKind = 'post' | 'task' | 'file' | 'message'

/**
 * Whether this actor may change this row.
 *
 * Authorship first, then the switch: a member editing somebody else's document
 * is the one place the workspace gets a say, and `can` already folds it in.
 */
export function mayEdit(ctx: AuthContext, authorId: string, projectId?: string): boolean {
  if (authorId === ctx.actorId) return allow(ctx, 'content.edit.own', { inProject: true, isAuthor: true })
  // Editing what somebody else wrote is one of the things running a project
  // carries, so the project has to be named. Without it only the owner and
  // the workspace switch answer — which is the old behaviour, and the right
  // fallback for a caller that has not got the project to hand.
  return allowIn(ctx, 'content.edit.any', projectId, { isAuthor: false })
}

/**
 * Whether this actor may change what somebody else *said*.
 *
 * Not `mayEdit`. The workspace switch is about documents — the permission
 * matrix says "only your own, and others' documents behind the switch" — and a comment is not a
 * document: it is speech with a name on it, and rewriting it leaves that name
 * underneath. So the owner and whoever runs the project, and nobody else.
 */
export function mayEditSaid(ctx: AuthContext, authorId: string, projectId?: string): boolean {
  if (authorId === ctx.actorId) {
    return allow(ctx, 'content.edit.own', { inProject: true, isAuthor: true })
  }
  return allowIn(ctx, 'content.edit.said', projectId, { isAuthor: false })
}

/**
 * Whether this actor may put back something deleted.
 *
 * Whoever deleted it, while they are still on its project; anybody else,
 * only with the right that deletes anybody's — never its author as such,
 * or a manager's delete would be the author's to undo for thirty days.
 * Never through a token, nor by GitHub or an import acting as somebody:
 * Undo is a press on a screen. A row deleted before anybody kept who did it
 * has no deleter, and is the right's alone.
 */
export function mayTakeBack(
  ctx: AuthContext,
  deletedBy: string | null,
  projectId: string | null | undefined,
  anybodys: Parameters<typeof allowIn>[1],
): boolean {
  if (ctx.viaMcp || ctx.viaGithub || ctx.viaImport) return false
  if (deletedBy === ctx.actorId) return allowIn(ctx, 'content.edit.own', projectId, { isAuthor: true })
  return allowIn(ctx, anybodys, projectId, { isAuthor: false })
}

/* Whether a file is not the whole project's: sent in a room with chosen
   people — or a room of no project — or a document still its author's or
   its chosen people's. The project's feed,
   its webhooks and its socket never name such a file. Read as a column of
   `file f`. */
export const apart = (tx: Tx) => tx`file_apart(f.id)`

/*
 * Whether what is said on this thing is the project's to hear. Not on a
 * file sent in a room with chosen people, nor on a document that is still
 * its author's or its chosen people's: its upload was never told to the
 * project, its feed, its webhooks or its socket, and what is said about it
 * is not either — the line carried the file's id and project to every
 * webhook. The review of; the undo spec.
 */
async function toldToProject(tx: Tx, objectType: string, objectId: string): Promise<boolean> {
  if (objectType !== 'file') return true
  const [r] = await tx<{ chosen: boolean }[]>`select ${apart(tx)} as chosen from file f where f.id = ${objectId}`
  return !r?.chosen
}

export async function isInProject(tx: Tx, projectId: string): Promise<boolean> {
  const [row] = await tx<{ ok: boolean }[]>`select in_project(${projectId}) as ok`
  return row?.ok === true
}

/** Subscribing the author is what makes the inbox useful without a setting. */
export async function subscribe(tx: Tx, ctx: AuthContext, objectType: string, objectId: string): Promise<void> {
  await tx`
    insert into subscription (id, workspace_id, object_type, object_id, actor_id)
    values (${uuidv7()}, ${ctx.workspaceId}, ${objectType}::object_kind, ${objectId},
            ${ctx.actorId})
    on conflict do nothing`
}

/**
 * Following a post or a document, and stopping.
 * The task's two endpoints, said once for the other two
 * kinds: idempotent, soft, the reader's own row and nobody else's (the
 * policy on `subscription` is `actor_id = current_actor()`). Starting asks
 * that the thing is there for the reader — row-level security decides —
 * and stopping answers `ok` whatever, as the task's does: a thing you cannot
 * see is one you will not hear about. Commenting again follows it again,
 * as it does a task.
 */
export async function follow(ctx: AuthContext, kind: 'post' | 'file', id: string, on: boolean): Promise<boolean> {
  return withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    if (!on) {
      await tx`
        update subscription set deleted_at = now(), updated_at = now()
        where object_type = ${kind}::object_kind and object_id = ${id}
          and actor_id = ${ctx.actorId} and deleted_at is null`
      return true
    }
    const [there] =
      kind === 'post'
        ? await tx<{ id: string }[]>`select id from post where id = ${id} and deleted_at is null`
        : await tx<{ id: string }[]>`select id from file where id = ${id} and deleted_at is null`
    if (!there) return false
    /* Revive first, then insert: the unique index is partial on
       `deleted_at is null` — the task's handler says why. */
    const back = await tx<{ id: string }[]>`
      update subscription set deleted_at = null, updated_at = now()
      where object_type = ${kind}::object_kind and object_id = ${id}
        and actor_id = ${ctx.actorId} and deleted_at is not null
      returning id`
    if (back.length === 0) await subscribe(tx, ctx, kind, id)
    return true
  })
}

export const CommentBody = z.object({ body: RichBody })

/*
 * How many comments one answer carries, and how much of them,
 * finding 5. A task read with its comments sent
 * every one of them whole, so four hundred long ones were an answer of
 * gigabytes. The newest two hundred, and no more than 4 MB of their bodies
 * (always at least one); the rest are `comments_earlier`'s to ask for.
 */
export const COMMENTS_MOST = 200
export const COMMENT_BYTES_MOST = 4 * 1024 * 1024

/** A page of comments, oldest first, and the cursor to the ones before it — null when there are none. */
export type CommentPage = { comments: readonly unknown[]; earlier: string | null }

/**
 * Comments on anything, on one schema.
 *
 * The target is a pair rather than four nullable columns: adding a fifth
 * commentable thing should not be a migration, and a nullable column per type
 * is how a table ends up with eleven of them.
 */
export async function listComments(
  ctx: AuthContext,
  objectType: ObjectKind,
  objectId: string,
  before: string | null = null,
): Promise<CommentPage> {
  return withActor(ctx.actorId, ctx.workspaceId, (tx) => commentsIn(tx, objectType, objectId, before))
}

/** `<created_at>_<id>` of a comment, or null for anything else. */
const COMMENT_CURSOR =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
export const commentCursor = (v: string | undefined | null): { at: string; id: string } | null => {
  const m = v ? COMMENT_CURSOR.exec(v) : null
  return m && !Number.isNaN(Date.parse(m[1]!)) ? { at: m[1]!, id: m[2]! } : null
}

/**
 * The same, inside a transaction somebody already has open — so a screen
 * that reads an object and its comments together does it in one, with the
 * queries sent side by side.
 */
export async function commentsIn(tx: Tx, objectType: ObjectKind, objectId: string, before: string | null = null): Promise<CommentPage> {
  const from = commentCursor(before)
  // `edited_at` rather than `updated_at`: null until somebody has actually
  // changed it, so the screen does not have to compare two timestamps and
  // decide what counts as a change.
  /* Said on GitHub by somebody who is not a person here: their name, no
     face and no person to open — as a line from Slack is drawn. */
  /* The newest first, one more than a page so whether there are earlier
     ones is known, each with what its body weighs and what the page weighs
     down to it. The moment as text both ways, to the microsecond, so a
     cursor never skips a comment written in the same millisecond. */
  const rows = await tx<{ id: string; at_key: string; n: number; running: number; total: number }[]>`
       with page as (
         select c.id, c.created_at, octet_length(c.body::text) as weight from comment c
         where c.object_type = ${objectType}::object_kind and c.object_id = ${objectId}
           and c.deleted_at is null
           ${from ? tx`and (c.created_at, c.id) < (${from.at}::text::timestamptz, ${from.id}::uuid)` : tx``}
         order by c.created_at desc, c.id desc
         limit ${COMMENTS_MOST + 1}
       ), kept as (
         select id, created_at,
                row_number() over (order by created_at desc, id desc)::int as n,
                sum(weight) over (order by created_at desc, id desc)::bigint as running,
                count(*) over ()::int as total
         from page
       )
       select c.id, c.body,
              case when c.said_as is null then c.author_id end as author_id, c.parent_id,
              coalesce(c.said_as, a.name) as author_name,
              case when c.said_as is null then a.avatar_key end as author_avatar, c.origin, c.created_at,
              case when c.updated_at > c.created_at then c.updated_at end as edited_at,
              /* On words in a document, and whether it is settled. */
              c.quote, c.resolved_at, c.resolved_by, rb.name as resolved_by_name,
              /* A question with choices, and its answer. */
              c.choices, c.asked, c.answer, c.answered_by, c.answered_at, ab.name as answered_by_name,
              to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at_key,
              k.n, k.running, k.total
       from kept k
       join comment c on c.id = k.id
       join actor a on a.id = c.author_id
       left join actor rb on rb.id = c.resolved_by
       left join actor ab on ab.id = c.answered_by
       where k.n <= ${COMMENTS_MOST} and (k.n = 1 or k.running <= ${COMMENT_BYTES_MOST})
       order by c.created_at, c.id`
  const oldest = rows[0]
  const earlier = oldest && oldest.total > rows.length ? `${oldest.at_key}_${oldest.id}` : null
  return {
    comments: rows.map(({ at_key: _a, n: _n, running: _r, total: _t, ...r }) =>
      facedAs(r as Record<string, unknown>, 'author_avatar', 'author_avatar_url'),
    ),
    earlier,
  }
}

export async function addComment(
  ctx: AuthContext,
  objectType: ObjectKind,
  objectId: string,
  projectId: string,
  body: unknown,
  /** The comment this answers, if it is a reply. */
  answering: string | null = null,
  /** The name it was said under on GitHub, by somebody who is not a person
      here — taken only from a change GitHub caused. */
  saidAs: string | null = null,
  /** Words in the document it is on, marked with its id in the same
      transaction. Answers the words,
      `null` when they are not there, `''` when there are none. */
  anchor: ((tx: Tx, id: string) => Promise<string | null>) | null = null,
  /** A question with choices, on a task, asked of these people or of the
      task's. */
  question: { choices: Choice[]; to: string[] | null } | null = null,
): Promise<{ id: string; quote?: string; asked?: string[] } | null | 'anchor_gone' | 'anchor_empty' | 'nobody_to_ask'> {
  if (!allow(ctx, 'content.create', { inProject: true })) return null
  const id = uuidv7()
  return withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    if (!(await isInProject(tx, projectId))) return null
    /* An anchor starts a thread: a reply is on its thread's words already. */
    if (anchor && answering) return null
    let quote: string | null = null
    if (anchor) {
      quote = await anchor(tx, id)
      if (quote === null) return 'anchor_gone' as const
      if (!quote) return 'anchor_empty' as const
      quote = quote.length > 500 ? `${quote.slice(0, 499)}…` : quote
    }
    /* One level: a reply to a reply answers the comment its parent answers.
       And only a comment on the same thing — a reply cannot hop objects. */
    let parent: string | null = null
    if (answering) {
      const [p] = await tx<{ id: string; parent_id: string | null }[]>`
        select id, parent_id from comment
        where id = ${answering} and object_type = ${objectType}::object_kind
          and object_id = ${objectId} and deleted_at is null`
      if (!p) return null
      parent = p.parent_id ?? p.id
    }
    /* A question starts a thread, on a task, and is asked of somebody. */
    let asked: string[] | null = null
    if (question) {
      if (objectType !== 'task' || parent || anchor) return null
      asked = await whoIsAsked(tx, ctx, objectId, question.to)
      if (!asked.length) return 'nobody_to_ask' as const
    }
    /* A draft it names is named without its title. */
    const said = await veilDocrefs(tx, body)
    await tx`
      insert into comment
        (id, workspace_id, project_id, object_type, object_id, author_id, body, origin, parent_id, said_as, quote,
         choices, asked)
      values (${id}, ${ctx.workspaceId}, ${projectId}, ${objectType}::object_kind,
              ${objectId}, ${ctx.actorId}, ${tx.json(said as never)},
              ${ctx.viaGithub ? 'github' : ctx.viaMcp ? 'mcp' : 'web'}::origin_kind, ${parent},
              ${ctx.viaGithub ? saidAs : null}, ${quote},
              ${question ? tx.json(question.choices.map((c) => ({ label: c.label, recommended: c.recommended === true })) as never) : null},
              ${asked}::uuid[])`
    await subscribe(tx, ctx, objectType, objectId)
    // A comment notifies about the thing it is on rather than about itself:
    // people subscribe to a task, not to each remark made on it.
    if (asked) {
      await askedNote(tx, ctx, objectId, body, asked)
    } else {
      const who = await doer(tx, ctx.actorId)
      await notify(tx, ctx, { objectType, objectId, body, what: (l) => LINES(l).commented(who(l)), kind: 'commented' })
    }
    await linkMentionedObjects(tx, ctx, { type: objectType, id: objectId }, body)
    if (await toldToProject(tx, objectType, objectId))
      await record(tx, ctx, `${objectType}.comment`, {
        projectId,
        objectType,
        objectId,
      })
    return quote ? { id, quote } : asked ? { id, asked } : { id }
  })
}

/* ---------------------------------------------------------- one comment */

type Vars = { ctx: AuthContext }

/**
 * Changing and withdrawing what was said.
 *
 * A comment could be made and never touched again: a typo stood for ever and
 * a line sent to the wrong task stayed on it. Both endpoints are here rather
 * than three times over on posts, tasks and files, because a comment's id is
 * its own — what it is *on* is a pair of columns and not part of the address.
 *
 * `mayEditSaid` decides both: your own always, somebody else's only for the
 * owner and whoever runs the project. Not `mayEdit`, which the bodies use —
 * the workspace switch there is about *documents*, and a comment is not one.
 * Rewriting somebody's sentence leaves their name under it.
 *
 * Deleting is not given a stronger right than editing, because anybody who
 * can rewrite a sentence into nothing has already deleted it — a separate
 * permission there would read as protection and be none.
 */
export const comments = new Hono<{ Variables: Vars }>()

async function held(ctx: AuthContext, id: string) {
  return withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [row] = await tx<
      { author_id: string; project_id: string | null; object_type: ObjectKind; object_id: string }[]
    >`select c.author_id, c.project_id, c.object_type, c.object_id from comment c
      where c.id = ${id} and c.deleted_at is null
        and case c.object_type
              when 'task' then c.project_id is not null
              when 'post' then c.project_id is not null
              when 'file' then exists (select 1 from file o where o.id = c.object_id and o.deleted_at is null)
              else false
            end`
    /* And the file it is on, read under its own policies: a file sent in a
       room with chosen people is hidden from whoever is outside the room,
       the owner and the runners included, and so is what was said about
       it. A task and an announcement are as visible as their project,
       which the comment's own policy already asks. `cmt_read` asks the
       same (migrations 237, 238); asked here too, so not seeing the object
       is the 404 and never a 403. */
    return row ?? null
  })
}

comments.patch('/comments/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const body = CommentBody.safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)

  // Row-level security has already refused anything outside the projects this
  // person is on, so not finding it is the 404 the design asks for rather than
  // a 403 that admits the row exists.
  const row = await held(ctx, id)
  if (!row) return c.json(missing, 404)
  if (!mayEditSaid(ctx, row.author_id, row.project_id ?? undefined)) return c.json(forbidden, 403)
  /* Somebody else's, never through a token — an agent's, a person's tool,
     one held to a few projects, the owner's own — nor by GitHub or an
     import acting as somebody: rewriting a sentence into nothing is
     deleting it, which no token does. One's own stays a token's to fix,
     which is what `update_comment` is for. As an announcement is; */
  if (row.author_id !== ctx.actorId && (ctx.viaMcp || ctx.viaGithub || ctx.viaImport)) return c.json(forbidden, 403)

  const done = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    /* What it said before, held until the write, so two edits at once each
       compare against the words they replace and a name is not told twice
       — or not at all. */
    const [was] = await tx<{ body: unknown }[]>`
      select body from comment where id = ${id} and deleted_at is null for update`
    if (!was) return false
    await tx`
      update comment set body = ${tx.json((await veilDocrefs(tx, body.data.body)) as never)}, updated_at = now()
      where id = ${id}`
    /* What it mentions is re-read, because the edit is what changed it. A
       link left behind by a sentence somebody deleted is a link to
       something nobody is talking about. */
    await linkMentionedObjects(tx, ctx, { type: row.object_type, id: row.object_id }, body.data.body)
    /* A name the edit added is told, once; the names it already had are
       not told again, and nobody watching hears about a typo fixed —
       `docs/specs/task-mentions.md`. */
    const before = new Set(mentionedIds(was.body))
    const fresh = mentionedIds(body.data.body).filter((x) => x !== 'everyone' && !before.has(x))
    if (fresh.length) {
      const who = await doer(tx, ctx.actorId)
      await notify(tx, ctx, {
        objectType: row.object_type,
        objectId: row.object_id,
        body: { type: 'doc', content: fresh.map((x) => ({ type: 'mention', attrs: { id: x } })) },
        watchers: false,
        what: (l) => LINES(l).commented(who(l)),
        kind: 'commented',
      })
    }
    if (await toldToProject(tx, row.object_type, row.object_id))
      await record(tx, ctx, `${row.object_type}.comment.edit`, {
        projectId: row.project_id,
        objectType: row.object_type,
        objectId: row.object_id,
      })
    return true
  })
  if (!done) return c.json(missing, 404)
  return c.json({ ok: true })
})

comments.delete('/comments/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const row = await held(ctx, id)
  if (!row) return c.json(missing, 404)
  /* Never through a token, one's own included — as a task is not; and
     somebody else's never by GitHub or an import acting as somebody.
     GitHub carrying a deletion made there acts as the comment's author. */
  if (
    !mayEditSaid(ctx, row.author_id, row.project_id ?? undefined) ||
    ctx.viaMcp ||
    (row.author_id !== ctx.actorId && (ctx.viaGithub || ctx.viaImport))
  )
    return c.json(forbidden, 403)

  await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    // Soft, like everything else, and the clear-out takes it for good —
    // and who did it, so Undo is theirs.
    await tx`update comment set deleted_at = now(), deleted_by = ${ctx.actorId}, updated_at = now() where id = ${id}`
    if (await toldToProject(tx, row.object_type, row.object_id))
      await record(tx, ctx, `${row.object_type}.comment.delete`, {
        projectId: row.project_id,
        objectType: row.object_type,
        objectId: row.object_id,
      })
  })
  return c.json({ ok: true })
})

/*
 * A comment put back, which is what the toast's Undo presses.
 * Whoever deleted it, or whoever may change what
 * anybody said here (`content.edit.said`: the owner, whoever runs the
 * project). Only while the thing it is on stands, read under the same
 * policies as reading it: `404` otherwise, and for what the asker cannot
 * see. Back where it was — its thread, its words in a document, its
 * answers.
 */
comments.post('/comments/:id/restore', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const result = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [row] = await tx<
      { deleted_by: string | null; project_id: string | null; object_type: ObjectKind; object_id: string }[]
    >`select c.deleted_by, c.project_id, c.object_type, c.object_id from comment c
      where c.id = ${id} and c.workspace_id = ${ctx.workspaceId} and c.deleted_at is not null
        and case c.object_type
              when 'task' then exists (select 1 from task o where o.id = c.object_id and o.deleted_at is null)
              when 'post' then exists (select 1 from post o where o.id = c.object_id and o.deleted_at is null)
              when 'file' then exists (select 1 from file o where o.id = c.object_id and o.deleted_at is null)
              else false
            end`
    /* Not `for update`: that asks the row's update policy, which is the
       question below, and its refusal would read as not being there. */
    if (!row) return 'missing' as const
    if (row.project_id && !(await isInProject(tx, row.project_id))) return 'missing' as const
    if (!mayTakeBack(ctx, row.deleted_by, row.project_id, 'content.edit.said')) return 'forbidden' as const
    /* Only a deleted one, and only what the row's policy lets this asker
       write: a restore that changed nothing says so, and logs nothing. */
    const back = await tx`
      update comment set deleted_at = null, deleted_by = null, updated_at = now()
      where id = ${id} and deleted_at is not null returning id`
    if (back.length === 0) return 'missing' as const
    /* No words in the line, as its delete had none: the thing it is on is
       named to whoever may read it, by the feed's own join — and nothing at
       all for a file in a room of chosen people. */
    if (await toldToProject(tx, row.object_type, row.object_id))
      await record(tx, ctx, `${row.object_type}.comment.restore`, {
        projectId: row.project_id,
        objectType: row.object_type,
        objectId: row.object_id,
      })
    return 'ok' as const
  })
  if (result === 'missing') return c.json(missing, 404)
  if (result === 'forbidden') return c.json(forbidden, 403)
  return c.json({ ok: true })
})

/*
 * A thread on a document's words settled, or opened again.
 * Whoever may comment on the document
 * may do either: it is not a change to what anybody said, so not
 * `mayEditSaid`; and through a token too, since it takes nothing away and
 * the same call takes it back.
 */
comments.put('/comments/:id/resolved', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const body = z.object({ resolved: z.boolean() }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const row = await held(ctx, id)
  if (!row) return c.json(missing, 404)
  if (!allowIn(ctx, 'content.create', row.project_id ?? undefined, { inProject: true })) return c.json(forbidden, 403)

  const done = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    /* Read again under every policy, in the transaction that changes it. */
    const [t] = await tx<{ quote: string | null; parent_id: string | null; resolved_at: string | null }[]>`
      select quote, parent_id, resolved_at from comment where id = ${id} and deleted_at is null`
    if (!t) return 'missing' as const
    if (!t.quote || t.parent_id) return 'not_anchored' as const
    if (row.project_id && !(await isInProject(tx, row.project_id))) return 'missing' as const
    if (Boolean(t.resolved_at) === body.data.resolved) return 'same' as const
    const [r] = await tx<{ ok: boolean }[]>`select resolve_thread(${id}, ${body.data.resolved}) as ok`
    if (!r?.ok) return 'missing' as const
    await record(tx, ctx, `${row.object_type}.comment.${body.data.resolved ? 'resolve' : 'reopen'}`, {
      projectId: row.project_id,
      objectType: row.object_type,
      objectId: row.object_id,
    })
    return 'done' as const
  })
  if (done === 'missing') return c.json(missing, 404)
  if (done === 'not_anchored')
    return c.json({ error: { code: 'not_anchored', message: 'Only a comment on words in a document is resolved.' } }, 409)
  return c.json({ ok: true, resolved: body.data.resolved })
})

/*
 * A question answered. A person's press:
 * `question.answer` is never an agent's and never a token's. Once: a second
 * answer is `409 answered` with the one that stands. Through
 * `answer_question`, a definer, because the question is the agent's comment
 * and `cmt_update` lets only its author and the project's runners change it.
 */
type Answered = {
  choices: Choice[] | null
  answer: number | null
  answered_by: string | null
  answered_by_name: string | null
  answered_at: string | null
}
const answeredIn = async (tx: Tx, id: string): Promise<Answered | undefined> =>
  (
    await tx<Answered[]>`select c.choices, c.answer, c.answered_by, a.name as answered_by_name, c.answered_at
      from comment c left join actor a on a.id = c.answered_by where c.id = ${id}`
  )[0]

comments.put('/comments/:id/answer', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const body = z.object({ choice: z.int().min(0).max(3) }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const row = await held(ctx, id)
  if (!row) return c.json(missing, 404)
  if (!allowIn(ctx, 'question.answer', row.project_id ?? undefined, { inProject: true })) return c.json(forbidden, 403)

  const done = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [q] = await tx<{ choices: unknown; author_id: string; asked: string[] | null }[]>`
      select choices, author_id, asked from comment where id = ${id} and deleted_at is null`
    if (!q) return { said: 'missing' as const }
    if (!q.choices) return { said: 'not_a_question' as const }
    const [r] = await tx<{ said: string }[]>`select answer_question(${id}, ${body.data.choice}) as said`
    const said = (r?.said ?? 'missing') as 'done' | 'missing' | 'answered' | 'out_of_range'
    if (said !== 'done') return { said, now: await answeredIn(tx, id) }
    /* My own note about it is read: the press was the reading. */
    await tx`
      update notification set read_at = now()
      where actor_id = ${ctx.actorId} and reason = 'asked' and object_type = 'task'
        and object_id = ${row.object_id} and read_at is null`
    /* The agent that asked hears it, where it comes for what was said to it
       (`my_mentions`). */
    const who = await doer(tx, ctx.actorId)
    await notify(tx, ctx, {
      objectType: 'task',
      objectId: row.object_id,
      watchers: false,
      also: { ids: [q.author_id], reason: 'mentioned' },
      kind: 'answered',
      what: (l) => LINES(l).answered(who(l)),
    })
    /* And everybody else asked reads their Needs you again: it is answered. */
    const others = (q.asked ?? []).filter((x) => x !== ctx.actorId)
    if (others.length) {
      await publishTo(
        tx,
        others.map((x) => `actor:${x}`),
        'notification',
        { reason: 'asked', object_type: 'task', object_id: row.object_id, workspace_id: ctx.workspaceId },
      )
    }
    await record(tx, ctx, 'task.comment.answer', {
      projectId: row.project_id,
      objectType: 'task',
      objectId: row.object_id,
      meta: { comment_id: id, choice: body.data.choice },
    })
    return { said, now: await answeredIn(tx, id) }
  })
  if (done.said === 'missing') return c.json(missing, 404)
  if (done.said === 'not_a_question')
    return c.json({ error: { code: 'not_a_question', message: 'Only a question with choices is answered.' } }, 409)
  if (done.said === 'out_of_range') return c.json({ error: { code: 'invalid', message: 'No such choice.' } }, 400)
  if (done.said === 'answered')
    return c.json({ error: { code: 'answered', message: 'Someone already answered this question.' }, ...done.now }, 409)
  return c.json({ ok: true, ...done.now })
})

/* Whether a question is answered, and with what — what `get_answer` asks. */
comments.get('/comments/:id/answer', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const row = await held(ctx, id)
  if (!row) return c.json(missing, 404)
  const q = await withActor(ctx.actorId, ctx.workspaceId, (tx) => answeredIn(tx, id))
  if (!q?.choices) return c.json({ error: { code: 'not_a_question', message: 'Only a question with choices is answered.' } }, 409)
  return c.json({ id, object_id: row.object_id, ...q })
})
