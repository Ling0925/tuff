import { v7 as uuidv7 } from 'uuid'
import { generateKeyBetween } from 'fractional-indexing'
import { Repeat, daysBetween, filled, nextDue } from '@tracker/shared-schema'
import type { Tx } from './db.js'
import type { AuthContext } from './auth/context.js'
import { todayFor } from './day.js'
import { record } from './http/activity.js'
import { linkMentionedObjects } from './notify.js'

/**
 * A task that repeats: the next one made when it is done, and taken back
 * when it is undone.
 *
 * Both run inside the transaction that finished or reopened the task, as
 * whoever did it, under the same policies as everything else they write.
 */

/** Today where this person is — the zone their account keeps (`day.ts`). */
export async function todayOf(tx: Tx, actorId: string): Promise<string> {
  const [r] = await tx<{ on: string }[]>`select ${todayFor(tx, actorId)}::text as on`
  return r!.on
}

/**
 * The rule as it is stored: checked, and whole — its missing parts read off
 * the due date it is saved beside, or today. Null takes it off.
 */
export async function ruleToStore(tx: Tx, ctx: AuthContext, rule: Repeat | null, due: string | null): Promise<Repeat | null> {
  if (!rule) return null
  return filled(rule, due ?? (await todayOf(tx, ctx.actorId)))
}

/** The task as it was before it was finished, and as it is now. */
export type Finished = {
  id: string
  project_id: string
  author_id: string
  number: number
  title: string
  body: unknown
  assignee_ids: string[]
  priority: string | null
  due_on: string | null
  starts_at: string | null
  ends_at: string | null
  repeat: unknown
  /** Where it stood before it was finished. */
  list_before: string | null
  key_before: string
  /** Where it stands now. */
  list_now: string | null
}

/**
 * The next one, made from a task that has just been finished.
 *
 * The plan, as a duplicate is (`duplicate.md`), with the date moved by the
 * rule and the rule handed on: title, description, list, the people still on
 * the project, labels, priority, its parts none of them done, and its
 * watchers. Its author is the author of the one before. Answers its id, or
 * null when the rule cannot be read.
 */
