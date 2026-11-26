import { RIGHTS_ON_JOINING, rightsOfItsMaker } from '@tracker/shared-schema'
import { Hono } from 'hono'
import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import { generateKeyBetween } from 'fractional-indexing'
import { withActor, type Tx } from '../db.js'
import { allow, type AuthContext } from '../auth/context.js'
import { sealSecret } from '../github.js'
import { LinearLater, LinearRefused, teamsOf } from '../linear.js'
import { importTally, TooLong } from '../mcp/markdown.js'
import { Busy, plainDoc, readMarkdownOrPlain } from '../mcp/markdownPool.js'
import { record } from './activity.js'
import { forbidden } from './objects.js'
import { spendOn } from './limits.js'
import { NAME, type Source } from '../importing.js'

/**
 * A team brought across from Linear.
 *
 * A person starts it and watches it; the worker does it, writing through
 * the doors below with a token that names the import (`via: 'import'`).
 * Those doors take nothing from anybody else: every one asks that the
 * token is the import's, and that the project it writes into is one that
 * same import made.
 */
type Vars = { ctx: AuthContext }
export const linearImport = new Hono<{ Variables: Vars }>()

/**
 * A person, not a token, and the owner: an import writes a whole team's
 * words, and puts colleagues' names on the ones Linear says they wrote. The
 * Slack import asks as much (`slack-import.md`).
 */
function mayStart(ctx: AuthContext): string | null {
  if (ctx.viaMcp || ctx.viaGithub || ctx.viaImport) return 'Connected tools can’t import.'
  if (!allow(ctx, 'audit.read')) return 'Only the workspace owner can import.'
  return null
}

const KEY = z
  .string()
  .trim()
  .min(20)
  .max(200)
  .regex(/^lin_api_[A-Za-z0-9_-]+$/)

