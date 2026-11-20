import { commentsOf, download, filesOf, projectsOfTask, sectionsOf, subtasksOf, tasksOf, type Task } from './asana.js'
import { Refused } from './importing.js'
import { asanaHtmlToMarkdown } from './importText.js'
import { cut, fileOf, kitOf, PAGES_A_TURN, talk, turn, wentThrough, writePage, type Claimed, type Kit } from './importKit.js'

/**
 * An Asana project's turn of an import.
 *
 * Asana numbers nothing, so the project does, as each task is written: in
 * Asana's order, each task and then its sub-tasks. What is here already is
 * known by Asana's own id (`import_task`), not by its place — a place moves
 * when somebody adds a task in Asana between two turns.
 */
const PRIORITY: Record<string, number> = { urgent: 1, highest: 1, critical: 1, high: 2, medium: 3, normal: 3, low: 4, lowest: 4 }

/** What a section is by its name, as a spreadsheet's statuses are read. */
export function kindOf(name: string): string {
  if (/backlog|icebox|someday/i.test(name)) return 'backlog'
  if (/done|complete|shipped|closed|finished/i.test(name)) return 'completed'
  if (/progress|doing|review|started|testing|blocked/i.test(name)) return 'started'
  return 'unstarted'
}

export function asanaTurn(job: Claimed, token: string): Promise<number> {
  const kit = kitOf(job)
  const { ours, save } = kit
  return turn(job, async (pages) => {
    for (const team of job.teams) {
      const p = (job.progress[team.id] ??= {})
      if (p.done) continue
      /* A list a name: two sections of one name are one list. */
      const states: { id: string; name: string; type: string; position: number }[] = []
      for (const s of (await sectionsOf(token, team.id)).slice(0, 99)) {
        const name = (s.name?.trim() || 'Untitled').slice(0, 200)
        if (!states.some((t) => t.name === name)) states.push({ id: s.gid, name, type: kindOf(name), position: states.length })
      }
      if (!states.length) states.push({ id: 'todo', name: 'To do', type: 'unstarted', position: 0 })
      /* Asana's "completed" is not a section; here it is a list. */
      if (!states.some((s) => s.type === 'completed')) states.push({ id: 'done', name: 'Done', type: 'completed', position: states.length })
      const doneName = states.find((s) => s.type === 'completed')!.name
      const firstName = states[0]!.name
      if (!p.project_id) {
        const made = await ours<{ project_id: string }>('/import/linear/project', {
          team: { id: team.id, key: '', name: team.name.slice(0, 200) },
          states,
          cycles: [],
        })
        p.project_id = made.project_id
        p.issues = 0
        await save()
      }
      for (;;) {
        if (pages.n >= PAGES_A_TURN) {
          await save(true)
          return 'later'
        }
        let page
        try {
          page = await tasksOf(token, team.id, p.cursor ?? null)
        } catch (e) {
          /* An offset Asana no longer knows: from the top, and what is here
             already is known by its id. */
          if (!(e instanceof Refused && e.status === 400 && p.cursor)) throw e
          p.cursor = null
          page = await tasksOf(token, team.id, null)
        }
        /* Each task, then its sub-tasks at any depth, each part under the top
           of its chain. A sub-task that is also in the project comes with
           its parent, not again on its own. */
        const tops: Task[] = []
        for (const t of page.tasks) {
          /* Brought with its parent when the parent is in this project too;
             a part whose parent lives elsewhere is a task of its own here. */
          if (t.parent?.gid && (await projectsOfTask(token, t.parent.gid)).includes(team.id)) continue
          tops.push(t)
        }
        const { origins } = tops.length
          ? await ours<{ origins: string[] }>('/import/linear/have', {
              project_id: p.project_id,
              numbers: [],
              origins: tops.map((t) => t.gid),
            })
          : { origins: [] as string[] }
        for (const [at, t] of tops.entries()) {
          p.reading = at
          if (at % 5 === 0) await save()
          const section = t.memberships?.find((m) => m.project?.gid === team.id)?.section?.name?.trim()
          const state = t.completed ? doneName : section && states.some((s) => s.name === section) ? section : firstName
          if (!origins.includes(t.gid)) await writePage(job, kit, p, [await issueOf(token, kit, p.project_id, { t, parent: null, state })])
          /* Its parts, after it, every time: one left behind by a stop part-way
             is brought now, and those here already are passed over by the door. */
          const parts = await under(token, t, 0, { left: 200 }, save)
          const here = parts.length
            ? (
                await ours<{ origins: string[] }>('/import/linear/have', {
                  project_id: p.project_id,
                  numbers: [],
                  origins: parts.map((x) => x.gid),
                })
              ).origins
            : []
          for (const s of parts.filter((x) => !here.includes(x.gid))) {
            await writePage(job, kit, p, [
              await issueOf(token, kit, p.project_id, { t: s, parent: t.gid, state: s.completed ? doneName : state }),
            ])
          }
        }
        p.reading = 0
        p.cursor = page.next
        pages.n += 1
        wentThrough(job)
        if (!page.next) {
          await ours('/import/linear/parents', { project_id: p.project_id })
          p.done = true
          await save()
          break
        }
        await save()
      }
    }
    return 'done'
  })
}

