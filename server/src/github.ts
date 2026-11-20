import { createHmac, createPrivateKey, timingSafeEqual } from 'node:crypto'
import { SignJWT } from 'jose'
import { env } from './env.js'
import { asWorker, withActorEverywhere, type Tx } from './db.js'
import { open, seal } from './auth/seal.js'

/**
 * The Tuff app on GitHub, as the server speaks to it.
 *
 * Two identities: the app itself, which signs a short JWT with its private
 * key and asks only about installations, and an installation, which the app
 * trades that JWT for a token of an hour to read the repositories it was
 * given. Both through `fetch`; nothing here is a dependency of its own.
 */

const API = 'https://api.github.com'

export function githubConfigured(): boolean {
  return Boolean(env.githubAppId && env.githubPrivateKey && env.githubWebhookSecret)
}

let key: ReturnType<typeof createPrivateKey> | null = null

/** The app's own token: ten minutes at most, by GitHub's rule, so nine. */
export async function appJwt(): Promise<string> {
  key ??= createPrivateKey(env.githubPrivateKey)
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(env.githubAppId)
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 9 * 60)
    .sign(key)
}

/* Kept until a minute before they run out: an hour each, and a burst of
   events for one installation asks once. */
const tokens = new Map<number, { token: string; until: number }>()