/** The teams a key can see — asked with the key, which is not kept. */
linearImport.post('/import/linear/teams', async (c) => {
  const ctx = c.get('ctx')
  const no = mayStart(ctx)
  if (no) return c.json({ error: { code: 'forbidden', message: no } }, 403)
  if (!(await spendOn(`linear:teams:${ctx.actorId}`, 20, 3600))) {
    return c.json({ error: { code: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' } }, 429)
  }
  const body = z.object({ key: KEY }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid', message: 'That doesn’t look like a Linear API key.' } }, 400)
  try {
    return c.json({ teams: await teamsOf(body.data.key) })
  } catch (e) {
    if (e instanceof LinearRefused && e.status === 401) {
      return c.json({ error: { code: 'invalid', message: 'Linear didn’t accept that key.' } }, 400)
    }
    if (e instanceof LinearLater)
      return c.json({ error: { code: 'rate_limited', message: 'Linear asked us to wait. Try again in a minute.' } }, 429)
    return c.json({ error: { code: 'unavailable', message: 'Couldn’t reach Linear. Try again.' } }, 502)
  }
})

/** Started: the key sealed for as long as the import runs. */
linearImport.post('/import/linear', async (c) => {
  const ctx = c.get('ctx')
  const no = mayStart(ctx)
  if (no) return c.json({ error: { code: 'forbidden', message: no } }, 403)
  const body = z
    .object({ key: KEY, teams: z.array(z.string().min(1).max(100)).min(1).max(20) })
    .safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  if (!(await spendOn(`linear:start:${ctx.actorId}`, 10, 3600))) {
    return c.json({ error: { code: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' } }, 429)
  }
  /* The teams are asked again with the key, not taken from the request:
     what is brought is what the key can see, named as Linear names it. */
  let teams
  try {
    teams = (await teamsOf(body.data.key)).filter((t) => body.data.teams.includes(t.id))
  } catch (e) {
    if (e instanceof LinearRefused && e.status === 401) {
      return c.json({ error: { code: 'invalid', message: 'Linear didn’t accept that key.' } }, 400)
    }
    return c.json({ error: { code: 'unavailable', message: 'Couldn’t reach Linear. Try again.' } }, 502)
  }
  if (!teams.length) return c.json({ error: { code: 'invalid', message: 'Choose at least one team.' } }, 400)
  const id = await begin(ctx, 'linear', body.data.key, teams)
  if (!id) return c.json({ error: { code: 'conflict', message: 'An import is already running.' } }, 409)
  return c.json({ id }, 202)
})

/** An import begun, its key sealed for as long as it runs; null while
    another is running in the workspace — one at a time, from any product. */
export async function begin(ctx: AuthContext, source: Source, key: string, teams: unknown[]): Promise<string | null> {
  const id = uuidv7()
  const started = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [running] = await tx<{ on: boolean }[]>`select workspace_importing() as on`
    if (running?.on) return false
    /* Two at one moment: the database's index lets one in. */
    const [made] = await tx`
      insert into linear_import (id, workspace_id, actor_id, key_enc, teams, source)
      values (${id}, ${ctx.workspaceId}, ${ctx.actorId}, ${sealSecret(key)}, ${tx.json(teams as never)}, ${source})
      on conflict (workspace_id) where state = 'running' do nothing
      returning id`
    return !!made
  })
  return started ? id : null
}

/** How far the person's imports have got — never the key. */
linearImport.get('/import/linear', async (c) => {
  const ctx = c.get('ctx')
  if (ctx.viaMcp || ctx.viaGithub || ctx.viaImport) return c.json(forbidden, 403)
  const rows = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) => tx`
    select id, source, teams, progress, state, error, created_at, finished_at
    from linear_import order by created_at desc limit 5`,
  )
  return c.json({ imports: rows })
})

/** Stopped by whoever started it: the key goes now, and the worker's next
    write is refused. What was brought stays. */
linearImport.post('/import/linear/:id/stop', async (c) => {
  const ctx = c.get('ctx')
  if (ctx.viaMcp || ctx.viaGithub || ctx.viaImport) return c.json(forbidden, 403)
  const id = c.req.param('id')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: { code: 'not_found' } }, 404)
  const [r] = await withActor(ctx.actorId, ctx.workspaceId, (tx) => tx<{ ok: boolean }[]>`select linear_import_stop(${id}) as ok`)
  return r?.ok ? c.json({ ok: true }) : c.json({ error: { code: 'not_found' } }, 404)
})

/* ------------------------------------------------- the worker's own doors */

/** The import a token speaks for, if it is one, still running, and the person's own. */
async function theImport(c: { get: (k: 'ctx') => AuthContext }): Promise<{ ctx: AuthContext; id: string; source: Source } | null> {
  const ctx = c.get('ctx')
  /* And still the owner's to do: handed over, it stops. */
  if (!ctx.viaImport || !allow(ctx, 'audit.read')) return null
  const [row] = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) => tx<{ source: Source }[]>`
    select source from linear_import where id = ${ctx.viaImport!} and state = 'running'`,
  )
  return row ? { ctx, id: ctx.viaImport, source: row.source } : null
}

/** A project the import made, or nothing. */
async function itsProject(tx: Tx, importId: string, projectId: string): Promise<{ id: string } | null> {
  const [p] = await tx<{ id: string }[]>`
    select id from project where id = ${projectId} and import_id = ${importId} and deleted_at is null`
  return p ?? null
}

const State = z.object({ id: z.string().max(100), name: z.string().min(1).max(200), type: z.string().max(40), position: z.number() })
const Cycle = z.object({
  id: z.string().max(100),
  number: z.number().int(),
  name: z.string().max(200).nullable(),
  startsAt: z.string().max(40),
  endsAt: z.string().max(40),
})

/* Where a Linear state's issues go: its type is the stage. */
const MARK: Record<string, { icon: string; finishes: boolean }> = {
  triage: { icon: 'backlog', finishes: false },
  backlog: { icon: 'backlog', finishes: false },
  unstarted: { icon: 'open', finishes: false },
  started: { icon: 'started', finishes: false },
  completed: { icon: 'done', finishes: true },
  canceled: { icon: 'stopped', finishes: true },
}

/**
 * The team's project, made once: its key if it is free, its states as
 * lists, its cycles as sprints. Answered with what the issues need to land.
 */
