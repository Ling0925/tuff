import { Hono } from 'hono'
import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import { generateNKeysBetween } from 'fractional-indexing'
import { withActor, type Tx } from '../db.js'
import { allowIn, type AuthContext } from '../auth/context.js'
import { importTally, TooLong, tooLong } from '../mcp/markdown.js'
import { readAll } from '../mcp/markdownPool.js'
import { languageOf } from '../words.js'
import { record } from './activity.js'
import { forbidden, isInProject } from './objects.js'
import { spendOn } from './limits.js'

/**
 * Tasks brought from a spreadsheet.
 *
 * The file is read in the browser; what comes here is its rows, already
 * said in Tuff's words: a title, words, a list of this project, a person by
 * email or name, a date, a priority, labels. A page of them is written
 * whole or not at all, in a handful of statements rather than one a row:
 * every task takes the project's counter, and the project waits for the
 * page as long as the page takes.
 */
type Vars = { ctx: AuthContext }
export const csvImport = new Hono<{ Variables: Vars }>()

/* A day that exists: the shape alone let 2026-13-45 through to a 500. */
const Day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
  })

const Row = z.object({
  title: z.string().trim().min(1).max(300),
  body: z.string().max(20_000).optional(),
  list_id: z.uuid().nullable().optional(),
  assignee: z.string().trim().max(254).optional(),
  due_on: Day.optional(),
  priority: z.enum(['urgent', 'high', 'medium', 'low']).optional(),
  /* As a label is named anywhere here: forty characters. */
  labels: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  /** Its key where it came from — said in the words, not kept as a number. */
  key: z.string().trim().max(60).optional(),
})

/* New labels a page may make: a spreadsheet's tags, not a flood of them. */
const NEW_LABELS = 100

const SAID = {
  from: { en: (k: string) => `Imported from ${k}.`, fr: (k: string) => `Importée depuis ${k}.` },
  to: { en: (w: string) => `Assigned to ${w}.`, fr: (w: string) => `Attribuée à ${w}.` },
}

