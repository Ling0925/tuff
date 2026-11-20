import type { AgentStatus } from '@tracker/shared-schema'
import type { Tx } from './db.js'

/*
 * What an agent is doing now.
 *
 * One row an agent at most, `agent_doing`, read under its policy: a status
 * that names a task reaches only whoever can see the task. A row older than
 * three minutes is in no answer — `agent_doing_fresh` is the one place that
 * number is written — so nothing has to run to put one out.
 */

/** The longest a status is kept, after cleaning. */
export const DOING_MAX = 120

/* Control characters and the two line separators, written as escapes. */
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]', 'g')
/* And every format character (`\\p{Cf}`: the bidi overrides and isolates,
   zero widths, the BOM), taken out rather than spaced: they would let a
   line show text in an order it was not written in. */
const FORMAT = /\p{Cf}/gu

/**
 * The agent's words, made one short line: control characters and line
 * breaks become spaces, runs of spaces one, and it is cut to 120. Empty
 * after that is nothing to say.
 */
export function cleanDoing(said: string): string {
  const flat = said.replace(FORMAT, '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()
  return [...flat].slice(0, DOING_MAX).join('').trim()
}

type Row = {
  agent_id: string
  task_id: string | null
  project_id: string | null
  task_number: number | null
  conversation_id: string | null
  thread_id: string | null
  doing: string
  since: Date
  at: Date
  until: Date
}

const shaped = (r: Row): AgentStatus => ({
  agent_id: r.agent_id,
  task_id: r.task_id,
  project_id: r.project_id,
  task_number: r.task_number,
  conversation_id: r.conversation_id,
  thread_id: r.thread_id,
  doing: r.doing,
  since: r.since.toISOString(),
  at: r.at.toISOString(),
  until: r.until.toISOString(),
})

/**
 * The live statuses the reader may see: all of them in the workspace, or
 * the ones on one task, or one agent's. As the reader, so the policy
 * decides; the join to the task drops an agent's own row about a task it
 * can no longer see.
 */
export async function liveStatuses(tx: Tx, about: { task?: string; agent?: string; room?: string } = {}): Promise<AgentStatus[]> {
  const rows = await tx<Row[]>`
    select d.agent_id, d.task_id, t.project_id, t.number as task_number, d.conversation_id, d.thread_id,
           d.doing, d.since, d.at,
           agent_doing_until(d.at) as until
    from agent_doing d
    left join task t on t.id = d.task_id and t.deleted_at is null
    where agent_doing_fresh(d.at)
      and (d.task_id is null or t.id is not null)
      /* Disconnected, it says nothing more — not even for its last three minutes. */
      and exists (select 1 from agent g where g.actor_id = d.agent_id and g.deleted_at is null)
      ${about.task ? tx`and d.task_id = ${about.task}` : tx``}
      ${about.agent ? tx`and d.agent_id = ${about.agent}` : tx``}
      ${about.room ? tx`and d.conversation_id = ${about.room}` : tx``}
    order by d.at desc`
  return rows.map(shaped)
}

/** By agent, for the lists that carry one on each agent. */
export async function statusByAgent(tx: Tx): Promise<Map<string, AgentStatus>> {
  return new Map((await liveStatuses(tx)).map((s) => [s.agent_id, s]))
}

/** Where a status is said: a task, a room and a thread in it, or none of them. */
export type Where = { task: string | null; room: string | null; thread: string | null }

/**
 * Said, or said again. The clock of how long it has been at it keeps
 * running while the task is the same and the last word is fresh, and
 * starts again otherwise. Answers the new status, and where the screens
 * should hear of it: the projects of the task it names now and of the one
 * it named before, when that changed, and the same of the rooms — none
 * when it said the same again.
 */
export async function sayDoing(
  tx: Tx,
  agentId: string,
  workspaceId: string,
  where: Where,
  doing: string,
): Promise<{ status: AgentStatus | null; tell: string[]; rooms: string[] }> {
  const [r] = await tx<
    (Row & {
      was_task: string | null
      was_doing: string | null
      was_project: string | null
      was_room: string | null
      was_thread: string | null
      was_fresh: boolean | null
    })[]
  >`
    with old as (
      select d.task_id, d.doing, d.conversation_id, d.thread_id, agent_doing_fresh(d.at) as fresh,
             (select t.project_id from task t where t.id = d.task_id) as project_id
      from agent_doing d where d.agent_id = ${agentId}
    ), said as (
      insert into agent_doing (agent_id, workspace_id, task_id, conversation_id, thread_id, doing, since, at)
      values (${agentId}, ${workspaceId}, ${where.task}, ${where.room}, ${where.thread}, ${doing}, now(), now())
      on conflict (agent_id) do update set
        since = case when agent_doing.task_id is not distinct from excluded.task_id
                      and agent_doing.conversation_id is not distinct from excluded.conversation_id
                      and agent_doing_fresh(agent_doing.at)
                     then agent_doing.since else excluded.since end,
        task_id = excluded.task_id,
        conversation_id = excluded.conversation_id,
        thread_id = excluded.thread_id,
        doing = excluded.doing,
        at = excluded.at
      returning agent_id, task_id, conversation_id, thread_id, doing, since, at
    )
    select s.agent_id, s.task_id, t.project_id, t.number as task_number, s.conversation_id, s.thread_id,
           s.doing, s.since, s.at, agent_doing_until(s.at) as until,
           (select task_id from old) as was_task, (select doing from old) as was_doing,
           (select project_id from old) as was_project, (select fresh from old) as was_fresh,
           (select conversation_id from old) as was_room, (select thread_id from old) as was_thread
    from said s left join task t on t.id = s.task_id`
  if (!r) return { status: null, tell: [], rooms: [] }
  const same =
    r.was_fresh === true &&
    r.was_task === r.task_id &&
    r.was_doing === r.doing &&
    r.was_room === r.conversation_id &&
    r.was_thread === r.thread_id
  const tell = same ? [] : [r.project_id, r.was_fresh ? r.was_project : null].filter((p): p is string => Boolean(p))
  const rooms = same ? [] : [r.conversation_id, r.was_fresh ? r.was_room : null].filter((p): p is string => Boolean(p))
  return { status: shaped(r), tell: [...new Set(tell)], rooms: [...new Set(rooms)] }
}

/** Taken away. Answers the project and the room whose screens should hear of it. */
export async function stopDoing(tx: Tx, agentId: string): Promise<{ tell: string[]; rooms: string[] }> {
  const rows = await tx<{ project_id: string | null; conversation_id: string | null; fresh: boolean }[]>`
    delete from agent_doing d where d.agent_id = ${agentId}
    returning (select t.project_id from task t where t.id = d.task_id) as project_id, d.conversation_id,
              agent_doing_fresh(d.at) as fresh`
  /* Stopping is done in the room too: the wake there is let go with it. */
  const woke = await tx<{ conversation_id: string }[]>`select conversation_id from agent_let_go()`
  return {
    tell: rows.filter((r) => r.fresh && r.project_id).map((r) => r.project_id!),
    rooms: [
      ...new Set([
        ...rows.filter((r) => r.fresh && r.conversation_id).map((r) => r.conversation_id!),
        ...woke.map((w) => w.conversation_id),
      ]),
    ],
  }
}

/** Who is at work in a room: an agent woken there, or saying it is. */
export type InRoom = {
  agent_id: string
  name: string
  thread_id: string | null
  message_id: string | null
  doing: string | null
  until: string
}

/**
 * The agents at work in a room, as the reader may see them — the wake's
 * five minutes and the status's three, whichever lasts longer, with the
 * status's words when it has some. Agents disconnected say nothing.
 */
export async function inRoom(tx: Tx, room: string): Promise<InRoom[]> {
  const rows = await tx<
    { agent_id: string; name: string; thread_id: string | null; message_id: string | null; doing: string | null; until: Date }[]
  >`
    with woke as (
      select w.agent_id, w.thread_id, w.message_id, agent_woken_until(w.at) as until
      from agent_woken w
      where w.conversation_id = ${room} and agent_woken_until(w.at) > now()
    ), says as (
      select d.agent_id, d.thread_id, d.doing, agent_doing_until(d.at) as until
      from agent_doing d
      where d.conversation_id = ${room} and agent_doing_fresh(d.at)
    )
    select coalesce(s.agent_id, w.agent_id) as agent_id, a.name,
           coalesce(s.thread_id, w.thread_id) as thread_id,
           case when s.agent_id is null or s.thread_id is not distinct from w.thread_id then w.message_id end as message_id,
           s.doing, greatest(s.until, w.until) as until
    from says s full join woke w on w.agent_id = s.agent_id
    join actor a on a.id = coalesce(s.agent_id, w.agent_id)
    where exists (select 1 from agent g where g.actor_id = a.id and g.deleted_at is null)
    order by a.name`
  return rows.map((r) => ({ ...r, until: r.until.toISOString() }))
}
