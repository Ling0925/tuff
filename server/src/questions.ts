import { v7 as uuidv7 } from 'uuid'
import type { Tx } from './db.js'
import type { AuthContext } from './auth/context.js'
import { LINES, doer, notify } from './notify.js'
import { languageOf, say, type Language } from './words.js'

/**
 * A question with choices. A comment on a
 * task that starts a thread, carrying two to four choices and who it is
 * asked of; answered once, by a person's press.
 */
export type Choice = { label: string; recommended?: boolean | undefined }

/**
 * Who a question on this task is asked of: the people named, or the people
 * it is given to, or — given to nobody but agents — whoever connected the
 * agent asking. Never an agent, never the asker, and never somebody who
 * cannot read the task (`may_read`, the read policies' own answer).
 */
export async function whoIsAsked(tx: Tx, ctx: AuthContext, taskId: string, named: readonly string[] | null): Promise<string[]> {
  const sift = async (ids: readonly string[]) => {
    if (!ids.length) return []
    const rows = await tx<{ id: string }[]>`
      select distinct x as id from unnest(${ids as string[]}::uuid[]) x
      where x <> ${ctx.actorId}
        and not exists (select 1 from agent g where g.actor_id = x)
        and may_read(x, 'task'::object_kind, ${taskId})`
    return rows.map((r) => r.id)
  }
  if (named?.length) return sift(named)
  const [t] = await tx<{ ids: string[] | null }[]>`select assignee_ids as ids from task where id = ${taskId} and deleted_at is null`
  const given = await sift(t?.ids ?? [])
  if (given.length) return given
  const [mine] = await tx<{ created_by: string }[]>`select created_by from agent where actor_id = ${ctx.actorId} and deleted_at is null`
  return sift(mine ? [mine.created_by] : [])
}

/**
 * Writes the question and tells the people asked — the comment's own
 * subscription, notes and feed line are the caller's (`addComment`), which
 * already writes them for every comment. Answers the note's parts.
 */
export async function askedNote(tx: Tx, ctx: AuthContext, taskId: string, body: unknown, asked: string[]): Promise<void> {
  const who = await doer(tx, ctx.actorId)
  await notify(tx, ctx, {
    objectType: 'task',
    objectId: taskId,
    body,
    what: (l) => LINES(l).asked(who(l)),
    whatFor: { asked: (l) => LINES(l).askedYou(who(l)) },
    also: { ids: asked, reason: 'asked' },
    kind: 'asked',
  })
}

const CHAIN = (l: Language) =>
  say(
    {
      said: [
        'Agents handed this task back and forth 3 times in a row, so I stopped here. Take a look.',
        'Des agents se sont passé cette tâche 3 fois de suite, je me suis donc arrêté ici. Jetez-y un œil.',
      ],
      goOn: ['Let them go on', 'Les laisser continuer'],
      mine: ['I’ll take it from here', 'Je m’en occupe'],
    },
    l,
  )

/**
 * The chain of agents stopped on a task:
 * a question, in the name of the
 * agent whose hand-off was stopped, to the task's people and whoever
 * connected the agents. Not a second one while a question is still open
 * on the task. Pressing either answer is a person's act on the task, which
 * starts the chain again.
 */
export async function askAboutChain(tx: Tx, ctx: AuthContext, taskId: string, connectors: string[]): Promise<void> {
  /* The chain's own question, still open on this task or from this agent
     anywhere: the people have it already. Any other open question is not
     this one, and does not stand in for it. */
  const [open] = await tx`
    select 1 from comment where stops_chain and answered_at is null and deleted_at is null
      and ((object_type = 'task' and object_id = ${taskId}) or author_id = ${ctx.actorId})
    limit 1`
  if (open) return
  const [t] = await tx<{ project_id: string; ids: string[] | null }[]>`
    select project_id, assignee_ids as ids from task where id = ${taskId} and deleted_at is null`
  if (!t) return
  const candidates = [...(t.ids ?? []), ...connectors]
  const asked = await whoIsAsked(tx, ctx, taskId, candidates.length ? candidates : null)
  if (!asked.length) return
  const W = CHAIN(await languageOf(tx, asked[0]!))
  const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: W.said }] }] }
  const choices: Choice[] = [{ label: W.goOn }, { label: W.mine }]
  await tx`
    insert into comment (id, workspace_id, project_id, object_type, object_id, author_id, body, origin, choices, asked, stops_chain)
    values (${uuidv7()}, ${ctx.workspaceId}, ${t.project_id}, 'task', ${taskId}, ${ctx.actorId},
            ${tx.json(body as never)}, ${ctx.viaMcp ? 'mcp' : 'web'}::origin_kind,
            ${tx.json(choices as never)}, ${asked}::uuid[], true)`
  const who = await doer(tx, ctx.actorId)
  await notify(tx, ctx, {
    objectType: 'task',
    objectId: taskId,
    watchers: false,
    whatFor: { asked: (l) => LINES(l).askedYou(who(l)) },
    also: { ids: asked, reason: 'asked' },
    kind: 'asked',
  })
}