linearImport.post('/import/linear/project', async (c) => {
  const it = await theImport(c)
  if (!it) return c.json(forbidden, 403)
  const { ctx } = it
  const body = z
    .object({
      team: z.object({ id: z.string().max(100), key: z.string().max(10), name: z.string().min(1).max(200) }),
      states: z.array(State).max(100),
      cycles: z.array(Cycle).max(500),
    })
    .safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const { team, states, cycles } = body.data
  /* Where from — `linear:<team>`, `jira:<site>:<project>`, `asana:<project>`. */
  const from = `${it.source}:${team.id}`
  const out = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    /* This import's project for the team — or one an earlier import of the
       same team left, which this one takes up: what is there is kept, and
       only what is missing comes. */
    const [had] = await tx<{ id: string; import_id: string }[]>`
      select id, import_id from project
      where imported_from = ${from} and deleted_at is null
      order by (import_id = ${it.id}) desc, created_at desc limit 1`
    if (had && had.import_id !== it.id) {
      const [running] = await tx<{ on: boolean }[]>`select project_importing(${had.id}) as on`
      if (running?.on) return null
      await tx`update project set import_id = ${it.id} where id = ${had.id}`
    }
    let projectId = had?.id
    if (!projectId) {
      projectId = uuidv7()
      /* Its key, when it is one a key may be here (three letters and a
         number) and nobody has it; the database names it otherwise. Asked
         by trying, under a savepoint: a project this person cannot see may
         hold it, and only the database sees all of them. */
      const want = team.key.toUpperCase()
      const insert = (key: string | null) => tx`
        insert into project (id, workspace_id, name, tools, key, import_id, imported_from)
        values (${projectId!}, ${ctx.workspaceId}, ${team.name}, ${['posts', 'tasks', 'files', 'messages']}::tool_kind[],
                ${key}, ${it.id}, ${from})`
      if (/^[A-Z]{1,3}[0-9]*$/.test(want)) {
        try {
          await tx.savepoint(
            (sp) => sp`
            insert into project (id, workspace_id, name, tools, key, import_id, imported_from)
            values (${projectId!}, ${ctx.workspaceId}, ${team.name}, ${['posts', 'tasks', 'files', 'messages']}::tool_kind[],
                    ${want}, ${it.id}, ${from})`,
          )
        } catch {
          await insert(null)
        }
      } else {
        await insert(null)
      }
      await tx`
        insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
        values (${uuidv7()}, ${ctx.workspaceId}, ${projectId}, ${ctx.actorId}, ${ctx.actorId}, ${rightsOfItsMaker(ctx.role)})`
      await tx`
        insert into conversation (id, workspace_id, project_id, name)
        values (${uuidv7()}, ${ctx.workspaceId}, ${projectId}, 'main')`
      let at: string | null = null
      let intake = false
      /* Linear's Triage first, and as this project's triage (`triage.md`). */
      const order = [...states].sort((a, b) => (a.type === 'triage' ? -1 : b.type === 'triage' ? 1 : a.position - b.position))
      for (const s of order) {
        at = generateKeyBetween(at, null)
        const mark = MARK[s.type] ?? MARK.unstarted!
        const isIntake: boolean = s.type === 'triage' && !intake
        intake ||= isIntake
        await tx`
          insert into task_list (id, workspace_id, project_id, author_id, name, sort_key, icon, finishes, intake)
          values (${uuidv7()}, ${ctx.workspaceId}, ${projectId}, ${ctx.actorId}, ${s.name}, ${at}, ${mark.icon}, ${mark.finishes}, ${isIntake})`
      }
      for (const cy of cycles) {
        if (!day(cy.startsAt) || !day(cy.endsAt)) continue
        await tx`
          insert into cycle (id, workspace_id, project_id, author_id, name, starts_on, ends_on)
          values (${uuidv7()}, ${ctx.workspaceId}, ${projectId}, ${ctx.actorId}, ${cy.name || `Sprint ${cy.number}`},
                  ${day(cy.startsAt)}::date, ${day(cy.endsAt)}::date)`
      }
      await record(tx, ctx, 'project.create', { projectId, objectType: 'project', objectId: projectId })
    }
    return { project_id: projectId }
  })
  if (!out) return c.json({ error: { code: 'conflict', message: 'An import is already running.' } }, 409)
  return c.json(out)
})

