import { Hono } from 'hono'
import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import { withActor } from '../db.js'
import { todayFor } from '../day.js'
import { allow, type AuthContext, allowIn } from '../auth/context.js'
import { record } from './activity.js'
import { forbidden, missing } from './objects.js'

type Vars = { ctx: AuthContext }
export const overview = new Hono<{ Variables: Vars }>()

/**
 * One screen with a switchable view, not four sections of reporting.
 *
 * Every view below answers from the same rows; what changes is the question.
 * Four separate endpoints would have become four screens, and the design is
 * explicit that they are one.
 *
 * A client never reaches this: `activity.read` is the same permission that
 * gates the feed, because "what is late across the company" is exactly the
 * kind of thing an outside party should not be reading.
 */
overview.get('/overview', async (c) => {
  const ctx = c.get('ctx')
  if (!allow(ctx, 'activity.read')) return c.json(forbidden, 403)

  const view = c.req.query('view') ?? 'deadlines'

  const data = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    switch (view) {
      case 'overdue':
        return tx`
          select t.id, t.title, t.due_on, t.project_id, p.name as project_name,
                 t.assignee_id, t.assignee_ids
          from task t join project p on p.id = t.project_id
          where t.workspace_id = ${ctx.workspaceId}
            and t.deleted_at is null and t.completed_at is null
            and t.due_on is not null and t.due_on < ${todayFor(tx, ctx.actorId)}
          order by t.due_on limit 200`

      case 'unassigned':
        // Work nobody has picked up is the thing that quietly does not happen.
        return tx`
          select t.id, t.title, t.due_on, t.project_id, p.name as project_name
          from task t join project p on p.id = t.project_id
          where t.workspace_id = ${ctx.workspaceId}
            and t.deleted_at is null and t.completed_at is null
            and t.assignee_ids = '{}'
          order by t.created_at desc limit 200`

      case 'by_person':
        return tx`
          select a.id as actor_id, a.name,
                 count(*) filter (where t.completed_at is null) as open,
                 count(*) filter (where t.completed_at is null
                                    and t.due_on < ${todayFor(tx, ctx.actorId)}) as overdue
          from actor a
          join task t on t.assignee_ids @> array[a.id] and t.deleted_at is null
           and t.workspace_id = ${ctx.workspaceId}
          group by a.id, a.name
          order by open desc`

      case 'progress':
        // The curve is a field on the list with a history, so "where is this"
        // is answered by the position somebody set, not inferred from counts.
        return tx`
          select l.id, l.name, l.progress, l.project_id, p.name as project_name,
                 count(t.id) filter (where t.completed_at is null) as open,
                 count(t.id) as total
          from task_list l
          join project p on p.id = l.project_id
          left join task t on t.list_id = l.id and t.deleted_at is null
          where l.deleted_at is null
          group by l.id, l.name, l.progress, l.project_id, p.name
          order by p.name, l.sort_key limit 200`

      default:
        // Deadlines across every project on one timeline.
        return tx`
          select t.id, t.title, t.due_on, t.starts_at, t.ends_at,
                 t.project_id, p.name as project_name, t.assignee_id, t.assignee_ids
          from task t join project p on p.id = t.project_id
          where t.deleted_at is null and t.completed_at is null
            and (t.due_on is not null or t.starts_at is not null)
          order by coalesce(t.starts_at::date, t.due_on) limit 200`
    }
  })
  return c.json({ view, rows: data })
})

/* -------------------------------------------------------------- the hours */

