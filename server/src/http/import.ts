import { RIGHTS_OF_ITS_MAKER } from '@tracker/shared-schema'
import { Hono } from 'hono'
import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import { generateKeyBetween } from 'fractional-indexing'
import { withActor } from '../db.js'
import { allow, type AuthContext } from '../auth/context.js'
import { record } from './activity.js'
import { forbidden } from './objects.js'
import { BODY_MOST } from './body.js'
import { used } from './used.js'

/* Characters, so the stored document is inside its ceiling however each
   one is written out (six bytes at worst, escaped). */
const SAID_CHARS = Math.floor(BODY_MOST.said / 6)
const PAGE_CHARS = Math.floor(BODY_MOST.page / 6)

type Vars = { ctx: AuthContext }
export const importer = new Hono<{ Variables: Vars }>()

/**
 * Bringing a team's work across.
 *
 * Three exports, one shape. Trello, Asana and Basecamp disagree about almost
 * everything except that a project holds lists which hold cards with comments,
 * so the adapters normalise to that and one importer does the writing. A
 * separate importer per source would be three places for the authorship rule
 * to be got wrong.
 *
 * Authorship is preserved where it can be: an imported card keeps the name of
 * whoever wrote it, as an actor with no account. Rewriting history to say the
 * person who ran the import wrote everything is the thing that makes a team
 * distrust an import.
 */
