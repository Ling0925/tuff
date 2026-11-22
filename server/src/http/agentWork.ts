import { Hono } from 'hono'
import { z } from 'zod'
import { withActor, type Tx } from '../db.js'
import { allow, type AuthContext } from '../auth/context.js'
import { todayFor, zoneOf } from '../day.js'
import { pageSize } from './limits.js'
import { feedLines, shapeLines } from './inbox.js'

type Vars = { ctx: AuthContext }

/**
 * What one agent did this week or this month.
 *
 * The tasks it took and finished and still holds, the questions it asked
 * and how many were answered, what its clients said it spent, and its
 * latest lines in the feed. Every row is read as the reader, under
 * row-level security: work in a project the reader cannot see is not a row
 * here, so it is neither listed nor counted, nor summed into the spend.
 */
export const agentWork = new Hono<{ Variables: Vars }>()

const forbidden = { error: { code: 'forbidden' } }
const missing = { error: { code: 'not_found' } }

const Period = z.enum(['week', 'month'])
/** Which number's tasks — one per tile on the page. */
const Of = z.enum(['took', 'finished', 'open', 'asked', 'answered', 'spend'])
type Of = z.infer<typeof Of>

/** A cursor: the row's key, a whole number, and its task's id. */
const CURSOR = /^(\d{1,24})_([0-9a-f-]{36})$/i

/**
 * The agent, and whether the reader may read its week: the Members screen's
 * to read, or whoever connected it (`agent.work.read`). Asked of the
 * workspace's own agents, so an id from elsewhere is not one.
 */
async function gate(tx: Tx, ctx: AuthContext, agentId: string): Promise<'missing' | 'forbidden' | 'ok'> {
  if (!z.uuid().safeParse(agentId).success) return 'missing'
  const [g] = await tx<{ created_by: string }[]>`
    select g.created_by from agent g
    where g.actor_id = ${agentId} and g.workspace_id = ${ctx.workspaceId} and g.deleted_at is null`
  if (!g) return 'missing'
  return allow(ctx, 'agent.work.read', { connectedIt: g.created_by === ctx.actorId }) ? 'ok' : 'forbidden'
}

/** Where the period began, on the reader's calendar, as the database writes a moment. */
async function sinceOf(tx: Tx, ctx: AuthContext, period: 'week' | 'month'): Promise<string> {
  const [r] = await tx<{ since: string }[]>`
    with z as (select ${zoneOf(tx, ctx.actorId)} as zone)
    select to_char((date_trunc(${period}, now() at time zone zone) at time zone zone) at time zone 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as since
    from z`
  return r!.since
}

/**
 * One number's rows: the task, its key in the list's order, and for the
 * spend and the questions what it adds up to. Not yet bounded by what the
 * reader may see of the task itself — `bounded` joins that.
 */
function rowsOf(tx: Tx, ws: string, of: Of, agentId: string, since: string) {
  const from = tx`${since}::text::timestamptz`
  switch (of) {
    /* Given to it in the period — the feed's lines that name it by id. */
    case 'took':
      return tx`
        select e.object_id as task_id, (extract(epoch from max(e.at)) * 1000000)::numeric(24, 0) as k,
               0::numeric as tokens, null::numeric as cost_usd, 1 as n
        from activity_event e
        where e.workspace_id = ${ws} and e.meta ? 'given_ids' and (e.meta -> 'given_ids') ? ${agentId}
          and e.action in ('task.create', 'task.update') and e.object_type = 'task'
          and e.at >= ${from}
        group by e.object_id`
    case 'finished':
      return tx`
        select t.id as task_id, (extract(epoch from t.completed_at) * 1000000)::numeric(24, 0) as k,
               0::numeric as tokens, null::numeric as cost_usd, 1 as n
        from task t
        where t.workspace_id = ${ws} and t.assignee_ids @> array[${agentId}]::uuid[]
          and t.deleted_at is null and t.completed_at >= ${from}`
    /* What it holds now, whatever the period: the number a lead acts on. */
    case 'open':
      return tx`
        select t.id as task_id, (extract(epoch from t.created_at) * 1000000)::numeric(24, 0) as k,
               0::numeric as tokens, null::numeric as cost_usd, 1 as n
        from task t
        where t.workspace_id = ${ws} and t.assignee_ids @> array[${agentId}]::uuid[]
          and t.deleted_at is null and t.completed_at is null`
    case 'asked':
    case 'answered':
      return tx`
        select c.object_id as task_id, (extract(epoch from max(c.created_at)) * 1000000)::numeric(24, 0) as k,
               0::numeric as tokens, null::numeric as cost_usd, count(*)::int as n
        from comment c
        where c.workspace_id = ${ws} and c.author_id = ${agentId} and c.choices is not null and c.deleted_at is null
          and c.object_type = 'task' and c.created_at >= ${from}
          ${of === 'answered' ? tx`and c.answered_at is not null` : tx``}
        group by c.object_id`
    /* In the period it was last reported in: a session's line is replaced
       with every reply, and counted where it ended. */
    case 'spend':
      return tx`
        select s.task_id, sum(s.tokens)::numeric as k,
               sum(s.tokens)::numeric as tokens, sum(s.cost_usd)::numeric as cost_usd, 1 as n
        from task_spend s
        where s.workspace_id = ${ws} and s.actor_id = ${agentId} and s.deleted_at is null and s.updated_at >= ${from}
        group by s.task_id`
  }
}

/** The rows on tasks the reader can see, in a project that stands — and, for
    what is open, one not put away, as My tasks and a person's page count it. */