overview.post('/time', async (c) => {
  const ctx = c.get('ctx')
  const body = z
    .object({
      project_id: z.uuid(),
      object_type: z.enum(['post', 'task', 'file', 'project']).nullish(),
      object_id: z.uuid().nullish(),
      minutes: z
        .int()
        .positive()
        .max(24 * 60),
      spent_on: z.iso.date(),
      note: z.string().max(1000).nullish(),
      /** Whoever runs the project may log time for somebody else. */
      actor_id: z.uuid().nullish(),
    })
    .safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)

  const forSomebodyElse = Boolean(body.data.actor_id && body.data.actor_id !== ctx.actorId)
  const action = forSomebodyElse ? 'time.any' : 'time.own'
  if (!allowIn(ctx, action, body.data.project_id)) return c.json(forbidden, 403)

  const id = uuidv7()
  const made = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [ok] = await tx<{ ok: boolean }[]>`select in_project(${body.data.project_id}) as ok`
    if (!ok?.ok) return false
    /* What it was spent on is this project's, and whoever it is logged for
       is on it — ids from anywhere were taken as they came. */
    if (body.data.object_type && body.data.object_type !== 'project' && body.data.object_id) {
      const table = body.data.object_type === 'task' ? tx`task` : body.data.object_type === 'post' ? tx`post` : tx`file`
      const [on] = await tx`
        select 1 from ${table} where id = ${body.data.object_id}
          and project_id = ${body.data.project_id} and deleted_at is null`
      if (!on) return false
    }
    if (forSomebodyElse) {
      const [them] = await tx`
        select 1 from project_member
        where project_id = ${body.data.project_id} and actor_id = ${body.data.actor_id!} and deleted_at is null`
      if (!them) return false
    }
    await tx`
      insert into time_entry
        (id, workspace_id, project_id, object_type, object_id, actor_id, minutes, spent_on, note)
      values (${id}, ${ctx.workspaceId}, ${body.data.project_id},
              ${body.data.object_type ?? null}::object_kind, ${body.data.object_id ?? null},
              ${body.data.actor_id ?? ctx.actorId}, ${body.data.minutes},
              ${body.data.spent_on}, ${body.data.note ?? null})`
    /* On what, so the feed's line names the task and opens it. */
    await record(tx, ctx, 'time.log', {
      projectId: body.data.project_id,
      ...(body.data.object_type && body.data.object_id ? { objectType: body.data.object_type, objectId: body.data.object_id } : {}),
      meta: { minutes: body.data.minutes },
    })
    return true
  })
  return made ? c.json({ id }, 201) : c.json(missing, 404)
})

/** By project and by person, which are the two questions anybody asks. */
overview.get('/time', async (c) => {
  const ctx = c.get('ctx')
  if (!allow(ctx, 'time.own', { inProject: true })) return c.json(forbidden, 403)
  const projectId = c.req.query('project')
  /* Everybody's hours across every project are the Members screen's, and
     where the owner keeps it to themselves a member is answered their own. */
  const onlyMine = !projectId && !allow(ctx, 'members.read')

  const rows = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      tx`select e.project_id, p.name as project_name, e.actor_id, a.name as actor_name,
              sum(e.minutes)::int as minutes
       from time_entry e
       join project p on p.id = e.project_id
       join actor a on a.id = e.actor_id
       where e.deleted_at is null
         ${projectId ? tx`and e.project_id = ${projectId}` : tx``}
         ${onlyMine ? tx`and e.actor_id = ${ctx.actorId}` : tx``}
       group by e.project_id, p.name, e.actor_id, a.name
       order by p.name, a.name`,
  )
  return c.json({ time: rows })
})

/**
 * Changing one — how long, which day, its note.
 *
 * It could not be changed, on the argument that a five-minute row edited
 * into eight hours is a claim changed with nothing to show for it. So the
 * change shows: a line in the feed with what it was and what it is now,
 * which is what removing and writing it again left, in one line instead
 * of two.
 *
 * Your own, or anybody's with `time.any` — whoever may remove it.
 */
overview.patch('/time/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const body = z
    .object({
      minutes: z
        .int()
        .positive()
        .max(24 * 60)
        .optional(),
      spent_on: z.iso.date().optional(),
      note: z.string().max(1000).nullish(),
    })
    .safeParse(await c.req.json().catch(() => ({})))
  if (!body.success || !z.uuid().safeParse(id).success) return c.json({ error: { code: 'invalid' } }, 400)
  const note = body.data.note === undefined ? undefined : body.data.note?.trim() || null

  const done = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [row] = await tx<
      {
        project_id: string
        actor_id: string
        object_type: string | null
        object_id: string | null
        minutes: number
        spent_on: string
        note: string | null
      }[]
    >`
      select project_id, actor_id, object_type, object_id, minutes, spent_on::text as spent_on, note from time_entry
      where id = ${id} and deleted_at is null for update`
    // Outside the asker's projects is not found, as removing one is.
    if (!row) return false
    if (!allowIn(ctx, row.actor_id === ctx.actorId ? 'time.own' : 'time.any', row.project_id)) return 'forbidden' as const
    const minutes = body.data.minutes ?? row.minutes
    const spentOn = body.data.spent_on ?? row.spent_on
    const said = note === undefined ? row.note : note
    if (minutes === row.minutes && spentOn === row.spent_on && said === row.note) return true
    await tx`
      update time_entry set minutes = ${minutes}, spent_on = ${spentOn}, note = ${said}, updated_at = now()
      where id = ${id}`
    await record(tx, ctx, 'time.edit', {
      projectId: row.project_id,
      ...(row.object_type && row.object_id ? { objectType: row.object_type, objectId: row.object_id } : {}),
      meta: {
        minutes,
        ...(minutes !== row.minutes ? { was_minutes: row.minutes } : {}),
        ...(spentOn !== row.spent_on ? { spent_on: spentOn, was_spent_on: row.spent_on } : {}),
        ...(said !== row.note ? { noted: said !== null } : {}),
      },
    })
    return true
  })
  if (done === 'forbidden') return c.json(forbidden, 403)
  return done ? c.json({ ok: true }) : c.json(missing, 404)
})

