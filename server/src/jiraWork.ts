import { attachmentOf, commentsAfter, issuesOf, siteOf, sprintFieldOf, statusesOf, type Issue, type JiraKey } from './jira.js'
import { Refused } from './importing.js'
import { adfToMarkdown } from './importText.js'
import { cut, fileOf, kitOf, PAGES_A_TURN, talk, turn, wentThrough, writePage, type Claimed, type Kit } from './importKit.js'

/**
 * A Jira project's turn of an import.
 * How Jira is read; the writing, the waits and the endings are every
 * import's (`importKit.ts`).
 */
const PRIORITY: Record<string, number> = { highest: 1, blocker: 1, critical: 1, high: 2, medium: 3, low: 4, lowest: 4, trivial: 4 }

export function jiraTurn(job: Claimed, key: JiraKey): Promise<number> {
  const kit = kitOf(job)
  const { ours, save } = kit
  const site = siteOf(key.site) ?? ''
  return turn(job, async (pages) => {
    const sprintField = await sprintFieldOf(key)
    for (const team of job.teams) {
      const p = (job.progress[team.id] ??= {})
      if (p.done) continue
      if (!p.project_id) {
        const states = await statusesOf(key, team.id)
        const made = await ours<{ project_id: string }>('/import/linear/project', {
          /* Where from is the site and the project, so two sites' projects of
             one number are two. */
          team: { id: `${site}:${team.id}`, key: team.key.slice(0, 10), name: team.name.slice(0, 200) },
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
          page = await issuesOf(key, team.id, p.cursor ?? null, sprintField)
        } catch (e) {
          /* A page token Jira no longer knows: from the start again, which
             costs a look at numbers already here and nothing else. */
          if (!(e instanceof Refused && e.status === 400 && p.cursor)) throw e
          p.cursor = null
          page = await issuesOf(key, team.id, null, sprintField)
        }
        const numbered = page.issues.map((i) => ({ i, number: numberOf(i.key) })).filter((x) => x.number !== null)
        const { have } = numbered.length
          ? await ours<{ have: number[] }>('/import/linear/have', { project_id: p.project_id, numbers: numbered.map((x) => x.number) })
          : { have: [] as number[] }
        const fresh = numbered.filter((x) => !have.includes(x.number!))
        for (const [at, { i, number }] of fresh.entries()) {
          p.reading = at
          if (at % 5 === 0) await save()
          await writePage(job, kit, p, [await issueOf(key, kit, p.project_id, i, number!, sprintField)])
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

/** `ENG-123` is 123: the number its commits and links already name. */
function numberOf(key: string): number | null {
  const m = /-(\d{1,8})$/.exec(key)
  const n = m ? Number(m[1]) : NaN
  return n >= 1 && n <= 10_000_000 ? n : null
}

const person = (p: { displayName?: string; emailAddress?: string } | null | undefined) =>
  p ? { email: p.emailAddress?.slice(0, 254) ?? null, name: p.displayName?.slice(0, 200) ?? null } : null

async function issueOf(key: JiraKey, kit: Kit, projectId: string, i: Issue, number: number, sprintField: string | null) {
  const f = i.fields
  const done = f.status?.statusCategory?.key === 'done'
  /* Attachments as files of the project, after the words. */
  const files: string[] = []
  const missed: string[] = []
  for (const a of (f.attachment ?? []).slice(0, 20)) {
    const name = (a.filename ?? 'File').slice(0, 120)
    const bytes = (a.size ?? 0) > 10 * 1024 * 1024 ? null : await attachmentOf(key, a.id)
    const id = bytes ? await kit.put(projectId, fileOf(bytes, a.mimeType ?? 'application/octet-stream', name)) : null
    if (id) files.push(`![${name.replace(/[[\]]/g, '')}](file:${id})`)
    else missed.push(name)
    /* A file can take a minute: the claim is kept while it does. */
    await kit.save()
  }
  /* Said, not dropped in silence. */
  if (missed.length) files.push(`(Not brought from Jira: ${missed.join(', ')}.)`)
  /* An epic is a task here; what is under it says which, as a label. A
     sub-task is a part of the task above it, in this project. */
  const up = f.parent
  const epic = up && up.fields?.issuetype?.hierarchyLevel === 1 ? up.fields.summary : null
  const parent = up && !epic && up.key && up.key.replace(/-\d+$/, '') === i.key.replace(/-\d+$/, '') ? numberOf(up.key) : null
  const sprints = (
    sprintField && Array.isArray(f[sprintField]) ? (f[sprintField] as { name?: string; startDate?: string; endDate?: string }[]) : []
  ).filter((s) => s && typeof s.name === 'string')
  const sprint = sprints[sprints.length - 1]
  const carried = f.comment?.comments ?? []
  const more = (f.comment?.total ?? 0) > carried.length ? await commentsAfter(key, i.id, carried.length) : []
  const said = talk(
    [...carried, ...more].map((c) => ({ body: adfToMarkdown(c.body), createdAt: c.created, user: person(c.author) })),
    'jira',
  )
  return {
    number,
    title: (f.summary || i.key).slice(0, 1000),
    body: cut([adfToMarkdown(f.description), ...files, said.note].filter(Boolean).join('\n\n'), 200_000, 'jira'),
    priority: PRIORITY[(f.priority?.name ?? '').toLowerCase()] ?? 0,
    dueDate: f.duedate ?? null,
    createdAt: f.created ?? new Date().toISOString(),
    completedAt: done ? (f.resolutiondate ?? f.created ?? null) : null,
    state: f.status?.name?.slice(0, 200) ?? null,
    assignee: person(f.assignee),
    creator: person(f.reporter),
    labels: [
      ...(f.labels ?? []),
      ...(f.components ?? []).map((c) => (c.name ? `Component: ${c.name}` : '')),
      ...(epic ? [`Epic: ${epic}`] : []),
    ]
      .map((l) => l.trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 60),
    cycle: sprint?.name?.slice(0, 200) ?? null,
    cycleSpan: sprint?.startDate && sprint.endDate ? { starts: sprint.startDate, ends: sprint.endDate } : null,
    parent,
    comments: said.kept.map((c) => ({ ...c, body: cut(c.body, 100_000, 'jira') })),
  }
}