const bounded = (tx: Tx, of: Of) => tx`
  join task t on t.id = x.task_id and t.deleted_at is null
  join project p on p.id = t.project_id and p.deleted_at is null
    ${of === 'open' ? tx`and p.archived_at is null` : tx``}`

/**
 * The counts, the spend and the latest lines. One statement for the
 * numbers: each is a set of rows bounded by the reader's sight and counted.
 */
agentWork.get('/agents/:id/work', async (c) => {
  const ctx = c.get('ctx')
  if (!allow(ctx, 'people.read') || ctx.agent) return c.json(forbidden, 403)
  const period = Period.safeParse(c.req.query('period') ?? 'week')
  if (!period.success) return c.json({ error: { code: 'invalid' } }, 400)
  const agentId = c.req.param('id')

  const read = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const may = await gate(tx, ctx, agentId)
    if (may !== 'ok') return may
    const since = await sinceOf(tx, ctx, period.data)
    /* Each set read once and then bounded: as a subquery the planner was free
       to read it again for every task it joined, which on the load data was
       seconds rather than milliseconds. */
    const count = (of: Of) =>
      tx`(with x as materialized (${rowsOf(tx, ctx.workspaceId, of, agentId, since)}) select count(*)::int from x ${bounded(tx, of)})`
    const questions = (of: Of) =>
      tx`(with x as materialized (${rowsOf(tx, ctx.workspaceId, of, agentId, since)}) select coalesce(sum(x.n), 0)::int from x ${bounded(tx, of)})`
    const [numbers] = await tx<
      {
        took: number
        finished: number
        open: number
        asked: number
        answered: number
        tokens: number
        cost_usd: number | null
        spent_on: number
      }[]
    >`
      with x as materialized (${rowsOf(tx, ctx.workspaceId, 'spend', agentId, since)})
      select ${count('took')} as took, ${count('finished')} as finished, ${count('open')} as open,
             ${questions('asked')} as asked, ${questions('answered')} as answered,
             s.tokens, s.cost_usd, s.spent_on
      from (select coalesce(sum(x.tokens), 0)::float8 as tokens, sum(x.cost_usd)::float8 as cost_usd,
                   count(*)::int as spent_on
            from x ${bounded(tx, 'spend')}) s`
    /* Its latest ten in the period, as the feed draws them; the rest is
       the feed's, by its cursor. */
    const lines = await feedLines(tx, ctx, { limit: 10, from: null, actorId: agentId, since })
    return { since, numbers: numbers!, lines }
  })
  if (read === 'missing') return c.json(missing, 404)
  if (read === 'forbidden') return c.json(forbidden, 403)
  const n = read.numbers
  return c.json({
    period: period.data,
    since: read.since,
    took: n.took,
    finished: n.finished,
    open: n.open,
    asked: n.asked,
    answered: n.answered,
    tokens: n.tokens,
    cost_usd: n.cost_usd,
    spent_on: n.spent_on,
    events: shapeLines(read.lines),
  })
})

/**
 * One number's tasks, a page at a time — what a press on its tile opens.
 * In the number's own order: the newest first, or for the spend the most
 * spent; by cursor, never a page number.
 */
agentWork.get('/agents/:id/work/tasks', async (c) => {
  const ctx = c.get('ctx')
  if (!allow(ctx, 'people.read') || ctx.agent) return c.json(forbidden, 403)
  const period = Period.safeParse(c.req.query('period') ?? 'week')
  const of = Of.safeParse(c.req.query('of'))
  if (!period.success || !of.success) return c.json({ error: { code: 'invalid' } }, 400)
  const raw = c.req.query('cursor')
  const at = raw === undefined ? null : CURSOR.exec(raw)
  if (raw !== undefined && !at) return c.json({ error: { code: 'invalid' } }, 400)
  const limit = pageSize(c.req.query('limit'), 50, 200)
  const agentId = c.req.param('id')

  const read = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const may = await gate(tx, ctx, agentId)
    if (may !== 'ok') return may
    const since = await sinceOf(tx, ctx, period.data)
    /* The set read once, then bounded, ordered and cut — see the counts. */
    return tx<{ id: string; k: string; tokens: number; cost_usd: number | null; n: number }[]>`
      with x as materialized (${rowsOf(tx, ctx.workspaceId, of.data, agentId, since)})
      select t.id, t.number, t.title, t.due_on, t.completed_at, t.project_id,
             p.name as project_name, p.key as project_key, p.slug as project_slug,
             (t.completed_at is null and t.due_on is not null and t.due_on < ${todayFor(tx, ctx.actorId)}) as overdue,
             l.icon, l.color,
             x.k::text as k, x.tokens::float8 as tokens, x.cost_usd::float8 as cost_usd, x.n
      from x
      ${bounded(tx, of.data)}
      left join task_list l on l.id = t.list_id
      ${at ? tx`where (x.k, t.id) < (${at[1]!}::numeric, ${at[2]!}::uuid)` : tx``}
      order by x.k desc, t.id desc
      limit ${limit}`
  })
  if (read === 'missing') return c.json(missing, 404)
  if (read === 'forbidden') return c.json(forbidden, 403)
  const last = read[read.length - 1]
  const spend = of.data === 'spend'
  const asked = of.data === 'asked' || of.data === 'answered'
  return c.json({
    tasks: read.map(({ k: _, tokens, cost_usd, n, ...t }) => ({
      ...t,
      ...(spend ? { tokens, cost_usd } : {}),
      ...(asked ? { questions: n } : {}),
    })),
    next_cursor: read.length === limit && last ? `${last.k}_${last.id}` : null,
  })
})