/**
 * Taking one back.
 *
 * Removing leaves a line in the feed, as changing one does.
 *
 * Your own, or anybody's with `time.any`: the same division as writing one,
 * about the same claim.
 */
overview.delete('/time/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')

  const gone = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [row] = await tx<
      { project_id: string; actor_id: string; object_type: string | null; object_id: string | null; minutes: number }[]
    >`
      select project_id, actor_id, object_type, object_id, minutes from time_entry
      where id = ${id} and deleted_at is null`
    // Row-level security has already refused anything outside the projects
    // this person is on, so not finding it is the 404 the design asks for
    // rather than a 403 that admits the row exists.
    if (!row) return false
    const mine = row.actor_id === ctx.actorId
    if (!allowIn(ctx, mine ? 'time.own' : 'time.any', row.project_id)) return 'forbidden' as const
    await tx`update time_entry set deleted_at = now(), updated_at = now() where id = ${id}`
    await record(tx, ctx, 'time.remove', {
      projectId: row.project_id,
      ...(row.object_type && row.object_id ? { objectType: row.object_type, objectId: row.object_id } : {}),
      meta: { minutes: row.minutes },
    })
    return true
  })
  if (gone === 'forbidden') return c.json(forbidden, 403)
  return gone ? c.json({ ok: true }) : c.json(missing, 404)
})

/* ------------------------------------------------------------- AI spend */

/**
 * What an AI tool spent on a task, sent by the tool's own client — Tuff
 * cannot see tokens. Kept beside the hours and asked the same right:
 * your own with `time.own`.
 *
 * Always the caller's: a spend line is what *your* client did. With a
 * `session`, a report replaces the earlier one from the same person,
 * client and session on the task — a hook sends the running total after
 * every reply, and adding them up would count the first reply twenty times.
 *
 * Not in the feed: a hook reporting after every reply would bury it.
 */
overview.post('/tasks/:id/spend', async (c) => {
  const ctx = c.get('ctx')
  const taskId = c.req.param('id')
  const body = z
    .object({
      client: z.string().trim().min(1).max(60),
      model: z.string().trim().min(1).max(100).nullish(),
      tokens: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
      cost_usd: z.number().min(0).lt(100_000_000).nullish(),
      session: z.string().trim().min(1).max(200).nullish(),
    })
    .refine((b) => b.tokens > 0 || (b.cost_usd ?? 0) > 0)
    .safeParse(await c.req.json().catch(() => ({})))
  if (!body.success || !z.uuid().safeParse(taskId).success) return c.json({ error: { code: 'invalid' } }, 400)
  const b = body.data

  const made = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [task] = await tx<{ project_id: string }[]>`
      select project_id from task where id = ${taskId} and deleted_at is null`
    // Not there and not yours to see are one answer — the design's 404.
    if (!task) return 'missing' as const
    if (!allowIn(ctx, 'time.own', task.project_id)) return 'forbidden' as const
    const cost = b.cost_usd == null ? null : Math.round(b.cost_usd * 1e6) / 1e6
    const [row] = await tx<{ id: string }[]>`
      insert into task_spend (id, workspace_id, project_id, task_id, actor_id, client, model, tokens, cost_usd, session)
      values (${uuidv7()}, ${ctx.workspaceId}, ${task.project_id}, ${taskId}, ${ctx.actorId},
              ${b.client}, ${b.model ?? null}, ${b.tokens}, ${cost}, ${b.session ?? null})
      on conflict (task_id, actor_id, client, session) where session is not null and deleted_at is null
      do update set tokens = excluded.tokens, cost_usd = excluded.cost_usd, model = excluded.model
      returning id`
    return row!.id
  })
  if (made === 'missing') return c.json(missing, 404)
  if (made === 'forbidden') return c.json(forbidden, 403)
  return c.json({ id: made }, 201)
})

