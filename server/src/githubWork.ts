import { v7 as uuidv7 } from 'uuid'
import { asWorker, withActor, withoutActor, type Tx } from './db.js'
import { issueAccessToken } from './auth/tokens.js'
import { app } from './http/routes.js'
import { fromInside } from './http/limits.js'
import { forwardTo, handlesIn } from './github.js'
import { fromComment, fromIssue, fromSubIssue, Later as IssuesLater, linkerCan } from './githubIssues.js'

/**
 * What GitHub said, applied.
 *
 * The worker's half of `POST /hooks/github`: each event in the queue, in the
 * order it came, as the person who linked the repository. What is written
 * about a pull request is GitHub's own state, kept beside the tasks it
 * names; what is done to a task — moving it — goes through the same
 * endpoint a person's move does, with a token that says GitHub caused it.
 */

type Event = { id: string; event: string; installation_id: string | null; payload: Record<string, unknown> }
type Route = {
  workspace_id: string
  install_id: string
  link_id: string | null
  project_id: string | null
  project_key: string | null
  linked_by: string | null
}

/** Something GitHub said that cannot be applied now but may be later. */
class Later extends Error {}

export async function githubWork(n = 20, wait = '3 seconds'): Promise<number> {
  const events = await asWorker((tx) => tx<Event[]>`select * from github_events_claim(${n}, ${wait}::interval)`)
  for (const e of events) {
    try {
      await apply(e)
      await asWorker((tx) => tx`select github_event_done(${e.id}, ${null}, false)`)
    } catch (err) {
      const said = err instanceof Error ? err.message : String(err)
      /* Kept for another try only when trying again could help. */
      const retry = err instanceof Later || err instanceof IssuesLater
      if (!retry) console.error('github: an event could not be applied', e.event, e.id, said)
      await asWorker((tx) => tx`select github_event_done(${e.id}, ${said}, ${retry})`)
    }
  }
  return events.length
}

async function apply(e: Event): Promise<void> {
  const p = e.payload as Record<string, any>
  const installation = Number(e.installation_id ?? p.installation?.id ?? 0)
  if (!installation) return

  if (e.event === 'installation') {
    if (p.action === 'deleted' || p.action === 'suspend') {
      await asWorker((tx) => tx`select github_install_gone(${installation})`)
    }
    return
  }
  if (e.event === 'installation_repositories') {
    for (const r of (p.repositories_removed ?? []) as { id: number }[]) {
      await asWorker((tx) => tx`select github_repo_gone(${installation}, ${r.id})`)
    }
    return
  }

  const repo = Number(p.repository?.id ?? 0)
  const [route] = await withoutActor((tx) => tx<Route[]>`select * from github_route(${installation}, ${repo})`)
  if (!route?.link_id || !route.project_id || !route.project_key || !route.linked_by) return
  const as = route as Required<{ [K in keyof Route]: NonNullable<Route[K]> }>
  if (!(await linkerCan(as.link_id, as.linked_by, as.workspace_id, as.project_id))) return

  if (e.event === 'issues') await fromIssue(as.project_id, p)
  else if (e.event === 'issue_comment') await fromComment(as.project_id, p)
  else if (e.event === 'sub_issues') await fromSubIssue(as.project_id, p)
  else if (e.event === 'pull_request' || e.event === 'pull_request_review') await pull(as, p)
  else if (e.event === 'check_suite') await checks(as, p)
  else if (e.event === 'push') await push(as, p)
}

/* ------------------------------------------------------- pull requests */

async function pull(r: Linked, p: Record<string, any>): Promise<void> {
  const pr = p.pull_request
  if (!pr?.number) return
  const state: 'open' | 'closed' | 'merged' = pr.merged || pr.merged_at ? 'merged' : pr.state === 'closed' ? 'closed' : 'open'
  const review =
    p.review?.state === 'approved'
      ? 'approved'
      : p.review?.state === 'changes_requested'
        ? 'changes'
        : p.action === 'review_requested'
          ? 'requested'
          : null
  /*
   * Only a pull request from inside: its branch in this repository, or
   * opened by somebody with a hand in it. On a public repository anybody
   * can open one from a fork, and naming RED-1 to RED-500 in it moved five
   * hundred tasks and hung a stranger's card on each.
   */
  const inside = pr.head?.repo?.id === p.repository?.id || ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(pr.author_association)
  if (!inside) return
  const found = handlesIn(`${pr.title ?? ''}\n${pr.body ?? ''}\n${pr.head?.ref ?? ''}`, r.project_key)
  /* And a handful of tasks, not a list: a pull request is about a few. */
  const named = found.named.slice(0, 10)
  const closes = found.closes.filter((n) => named.includes(n))

  const tasks = await asLinker(r, async (tx) => {
    const found = named.length
      ? await tx<{ id: string; number: number }[]>`
          select id, number from task
          where project_id = ${r.project_id} and number = any(${named}::int[]) and deleted_at is null`
      : []
    const [row] = await tx<{ id: string }[]>`
      insert into github_pull (id, workspace_id, project_id, link_id, number, title, url, author_login, author_avatar,
                               head_ref, head_sha, state, draft, review)
      values (${uuidv7()}, ${r.workspace_id}, ${r.project_id}, ${r.link_id}, ${pr.number}, ${String(pr.title ?? '')},
              ${String(pr.html_url ?? '')}, ${pr.user?.login ?? null}, ${pr.user?.avatar_url ?? null},
              ${pr.head?.ref ?? null}, ${pr.head?.sha ?? null}, ${state}, ${Boolean(pr.draft)}, ${review})
      on conflict (link_id, number) do update set
        title = excluded.title, url = excluded.url, author_login = excluded.author_login,
        author_avatar = excluded.author_avatar, head_ref = excluded.head_ref,
        head_sha = excluded.head_sha, state = excluded.state, draft = excluded.draft,
        review = coalesce(excluded.review, github_pull.review),
        checks = case when github_pull.head_sha is distinct from excluded.head_sha then null else github_pull.checks end,
        updated_at = now()
      returning id`
    const pullId = row!.id
    await tx`delete from github_pull_task where pull_id = ${pullId} and not (task_id = any(${found.map((t) => t.id)}::uuid[]))`
    for (const t of found) {
      await tx`
        insert into github_pull_task (workspace_id, project_id, pull_id, task_id, closes)
        values (${r.workspace_id}, ${r.project_id}, ${pullId}, ${t.id}, ${closes.includes(t.number)})
        on conflict (pull_id, task_id) do update set closes = excluded.closes`
    }
    return found.map((t) => ({ ...t, closes: closes.includes(t.number) }))
  })

  /* What moves, and only when the pull request itself changed state — an
     edit to its words is not news about the work. */
  const moving = ['opened', 'reopened', 'ready_for_review', 'converted_to_draft', 'closed']
  if (e_action(p) && !moving.includes(e_action(p)!)) return
  if (state === 'merged') {
    await move(
      r,
      tasks.filter((t) => t.closes).map((t) => t.id),
      ['done'],
    )
  } else if (state === 'open') {
    await move(
      r,
      tasks.map((t) => t.id),
      pr.draft ? ['started', 'doing'] : ['review', 'doing'],
    )
  }
}