const Said = z.object({ email: z.string().max(254).nullable(), name: z.string().max(200).nullable() }).nullable()
const Issue = z.object({
  /* Its number where it had one (Linear, Jira); none, and it is numbered here (Asana). */
  number: z.number().int().min(1).max(10_000_000).optional(),
  /** Its id where it came from, when that is what says it is here already. */
  origin: z.string().min(1).max(100).optional(),
  /** The task above it, by that same id, written before it. */
  parentOrigin: z.string().min(1).max(100).nullable().optional(),
  title: z.string().min(1).max(1000),
  body: z.string().max(200_000),
  priority: z.number().int().min(0).max(4),
  dueDate: z.string().max(40).nullable(),
  createdAt: z.string().max(40),
  completedAt: z.string().max(40).nullable(),
  state: z.string().max(200).nullable(),
  assignee: Said,
  creator: Said,
  labels: z.array(z.string().min(1).max(200)).max(60),
  cycle: z.string().max(200).nullable(),
  /* A sprint by its dates, made the first time an issue names it: Jira's
     come with the issues, not ahead of them. */
  cycleSpan: z
    .object({ starts: z.string().max(40), ends: z.string().max(40) })
    .nullable()
    .optional(),
  parent: z.number().int().min(1).nullable(),
  comments: z.array(z.object({ body: z.string().max(100_000), createdAt: z.string().max(40), user: Said })).max(2000),
})

const PRIORITY = [null, 'urgent', 'high', 'medium', 'low'] as const

type Doc = { type: string; attrs?: Record<string, unknown>; content?: Doc[] }

/**
 * A body as the editor's document, read by a worker before the page's
 * transaction opens, so no connection
 * or project lock waits on it.
 *
 * Nothing about one body ends the import, whose worker takes a refusal as
 * the end: one the workers cannot read in half a second is kept as its
 * plain paragraphs; one the parser fails on is too, and logged, rather
 * than failing the same page on every turn. Only a busy pool is passed on
 * — a `503`, which the import waits out (`importKit.ts`).
 */
async function parsedOf(text: string, tally: ReturnType<typeof importTally>): Promise<Doc> {
  let d: Doc
  try {
    d = (await readMarkdownOrPlain(text)) as Doc
  } catch (e) {
    if (e instanceof Busy) throw e
    console.error(`[import] a body of ${text.length} characters could not be read, kept as plain words:`, (e as Error).message)
    d = plainDoc(text) as Doc
  }
  /* Every body of the page together, against what one page may write:
     each is bounded on its own, and a page of bounded ones was not. One past it is kept as its plain words rather than refusing
     the page. */
  try {
    tally(text, JSON.stringify(d).length)
  } catch (e) {
    if (!(e instanceof TooLong)) throw e
    d = plainDoc(text) as Doc
    /* Plain words are no bigger than what was sent; counted whatever the
       ceiling says, so what follows sees the page as it is. */
    tally(text, JSON.stringify(d).length, true)
  }
  return d
}

/**
 * Its files drawn as what they are. An attachment is drawn from what its
 * node says — name, kind, size, the picture's pixels — and a node that
 * says only which file was drawn as "File", a picture nobody could see, a
 * download with no name a computer opens. Each is filled from the file
 * itself, in this project only.
 */
async function filled(tx: Tx, projectId: string, d: Doc): Promise<Doc> {
  const kept: Doc[] = []
  for (const n of d.content ?? []) {
    kept.push(n)
    if (n.type !== 'attachment') continue
    /* A file that is not this project's is not drawn: the words of the
       other product named it, and it is nobody's here. */
    if (typeof n.attrs?.fileId !== 'string') {
      kept.pop()
      continue
    }
    const [f] = await tx<
      { name: string; content_type: string | null; size_bytes: string | null; pixel_width: number | null; pixel_height: number | null }[]
    >`
      select name, content_type, size_bytes, pixel_width, pixel_height
      from file where id = ${n.attrs.fileId} and project_id = ${projectId} and deleted_at is null`
    if (!f) {
      kept.pop()
      continue
    }
    n.attrs = {
      fileId: n.attrs.fileId,
      name: f.name,
      kind: f.content_type?.startsWith('image/') ? 'image' : 'file',
      size: f.size_bytes === null ? null : Number(f.size_bytes),
      pixelWidth: f.pixel_width,
      pixelHeight: f.pixel_height,
    }
  }
  d.content = kept
  return d
}