/** By person and client, in one project or every visible one — the hours' two questions. */
overview.get('/spend', async (c) => {
  const ctx = c.get('ctx')
  if (!allow(ctx, 'time.own', { inProject: true })) return c.json(forbidden, 403)
  const projectId = c.req.query('project')
  if (projectId && !z.uuid().safeParse(projectId).success) return c.json({ error: { code: 'invalid' } }, 400)
  /* Everybody's across every project is the Members screen's, as with hours. */
  const onlyMine = !projectId && !allow(ctx, 'members.read')

  const rows = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      tx`select s.project_id, p.name as project_name, s.actor_id, a.name as actor_name, s.client,
              sum(s.tokens)::float8 as tokens,
              sum(s.cost_usd)::float8 as cost_usd
       from task_spend s
       join project p on p.id = s.project_id
       join actor a on a.id = s.actor_id
       join task t on t.id = s.task_id and t.deleted_at is null
       where s.deleted_at is null
         ${projectId ? tx`and s.project_id = ${projectId}` : tx``}
         ${onlyMine ? tx`and s.actor_id = ${ctx.actorId}` : tx``}
       group by s.project_id, p.name, s.actor_id, a.name, s.client
       order by p.name, tokens desc`,
  )
  return c.json({ spend: rows })
})

/** Taking one back: your own, or anybody's with `time.any` — like an hour. */
overview.delete('/spend/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  if (!z.uuid().safeParse(id).success) return c.json(missing, 404)

  const gone = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [row] = await tx<{ project_id: string; actor_id: string }[]>`
      select project_id, actor_id from task_spend where id = ${id} and deleted_at is null`
    if (!row) return false
    if (!allowIn(ctx, row.actor_id === ctx.actorId ? 'time.own' : 'time.any', row.project_id)) return 'forbidden' as const
    await tx`update task_spend set deleted_at = now() where id = ${id}`
    return true
  })
  if (gone === 'forbidden') return c.json(forbidden, 403)
  return gone ? c.json({ ok: true }) : c.json(missing, 404)
})

/* ------------------------------------------------------------- templates */

/**
 * A template is a snapshot of a project, not a separate kind of thing.
 *
 * Making one from an existing project is the only version worth having: a
 * template built from nothing is a form, and nobody fills in a form to start.
 * Dates are stored as offsets from the start so they land relative to the new
 * project's start date rather than in the past.
 */
