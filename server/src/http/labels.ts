import { Hono } from 'hono'
import { z } from 'zod'
import { generateNKeysBetween } from 'fractional-indexing'
import { v7 as uuidv7 } from 'uuid'
import { withActor } from '../db.js'
import { allow, type AuthContext } from '../auth/context.js'

/**
 * Words on a task.
 *
 * Per project: each keeps its own vocabulary and a new one starts with
 * Bug, Feature and Improvement (a trigger, `071`). Made by typing a name
 * into the picker on a task, or in the project's settings, where they are
 * also renamed, recoloured and taken away.
 */
export const labels = new Hono<{ Variables: { ctx: AuthContext } }>()

const Name = z.string().trim().min(1).max(40)

/**
 * One of the ten the product already draws with, or nothing.
 *
 * Checked against the list rather than taken as a colour: a free string here
 * is a label that can be any colour at all, which is a second palette beside
 * the one every other mark in the product uses. `web/src/ui/kit.tsx` holds
 * the same ten.
 *
 * Null is the ordinary state and means the chip works it out from the id, as
 * every label did before this existed.
 */
const Colour = z.enum(['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink', 'grey'])

labels.get('/labels', async (c) => {
  const ctx = c.get('ctx')
  const rows = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      tx`select l.id, l.project_id, l.name, l.color
       from label l
       where l.workspace_id = ${ctx.workspaceId} and l.deleted_at is null
       order by l.sort_key nulls last, l.name`,
  )
  return c.json({ labels: rows })
})

/**
 * A project's own, with how many of its tasks carry each.
 *
 * The count is the project's, because the label is: it is the number a
 * person removing one needs to see.
 */
labels.get('/projects/:projectId/labels', async (c) => {
  const ctx = c.get('ctx')
  const projectId = c.req.param('projectId')
  const rows = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      tx`select l.id, l.project_id, l.name, l.color,
              (select count(*) from task_label tl join task t on t.id = tl.task_id
               where tl.label_id = l.id and t.deleted_at is null)::int as used
       from label l
       where l.workspace_id = ${ctx.workspaceId} and l.project_id = ${projectId}
         and l.deleted_at is null
       order by l.sort_key nulls last, l.name`,
  )
  return c.json({ labels: rows })
})

/**
 * Made by name, in a project, and the same name twice is the same label.
 *
 * Two people typing "bug" a minute apart must not end with two labels called
 * bug, which is the fault every tool with labels has. The unique index —
 * per project now — decides it rather than a read-then-write that two
 * requests can both win.
 */
labels.post('/projects/:projectId/labels', async (c) => {
  const ctx = c.get('ctx')
  if (!allow(ctx, 'content.create')) return c.json({ error: { code: 'forbidden' } }, 403)
  const projectId = c.req.param('projectId')
  const body = z.object({ name: Name, color: Colour.nullish() }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)

  const row = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    /* A project this person cannot see is one they cannot label: 404, as a
       link into it would be. */
    const [here] = await tx`select 1 from project
      where id = ${projectId} and workspace_id = ${ctx.workspaceId} and deleted_at is null`
    if (!here) return null
    const [made] = await tx<{ id: string; project_id: string; name: string; color: string | null }[]>`
      insert into label (id, workspace_id, project_id, name, color)
      values (${uuidv7()}, ${ctx.workspaceId}, ${projectId}, ${body.data.name}, ${body.data.color ?? null})
      on conflict (project_id, name) where deleted_at is null
      /* The colour is not overwritten by a second person typing the same
         name: the row already exists and is already somebody's answer. */
      do update set updated_at = now()
      returning id, project_id, name, color`
    return made ?? null
  })
  if (!row) return c.json({ error: { code: 'not_found' } }, 404)
  return c.json(row, 201)
})

/**
 * Renamed, or given a colour, or given its own colour back.
 *
 * From the project's settings. A name another
 * label in the project already has is refused rather than merged: two
 * labels becoming one is a decision about every task that carries either,
 * and a rename is not where to make it.
 */
labels.patch('/labels/:id', async (c) => {
  const ctx = c.get('ctx')
  if (!allow(ctx, 'content.create')) return c.json({ error: { code: 'forbidden' } }, 403)
  const body = z
    .object({
      name: Name.optional(),
      color: Colour.nullable().optional(),
      /* After this label in its project's order, or first when null. */
      after: z.uuid().nullable().optional(),
    })
    .refine((b) => b.name !== undefined || b.color !== undefined || b.after !== undefined)
    .safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const { name, color, after } = body.data
  try {
    const row = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
      const [r] = await tx<{ id: string; project_id: string; name: string; color: string | null }[]>`
        update label set
          name = coalesce(${name ?? null}, name),
          color = ${color === undefined ? tx`color` : color},
          updated_at = now()
        where id = ${c.req.param('id')} and workspace_id = ${ctx.workspaceId}
          and deleted_at is null
        returning id, project_id, name, color`
      /*
       * Moved in its project's order, the whole order written again: the
       * labels with no place yet are given one in the order they were
       * shown, so a first move puts every label somewhere.
       */
      if (r && after !== undefined) {
        const all = await tx<{ id: string }[]>`
          select id from label where project_id = ${r.project_id} and deleted_at is null
          order by sort_key nulls last, name`
        const rest = all.map((l) => l.id).filter((x) => x !== r.id)
        const at = after === null ? 0 : rest.indexOf(after) + 1
        if (after !== null && at === 0) return null
        rest.splice(at, 0, r.id)
        const keys = generateNKeysBetween(null, null, rest.length)
        for (let i = 0; i < rest.length; i++) {
          await tx`update label set sort_key = ${keys[i]!} where id = ${rest[i]!}`
        }
      }
      return r ?? null
    })
    if (!row) return c.json({ error: { code: 'not_found' } }, 404)
    return c.json(row)
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return c.json({ error: { code: 'taken' } }, 409)
    throw e
  }
})

/**
 * And taking one away.
 *
 * A workspace starts with three, which means somebody who disagrees with one
 * has to be able to remove it — a starter nobody can delete is a vocabulary
 * imposed rather than offered. Soft, like everything else here: the rows that
 * carried it stay, and every read filters on `deleted_at`, so a label removed
 * by mistake is a row to bring back rather than a set of tasks to re-label.
 */
labels.delete('/labels/:id', async (c) => {
  const ctx = c.get('ctx')
  if (!allow(ctx, 'content.create')) return c.json({ error: { code: 'forbidden' } }, 403)
  await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      tx`update label set deleted_at = now(), updated_at = now()
       where id = ${c.req.param('id')} and workspace_id = ${ctx.workspaceId}
         and deleted_at is null`,
  )
  return c.json({ ok: true })
})