export async function installationToken(installationId: number): Promise<string> {
  const kept = tokens.get(installationId)
  if (kept && kept.until > Date.now() + 60_000) return kept.token
  const r = await call<{ token: string; expires_at: string }>(`/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    as: await appJwt(),
  })
  tokens.set(installationId, { token: r.token, until: Date.parse(r.expires_at) })
  return r.token
}

export class GithubRefused extends Error {
  constructor(
    readonly status: number,
    message: string,
    /* What GitHub said about it, when it said something: a sub-issue over
       a limit is a 422 whose words are worth putting on the task. */
    readonly said: string | null = null,
  ) {
    super(message)
  }
}

/** One request to GitHub's API, as the app or as an installation. */
export async function call<T>(path: string, opts: { method?: string; as: string; body?: unknown }): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${opts.as}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'Tuff',
      ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!r.ok) {
    const why = await r
      .json()
      .then((v) => v as { message?: unknown; errors?: { message?: unknown }[] } | null)
      .then((b) =>
        [b?.message, ...(Array.isArray(b?.errors) ? b.errors.map((e) => e?.message) : [])]
          .filter((x): x is string => typeof x === 'string' && x.length > 0)
          .join(' — ')
          .slice(0, 300),
      )
      .catch(() => '')
    throw new GithubRefused(r.status, `${opts.method ?? 'GET'} ${path} → ${r.status}`, why || null)
  }
  return (r.status === 204 ? undefined : await r.json()) as T
}

/** The same, as an installation. */
export async function asInstallation<T>(installationId: number, path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  return call<T>(path, { ...opts, as: await installationToken(installationId) })
}

export type Installation = {
  id: number
  account: { id: number; login: string; type: string } | null
  created_at: string
  suspended_at: string | null
}

export async function installation(id: number): Promise<Installation | null> {
  try {
    return await call<Installation>(`/app/installations/${id}`, { as: await appJwt() })
  } catch (e) {
    if (e instanceof GithubRefused && e.status === 404) return null
    throw e
  }
}

/* What the app is called on GitHub, for the address it is installed from.
   Asked once: it is the name chosen when the app was registered. */
let slug: string | null = null
export async function appSlug(): Promise<string> {
  if (slug) return slug
  try {
    slug = (await call<{ slug: string }>('/app', { as: await appJwt() })).slug
  } catch {
    return env.githubAppSlug
  }
  return slug
}

export type Repo = { id: number; full_name: string; private: boolean }

/** Every repository the installation was given, a hundred a page. */
export async function repositories(installationId: number): Promise<Repo[]> {
  const out: Repo[] = []
  for (let page = 1; page <= 20; page++) {
    const r = await asInstallation<{ total_count: number; repositories: Repo[] }>(
      installationId,
      `/installation/repositories?per_page=100&page=${page}`,
    )
    out.push(...r.repositories.map(({ id, full_name, private: p }) => ({ id, full_name, private: p })))
    if (out.length >= r.total_count || r.repositories.length < 100) break
  }
  return out
}

/** Whether a body is the one GitHub signed with the app's webhook secret. */
export function signedByGithub(raw: string, header: string | undefined): boolean {
  if (!env.githubWebhookSecret || !header?.startsWith('sha256=')) return false
  const want = Buffer.from(createHmac('sha256', env.githubWebhookSecret).update(raw).digest('hex'))
  const got = Buffer.from(header.slice(7))
  return want.length === got.length && timingSafeEqual(want, got)
}

/* ------------------------------------------------------------ the handles */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The numbers a text names in this project — `RED-12`, `red-12-sign-in` —
 * and which of them it says it closes. Case-blind; only the project's own
 * key, so a repository cannot reach another project's tasks by naming them.
 */
export function handlesIn(text: string, key: string): { named: number[]; closes: number[] } {
  /* Bounded, and with no run of spaces a pattern can try every split of:
     a sixty-kilobyte body of spaces took two seconds a pass. */
  text = text.slice(0, 20_000)
  const k = escape(key)
  const named = new Set<number>()
  const closes = new Set<number>()
  for (const m of text.matchAll(new RegExp(`(?<![A-Za-z0-9])${k}-(\\d+)(?![A-Za-z0-9])`, 'gi'))) named.add(Number(m[1]))
  const closing = new RegExp(`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)[\\s:]{1,10}${k}-(\\d+)(?![A-Za-z0-9])`, 'gi')
  for (const m of text.matchAll(closing)) closes.add(Number(m[1]))
  return { named: [...named], closes: [...closes] }
}

/* --------------------------------------------------------------- the moves */

/** How far round a list's mark has gone — `lists.md`; the endings last. */
export const RANK: Record<string, number> = { backlog: 0, open: 1, started: 2, doing: 3, review: 4, done: 5, stopped: 5 }

/**
 * Where GitHub would put a task, by the marks of the project's lists, or
 * nowhere — and only forwards: a task already further on stays where it is.
 * `wants` is the marks to try, in order.
 */
export function forwardTo(
  lists: { id: string; icon: string | null }[],
  now: { icon: string | null } | null,
  wants: string[],
): string | null {
  for (const mark of wants) {
    const to = lists.find((l) => l.icon === mark)
    if (!to) continue
    const here = RANK[now?.icon ?? 'open'] ?? 1
    return (RANK[mark] ?? 0) > here ? to.id : null
  }
  return null
}

/** The branch a task is worked on, as Linear names it. */
export function branchName(who: string, key: string, number: number, title: string): string {
  const words = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
  const person = who.toLowerCase().replace(/[^a-z0-9-]+/g, '')
  return `${person ? `${person}/` : ''}${key.toLowerCase()}-${number}${words ? `-${words}` : ''}`
}

/* ------------------------------------------------------- a person's own */

/**
 * A person's GitHub, from the code GitHub hands back after they authorise
 * the app: their token (eight hours, and a refresh token for six months, as
 * a GitHub App's user tokens are) and who they are on GitHub.
 */
export type PersonToken = { token: string; refresh: string | null; until: Date | null; refreshUntil: Date | null }

export async function tradeCode(code: string, redirect: string): Promise<PersonToken> {
  return tokenFrom({ code, redirect_uri: redirect })
}

/**
 * A person's GitHub let go of at GitHub as well as here: the grant is
 * withdrawn, so the token and its refresh, which outlive the row that kept
 * them, are good for nothing. Best effort — GitHub not answering leaves
 * the row gone here all the same.
 */
export async function letGo(token: string | null): Promise<void> {
  if (!token || !env.githubClientId || !env.githubClientSecret) return
  await fetch(`https://api.github.com/applications/${env.githubClientId}/grant`, {
    method: 'DELETE',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Basic ${Buffer.from(`${env.githubClientId}:${env.githubClientSecret}`).toString('base64')}`,
      'content-type': 'application/json',
      'user-agent': 'Tuff',
    },
    body: JSON.stringify({ access_token: token }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
}

export async function refreshToken(refresh: string): Promise<PersonToken> {
  return tokenFrom({ grant_type: 'refresh_token', refresh_token: refresh })
}

async function tokenFrom(fields: Record<string, string>): Promise<PersonToken> {
  const r = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'Tuff' },
    body: JSON.stringify({ client_id: env.githubClientId, client_secret: env.githubClientSecret, ...fields }),
    signal: AbortSignal.timeout(15_000),
  })
  const b = (await r.json().catch(() => ({}))) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    refresh_token_expires_in?: number
    error?: string
  }
  if (!r.ok || !b.access_token) throw new GithubRefused(r.status === 200 ? 400 : r.status, b.error ?? 'no token')
  const now = Date.now()
  return {
    token: b.access_token,
    refresh: b.refresh_token ?? null,
    until: b.expires_in ? new Date(now + b.expires_in * 1000) : null,
    refreshUntil: b.refresh_token_expires_in ? new Date(now + b.refresh_token_expires_in * 1000) : null,
  }
}

export type GithubUser = { id: number; login: string; avatar_url: string | null }

export async function whoIs(token: string): Promise<GithubUser> {
  const u = await call<GithubUser>('/user', { as: token })
  return { id: u.id, login: u.login, avatar_url: u.avatar_url ?? null }
}

/* Kept sealed: a token read back to act as somebody has to be readable,
   so it is encrypted rather than hashed, with a key from the environment
   — the same shape as the second factor's secret (`auth/totp.ts`), under
   `ENCRYPTION_KEY` when there is one (`auth/seal.ts`). Slack's tokens and
   an import's API key are sealed the same way. */
export function sealSecret(secret: string): string {
  return seal('github', secret)
}

export function openSecret(sealed: string | null): string | null {
  return open('github', sealed)
}

/**
 * A person's own token, renewed when it has run out; null when they have
 * none that works. Asked by a request, it is the asker's own and nobody
 * else's — as them, which is all the database answers the application
 * role (migration 153). The worker, writing as whoever linked a
 * repository, asks as itself and always for one workspace and project
 * (`within`): it is answered only while the person is still in both
 * (`github_person_token_in`, migration 292), and has no other way
 * to ask.
 */
export async function personToken(actor: string, within?: { workspace: string; project: string }): Promise<string | null> {
  const as = <T>(fn: (tx: Tx) => Promise<T>) => (within ? asWorker(fn) : withActorEverywhere(actor, fn))
  type Row = { token_enc: string | null; refresh_enc: string | null; token_until: Date | null }
  const [row] = await as((tx) =>
    within
      ? tx<Row[]>`select * from github_person_token_in(${actor}, ${within.workspace}, ${within.project})`
      : tx<Row[]>`select * from github_person_token(${actor})`,
  )
  if (!row) return null
  const token = openSecret(row.token_enc)
  if (token && (!row.token_until || row.token_until.getTime() > Date.now() + 60_000)) return token
  const refresh = openSecret(row.refresh_enc)
  if (!refresh) return null
  try {
    const t = await refreshToken(refresh)
    await as(
      (tx) => tx`
      select github_person_retoken(${actor}, ${sealSecret(t.token)}, ${t.refresh ? sealSecret(t.refresh) : null},
                                   ${t.until}, ${t.refreshUntil})`,
    )
    return t.token
  } catch {
    return null
  }
}

/** What a person, by their own GitHub, may do in a repository: nothing,
    read, or write to its issues (triage or more). */
export async function personOnRepo(token: string, fullName: string): Promise<'none' | 'read' | 'write'> {
  const r = await call<{ permissions?: { pull?: boolean; triage?: boolean; push?: boolean; admin?: boolean; maintain?: boolean } }>(
    `/repos/${fullName}`,
    { as: token },
  ).catch(() => null)
  const p = r?.permissions
  if (!r) return 'none'
  return p?.admin || p?.maintain || p?.push || p?.triage ? 'write' : 'read'
}

/** The repositories of an installation a person can reach by their own GitHub. */
export async function personsRepos(token: string, installationId: number): Promise<Repo[]> {
  const out: Repo[] = []
  for (let page = 1; page <= 20; page++) {
    const r = await call<{ total_count: number; repositories: Repo[] }>(
      `/user/installations/${installationId}/repositories?per_page=100&page=${page}`,
      { as: token },
    ).catch(() => null)
    if (!r) break
    out.push(...r.repositories.map(({ id, full_name, private: p }) => ({ id, full_name, private: p })))
    if (out.length >= r.total_count || r.repositories.length < 100) break
  }
  return out
}