overview.post('/projects/:id/copy', async (c) => {
  const ctx = c.get('ctx')
  if (!allow(ctx, 'project.create')) return c.json(forbidden, 403)

  const body = z
    .object({ name: z.string().min(1).max(200), starts_on: z.iso.date().optional() })
    .safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)

  const sourceId = c.req.param('id')
  const newId = uuidv7()

  const made = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [source] = await tx<{ description: string | null; tools: string[] }[]>`
      select description, tools from project where id = ${sourceId} and deleted_at is null`
    if (!source) return false

    await tx`
      insert into project (id, workspace_id, name, description, tools)
      values (${newId}, ${ctx.workspaceId}, ${body.data.name}, ${source.description},
              ${source.tools}::tool_kind[])`
    await tx`
      insert into project_member (id, workspace_id, project_id, actor_id, added_by)
      values (${uuidv7()}, ${ctx.workspaceId}, ${newId}, ${ctx.actorId}, ${ctx.actorId})`
    /*
     * The source's labels, not the starting three: a copy brings the plan,
     * and the words its work is filed under are part of it. The trigger has
     * given the new project the defaults; the ones the source does not have
     * go, the ones it has are made.
     */
    await tx`
      update label set deleted_at = now(), updated_at = now()
      where project_id = ${newId} and deleted_at is null
        and name not in (select name from label where project_id = ${sourceId} and deleted_at is null)`
    await tx`
      insert into label (id, workspace_id, project_id, name, color)
      select gen_random_uuid(), ${ctx.workspaceId}, ${newId}, name, color
      from label where project_id = ${sourceId} and deleted_at is null
      on conflict (project_id, name) where deleted_at is null do nothing`
    await tx`
      insert into conversation (id, workspace_id, project_id, name)
      values (${uuidv7()}, ${ctx.workspaceId}, ${newId}, 'main')`

    /* The marks and the colours travel with the lists, and whether one
       starts narrowed: a copy of a board whose Done had a tick and whose
       Canceled sat folded arrived with five plain rings, all open. */
    const lists = await tx<
      {
        id: string
        name: string
        sort_key: string
        finishes: boolean
        icon: string
        color: string | null
        narrow: boolean
        intake: boolean
      }[]
    >`select id, name, sort_key, finishes, icon, color, narrow, intake from task_list
      where project_id = ${sourceId} and deleted_at is null order by sort_key`
    const listMap = new Map<string, string>()
    for (const l of lists) {
      const id = uuidv7()
      listMap.set(l.id, id)
      await tx`
        insert into task_list (id, workspace_id, project_id, author_id, name,
                               sort_key, finishes, icon, color, narrow, intake)
        values (${id}, ${ctx.workspaceId}, ${newId}, ${ctx.actorId}, ${l.name},
                ${l.sort_key}, ${l.finishes}, ${l.icon}, ${l.color}, ${l.narrow}, ${l.intake})`
    }
    /*
     * Where finished work lands in the copy: at the start, not in the list
     * that finishes.
     *
     * A template brings the shape of the work and not the state of it, and
     * the list is the state now — copying a task into the Done list would
     * mark it done on arrival, which is the one thing a template must not
     * do.
     */
    /* And not into Triage: a copy's work was the team's already. */
    const first = lists.find((l) => !l.finishes && !l.intake)
    const unfinished = (from: string | null) => {
      if (!from) return null
      const l = lists.find((x) => x.id === from)
      if (l?.finishes) return first ? (listMap.get(first.id) ?? null) : null
      return listMap.get(from) ?? null
    }

    /*
     * The tasks, in one statement.
     *
     * They were inserted one at a time, a round trip each inside the one
     * transaction, so copying a project of ten thousand tasks held a pooled
     * connection for minutes — and a handful of copies at once held the
     * pool. One `insert … select` does the same work in the database.
     *
     * Offsets, not dates: copying a plan that starts next month should not
     * produce a project whose every task is already late. And a part keeps
     * its parent, which the row-at-a-time copy forgot.
     */
    const start = body.data.starts_on ?? null
    const olds = lists.map((l) => l.id)
    const news = lists.map((l) => unfinished(l.id))
    const [copied] = await tx<{ n: number }[]>`
      with src as (
        select t.id as old_id, gen_random_uuid() as new_id, t.parent_id, t.list_id, t.title,
               t.sort_key, t.due_on
        from task t where t.project_id = ${sourceId} and t.deleted_at is null
      ),
      lists as (
        select * from unnest(${olds}::uuid[], ${news}::uuid[]) as m(old_id, new_id)
      ),
      first_due as (
        select min(due_on) as d from task
        where project_id = ${sourceId} and due_on is not null and deleted_at is null
      ),
      made as (
        insert into task (id, workspace_id, project_id, author_id, parent_id, list_id, title,
                          sort_key, due_on)
        select s.new_id, ${ctx.workspaceId}, ${newId}, ${ctx.actorId}, p.new_id, l.new_id, s.title,
               s.sort_key,
               case when ${start}::date is not null and s.due_on is not null
                    then ${start}::date + (s.due_on - (select d from first_due)) end
        from src s
        left join src p on p.old_id = s.parent_id
        left join lists l on l.old_id = s.list_id
        -- Parents first: the trigger that checks a part's parent sees only
        -- the rows already written, so a part that came before its task
        -- failed the whole copy.
        order by s.parent_id is not null
        returning 1
      )
      select count(*)::int as n from made`

    await record(tx, ctx, 'project.copy', {
      projectId: newId,
      meta: { from: sourceId, tasks: copied?.n ?? 0 },
    })
    return true
  })
  return made ? c.json({ id: newId }, 201) : c.json(missing, 404)
})

/* ------------------------------------------------- recurring check-ins */

/**
 * A recurring check-in is a post that arrives on a schedule.
 *
 * Not a fifth entity and not a separate feature: the schedule is a field, and
 * this endpoint is what a timer calls. Running it twice on the same day must
 * not produce two, so the guard is a query rather than a lock.
 */
overview.post('/checkins/run', async (c) => {
  const ctx = c.get('ctx')
  if (!allow(ctx, 'workspace.billing')) return c.json(forbidden, 403)

  const made = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const due = await tx<{ id: string; project_id: string; title: string; body: unknown }[]>`
      select id, project_id, title, body from post
      where workspace_id = ${ctx.workspaceId} and schedule is not null
        and deleted_at is null
        /* Never somebody's draft, the asker's own included: copied, it
           would be published by a timer. */
        and audience = 'project'
        and not exists (
          select 1 from post copy
          where copy.workspace_id = post.workspace_id
            and copy.title = post.title
            and copy.schedule is null
            and copy.audience = 'project'
            and copy.created_at::date = current_date
        )`
    for (const p of due) {
      await tx`
        insert into post (id, workspace_id, project_id, author_id, title, body, published_at)
        values (${uuidv7()}, ${ctx.workspaceId}, ${p.project_id}, ${ctx.actorId},
                ${p.title}, ${tx.json(p.body as never)}, now())`
    }
    return due.length
  })
  return c.json({ created: made })
})
