import { Hono } from 'hono'
import { withActor, type Tx } from '../db.js'
import type { AuthContext } from '../auth/context.js'
import { faceLink } from '../storage.js'
import { record } from './activity.js'
import { pageSize } from './limits.js'
import { forbidden, mayEdit, missing } from './objects.js'
import { Refused, restoreBody } from '../coedit.js'
import { keepVersion } from '../versions.js'

/*
 * A document's versions: read, and one put back.
 * Kept by the co-editing room and by
 * `PATCH /api/files/:id` (`server/src/versions.ts`); read here.
 */

type Vars = { ctx: AuthContext }
export const versions = new Hono<{ Variables: Vars }>()

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Doc = { author_id: string; project_id: string | null }

/**
 * The written document, as this reader may see it: under their own
 * row-level security, in their workspace, not in the bin, neither an
 * upload nor a link. Null is a 404 — for another workspace's, one on a
 * project they are not on, and one that has no versions to have.
 */
async function documentOf(tx: Tx, ctx: AuthContext, id: string): Promise<Doc | null> {
  if (!UUID.test(id)) return null
  const [f] = await tx<Doc[]>`
    select author_id, project_id from file
    where id = ${id} and workspace_id = ${ctx.workspaceId} and deleted_at is null
      and body is not null and storage_key is null and url is null`
  return f ?? null
}

type Row = {
  id: string
  version: number
  created_at: string
  restored_version: number | null
  contributors: { actor_id: string; name: string; avatar_key: string | null }[]
  body?: unknown
}

/* Who wrote in it, by name and face, in the order they first wrote. */
const shown = ({ contributors, ...r }: Row) => ({
  ...r,
  contributors: contributors.map(({ avatar_key, ...p }) => ({ ...p, avatar_url: avatar_key ? faceLink(avatar_key) : null })),
})

const columns = (tx: Tx) => tx`
  v.id, v.version, v.created_at, v.restored_version,
  coalesce((
    select json_agg(json_build_object('actor_id', a.id, 'name', a.name, 'avatar_key', a.avatar_key)
                    order by array_position(v.contributors, a.id))
    from actor a where a.id = any (v.contributors)
  ), '[]'::json) as contributors`

versions.get('/files/:id/versions', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const cursor = c.req.query('cursor') || null
  if (cursor !== null && !UUID.test(cursor)) return c.json({ error: { code: 'invalid' } }, 400)
  const limit = pageSize(c.req.query('limit'), 50, 100)
  const page = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    if (!(await documentOf(tx, ctx, id))) return null
    /* By the uuidv7 each was given: newest first, and two kept in one
       moment neither skipped nor shown twice. */
    return tx<Row[]>`
      select ${columns(tx)}
      from file_version v
      where v.workspace_id = ${ctx.workspaceId} and v.file_id = ${id}
        and (${cursor}::uuid is null or v.id < ${cursor}::uuid)
      order by v.id desc
      limit ${limit + 1}`
  })
  if (!page) return c.json(missing, 404)
  const more = page.length > limit
  const rows = more ? page.slice(0, limit) : page
  return c.json({ versions: rows.map(shown), next_cursor: more ? rows[rows.length - 1]!.id : null })
})

versions.get('/files/:id/versions/:versionId', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const versionId = c.req.param('versionId')
  if (!UUID.test(versionId)) return c.json(missing, 404)
  const row = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    if (!(await documentOf(tx, ctx, id))) return null
    const [v] = await tx<Row[]>`
      select ${columns(tx)}, v.body
      from file_version v
      where v.workspace_id = ${ctx.workspaceId} and v.file_id = ${id} and v.id = ${versionId}`
    return v ?? null
  })
  if (!row) return c.json(missing, 404)
  return c.json({ version: shown(row) })
})

/*
 * Put back: an edit like any other, in the restorer's name, merged into
 * the shared state so the people in the document see it change — and a
 * new version, so nothing after the one restored is lost.
 */
versions.post('/files/:id/versions/:versionId/restore', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const versionId = c.req.param('versionId')
  if (!UUID.test(versionId)) return c.json(missing, 404)
  const result = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const f = await documentOf(tx, ctx, id)
    if (!f) return 'missing' as const
    const [v] = await tx<{ version: number; body: unknown }[]>`
      select version, body from file_version
      where workspace_id = ${ctx.workspaceId} and file_id = ${id} and id = ${versionId}`
    if (!v) return 'missing' as const
    if (!mayEdit(ctx, f.author_id, f.project_id ?? undefined)) return 'forbidden' as const
    const done = await restoreBody(tx, ctx, id, v.body)
    if (!done) return 'missing' as const
    if (!done.changed) return { version: done.version }
    await keepVersion(tx, {
      fileId: id,
      workspaceId: ctx.workspaceId,
      version: done.version,
      body: done.body,
      contributors: [ctx.actorId],
      before: done.before,
      restoredVersion: v.version,
    })
    await record(tx, ctx, 'file.update', {
      projectId: f.project_id,
      objectType: 'file',
      objectId: id,
      meta: { restored_version: v.version },
    })
    return { version: done.version }
  }).catch((e: unknown) => {
    if (e instanceof Refused) return e
    throw e
  })
  if (result instanceof Refused)
    return c.json({ error: { code: 'too_large', message: 'This document is too large to add more. Remove something first.' } }, 413)
  if (result === 'missing') return c.json(missing, 404)
  if (result === 'forbidden') return c.json(forbidden, 403)
  return c.json({ ok: true, version: result.version })
})