const Normalised = z.object({
  name: z.string().min(1).max(200),
  lists: z
    .array(
      z.object({
        name: z.string().max(200),
        tasks: z
          .array(
            z.object({
              title: z.string().min(1).max(300),
              body: z.string().max(20_000).optional(),
              author: z.string().max(200).optional(),
              due_on: z.string().optional(),
              completed: z.boolean().optional(),
              comments: z.array(z.object({ author: z.string().max(200).optional(), text: z.string().max(SAID_CHARS) })).default([]),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
  posts: z.array(z.object({ title: z.string(), body: z.string().max(PAGE_CHARS).optional(), author: z.string().optional() })).default([]),
})
type Normalised = z.infer<typeof Normalised>

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

/** Trello: board → lists → cards, with actions as comments. */
function fromTrello(raw: Record<string, unknown>): Normalised {
  const lists = (raw.lists ?? []) as { id: string; name: string; closed?: boolean }[]
  const cards = (raw.cards ?? []) as {
    idList: string
    name: string
    desc?: string
    due?: string | null
    closed?: boolean
  }[]
  const actions = (raw.actions ?? []) as {
    type: string
    data?: { card?: { id: string }; text?: string }
    memberCreator?: { fullName?: string }
  }[]
  const members = (raw.members ?? []) as { id: string; fullName?: string }[]
  void members

  return {
    name: String(raw.name ?? 'Imported board'),
    lists: lists
      .filter((l) => !l.closed)
      .map((l) => ({
        name: l.name,
        tasks: cards
          .filter((c) => c.idList === l.id)
          .map((c) => ({
            title: c.name,
            body: c.desc || undefined,
            due_on: c.due ? c.due.slice(0, 10) : undefined,
            completed: Boolean(c.closed),
            comments: actions
              .filter((a) => a.type === 'commentCard' && a.data?.text)
              .map((a) => ({ author: a.memberCreator?.fullName, text: a.data!.text! })),
          })),
      })),
    posts: [],
  }
}

/** Asana: a project with sections and tasks. */
function fromAsana(raw: Record<string, unknown>): Normalised {
  const data = (raw.data ?? raw) as Record<string, unknown>
  const tasks = (data.tasks ?? []) as {
    name: string
    notes?: string
    due_on?: string
    completed?: boolean
    memberships?: { section?: { name?: string } }[]
    created_by?: { name?: string }
    stories?: { text?: string; created_by?: { name?: string } }[]
  }[]

  const bySection = new Map<string, Normalised['lists'][number]>()
  for (const t of tasks) {
    const section = t.memberships?.[0]?.section?.name ?? 'Tasks'
    const list = bySection.get(section) ?? { name: section, tasks: [] }
    list.tasks.push({
      title: t.name,
      body: t.notes || undefined,
      author: t.created_by?.name,
      due_on: t.due_on,
      completed: Boolean(t.completed),
      comments: (t.stories ?? []).filter((s) => s.text).map((s) => ({ author: s.created_by?.name, text: s.text! })),
    })
    bySection.set(section, list)
  }
  return {
    name: String(data.name ?? 'Imported project'),
    lists: [...bySection.values()],
    posts: [],
  }
}

/** Basecamp: a project with to-do lists and a message board. */
function fromBasecamp(raw: Record<string, unknown>): Normalised {
  const todosets = (raw.todolists ?? []) as {
    title: string
    todos?: {
      content: string
      description?: string
      due_on?: string
      completed?: boolean
      creator?: { name?: string }
      comments?: { content: string; creator?: { name?: string } }[]
    }[]
  }[]
  const messages = (raw.messages ?? []) as {
    subject: string
    content?: string
    creator?: { name?: string }
  }[]

  return {
    name: String(raw.name ?? 'Imported project'),
    lists: todosets.map((l) => ({
      name: l.title,
      tasks: (l.todos ?? []).map((t) => ({
        title: t.content,
        body: t.description || undefined,
        author: t.creator?.name,
        due_on: t.due_on,
        completed: Boolean(t.completed),
        comments: (t.comments ?? []).map((c) => ({ author: c.creator?.name, text: c.content })),
      })),
    })),
    posts: messages.map((m) => ({
      title: m.subject,
      body: m.content,
      author: m.creator?.name,
    })),
  }
}

export const ADAPTERS = {
  trello: fromTrello,
  asana: fromAsana,
  basecamp: fromBasecamp,
  normalised: (raw: Record<string, unknown>) => Normalised.parse(raw),
} as const

importer.post('/import/:source', async (c) => {
  const ctx = c.get('ctx')
  // Importing creates a project and people, so it is an admin act and never a
  // token's: an import that arrives through a tool is somebody else's data
  // landing in your workspace with nobody having looked.
  if (ctx.viaMcp || !allow(ctx, 'project.create') || !allow(ctx, 'people.invite')) {
    return c.json(forbidden, 403)
  }
  /*
   * Closed until it is rebuilt.
   *
   * It failed on every file, and it did so after holding one of the pool's
   * connections for the whole import: thousands of inserts awaited one by
   * one in a single transaction, from a body of fifty megabytes with no
   * ceiling on how many lists and tasks were in it. Hidden from the screen
   * was not enough while the door stayed open.
   */
  if (!process.env.IMPORT_OPEN) {
    return c.json({ error: { code: 'gone', message: 'Import isn’t available yet.' } }, 410)
  }

  const source = c.req.param('source') as keyof typeof ADAPTERS
  const adapter = ADAPTERS[source]
  if (!adapter) return c.json({ error: { code: 'invalid', message: 'Unknown source' } }, 400)
  used(c, `import.${source}`)

  let plan: Normalised
  try {
    plan = Normalised.parse(adapter((await c.req.json()) as Record<string, unknown>))
  } catch {
    return c.json({ error: { code: 'invalid', message: 'Couldn’t read that export. Check the file and try again.' } }, 400)
  }

  const projectId = uuidv7()
  const counts = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    await tx`
      insert into project (id, workspace_id, name) values (${projectId}, ${ctx.workspaceId}, ${plan.name})`
    await tx`
      insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
      values (${uuidv7()}, ${ctx.workspaceId}, ${projectId}, ${ctx.actorId}, ${ctx.actorId}, ${[...RIGHTS_OF_ITS_MAKER]})`
    await tx`
      insert into conversation (id, workspace_id, project_id, name)
      values (${uuidv7()}, ${ctx.workspaceId}, ${projectId}, 'main')`

    // One actor per name, reused. Imported people have no account: they exist
    // so the work keeps the name of whoever did it, and they can be given a
    // real account later by inviting the same person.
    const people = new Map<string, string>()
    async function actorFor(name: string | undefined): Promise<string> {
      if (!name) return ctx.actorId
      const known = people.get(name)
      if (known) return known
      const [existing] = await tx<{ id: string }[]>`
        select a.id from actor a join membership m on m.actor_id = a.id
        where m.workspace_id = ${ctx.workspaceId} and a.name = ${name} and m.deleted_at is null`
      const id = existing?.id ?? uuidv7()
      if (!existing) {
        await tx`insert into actor (id, name) values (${id}, ${name})`
        await tx`
          insert into membership (id, workspace_id, actor_id, role, invited_by, joined_at)
          values (${uuidv7()}, ${ctx.workspaceId}, ${id}, 'member', ${ctx.actorId}, now())`
      }
      people.set(name, id)
      return id
    }

    let tasks = 0
    let comments = 0
    let key: string | null = null

    for (const list of plan.lists) {
      const listId = uuidv7()
      await tx`
        insert into task_list (id, workspace_id, project_id, author_id, name, sort_key)
        values (${listId}, ${ctx.workspaceId}, ${projectId}, ${ctx.actorId}, ${list.name},
                ${generateKeyBetween(key, null)})`
      key = generateKeyBetween(key, null)

      let taskKey: string | null = null
      for (const t of list.tasks) {
        const taskId = uuidv7()
        taskKey = generateKeyBetween(taskKey, null)
        await tx`
          insert into task (id, workspace_id, project_id, author_id, list_id, title, body,
                            sort_key, due_on, completed_at, column_name)
          values (${taskId}, ${ctx.workspaceId}, ${projectId}, ${await actorFor(t.author)},
                  ${listId}, ${t.title}, ${t.body ? tx.json(doc(t.body) as never) : null},
                  ${taskKey}, ${t.due_on ?? null},
                  ${t.completed ? tx`now()` : null}, ${list.name})`
        tasks++
        for (const cm of t.comments) {
          await tx`
            insert into comment
              (id, workspace_id, project_id, object_type, object_id, author_id, body)
            values (${uuidv7()}, ${ctx.workspaceId}, ${projectId}, 'task', ${taskId},
                    ${await actorFor(cm.author)}, ${tx.json(doc(cm.text) as never)})`
          comments++
        }
      }
    }

    for (const p of plan.posts) {
      await tx`
        insert into post (id, workspace_id, project_id, author_id, title, body, published_at)
        values (${uuidv7()}, ${ctx.workspaceId}, ${projectId}, ${await actorFor(p.author)},
                ${p.title}, ${p.body ? tx.json(doc(p.body) as never) : tx.json({} as never)}, now())`
    }

    await record(tx, ctx, 'project.import', {
      projectId,
      meta: { source, tasks, comments, people: people.size },
    })
    return { tasks, comments, posts: plan.posts.length, people: people.size }
  })

  return c.json({ project_id: projectId, ...counts }, 201)
})