const e_action = (p: Record<string, any>): string | null => (typeof p.action === 'string' ? p.action : null)

/** A suite of checks finished: the pull requests on that commit say so. */
async function checks(r: Linked, p: Record<string, any>): Promise<void> {
  const suite = p.check_suite
  if (!suite?.head_sha) return
  const said =
    p.action === 'completed'
      ? suite.conclusion === 'success' || suite.conclusion === 'neutral' || suite.conclusion === 'skipped'
        ? 'success'
        : 'failure'
      : 'pending'
  await asLinker(
    r,
    (tx) => tx`
    update github_pull set checks = ${said}, updated_at = now()
    where link_id = ${r.link_id} and head_sha = ${suite.head_sha}`,
  )
}

/**
 * A push: a new branch that names a task starts it, and a commit on the
 * default branch that says it closes one finishes it — the way GitHub
 * closes an issue from a commit.
 */
async function push(r: Linked, p: Record<string, any>): Promise<void> {
  const ref = String(p.ref ?? '')
  if (!ref.startsWith('refs/heads/') || p.deleted) return
  const branch = ref.slice('refs/heads/'.length)
  if (p.created) {
    const { named } = handlesIn(branch, r.project_key)
    await move(r, await numbered(r, named), ['started', 'doing'])
  }
  if (branch === p.repository?.default_branch) {
    const closing = ((p.commits ?? []) as { message?: string }[]).flatMap((c) => handlesIn(c.message ?? '', r.project_key).closes)
    await move(r, await numbered(r, [...new Set(closing)]), ['done'])
  }
}

/* ------------------------------------------------------------ the doing */

type Linked = { workspace_id: string; install_id: string; link_id: string; project_id: string; project_key: string; linked_by: string }

/** A transaction as the person who linked the repository, inside their workspace. */
function asLinker<T>(r: Linked, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withActor(r.linked_by, r.workspace_id, fn)
}

async function numbered(r: Linked, numbers: number[]): Promise<string[]> {
  if (!numbers.length) return []
  const rows = await asLinker(
    r,
    (tx) => tx<{ id: string }[]>`
    select id from task where project_id = ${r.project_id} and number = any(${numbers}::int[]) and deleted_at is null`,
  )
  return rows.map((t) => t.id)
}

/**
 * Moving tasks forward, through `PATCH /api/tasks/:id` as the person who
 * linked the repository, with a token that says GitHub caused it. Refused —
 * that person has left, or may no longer change tasks there — and the move
 * is not made; nobody else's rights are borrowed.
 */
async function move(r: Linked, ids: string[], wants: string[]): Promise<void> {
  if (!ids.length) return
  const { lists, tasks } = await asLinker(r, async (tx) => ({
    lists: await tx<{ id: string; icon: string | null }[]>`
      select id, icon from task_list where project_id = ${r.project_id} and deleted_at is null order by sort_key`,
    tasks: await tx<{ id: string; icon: string | null; parent_id: string | null }[]>`
      select t.id, l.icon, t.parent_id from task t left join task_list l on l.id = t.list_id
      where t.id = any(${ids}::uuid[]) and t.deleted_at is null`,
  }))
  const token = await issueAccessToken({ sub: r.linked_by, workspace_id: r.workspace_id, via: 'github' })
  for (const t of tasks) {
    const to = forwardTo(lists, t, wants)
    if (!to) continue
    const res = await app.request(`/api/tasks/${t.id}`, {
      method: 'PATCH',
      headers: { ...fromInside(), 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ list_id: to }),
    })
    if (res.status >= 500) throw new Later(`moving ${t.id} → ${res.status}`)
    if (!res.ok) console.log(`github: ${t.id} not moved, ${res.status}`)
  }
}
