import { Hono } from 'hono'
import { AUDIT_TYPES, AuditTypeKey } from '@tracker/shared-schema'
import { withActor } from '../db.js'
import { allow, type AuthContext } from '../auth/context.js'
import { forbidden } from './objects.js'
import { pageSize } from './limits.js'

type Vars = { ctx: AuthContext }
export const audit = new Hono<{ Variables: Vars }>()

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** `<moment in UTC>_<id>`, or the bare moment this answered with before. */
const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z)(?:_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?$/i

/**
 * Read by a person, in their own session — never through a token: not an
 * owner's MCP token, not the GitHub or import work that acts as the owner.
 * The log carries every member's sign-in address and browser, and a key
 * handed to a tool is not the owner looking. As `slack.ts` and
 * `webhooks.ts` decide it.
 */
export const readsAudit = (ctx: AuthContext): boolean =>
  Boolean(ctx.sessionId) && !ctx.viaMcp && !ctx.viaGithub && !ctx.viaImport && allow(ctx, 'audit.read')

/**
 * The audit log.
 *
 * Who did what across the whole workspace: sign-ins and tokens, who came in
 * and who was taken out, rights given, switches turned, projects deleted,
 * integrations connected. The security record and the workspace's own lines
 * of the feed, read as one list by `audit_page`, newest first, narrowed by
 * kind (`?type=`) and by a person it is by or about (`?who=`).
 *
 * Separate from a project's Activity because it answers a different
 * question to a different reader: not what happened to the work but who was
 * given what, and by whom — and only the owner reads it.
 */
audit.get('/audit', async (c) => {
  const ctx = c.get('ctx')
  if (!readsAudit(ctx)) return c.json(forbidden, 403)
  const limit = pageSize(c.req.query('limit'), 50, 200)

  const type = c.req.query('type')
  const kinds = type ? AuditTypeKey.safeParse(type) : null
  if (kinds && !kinds.success) return c.json({ error: { code: 'invalid' } }, 400)
  const who = c.req.query('who') || null
  if (who && !UUID.test(who)) return c.json({ error: { code: 'invalid' } }, 400)

  /* The cursor this answered last time, or — from before there were two
     tables under it — a bare moment, which reads as "before it". */
  const cursor = c.req.query('cursor')
  let at: string | null = null
  let id: string | null = null
  if (cursor) {
    /* Exactly the shape this answers with: anything else is a 400, not a
       cast the database refuses with a 500. */
    const said = CURSOR.exec(cursor)
    if (!said || Number.isNaN(Date.parse(said[1]!))) return c.json({ error: { code: 'invalid' } }, 400)
    at = said[1]!
    id = said[2] ?? '00000000-0000-0000-0000-000000000000'
  }
  const asked = kinds?.success ? [...AUDIT_TYPES[kinds.data]] : null

  /* The moment to the microsecond, as text both ways: a `Date` keeps
     milliseconds, and a cursor a few hundred microseconds off skips the
     lines between. The driver turns a `timestamptz` parameter into a `Date`
     on its way in, so it is sent as text and cast in the query. */
  const rows = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      tx<{ id: string; at_key: string; subject_name: string | null }[]>`
      select p.*, to_char(p.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at_key
      from audit_page(${asked}::text[], ${who}::uuid, ${at}::text::timestamptz, ${id}::uuid, ${limit}) p`,
  )
  const last = rows[rows.length - 1]
  return c.json({
    events: rows.map(({ at_key: _, ...r }) => ({ ...r, to_name: r.subject_name })),
    /* `<at>_<id>`: the last line's moment and the line itself, so two lines
       written in one moment are neither skipped nor shown twice. */
    next_cursor: rows.length === limit && last ? `${last.at_key}_${last.id}` : null,
  })
})

/**
 * Everybody the log can be narrowed to: the people here now and the people
 * who were — "who removed Sam" is asked about somebody no longer in the
 * Members list. Agents too: what a tool did is in the log under its name.
 */
audit.get('/audit/people', async (c) => {
  const ctx = c.get('ctx')
  if (!readsAudit(ctx)) return c.json(forbidden, 403)
  const people = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      tx`
      select actor_id, name, here from (
        select distinct on (m.actor_id) m.actor_id, a.name, (m.deleted_at is null) as here
        from membership m
        join actor a on a.id = m.actor_id
        where m.workspace_id = ${ctx.workspaceId}
        order by m.actor_id, (m.deleted_at is null) desc
      ) p
      order by here desc, lower(name), actor_id`,
  )
  return c.json({ people })
})
