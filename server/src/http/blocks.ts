import { Hono } from 'hono'
import { z } from 'zod'
import { withActor, type Tx } from '../db.js'
import type { AuthContext } from '../auth/context.js'
import { publish } from '../realtime.js'
import { LINES, notify } from '../notify.js'
import { forbidden, mayEdit, missing } from './objects.js'

/**
 * Blocked by.
 *
 * A task waits on another; the other blocks it. A field on Task kept in
 * `task_block`, readable only where both tasks are (the table's own policy),
 * changed by whoever may edit the task that waits.
 */

type Vars = { ctx: AuthContext }
export const blocks = new Hono<{ Variables: Vars }>()

/** One end of a relation as a screen draws it: handle, title, where it stands. */
export type Related = {
  id: string
  number: number
  title: string
  project_id: string
  project_key: string
  project_slug: string
  completed_at: string | null
  list_icon: string | null
  list_color: string | null
}

const columns = (tx: Tx) => tx`
  t.id, t.number, t.title, t.project_id, p.key as project_key, p.slug as project_slug,
  t.completed_at, l.icon as list_icon, l.color as list_color`

/** What this task waits on, and what waits on it — readable ones only. */
export async function relationsOf(tx: Tx, taskId: string): Promise<{ blocked_by: Related[]; blocks: Related[] }> {
  const [blockedBy, blocking] = await Promise.all([
    tx<Related[]>`
      select ${columns(tx)}
      from task_block tb
      join task t on t.id = tb.blocker_id
      join project p on p.id = t.project_id
      left join task_list l on l.id = t.list_id
      where tb.task_id = ${taskId} and t.deleted_at is null and p.deleted_at is null
      order by tb.created_at, t.id`,
    tx<Related[]>`
      select ${columns(tx)}
      from task_block tb
      join task t on t.id = tb.task_id
      join project p on p.id = t.project_id
      left join task_list l on l.id = t.list_id
      where tb.blocker_id = ${taskId} and t.deleted_at is null and p.deleted_at is null
      order by tb.created_at, t.id`,
  ])
  return { blocked_by: blockedBy, blocks: blocking }
}

/** A task this one blocks, with the handles it waits on now. */
export type Waiting = { id: string; waiting_on: string[] }

/**
 * The tasks this one blocks, readable ones, each with what it waits on
 * that is still open — the same handles the project's rows carry. Asked
 * when this one is finished or reopened, so the screen that moved it can
 * put the marks right without reading the project again.
 */
export async function waitingOnNow(tx: Tx, taskId: string): Promise<Waiting[]> {
  return tx<Waiting[]>`
    select w.id,
           coalesce((select json_agg(bp.key || '-' || b.number order by tb2.created_at, b.id)
                     from task_block tb2
                     join task b on b.id = tb2.blocker_id
                     join project bp on bp.id = b.project_id
                     where tb2.task_id = w.id and b.deleted_at is null and b.completed_at is null
                       and bp.deleted_at is null), '[]') as waiting_on
    from task_block tb
    join task w on w.id = tb.task_id
    where tb.blocker_id = ${taskId} and w.deleted_at is null
    order by tb.created_at, w.id
    limit 200`
}

/**
 * Told when the last thing a task waited on is finished.
 *
 * Called right after a task went from open to finished, in the same
 * transaction. `task_unblocked_by` is a definer: the person finishing need
 * not see what it held up. Each assignee is then asked, as them, whether
 * they may read both — the line names the blocker.
 */
export async function tellUnblocked(tx: Tx, ctx: AuthContext, taskId: string): Promise<void> {
  const freed = await tx<{ task_id: string; project_key: string; number: number; assignee_ids: string[] }[]>`
    select * from task_unblocked_by(${taskId})`
  if (freed.length === 0) return
  const [done] = await tx<{ number: number; key: string }[]>`
    select t.number, p.key from task t join project p on p.id = t.project_id where t.id = ${taskId}`
  if (!done) return
  const doneHandle = `${done.key}-${done.number}`
  for (const w of freed) {
    const asked = (w.assignee_ids ?? []).filter((id) => id !== ctx.actorId)
    if (asked.length === 0) continue
    const may = await tx<{ id: string }[]>`
      select x as id from unnest(${asked}::uuid[]) x
      where may_read(x, 'task'::object_kind, ${w.task_id}) and may_read(x, 'task'::object_kind, ${taskId})`
    if (may.length === 0) continue
    const handle = `${w.project_key}-${w.number}`
    await notify(tx, ctx, {
      objectType: 'task',
      objectId: w.task_id,
      also: { ids: may.map((m) => m.id), reason: 'unblocked' },
      watchers: false,
      kind: 'unblocked',
      what: (l) => LINES(l).unblocked(doneHandle, handle),
    })
  }
}