export async function makeNext(tx: Tx, ctx: AuthContext, t: Finished): Promise<string | null> {
  const parsed = Repeat.safeParse(t.repeat)
  if (!parsed.success) return null
  const rule = parsed.data
  const today = await todayOf(tx, ctx.actorId)
  const due = nextDue(rule, t.due_on, today)
  const shift = (at: string | null) => {
    if (!at || !t.due_on) return null
    return new Date(new Date(at).getTime() + daysBetween(t.due_on, due) * 86_400_000).toISOString()
  }

  /* The list it was in before it was finished, unless that one finishes
     too; then the first open one. */
  const lists = await tx<{ id: string; finishes: boolean; intake: boolean }[]>`
    select id, finishes, intake from task_list
    where project_id = ${t.project_id} and deleted_at is null order by sort_key`
  const was = lists.find((l) => l.id === t.list_before)
  const into =
    (was && !was.finishes ? was : undefined) ??
    lists.find((l) => !l.finishes && !l.intake) ??
    lists.find((l) => !l.intake) ??
    lists[0] ??
    null

  /* In the slot the finished one left, when it left its list; under it,
     when it was finished where it stands; at the top of a list it was not
     in. */
  let key: string
  if (into && into.id === t.list_before && t.list_now !== t.list_before) {
    const [taken] = await tx<{ id: string }[]>`
      select id from task where project_id = ${t.project_id} and deleted_at is null and parent_id is null
        and list_id = ${into.id} and sort_key = ${t.key_before} limit 1`
    if (!taken) key = t.key_before
    else {
      const [below] = await tx<{ sort_key: string }[]>`
        select sort_key from task where project_id = ${t.project_id} and deleted_at is null and parent_id is null
          and list_id = ${into.id} and sort_key > ${t.key_before} order by sort_key limit 1`
      key = generateKeyBetween(t.key_before, below?.sort_key ?? null)
    }
  } else if (into && into.id === t.list_now) {
    const [below] = await tx<{ sort_key: string }[]>`
      select sort_key from task where project_id = ${t.project_id} and deleted_at is null and parent_id is null
        and list_id = ${into.id} and sort_key > ${t.key_before} order by sort_key limit 1`
    key = generateKeyBetween(t.key_before, below?.sort_key ?? null)
  } else {
    const [edge] = await tx<{ sort_key: string }[]>`
      select sort_key from task where project_id = ${t.project_id} and deleted_at is null and parent_id is null
        and list_id is not distinct from ${into?.id ?? null} order by sort_key limit 1`
    key = generateKeyBetween(null, edge?.sort_key ?? null)
  }

  const parts = await tx<
    { id: string; title: string; body: unknown; assignee_ids: string[]; priority: string | null; due_on: string | null }[]
  >`
    select id, title, body, assignee_ids, priority, due_on::text as due_on from task
    where parent_id = ${t.id} and deleted_at is null order by sort_key`

  /* Whoever is still on the project: somebody who has left is not given a
     task they could not open. */
  const everyone = [...new Set([...t.assignee_ids, ...parts.flatMap((p) => p.assignee_ids)])]
  const onProject = async (ids: string[]) => {
    if (!ids.length) return new Set<string>()
    const rows = await tx<{ actor_id: string }[]>`
      select m.actor_id from membership m
      where m.workspace_id = ${ctx.workspaceId} and m.actor_id = any(${ids}::uuid[])
        and m.deleted_at is null and m.joined_at is not null
        and (m.role = 'owner' or exists (
          select 1 from project_member pm
          where pm.project_id = ${t.project_id} and pm.actor_id = m.actor_id and pm.deleted_at is null))`
    return new Set(rows.map((r) => r.actor_id))
  }
  const stays = await onProject(everyone)
  const keep = (ids: string[]) => ids.filter((a) => stays.has(a))

  const id = uuidv7()
  const listId = into?.id ?? null
  const write = async (
    newId: string,
    parent: string | null,
    sortKey: string,
    w: { title: string; body: unknown; assignee_ids: string[]; priority: string | null; due_on: string | null },
    extra: { starts_at?: string | null; ends_at?: string | null; repeat?: Repeat | null },
  ) => {
    await tx`
      insert into task (id, workspace_id, project_id, author_id, parent_id, list_id,
                        title, body, assignee_ids, due_on, priority, starts_at, ends_at, sort_key, repeat)
      values (${newId}, ${ctx.workspaceId}, ${t.project_id}, ${ctx.actorId}, ${parent}, ${listId},
              ${w.title}, ${w.body ? tx.json(w.body as never) : null},
              ${keep(w.assignee_ids)}::uuid[], ${w.due_on}, ${w.priority}::task_priority,
              ${extra.starts_at ?? null}, ${extra.ends_at ?? null}, ${sortKey},
              ${extra.repeat ? tx.json(extra.repeat as never) : null})`
    if (w.body) await linkMentionedObjects(tx, ctx, { type: 'task', id: newId }, w.body)
  }
  await write(id, null, key, { ...t, due_on: due }, { starts_at: shift(t.starts_at), ends_at: shift(t.ends_at), repeat: rule })
  let at: string | null = null
  const made = new Map<string, string>([[t.id, id]])
  for (const p of parts) {
    at = generateKeyBetween(at, null)
    const partId = uuidv7()
    made.set(p.id, partId)
    /* A step's own date moves with its task's. */
    const partDue =
      p.due_on && t.due_on
        ? new Date(Date.parse(`${p.due_on}T00:00:00Z`) + daysBetween(t.due_on, due) * 86_400_000).toISOString().slice(0, 10)
        : p.due_on
    await write(partId, id, at, { ...p, due_on: partDue }, {})
  }
  /* Written as the finisher, as the policies ask, and then the series'
     author put back on: finishing somebody's weekly task does not make the
     rest of it the finisher's own. */
  if (t.author_id !== ctx.actorId) {
    await tx`update task set author_id = ${t.author_id} where id = ${id} or parent_id = ${id}`
  }

  const labels = await tx<{ task_id: string; label_id: string }[]>`
    select tl.task_id, tl.label_id from task_label tl join label l on l.id = tl.label_id
    where tl.task_id = any(${[...made.keys()]}::uuid[]) and l.deleted_at is null`
  if (labels.length) {
    await tx`
      insert into task_label ${tx(
        labels.map((l) => ({ id: uuidv7(), workspace_id: ctx.workspaceId, task_id: made.get(l.task_id)!, label_id: l.label_id })),
        'id',
        'workspace_id',
        'task_id',
        'label_id',
      )}
      on conflict (task_id, label_id) do nothing`
  }

  /* Who watched it watches the next one — through the definer, because a
     subscription is its owner's row. */
  const watching = await tx<{ actor_id: string }[]>`
    select * from subscribers(${ctx.workspaceId}, 'task'::object_kind, ${t.id})`
  const watchers = await onProject(watching.map((w) => w.actor_id))
  for (const a of watchers) {
    await tx`select follow_for(${ctx.workspaceId}, 'task'::object_kind, ${id}, ${a})`
  }

  /* The rule goes on with the next one; the finished one keeps the way back. */
  await tx`update task set repeat = null, repeat_next_id = ${id} where id = ${t.id}`
  await record(tx, ctx, 'task.repeat', {
    projectId: t.project_id,
    objectType: 'task',
    objectId: id,
    meta: { from_task_id: t.id, from_number: t.number, due_on: due },
  })
  return id
}

/**
 * Taking the next one back, when the one that made it is reopened or put
 * back: soft-deleted with its parts if it is still open and still there, and
 * its rule — as it is now — returned to the task it came from. A next one
 * finished or deleted meanwhile is left alone, and the reopened task is
 * ordinary work. Answers the id taken back, or null.
 */
export async function takeNextBack(tx: Tx, ctx: AuthContext, taskId: string): Promise<string | null> {
  const [from] = await tx<{ repeat_next_id: string | null }[]>`
    select repeat_next_id from task where id = ${taskId}`
  if (!from?.repeat_next_id) return null
  const [next] = await tx<
    { id: string; project_id: string; title: string; repeat: unknown; completed_at: string | null; deleted_at: string | null }[]
  >`
    select id, project_id, title, repeat, completed_at, deleted_at from task
    where id = ${from.repeat_next_id} for update`
  if (!next || next.deleted_at || next.completed_at) {
    await tx`update task set repeat_next_id = null where id = ${taskId}`
    return null
  }
  await tx`update task set deleted_at = now() where (id = ${next.id} or parent_id = ${next.id}) and deleted_at is null`
  await tx`
    update task set repeat = ${next.repeat ? tx.json(next.repeat as never) : null}, repeat_next_id = null
    where id = ${taskId}`
  await record(tx, ctx, 'task.delete', {
    projectId: next.project_id,
    objectType: 'task',
    objectId: next.id,
    meta: { title: next.title, withdrawn: true },
  })
  return next.id
}
