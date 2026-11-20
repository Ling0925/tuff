import { Hono } from 'hono'
import { withActor } from '../db.js'
import type { AuthContext } from '../auth/context.js'

type Vars = { ctx: AuthContext }
export const search = new Hono<{ Variables: Vars }>()

/**
 * One search across everything, filtered by type and project.
 *
 * It reads the tables directly for now. The design calls for a separate index
 * at scale, and the shape of this endpoint is what that index will have to
 * answer — so the contract can stay while the implementation moves.
 *
 * Nothing here filters for a client: row-level security has already decided
 * what these queries can see, which is the whole reason visibility lives on
 * the row rather than in a handler.
 */
search.get('/search', async (c) => {
  const ctx = c.get('ctx')
  /* Two hundred characters at most, and `%` and `_` taken as themselves —
     a pattern of wildcards has no trigrams and reads every row. */
  const q = (c.req.query('q') ?? '').trim().slice(0, 200)
  const types = (c.req.query('type') ?? '').split(',').filter(Boolean)
  const projectId = c.req.query('project') ?? null

  /*
   * Narrowing what was said:
   * from one person, with a link, with a file, in a thread, oldest first.
   * Each is about messages alone, so asking for any of them asks for
   * messages and nothing else, and words may be left out.
   */
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const from = c.req.query('from') ?? null
  if (from !== null && !uuid.test(from)) return c.json({ error: { code: 'invalid' } }, 400)
  if (projectId !== null && !uuid.test(projectId)) return c.json({ error: { code: 'invalid' } }, 400)
  const has = (c.req.query('has') ?? '').split(',').filter(Boolean)
  const link = has.includes('link')
  const file = has.includes('file')
  const thread = c.req.query('in') === 'thread'
  const oldest = c.req.query('sort') === 'oldest'
  const narrowed = Boolean(from) || link || file || thread
  if (narrowed || oldest) {
    if (!narrowed && q.length < 3) return c.json({ results: [] })
    const results = await withActor(
      ctx.actorId,
      ctx.workspaceId,
      (tx) => tx`
        select 'message' as type, * from search_messages_by(${q}, ${projectId}::uuid, ${from}::uuid, ${link}, ${file}, ${thread}, ${oldest})`,
    )
    return c.json({ results })
  }

  if (q.length < 2) return c.json({ results: [] })
  const wants = (t: string) => types.length === 0 || types.includes(t)

  /*
   * A task by its handle — `TRA-111`, `tra111`, `TRA-11` on the way to it,
   * or the number alone. The handle is what people say, paste and type,
   * and it is in no title. `docs/specs/palette.md`.
   */
  const handle = /^([a-z]{1,3}\d*)-(\d{1,7})$/i.exec(q) ?? /^([a-z]{1,3})(\d{1,7})$/i.exec(q) ?? /^()(\d{1,7})$/.exec(q)
  /*
   * And the words: a title, or what is written inside — a description, an
   * announcement, a document — each under its own trigram index
   * (migration 098). A title that matches stands above one that only says
   * the words further down, and where the words were found inside, a piece
   * of the sentence comes back to show where.
   */
  const results = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const out: unknown[] = []
    if (handle && wants('task')) {
      const key = handle[1] ? handle[1].toUpperCase() : null
      out.push(
        ...(await tx`
          select 'task' as type, t.id, t.number, t.project_id, t.title, t.created_at,
                 null as snippet, true as by_handle
          from task t join project p on p.id = t.project_id
          /* The workspace named, so the index on it bounds the read to
             this company's tasks rather than every company's. */
          where t.workspace_id = ${ctx.workspaceId} and t.deleted_at is null
            and (${key}::text is null or p.key = ${key})
            and t.number::text like ${`${handle[2]}%`}
            ${projectId ? tx`and t.project_id = ${projectId}` : tx``}
          order by length(t.number::text), t.number limit 10`),
      )
    }
    const seen = new Set(out.map((r) => (r as { id: string }).id))
    const add = (rows: { id: string }[]) => out.push(...rows.filter((r) => !seen.has(r.id)))
    /*
     * Through the three `search_*` functions, which can use the trigram
     * indexes: `ilike` is not leakproof, so under row-level security no
     * index was ever used and every task, post and file in the database was
     * read for each key pressed. They say in the query what the policies
     * say — this workspace, what the asker can see — and look inside a body
     * from three letters, the shortest a trigram index can find.
     */
    const project = projectId ?? null
    if (wants('post')) {
      add(await tx`select 'post' as type, * from search_posts(${q}, ${project}::uuid)`)
    }
    if (wants('task')) {
      add(await tx`select 'task' as type, * from search_tasks(${q}, ${project}::uuid)`)
    }
    if (wants('file')) {
      const found = await tx<{ id: string }[]>`select 'file' as type, * from search_files(${q}, ${project}::uuid)`
      /* And what each wears, so a document is found by the mark it is
         known by — `docs/specs/docs.md`, "A document's mark". Read
         beside the function rather than in it: what it answers is a
         table type the policies' audit pinned down. */
      const marks = found.length
        ? await tx<{ id: string; mark_icon: string | null; mark_tint: number | null }[]>`
            select id, mark_icon, mark_tint from file where id = any(${found.map((f) => f.id)}::uuid[])`
        : []
      const markOf = new Map(marks.map((m) => [m.id, m]))
      add(found.map((f) => ({ ...f, mark_icon: markOf.get(f.id)?.mark_icon ?? null, mark_tint: markOf.get(f.id)?.mark_tint ?? null })))
    }
    /* What was said in chat, in the rooms this person may read, after the
       rest. Only when asked for by name: an
       app from before draws a found message as a row it cannot open. */
    if (types.includes('message')) {
      add(await tx`select 'message' as type, * from search_messages(${q}, ${project}::uuid)`)
    }
    return out
  })
  return c.json({ results })
})