/** A task's sub-tasks and theirs, five deep and two hundred at most. */
async function under(token: string, t: Task, depth: number, budget: { left: number }, keep: () => Promise<unknown>): Promise<Task[]> {
  if (!t.num_subtasks || depth > 4 || budget.left <= 0) return []
  /* Asked one task at a time, which can be long: the claim is kept meanwhile. */
  await keep()
  const out: Task[] = []
  for (const s of await subtasksOf(token, t.gid)) {
    if (budget.left-- <= 0) break
    out.push(s, ...(await under(token, s, depth + 1, budget, keep)))
  }
  return out
}

async function issueOf(token: string, kit: Kit, projectId: string, r: { t: Task; parent: string | null; state: string }) {
  const t = r.t
  const files: string[] = []
  const missed: string[] = []
  for (const a of (await filesOf(token, t.gid)).slice(0, 20)) {
    const name = (a.name ?? 'File').slice(0, 120)
    /* Kept elsewhere — Drive, Dropbox — it is a link in Asana, and stays one there. */
    if (a.host !== 'asana') continue
    const bytes = await download(a)
    const id = bytes ? await kit.put(projectId, fileOf(bytes, 'application/octet-stream', name)) : null
    if (id) files.push(`![${name.replace(/[[\]]/g, '')}](file:${id})`)
    else missed.push(name)
    await kit.save()
  }
  if (missed.length) files.push(`(Not brought from Asana: ${missed.join(', ')}.)`)
  const link =
    t.permalink_url && /^https:\/\/app\.asana\.com\//.test(t.permalink_url)
      ? `[Imported from Asana](${t.permalink_url})`
      : 'Imported from Asana.'
  const notes = t.html_notes ? asanaHtmlToMarkdown(t.html_notes) : (t.notes ?? '')
  const priority = t.custom_fields?.find((f) => /^priority$/i.test(f.name ?? ''))?.enum_value?.name ?? ''
  const said = talk(
    (await commentsOf(token, t.gid)).map((c) => ({
      body: c.text,
      createdAt: c.created_at,
      user: c.created_by ? { email: c.created_by.email?.slice(0, 254) ?? null, name: c.created_by.name?.slice(0, 200) ?? null } : null,
    })),
    'asana',
  )
  return {
    origin: t.gid,
    parentOrigin: r.parent,
    title: (t.name?.trim() || 'Untitled task').slice(0, 1000),
    body: cut([link, notes, ...files, said.note].filter(Boolean).join('\n\n'), 200_000, 'asana'),
    priority: PRIORITY[priority.toLowerCase()] ?? 0,
    dueDate: t.due_on ?? null,
    createdAt: t.created_at ?? new Date().toISOString(),
    completedAt: t.completed ? (t.completed_at ?? null) : null,
    state: r.state,
    assignee: t.assignee ? { email: t.assignee.email?.slice(0, 254) ?? null, name: t.assignee.name?.slice(0, 200) ?? null } : null,
    creator: null,
    labels: (t.tags ?? [])
      .map((g) => (g.name ?? '').trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 60),
    cycle: null,
    cycleSpan: null,
    parent: null,
    comments: said.kept.map((c) => ({ ...c, body: cut(c.body, 100_000, 'asana') })),
  }
}