/* People here by their email — only this workspace's, through the one
   function that reads a colleague's address. Never by name: a name in Jira
   is whatever its person typed, and a guest who calls themselves a
   colleague here would be given their tasks and their project. */
async function peopleOf(tx: Tx, workspaceId: string): Promise<Map<string, string>> {
  const people = new Map<string, string>()
  for (const r of await tx<{ actor_id: string; email: string | null }[]>`
    select m.actor_id, card.email::text as email
    from membership m left join lateral colleague_card(m.actor_id) card on true
    where m.workspace_id = ${workspaceId} and m.deleted_at is null and m.joined_at is not null`) {
    if (r.email) people.set(r.email.toLowerCase(), r.actor_id)
  }
  return people
}
/* A moment, or a day, that the database will take: another product's
   dates are its own, and a year 275760 failed the page three times. */
const when = (s: string | null) => {
  const d = s ? new Date(s) : null
  return d && !Number.isNaN(d.getTime()) && d.getUTCFullYear() >= 1970 && d.getUTCFullYear() <= 2200 ? d : null
}
const day = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) && when(s.slice(0, 10)) ? s.slice(0, 10) : null)

/**
 * A page of a team's issues, written into its project with the numbers they
 * had. One already there by its number is left as it is: an import that
 * stopped half-way goes on, not twice.
 */
