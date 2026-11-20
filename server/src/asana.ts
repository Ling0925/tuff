/**
 * Asana's API, read with somebody's personal access token.
 *
 * The token goes to `app.asana.com` and nothing else. Asana's files are
 * short-lived signed addresses in its own Amazon bucket, fetched with no
 * token at all.
 */
import { capped, on, patiently, Refused } from './importing.js'

const API = 'https://app.asana.com/api/1.0'

/* An id of Asana's in a path is its digits and nothing else. */
const gid = (id: string) => {
  if (!/^\d{1,30}$/.test(id)) throw new Refused(400, 'Not an Asana id.')
  return id
}

async function asana<T>(token: string, path: string, inPlace = true): Promise<{ data: T; next: string | null }> {
  const r = await patiently(
    () =>
      fetch(`${API}${path}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': 'Tuff' },
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      }),
    inPlace,
  )
  if (r.status === 401 || r.status === 403) throw new Refused(401, 'Asana didn’t accept that token.')
  if (!r.ok) throw new Refused(r.status, `Asana answered ${r.status}`)
  const body = (await r.json()) as { data: T; next_page?: { offset?: string } | null }
  return { data: body.data, next: body.next_page?.offset ?? null }
}

export type Project = { id: string; key: string; name: string; issues: number }

/** The projects of every workspace the token can see, with their task counts. */
export async function projectsOf(token: string): Promise<Project[]> {
  const { data: spaces } = await asana<{ gid: string }[]>(token, '/workspaces?limit=100', false)
  const out: Project[] = []
  for (const w of spaces.slice(0, 10)) {
    let offset: string | null = null
    for (let page = 0; page < 10; page++) {
      const got: { data: { gid: string; name: string }[]; next: string | null } = await asana(
        token,
        `/projects?workspace=${gid(w.gid)}&archived=false&limit=100&opt_fields=name${offset ? `&offset=${encodeURIComponent(offset)}` : ''}`,
        false,
      )
      out.push(...got.data.map((p) => ({ id: p.gid, key: '', name: (p.name || 'Untitled project').slice(0, 200), issues: 0 })))
      offset = got.next
      if (!offset) break
    }
  }
  /* Counts for the first twenty: one request each, and a long list is
     chosen by its names. */
  for (const p of out.slice(0, 20)) {
    const { data } = await asana<{ num_tasks?: number }>(token, `/projects/${gid(p.id)}/task_counts?opt_fields=num_tasks`, false).catch(
      () => ({
        data: {} as { num_tasks?: number },
      }),
    )
    p.issues = data.num_tasks ?? 0
  }
  return out
}

export async function sectionsOf(token: string, project: string): Promise<{ gid: string; name: string }[]> {
  return (await asana<{ gid: string; name: string }[]>(token, `/projects/${gid(project)}/sections?limit=100&opt_fields=name`)).data
}

export type Task = {
  gid: string
  name?: string
  html_notes?: string
  notes?: string
  completed?: boolean
  completed_at?: string | null
  created_at?: string
  due_on?: string | null
  assignee?: { email?: string; name?: string } | null
  tags?: { name?: string }[]
  memberships?: { project?: { gid?: string }; section?: { name?: string } | null }[]
  custom_fields?: { name?: string; enum_value?: { name?: string } | null }[]
  num_subtasks?: number
  permalink_url?: string
  parent?: { gid?: string } | null
}
const FIELDS = [
  'name',
  'html_notes',
  'completed',
  'completed_at',
  'created_at',
  'due_on',
  'assignee.email',
  'assignee.name',
  'tags.name',
  'memberships.project.gid',
  'memberships.section.name',
  'custom_fields.name',
  'custom_fields.enum_value.name',
  'num_subtasks',
  'permalink_url',
  'parent.gid',
].join(',')

/** A page of a project's tasks, in the project's order, by Asana's offset. */
export async function tasksOf(token: string, project: string, offset: string | null): Promise<{ tasks: Task[]; next: string | null }> {
  const { data, next } = await asana<Task[]>(
    token,
    `/tasks?project=${gid(project)}&limit=25&opt_fields=${FIELDS}${offset ? `&offset=${encodeURIComponent(offset)}` : ''}`,
  )
  return { tasks: data, next }
}

/** Which projects a task is in — asked of a part found among a project's own tasks. */
export async function projectsOfTask(token: string, task: string): Promise<string[]> {
  const { data } = await asana<{ memberships?: { project?: { gid?: string } }[] }>(
    token,
    `/tasks/${gid(task)}?opt_fields=memberships.project.gid`,
  )
  return (data.memberships ?? []).map((m) => m.project?.gid ?? '').filter(Boolean)
}

export async function subtasksOf(token: string, task: string): Promise<Task[]> {
  return (await asana<Task[]>(token, `/tasks/${gid(task)}/subtasks?limit=100&opt_fields=${FIELDS}`)).data
}

export type Comment = { text: string; created_at: string; created_by?: { name?: string; email?: string } | null }

/** A task's comments — only those: a story that it moved is Asana's feed, not talk. */
export async function commentsOf(token: string, task: string): Promise<Comment[]> {
  const out: Comment[] = []
  let offset: string | null = null
  for (let page = 0; page < 20; page++) {
    const got: { data: (Comment & { resource_subtype?: string })[]; next: string | null } = await asana(
      token,
      `/tasks/${gid(task)}/stories?limit=100&opt_fields=resource_subtype,text,created_at,created_by.name,created_by.email${offset ? `&offset=${encodeURIComponent(offset)}` : ''}`,
    )
    out.push(...got.data.filter((s) => s.resource_subtype === 'comment_added' && typeof s.text === 'string'))
    offset = got.next
    if (!offset) break
  }
  return out
}

export type Attachment = { gid: string; name?: string; host?: string; download_url?: string | null; size?: number }

export async function filesOf(token: string, task: string): Promise<Attachment[]> {
  return (await asana<Attachment[]>(token, `/attachments?parent=${gid(task)}&limit=100&opt_fields=name,host,download_url,size`)).data
}

/* Asana's own bucket — `asana-user-private-us-east-1.s3.amazonaws.com` and
   its regions — and nothing that only looks like it. */
const BUCKET = /^asana-user-private-[a-z0-9-]{1,40}\.s3(?:[.-][a-z0-9-]{1,30})?\.amazonaws\.com$/

/**
 * A file Asana keeps itself: its signed address lives two minutes, so it
 * is asked for just before. No token goes with it, no redirect is
 * followed, ten megabytes at most. One that lives on Drive or Dropbox is
 * not Asana's to give and is left as its name.
 */
export async function download(a: Attachment): Promise<ArrayBuffer | null> {
  if (a.host !== 'asana' || !a.download_url) return null
  const u = on(a.download_url, (h) => BUCKET.test(h))
  if (!u) return null
  const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(60_000) }).catch(() => null)
  if (!r || !r.ok) return null
  return capped(r)
}
