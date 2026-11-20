/**
 * Linear's API, read with somebody's personal key.
 *
 * Only `api.linear.app` and `uploads.linear.app` are ever asked, and the key
 * goes to nothing else. No package: GraphQL is one POST.
 */
import { capped, Later, Refused } from './importing.js'

const API = 'https://api.linear.app/graphql'

/* Linear's names for what every import shares. */
export { Refused as LinearRefused, Later as LinearLater }

export async function linear<T>(key: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(API, {
    method: 'POST',
    /* A personal key is the header's whole value, with no `Bearer`. */
    headers: { authorization: key, 'content-type': 'application/json', 'user-agent': 'Tuff' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  })
  if (r.status === 429) throw new Later(Number(r.headers.get('retry-after')) || 60)
  const body = (await r.json().catch(() => null)) as { data?: T; errors?: { message?: string; extensions?: { code?: string } }[] } | null
  if (body?.errors?.some((e) => e.extensions?.code === 'RATELIMITED')) {
    throw new Later(Number(r.headers.get('retry-after')) || 60)
  }
  if (r.status === 401 || r.status === 403 || body?.errors?.some((e) => e.extensions?.code === 'AUTHENTICATION_ERROR')) {
    throw new Refused(401, 'Linear didn’t accept that key.')
  }
  if (!r.ok || !body?.data) throw new Refused(r.status, body?.errors?.[0]?.message?.slice(0, 200) ?? `Linear answered ${r.status}`)
  /* Low on the hour's allowance: the next page waits rather than spends
     the last of it and is refused. */
  const said = r.headers.get('x-ratelimit-requests-remaining')
  if (said !== null && Number(said) < 50) throw new Later(120)
  return body.data
}

export type Team = { id: string; key: string; name: string; issues: number }

/** The teams a key can see, with how many issues each holds. */
export async function teamsOf(key: string): Promise<Team[]> {
  const d = await linear<{ teams: { nodes: { id: string; key: string; name: string; issueCount: number }[] } }>(
    key,
    `query { teams(first: 100) { nodes { id key name issueCount } } }`,
  )
  return d.teams.nodes.map((t) => ({ id: t.id, key: t.key, name: t.name, issues: t.issueCount }))
}

export type State = { id: string; name: string; type: string; position: number }
export type Cycle = { id: string; number: number; name: string | null; startsAt: string; endsAt: string }
type Person = { email: string | null; name: string | null } | null
export type Issue = {
  id: string
  number: number
  title: string
  description: string | null
  priority: number
  estimate: number | null
  dueDate: string | null
  createdAt: string
  completedAt: string | null
  canceledAt: string | null
  archivedAt: string | null
  state: { id: string } | null
  assignee: Person
  creator: Person
  labels: { nodes: { name: string }[] }
  cycle: { id: string } | null
  parent: { number: number; team: { id: string } } | null
  project: { name: string } | null
  comments: { nodes: { body: string; createdAt: string; user: Person }[] }
}

/** A team's states and cycles: what its issues point at. */
export async function shapeOf(key: string, team: string): Promise<{ states: State[]; cycles: Cycle[] }> {
  const d = await linear<{
    team: { states: { nodes: State[] }; cycles: { nodes: Cycle[] } }
  }>(
    key,
    `query($team: String!) { team(id: $team) {
      states(first: 100) { nodes { id name type position } }
      cycles(first: 100, includeArchived: true) { nodes { id number name startsAt endsAt } }
    } }`,
    { team },
  )
  return { states: d.team.states.nodes, cycles: d.team.cycles.nodes }
}

/**
 * A page of a team's issues, oldest number first, archived ones too.
 *
 * Twenty-five a page and twenty-five comments each keeps a page well under
 * Linear's ten thousand points a query; an issue with more comments says so
 * and the rest are asked for on their own (`commentsAfter`).
 */
export async function issuesOf(
  key: string,
  team: string,
  after: string | null,
): Promise<{ issues: (Issue & { moreComments: string | null })[]; next: string | null }> {
  const d = await linear<{
    team: {
      issues: {
        nodes: (Issue & { comments: Issue['comments'] & { pageInfo: { hasNextPage: boolean; endCursor: string | null } } })[]
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
      }
    }
  }>(
    key,
    `query($team: String!, $after: String) { team(id: $team) {
      issues(first: 25, after: $after, includeArchived: true, orderBy: createdAt) {
        nodes {
          id number title description priority estimate dueDate createdAt completedAt canceledAt archivedAt
          state { id }
          assignee { email name }
          creator { email name }
          labels(first: 25) { nodes { name } }
          cycle { id }
          parent { number team { id } }
          project { name }
          comments(first: 25) { nodes { body createdAt user { email name } } pageInfo { hasNextPage endCursor } }
        }
        pageInfo { hasNextPage endCursor }
      }
    } }`,
    { team, after },
  )
  const page = d.team.issues
  return {
    issues: page.nodes.map((i) => ({
      ...i,
      moreComments: i.comments.pageInfo.hasNextPage ? i.comments.pageInfo.endCursor : null,
    })),
    next: page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null,
  }
}

/** The rest of an issue's comments, after the first page. */
export async function commentsAfter(key: string, issue: string, after: string): Promise<Issue['comments']['nodes']> {
  const out: Issue['comments']['nodes'] = []
  let cursor: string | null = after
  for (let page = 0; cursor && page < 40; page++) {
    const d: {
      issue: { comments: { nodes: Issue['comments']['nodes']; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }
    } = await linear(
      key,
      `query($issue: String!, $after: String) { issue(id: $issue) {
        comments(first: 50, after: $after) { nodes { body createdAt user { email name } } pageInfo { hasNextPage endCursor } }
      } }`,
      { issue, after: cursor },
    )
    out.push(...d.issue.comments.nodes)
    cursor = d.issue.comments.pageInfo.hasNextPage ? d.issue.comments.pageInfo.endCursor : null
  }
  return out
}

/**
 * A picture or file from Linear's own store, with the key — its files are
 * kept behind it. Only `uploads.linear.app`, no redirect followed off it,
 * ten megabytes at most, read as it streams.
 */
export async function upload(key: string, url: string): Promise<{ bytes: ArrayBuffer; type: string; name: string } | null> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.hostname !== 'uploads.linear.app') return null
  const r = await fetch(u, { headers: { authorization: key }, redirect: 'manual', signal: AbortSignal.timeout(30_000) }).catch(() => null)
  if (!r || !r.ok || !r.body) return null
  const type = (r.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]!.trim()
  const bytes = await capped(r)
  if (!bytes) return null
  let name = u.pathname.split('/').pop() || 'file'
  try {
    name = decodeURIComponent(name)
  } catch {
    // A name with a broken escape keeps the escape.
  }
  name = name.slice(0, 200)
  return { bytes, type, name }
}