linearImport.post('/import/linear/issues', async (c) => {
  const it = await theImport(c)
  if (!it) return c.json(forbidden, 403)
  const { ctx } = it
  const body = z.object({ project_id: z.uuid(), issues: z.array(Issue).max(100) }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const issues = body.data.issues

  /* Who the issues name, read in a short transaction of its own, and every
     body then read by the workers with nothing held; the page is written
     after. */
  const before = await withActor(ctx.actorId, ctx.workspaceId, async (tx) =>
    (await itsProject(tx, it.id, body.data.project_id)) ? peopleOf(tx, ctx.workspaceId) : null,
  )
  if (before === null) return c.json(forbidden, 403)
  const named = (people: Map<string, string>, p: z.infer<typeof Said>) => (p?.email ? (people.get(p.email.toLowerCase()) ?? null) : null)
  /* Whoever imported it is its author here, and Linear's author is said
     in its words: a description anybody on the Linear team could edit is
     not to be put under a colleague's name. */
  const texts = issues.map((i) => {
    const note = [
      i.creator ? `Created in ${NAME[it.source]} by ${i.creator.name ?? i.creator.email}.` : null,
      i.assignee && !named(before, i.assignee) ? `Assigned in ${NAME[it.source]} to ${i.assignee.name ?? i.assignee.email}.` : null,
    ].filter(Boolean)
    return [note.join(' '), i.body].filter(Boolean).join('\n\n')
  })
  const tally = importTally()
  const bodies: (Doc | null)[] = []
  const said: (Doc | null)[][] = []
  for (const [k, i] of issues.entries()) {
    bodies.push(texts[k]!.trim() ? await parsedOf(texts[k]!, tally) : null)
    const docs: (Doc | null)[] = []
    for (const cm of i.comments) docs.push(cm.body.trim() ? await parsedOf(cm.body, tally) : null)
    said.push(docs)
  }

  const written = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const project = await itsProject(tx, it.id, body.data.project_id)
    if (!project) return null
    const projectId = project.id
    /* Read again under the write: somebody gone since is given nothing. */
    const people = await peopleOf(tx, ctx.workspaceId)
    const who = (p: z.infer<typeof Said>) => named(people, p)
    const lists = new Map(
      (await tx<{ id: string; name: string }[]>`select id, name from task_list where project_id = ${projectId} and deleted_at is null`).map(
        (l) => [l.name, l.id],
      ),
    )
    const cycles = new Map(
      (await tx<{ id: string; name: string }[]>`select id, name from cycle where project_id = ${projectId} and deleted_at is null`).map(
        (cy) => [cy.name, cy.id],
      ),
    )
    const labels = new Map(
      (
        await tx<{ id: string; name: string }[]>`select id, name::text from label where project_id = ${projectId} and deleted_at is null`
      ).map((l) => [l.name.toLowerCase(), l.id]),
    )
    const onProject = new Set(
      (await tx<{ actor_id: string }[]>`select actor_id from project_member where project_id = ${projectId} and deleted_at is null`).map(
        (r) => r.actor_id,
      ),
    )
    const join = async (actor: string) => {
      if (onProject.has(actor)) return
      onProject.add(actor)
      await tx`
        insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
        values (${uuidv7()}, ${ctx.workspaceId}, ${projectId}, ${actor}, ${ctx.actorId}, ${[...RIGHTS_ON_JOINING]})`
    }
    const labelOf = async (name: string) => {
      const known = labels.get(name.toLowerCase())
      if (known) return known
      const id = uuidv7()
      await tx`insert into label (id, workspace_id, project_id, name) values (${id}, ${ctx.workspaceId}, ${projectId}, ${name})`
      labels.set(name.toLowerCase(), id)
      return id
    }
    const [{ last } = { last: null }] = await tx<{ last: string | null }[]>`
      select max(sort_key) as last from task where project_id = ${projectId}`
    let sortKey = last

    let n = 0
    let top = 0
    for (const [k, i] of issues.entries()) {
      if (i.origin) {
        const [known] = await tx`select 1 from import_task where project_id = ${projectId} and origin = ${i.origin}`
        if (known) continue
      }
      let number = i.number
      if (number === undefined) {
        /* Numbered here, in the order it came: the counter is the import's
           while it runs — nobody else may take from it. */
        const [seq] = await tx<{ task_seq: number }[]>`
          update project set task_seq = task_seq + 1 where id = ${projectId} returning task_seq`
        number = seq!.task_seq
      } else {
        const [there] = await tx`select 1 from task where project_id = ${projectId} and number = ${number}`
        if (there) continue
      }
      top = Math.max(top, number)
      const assignee = who(i.assignee)
      if (assignee) await join(assignee)
      const doc = bodies[k]
      const taskId = uuidv7()
      sortKey = generateKeyBetween(sortKey, null)
      const [up] = i.parentOrigin
        ? await tx<{ task_id: string }[]>`
            select it.task_id from import_task it join task t on t.id = it.task_id
            where it.project_id = ${projectId} and it.origin = ${i.parentOrigin} and t.parent_id is null`
        : []
      const finished = i.state ? lists.get(i.state) : null
      if (i.cycle && !cycles.has(i.cycle) && i.cycleSpan) {
        const starts = when(i.cycleSpan.starts)
        const ends = when(i.cycleSpan.ends)
        if (starts && ends && ends >= starts && ends.getTime() - starts.getTime() < 366 * 86_400_000) {
          const id = uuidv7()
          await tx`
            insert into cycle (id, workspace_id, project_id, author_id, name, starts_on, ends_on)
            values (${id}, ${ctx.workspaceId}, ${projectId}, ${ctx.actorId}, ${i.cycle},
                    ${starts.toISOString().slice(0, 10)}::date, ${ends.toISOString().slice(0, 10)}::date)`
          cycles.set(i.cycle, id)
        }
      }
      await tx`
        insert into task (id, workspace_id, project_id, author_id, list_id, title, body, number, priority,
                          due_on, assignee_ids, cycle_id, sort_key, created_at, completed_at, parent_id)
        values (${taskId}, ${ctx.workspaceId}, ${projectId}, ${ctx.actorId}, ${finished ?? null},
                ${i.title.slice(0, 300)}, ${doc ? tx.json((await filled(tx, projectId, doc)) as never) : null}, ${number},
                ${PRIORITY[i.priority] ?? null}, ${day(i.dueDate)},
                ${assignee ? [assignee] : []}::uuid[], ${i.cycle ? (cycles.get(i.cycle) ?? null) : null}, ${sortKey},
                ${when(i.createdAt) ?? new Date()}, ${when(i.completedAt)}, ${up?.task_id ?? null})`
      if (i.origin) {
        await tx`insert into import_task (workspace_id, project_id, origin, task_id) values (${ctx.workspaceId}, ${projectId}, ${i.origin}, ${taskId})`
      }
      for (const name of i.labels) {
        await tx`
          insert into task_label (id, workspace_id, task_id, label_id)
          values (${uuidv7()}, ${ctx.workspaceId}, ${taskId}, ${await labelOf(name)})
          on conflict do nothing`
      }
      if (i.parent) {
        await tx`insert into linear_import_parent (task_id, parent_number) values (${taskId}, ${i.parent})`
      }
      /* Every comment is the importer's row, under the name Linear gave
         its writer: a colleague is never made the author of words they did
         not write here — and the database would refuse it, rightly
         (`cmt_write`: a comment is its author's). */
      for (const [j, cm] of i.comments.entries()) {
        const words = said[k]![j]
        if (!words) continue
        await tx`
          insert into comment (id, workspace_id, project_id, object_type, object_id, author_id, body, origin, said_as, created_at)
          values (${uuidv7()}, ${ctx.workspaceId}, ${projectId}, 'task', ${taskId}, ${ctx.actorId},
                  ${tx.json((await filled(tx, projectId, words)) as never)}, 'import',
                  ${(cm.user?.name ?? cm.user?.email ?? NAME[it.source]).slice(0, 200)},
                  ${when(cm.createdAt) ?? new Date()})`
      }
      n += 1
    }
    /* The next task made here comes after the highest number brought. */
    await tx`update project set task_seq = greatest(task_seq, ${top}) where id = ${projectId}`
    return n
  })
  if (written === null) return c.json(forbidden, 403)
  return c.json({ written })
})

