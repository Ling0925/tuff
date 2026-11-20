/**
 * Jira Cloud's API, read with somebody's email and API token.
 *
 * Only the site they named is ever asked, and only when it is a site of
 * Atlassian's: `<name>.atlassian.net`, nothing before or after it. That
 * field is the one place a person types where our server goes, and it is
 * not a way to send it anywhere else.
 */
import { capped, Later, patiently, Refused } from './importing.js'

export type JiraKey = { site: string; email: string; token: string }

/** The site as somebody pasted it — with or without `https://` and a path — or null. */
export function siteOf(said: string): string | null {
  const bare = said
    .trim()
    .toLowerCase()
    .replace(/^https:\/\//, '')
    .replace(/\/.*$/, '')
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.atlassian\.net$/.test(bare) ? bare : null
}

async function jira<T>(k: JiraKey, path: string, body?: unknown, inPlace = true): Promise<T> {
  const site = siteOf(k.site)
  if (!site) throw new Refused(400, 'That isn’t a Jira Cloud site.')
  const r = await patiently(
    () =>
      fetch(`https://${site}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${k.email}:${k.token}`).toString('base64')}`,
          accept: 'application/json',
          'user-agent': 'Tuff',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        /* A key is never carried to wherever a redirect points. */
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      }),
    inPlace,
  )
  if (r.status === 401 || r.status === 403) throw new Refused(401, 'Jira didn’t accept that email and token.')
  if (!r.ok) throw new Refused(r.status, `Jira answered ${r.status}`)
  return (await r.json()) as T
}

export type Project = { id: string; key: string; name: string; issues: number }

/** The site's projects the key can see, with how many issues each holds. */
export async function projectsOf(k: JiraKey): Promise<Project[]> {
  const out: Project[] = []
  for (let startAt = 0, page = 0; page < 10; page++) {
    const d = await jira<{
      values: { id: string; key: string; name: string; insight?: { totalIssueCount?: number } }[]
      isLast?: boolean
    }>(k, `/rest/api/3/project/search?expand=insight&maxResults=50&startAt=${startAt}`, undefined, false)
    out.push(...d.values.map((p) => ({ id: p.id, key: p.key, name: p.name, issues: p.insight?.totalIssueCount ?? 0 })))
    if (d.isLast !== false || !d.values.length) break
    startAt += d.values.length
  }
  return out
}

export type State = { id: string; name: string; type: string; position: number }

/**
 * A project's statuses as lists: every issue type's, once each by name, in
 * the order work goes — to do, in progress, done. A Backlog is a backlog;
 * a done that is a refusal is a cancel.
 */
export async function statusesOf(k: JiraKey, project: string): Promise<State[]> {
  const d = await jira<{ statuses: { name: string; statusCategory?: { key?: string } }[] }[]>(
    k,
    `/rest/api/3/project/${encodeURIComponent(project)}/statuses`,
  )
  const seen = new Map<string, State>()
  const RANK: Record<string, number> = { new: 0, indeterminate: 1, done: 2 }
  for (const t of d) {
    for (const s of t.statuses ?? []) {
      if (!s.name || seen.has(s.name)) continue
      const cat = s.statusCategory?.key ?? 'new'
      const type =
        cat === 'done'
          ? /cancel|declin|reject|won.?t|duplicate/i.test(s.name)
            ? 'canceled'
            : 'completed'
          : cat === 'indeterminate'
            ? 'started'
            : /backlog/i.test(s.name)
              ? 'backlog'
              : 'unstarted'
      seen.set(s.name, { id: s.name, name: s.name.slice(0, 200), type, position: (RANK[cat] ?? 0) * 1000 + seen.size })
    }
  }
  return [...seen.values()].sort((a, b) => a.position - b.position)
}

/** The field a site keeps sprints in: a custom one, named differently on every site. */
export async function sprintFieldOf(k: JiraKey): Promise<string | null> {
  const d = await jira<{ id: string; schema?: { custom?: string } }[]>(k, '/rest/api/3/field')
  return d.find((f) => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint')?.id ?? null
}

type Person = { displayName?: string; emailAddress?: string } | null
export type Comment = { body: unknown; created: string; author?: Person }
export type Issue = {
  id: string
  key: string
  fields: {
    summary?: string
    description?: unknown
    status?: { name?: string; statusCategory?: { key?: string } }
    priority?: { name?: string } | null
    assignee?: Person
    reporter?: Person
    labels?: string[]
    components?: { name?: string }[]
    duedate?: string | null
    created?: string
    resolutiondate?: string | null
    issuetype?: { hierarchyLevel?: number }
    parent?: { key?: string; fields?: { summary?: string; issuetype?: { hierarchyLevel?: number } } }
    comment?: { comments?: Comment[]; total?: number }
    attachment?: { id: string; filename?: string; mimeType?: string; size?: number }[]
    [sprints: string]: unknown
  }
}

/** A page of a project's issues, oldest first, by Jira's own page token. */
export async function issuesOf(
  k: JiraKey,
  project: string,
  next: string | null,
  sprintField: string | null,
): Promise<{ issues: Issue[]; next: string | null }> {
  if (!/^\d{1,20}$/.test(project)) throw new Refused(400, 'Not a Jira project.')
  const d = await jira<{ issues?: Issue[]; nextPageToken?: string; isLast?: boolean }>(k, '/rest/api/3/search/jql', {
    jql: `project = ${project} ORDER BY created ASC`,
    maxResults: 25,
    ...(next ? { nextPageToken: next } : {}),
    fields: [
      'summary',
      'description',
      'status',
      'priority',
      'assignee',
      'reporter',
      'labels',
      'components',
      'duedate',
      'created',
      'resolutiondate',
      'issuetype',
      'parent',
      'comment',
      'attachment',
      ...(sprintField ? [sprintField] : []),
    ],
  })
  return { issues: d.issues ?? [], next: d.isLast === false && d.nextPageToken ? d.nextPageToken : null }
}

/** The rest of an issue's comments, past what the search carried. */
export async function commentsAfter(k: JiraKey, issue: string, startAt: number): Promise<Comment[]> {
  const out: Comment[] = []
  for (let at = startAt, page = 0; page < 20; page++) {
    const d = await jira<{ comments?: Comment[]; total?: number }>(
      k,
      `/rest/api/3/issue/${encodeURIComponent(issue)}/comment?startAt=${at}&maxResults=100&orderBy=created`,
    )
    const got = d.comments ?? []
    out.push(...got)
    at += got.length
    if (!got.length || at >= (d.total ?? 0)) break
  }
  return out
}

/**
 * An attachment's bytes, from the site itself: `redirect=false` asks Jira
 * for the file rather than a redirect to its media store, so the key goes
 * to the one host it was given for and nowhere else. Ten megabytes.
 */
export async function attachmentOf(k: JiraKey, id: string): Promise<ArrayBuffer | null> {
  const site = siteOf(k.site)
  if (!site || !/^\d{1,20}$/.test(id)) return null
  const r = await patiently(() =>
    fetch(`https://${site}/rest/api/3/attachment/content/${id}?redirect=false`, {
      headers: { authorization: `Basic ${Buffer.from(`${k.email}:${k.token}`).toString('base64')}`, 'user-agent': 'Tuff' },
      redirect: 'manual',
      signal: AbortSignal.timeout(60_000),
    }),
  ).catch((e) => {
    if (e instanceof Later) throw e
    return null
  })
  if (!r || !r.ok) return null
  return capped(r)
}