csvImport.post('/projects/:projectId/import/tasks', async (c) => {
  const ctx = c.get('ctx')
  const projectId = c.req.param('projectId')
  /* By hand, by somebody who may make tasks here. */
  if (ctx.viaMcp || ctx.viaGithub || ctx.viaImport || !allowIn(ctx, 'task.create', projectId)) return c.json(forbidden, 403)
  /* Spent before the body is read: a malformed one cost a parse and nothing else. */
  if (!(await spendOn(`csv:${ctx.actorId}`, 120, 3600))) {
    return c.json({ error: { code: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' } }, 429)
  }
  const body = z.object({ tasks: z.array(Row).min(1).max(200) }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid', message: 'Some rows could not be read.' } }, 400)

  /* What the page's bodies come to, written out, against what one page may
     write: each body is bounded on its own (`BYTE_BUDGET`), and two hundred
     bounded bodies were still two gigabytes. */
  const tally = importTally()

  /*
   * Who the rows name, and the words each task will say, read first in a
   * short transaction of its own; the bodies are then read by the workers
   * with nothing held — not the project's lock, not a connection — and
   * only then is the page written.
   *
   * A person is given a task only if they are on the project already, or
   * own the workspace: an import adds nobody. A name in a file is not an
   * invitation, and the project's door is its members screen, with its
   * rights, its notice and its line in the feed.
   */
  const peopleIn = (tx: Tx) => tx<{ actor_id: string; name: string; email: string | null; may: boolean }[]>`
      select m.actor_id, a.name, card.email::text as email,
             (m.role = 'owner' or exists (
               select 1 from project_member pm
               where pm.project_id = ${projectId} and pm.actor_id = m.actor_id and pm.deleted_at is null)) as may
      from membership m join actor a on a.id = m.actor_id
      left join lateral colleague_card(m.actor_id) card on true
      where m.workspace_id = ${ctx.workspaceId} and m.deleted_at is null and m.joined_at is not null`
  const named = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    if (!(await isInProject(tx, projectId))) return null
    return { language: await languageOf(tx, ctx.actorId), people: await peopleIn(tx) }
  })
  if (named === null) return c.json({ error: { code: 'not_found' } }, 404)
  const { language, people } = named
  const here = people.filter((p) => p.may)
  const byEmail = new Map(here.filter((p) => p.email).map((p) => [p.email!.toLowerCase(), p.actor_id]))
  const byName = new Map<string, string | null>()
  for (const p of here) {
    const k = p.name.trim().toLowerCase()
    byName.set(k, byName.has(k) ? null : p.actor_id)
  }
  const who = (said?: string) => (said ? (byEmail.get(said.toLowerCase()) ?? byName.get(said.toLowerCase()) ?? null) : null)
  const persons = body.data.tasks.map((r) => who(r.assignee))
  const texts = body.data.tasks.map((r, i) => {
    const said = [r.key ? SAID.from[language](r.key) : null, r.assignee && !persons[i] ? SAID.to[language](r.assignee) : null]
      .filter(Boolean)
      .join(' ')
    return [said, r.body ?? ''].filter(Boolean).join('\n\n')
  })
  /* Read by the workers, two at a time and in order, each counted as it
     comes: the first body refused, or the first past what the page may
     write, stops the rest. */
  const full = texts.flatMap((t, i) => (t.trim() ? [i] : []))
  const bodies: (string | null)[] = texts.map(() => null)
  try {
    await readAll(
      full.map((i) => texts[i]!),
      2,
      (doc, j) => {
        const i = full[j]!
        const written = JSON.stringify(doc)
        tally(texts[i]!, written.length)
        bodies[i] = written
      },
      `person:${ctx.actorId}`,
    )
  } catch (e) {
    if (e instanceof TooLong) return c.json(tooLong, 413)
    throw e
  }

  const written = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    if (!(await isInProject(tx, projectId))) return null
    /* The project first, held: its counter is what every task takes, and
       the last task's place is read under it, so two pages at once do not
       both start after the same card. */
    await tx`select id from project where id = ${projectId} for update`
    const lists = await tx<{ id: string; finishes: boolean; intake: boolean }[]>`
      select id, finishes, intake from task_list where project_id = ${projectId} and deleted_at is null order by sort_key`
    const known = new Map(lists.map((l) => [l.id, l]))
    /* What a row names no list for lands where a task made by hand does. */
    const fallback = lists.find((l) => !l.intake) ?? lists[0]
    /* Asked again under the lock: somebody taken off the project while the
       bodies were read is given nothing. */
    const still = new Set((await peopleIn(tx)).filter((p) => p.may).map((p) => p.actor_id))

    const labels = new Map(
      (
        await tx<{ id: string; name: string }[]>`select id, name::text from label where project_id = ${projectId} and deleted_at is null`
      ).map((l) => [l.name.toLowerCase(), l.id]),
    )
    const [{ last } = { last: null }] = await tx<{ last: string | null }[]>`
      select max(sort_key) as last from task where project_id = ${projectId}`
    const keys = generateNKeysBetween(last, null, body.data.tasks.length)

    const newLabels: { id: string; workspace_id: string; project_id: string; name: string }[] = []
    const taskLabels: { id: string; workspace_id: string; task_id: string; label_id: string }[] = []
    const tasks = body.data.tasks.map((r, i) => {
      const list = (r.list_id && known.get(r.list_id)) || fallback
      const person = persons[i] && still.has(persons[i]) ? persons[i] : null
      const id = uuidv7()
      for (const name of r.labels ?? []) {
        let labelId = labels.get(name.toLowerCase())
        if (!labelId) {
          if (newLabels.length >= NEW_LABELS) continue
          labelId = uuidv7()
          labels.set(name.toLowerCase(), labelId)
          newLabels.push({ id: labelId, workspace_id: ctx.workspaceId, project_id: projectId, name })
        }
        if (!taskLabels.some((t) => t.task_id === id && t.label_id === labelId)) {
          taskLabels.push({ id: uuidv7(), workspace_id: ctx.workspaceId, task_id: id, label_id: labelId })
        }
      }
      return {
        id,
        workspace_id: ctx.workspaceId,
        project_id: projectId,
        author_id: ctx.actorId,
        list_id: list?.id ?? null,
        title: r.title,
        body: bodies[i],
        priority: r.priority ?? null,
        due_on: r.due_on ?? null,
        assignee_ids: person ? `{${person}}` : '{}',
        sort_key: keys[i]!,
        completed_at: list?.finishes ? new Date() : null,
      }
    })

    await tx`
      insert into task (id, workspace_id, project_id, author_id, list_id, title, body, priority, due_on,
                        assignee_ids, sort_key, completed_at)
      select id, workspace_id, project_id, author_id, list_id, title, body::jsonb, priority::task_priority, due_on::date,
             assignee_ids::uuid[], sort_key, completed_at
      from jsonb_to_recordset(${tx.json(tasks as never)}) as t(
        id uuid, workspace_id uuid, project_id uuid, author_id uuid, list_id uuid, title text, body text,
        priority text, due_on text, assignee_ids text, sort_key text, completed_at timestamptz)`
    if (newLabels.length) {
      await tx`
        insert into label (id, workspace_id, project_id, name)
        select id, workspace_id, project_id, name from jsonb_to_recordset(${tx.json(newLabels as never)})
          as l(id uuid, workspace_id uuid, project_id uuid, name text)`
    }
    if (taskLabels.length) {
      await tx`
        insert into task_label (id, workspace_id, task_id, label_id)
        select id, workspace_id, task_id, label_id from jsonb_to_recordset(${tx.json(taskLabels as never)})
          as l(id uuid, workspace_id uuid, task_id uuid, label_id uuid)
        on conflict do nothing`
    }
    /* One line for the page in the feed, not one a task. Imported tasks are
       not announced to webhooks or GitHub one by one either: a spreadsheet
       of a thousand is not a thousand events. */
    await record(tx, ctx, 'task.import', { projectId, meta: { count: tasks.length, from: 'csv' } })
    return tasks.length
  })
  if (written === null) return c.json({ error: { code: 'not_found' } }, 404)
  return c.json({ written })
})