/** The screens watching either end read again. Nothing reaches the feed. */
async function heard(tx: Tx, ctx: AuthContext, projects: string[], taskId: string): Promise<void> {
  for (const projectId of new Set(projects)) {
    await publish(
      `project:${projectId}`,
      'task.update',
      { object_type: 'task', object_id: taskId, actor_id: ctx.actorId, tab: ctx.tab ?? null },
      tx,
    )
  }
}

/** The task that waits, read as the caller, and whether they may change it. */
async function waiting(tx: Tx, ctx: AuthContext, id: string) {
  const [row] = await tx<{ author_id: string; project_id: string }[]>`
    select author_id, project_id from task where id = ${id} and deleted_at is null`
  if (!row) return 'missing' as const
  if (!mayEdit(ctx, row.author_id, row.project_id)) return 'forbidden' as const
  return row
}

const Add = z.object({ task_id: z.uuid() })

blocks.post('/tasks/:id/blocked-by', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const body = Add.safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const blockerId = body.data.task_id
  try {
    const result = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
      const task = await waiting(tx, ctx, id)
      if (typeof task === 'string') return task
      const [blocker] = await tx<{ project_id: string }[]>`
        select t.project_id from task t join project p on p.id = t.project_id
        where t.id = ${blockerId} and t.deleted_at is null and p.deleted_at is null`
      if (!blocker) return 'missing' as const
      if (blockerId === id) return 'self' as const
      const made = await tx`
        insert into task_block (workspace_id, task_id, blocker_id, created_by)
        values (${ctx.workspaceId}, ${id}, ${blockerId}, ${ctx.actorId})
        on conflict (task_id, blocker_id) do nothing
        returning task_id`
      const { blocked_by } = await relationsOf(tx, id)
      const said = blocked_by.find((b) => b.id === blockerId)
      if (!said) return 'missing' as const
      if (made.length) await heard(tx, ctx, [task.project_id, blocker.project_id], id)
      return { fresh: made.length > 0, blocker: said }
    })
    if (result === 'missing') return c.json(missing, 404)
    if (result === 'forbidden') return c.json(forbidden, 403)
    if (result === 'self') return c.json({ error: { code: 'invalid', message: 'A task can’t wait on itself.' } }, 400)
    return c.json({ blocker: result.blocker }, result.fresh ? 201 : 200)
  } catch (e) {
    const constraint = (e as { constraint_name?: string }).constraint_name
    if (constraint === 'task_block_loop') {
      return c.json({ error: { code: 'cycle', message: 'That would make a loop: it already waits on this task.' } }, 409)
    }
    if (constraint === 'task_block_too_many') {
      return c.json({ error: { code: 'invalid', message: 'A task can wait on fifty things at most.' } }, 400)
    }
    throw e
  }
})

blocks.delete('/tasks/:id/blocked-by/:blockerId', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const blockerId = c.req.param('blockerId')
  if (!z.uuid().safeParse(blockerId).success) return c.json(missing, 404)
  const result = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const task = await waiting(tx, ctx, id)
    if (typeof task === 'string') return task
    const [blocker] = await tx<{ project_id: string }[]>`
      select project_id from task where id = ${blockerId} and deleted_at is null`
    if (!blocker) return 'missing' as const
    const gone = await tx`
      delete from task_block where task_id = ${id} and blocker_id = ${blockerId} returning task_id`
    if (gone.length) await heard(tx, ctx, [task.project_id, blocker.project_id], id)
    return 'ok' as const
  })
  if (result === 'missing') return c.json(missing, 404)
  if (result === 'forbidden') return c.json(forbidden, 403)
  return c.json({ ok: true })
})