/** Which of these numbers the project already has, so the worker brings
    nothing for them — not their files either — on a page taken again. */
linearImport.post('/import/linear/have', async (c) => {
  const it = await theImport(c)
  if (!it) return c.json(forbidden, 403)
  const { ctx } = it
  const body = z
    .object({
      project_id: z.uuid(),
      numbers: z.array(z.number().int().min(1).max(10_000_000)).max(100),
      origins: z.array(z.string().min(1).max(100)).max(1000).optional(),
    })
    .safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const have = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const project = await itsProject(tx, it.id, body.data.project_id)
    if (!project) return null
    const numbers = (
      await tx<{ number: number }[]>`
      select number from task where project_id = ${project.id} and number = any(${body.data.numbers}::int[])`
    ).map((r) => r.number)
    const origins = body.data.origins?.length
      ? (
          await tx<{ origin: string }[]>`
          select origin from import_task where project_id = ${project.id} and origin = any(${body.data.origins}::text[])`
        ).map((r) => r.origin)
      : []
    return { numbers, origins }
  })
  if (have === null) return c.json(forbidden, 403)
  return c.json({ have: have.numbers, origins: have.origins })
})

/** The team's last page is in: a part finds its parent, now that both are here. */
linearImport.post('/import/linear/parents', async (c) => {
  const it = await theImport(c)
  if (!it) return c.json(forbidden, 403)
  const { ctx } = it
  const body = z.object({ project_id: z.uuid() }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const done = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const project = await itsProject(tx, it.id, body.data.project_id)
    if (!project) return null
    /*
     * Each to the top of its chain. Linear nests parts in parts; a part
     * here is one level under a task and no deeper (the database refuses a
     * subtask of a subtask), so `ENG-9` under `ENG-7` under `ENG-3` is a
     * part of `ENG-3`. Twenty levels at most, a loop in Linear's data
     * included.
     */
    const linked = await tx`
      with recursive chain as (
        select w.task_id, w.parent_number as up, 1 as depth
        from linear_import_parent w join task t on t.id = w.task_id
        where t.project_id = ${project.id}
        union all
        select c.task_id, w2.parent_number, c.depth + 1
        from chain c
        join task pt on pt.project_id = ${project.id} and pt.number = c.up
        join linear_import_parent w2 on w2.task_id = pt.id
        where c.depth < 20
      ),
      top as (select distinct on (task_id) task_id, up from chain order by task_id, depth desc)
      update task t set parent_id = p.id
      from top, task p
      where t.id = top.task_id and p.project_id = ${project.id} and p.number = top.up
        and p.id <> t.id and p.parent_id is null`
    await tx`delete from linear_import_parent w using task t where w.task_id = t.id and t.project_id = ${project.id}`
    return linked.count
  })
  if (done === null) return c.json(forbidden, 403)
  return c.json({ linked: done })
})
