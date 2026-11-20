/**
 * Slack's Web API, read and written with the Tuff app's bot token.
 *
 * Only `slack.com` is asked, and no redirect is followed with a token in
 * it. Every answer is Slack's `{ ok, error }`: a refusal comes back as a
 * 200 with `ok: false`, so the status says little and the word says what.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from './env.js'
import { publicUrl } from './publicUrl.js'

/* And an address of its own to send Slack back to and to link to: on your
   own server, `APP_URL` — never usetuff.com's (`publicUrl.ts`). */
export function slackConfigured(): boolean {
  return Boolean(env.slackClientId && env.slackClientSecret && publicUrl())
}

/** Where Slack sends the owner back to. Registered with the app as it is. */
export function slackCallback(): string {
  return `${publicUrl()}/auth/slack/callback`
}

/** Bot scopes, the least that posts and lists the channels to choose from. */
export const SCOPES = ['chat:write', 'chat:write.public', 'channels:read', 'groups:read']
/* And previews — told of an address and
   answering it, asked for only once the events can be believed. */
const PREVIEWS = ['links:read', 'links:write']

export const previewsOn = () => Boolean(env.slackSigningSecret)
export const scopes = () => (previewsOn() ? [...SCOPES, ...PREVIEWS] : SCOPES)
/** Whether a connection was granted what previews need. */
export const previewsGranted = (granted: string) => PREVIEWS.every((s) => granted.split(',').includes(s))

export function authorizeUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: env.slackClientId,
    scope: scopes().join(','),
    redirect_uri: slackCallback(),
    state,
  })
  return `https://slack.com/oauth/v2/authorize?${q}`
}

export type Answer = { ok: boolean; error?: string; retryAfter?: number; [k: string]: unknown }

/** One method, form-encoded, as every Web API method takes it. */
export async function slack(method: string, params: Record<string, string>, token?: string): Promise<Answer> {
  if (!/^[a-z]+(\.[a-zA-Z0-9]+)+$/.test(method)) throw new Error(`not a Slack method: ${method}`)
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
      'user-agent': 'Tuff',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: new URLSearchParams(params).toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  })
  if (r.status === 429) {
    const after = Number(r.headers.get('retry-after'))
    return { ok: false, error: 'ratelimited', retryAfter: Number.isFinite(after) && after > 0 ? Math.min(after, 3600) : 30 }
  }
  if (!r.ok) return { ok: false, error: `http_${r.status}` }
  try {
    return (await r.json()) as Answer
  } catch {
    return { ok: false, error: 'not_json' }
  }
}

export type Installed = { token: string; teamId: string; teamName: string; scopes: string; botUser: string | null }

/**
 * The code Slack sent back, traded for the bot token. Taken only as Slack
 * says it — a bot token, for the team it names, with the scopes asked —
 * and the team is that answer's, never the browser's.
 */
export async function tradeCode(code: string): Promise<Installed | null> {
  const d = await slack('oauth.v2.access', {
    client_id: env.slackClientId,
    client_secret: env.slackClientSecret,
    code,
    redirect_uri: slackCallback(),
  })
  const team = d.team as { id?: unknown; name?: unknown } | undefined
  const granted = String(d.scope ?? '').split(',')
  const asked = scopes()
  if (
    !d.ok ||
    d.token_type !== 'bot' ||
    typeof d.access_token !== 'string' ||
    !d.access_token.startsWith('xoxb-') ||
    typeof team?.id !== 'string' ||
    !/^T[A-Z0-9]{2,30}$/.test(team.id) ||
    /* An install across a whole Enterprise Grid org is not this. */
    d.is_enterprise_install === true ||
    /* Everything asked, and nothing beyond what this app ever asks: an
       address edited to ask for more is not taken. Slack adds a bot's
       scopes up across installs, so a Slack once given previews keeps them
       when this server stops asking. */
    !asked.every((s) => granted.includes(s)) ||
    !granted.every((s) => SCOPES.includes(s) || PREVIEWS.includes(s))
  ) {
    return null
  }
  return {
    token: d.access_token,
    teamId: team.id,
    teamName: typeof team.name === 'string' && team.name ? team.name : team.id,
    scopes: granted.join(','),
    botUser: typeof d.bot_user_id === 'string' ? d.bot_user_id : null,
  }
}

export type Channel = { id: string; name: string; private: boolean }

/**
 * The channels a project may choose: every public one, and the private
 * ones the app has been invited to — which is all `groups:read` shows it.
 * Archived ones are left out. Null when Slack refused the token.
 */
export async function channelsOf(token: string): Promise<Channel[] | null> {
  const out: Channel[] = []
  let cursor = ''
  for (let page = 0; page < 20; page++) {
    const d = await slack(
      'conversations.list',
      { types: 'public_channel,private_channel', exclude_archived: 'true', limit: '1000', ...(cursor ? { cursor } : {}) },
      token,
    )
    if (!d.ok) return null
    for (const c of (d.channels as { id?: unknown; name?: unknown; is_private?: unknown }[] | undefined) ?? []) {
      if (typeof c.id === 'string' && /^[CG][A-Z0-9]{2,30}$/.test(c.id) && typeof c.name === 'string') {
        out.push({ id: c.id, name: c.name.slice(0, 80), private: c.is_private === true })
      }
    }
    cursor = String((d.response_metadata as { next_cursor?: unknown } | undefined)?.next_cursor ?? '')
    if (!cursor) break
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** The token given back; whatever Slack says, it is gone from here. */
export async function letGo(token: string | null): Promise<void> {
  if (!token) return
  await slack('auth.revoke', {}, token).catch(() => {})
}

/* --------------------------------------------------------------- the text */

/**
 * Somebody's words, made safe for `mrkdwn`. `<` and `>` are what Slack's
 * controls are made of — `<!channel>` pings everybody, `<url|label>` is a
 * link drawn as anything — so they are never somebody's to write; `&` goes
 * first so the other two are not undone.
 */
export function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** On one line: a break in a title or a name would break the link it is in. */
const flat = (text: string) => text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim()

/** At most `n` characters, cut at a word where there is one near. */
export function excerpt(text: string, n = 300): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= n) return flat
  const cut = flat.slice(0, n)
  const space = cut.lastIndexOf(' ')
  return `${(space > n * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

export type Owed = {
  kind: 'created' | 'finished' | 'commented' | 'announced'
  actor_name: string
  project_key: string
  project_slug: string
  workspace_slug: string
  number: number
  title: string
  list_name: string | null
  list_icon: string | null
  said: string | null
}

/** The message for one thing owed, in Slack's `mrkdwn`, every word of it escaped. */
export function messageOf(o: Owed): string {
  const base = publicUrl()
  const where = `${base}/${encodeURIComponent(o.workspace_slug)}/${encodeURIComponent(o.project_slug)}`
  const who = `*${escape(flat(o.actor_name))}*`
  const title = escape(flat(o.title.slice(0, 500)))
  const task = `<${where}/tasks/${o.number}|${escape(o.project_key)}-${o.number} ${title}>`
  const quote = (s: string | null) => {
    const e = s ? excerpt(s) : ''
    return e ? `\n>${escape(e)}` : ''
  }
  switch (o.kind) {
    case 'created':
      return `${who} created ${task}${o.list_name ? ` in _${escape(flat(o.list_name))}_` : ''}`
    case 'finished':
      return `${who} ${o.list_icon === 'stopped' ? 'canceled' : 'finished'} ${task}`
    case 'commented':
      return `${who} commented on ${task}${quote(o.said)}`
    case 'announced':
      return `${who} announced <${where}/posts/${o.number}|${title}>${quote(o.said)}`
  }
}

/** Posted, as plain text with nothing Slack would read into it. */
export function postMessage(token: string, channel: string, text: string): Promise<Answer> {
  return slack(
    'chat.postMessage',
    { channel, text, mrkdwn: 'true', parse: 'none', link_names: 'false', unfurl_links: 'false', unfurl_media: 'false' },
    token,
  )
}

/** Slack's words for a token that no longer works, and for a channel that doesn't. */
export const TOKEN_DEAD = new Set([
  'invalid_auth',
  'not_authed',
  'token_revoked',
  'token_expired',
  'account_inactive',
  'team_access_not_granted',
  'missing_scope',
  'no_permission',
  'ekm_access_denied',
  'team_not_found',
])
export const CHANNEL_DEAD = new Set(['channel_not_found', 'is_archived', 'not_in_channel', 'restricted_action'])

/* ------------------------------------------------------------ previews */

/**
 * Slack's signature on an event: HMAC-SHA256 with the app's signing
 * secret over `v0:timestamp:body`, and the timestamp within five minutes,
 * so a request caught once is not good for long.
 */
export function signedBySlack(raw: string, ts: string | undefined, sig: string | undefined, now = Date.now()): boolean {
  if (!env.slackSigningSecret || !ts || !/^\d{1,12}$/.test(ts) || !sig?.startsWith('v0=')) return false
  if (Math.abs(now / 1000 - Number(ts)) > 300) return false
  const want = Buffer.from(`v0=${createHmac('sha256', env.slackSigningSecret).update(`v0:${ts}:${raw}`).digest('hex')}`)
  const got = Buffer.from(sig)
  return want.length === got.length && timingSafeEqual(want, got)
}

export type Address = { ws: string; project: string; kind: 'project' | 'task' | 'post' | 'file'; number: number | null }

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/i
const TABS = new Set(['tasks', 'posts', 'files', 'messages', 'activity', 'settings'])
const NUMBERED: Record<string, Address['kind']> = { tasks: 'task', posts: 'post', files: 'file' }

/**
 * What a pasted address points at, if it is one of ours: a project, or a
 * task, an announcement or a file in it by its number. Anything else — a
 * person, a room, a sub-task's page, another host — is not previewed.
 */
export function addressOf(raw: string): Address | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  const site = publicUrl()
  if (!site) return null
  const home = new URL(site).hostname.toLowerCase()
  const host = u.hostname.toLowerCase()
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || (host !== home && host !== `www.${home}`)) return null
  const parts = u.pathname.split('/').filter(Boolean)
  const [ws, project, tab, n, more] = parts
  if (!ws || !project || !SLUG.test(ws) || !SLUG.test(project) || more !== undefined) return null
  if (tab === undefined) return { ws, project, kind: 'project', number: null }
  if (n === undefined) return TABS.has(tab) ? { ws, project, kind: 'project', number: null } : null
  const kind = NUMBERED[tab]
  return kind && /^\d{1,9}$/.test(n) ? { ws, project, kind, number: Number(n) } : null
}

export type Preview = {
  kind: Address['kind']
  workspace_slug: string
  project_slug: string
  project_name: string
  project_key: string
  number: number | null
  title: string
  list_name: string | null
  list_icon: string | null
  done: boolean
  people: string | null
  due_on: Date | string | null
  at: Date | string | null
  said: string | null
  file_kind: 'doc' | 'upload' | 'link' | null
  content_type: string | null
  size_bytes: string | number | null
  address: string | null
}

/** A day as Slack's readers write it — Fri 14 Nov, and the year when it is not this one. */
function day(v: Date | string): string {
  const d = new Date(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v)
  const thisYear = d.getUTCFullYear() === new Date().getUTCFullYear()
  return d.toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(thisYear ? {} : { year: 'numeric' }),
  })
}

function size(v: string | number): string {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 1000) return `${Number.isFinite(n) ? n : 0} bytes`
  if (n < 1_000_000) return `${Math.round(n / 1000)} KB`
  const mb = n / 1_000_000
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

/** Three names, and how many more. */
function few(names: string): string {
  const all = names.split(', ')
  return all.length <= 3 ? names : `${all.slice(0, 3).join(', ')} +${all.length - 3}`
}

/** What a file is, as its reader would say it: PDF, PNG, or its type. */
function sortOf(name: string, type: string | null): string {
  const ext = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]
  return ext ? ext.toUpperCase() : (type ?? 'File').slice(0, 60)
}

/**
 * One address's preview, in Slack's blocks. Every word in it is somebody's
 * and escaped, as in the messages; the one link is ours, to the address.
 */
export function previewOf(p: Preview): { blocks: unknown[] } {
  const base = publicUrl()
  const where = `${base}/${encodeURIComponent(p.workspace_slug)}/${encodeURIComponent(p.project_slug)}`
  const e = (s: string) => escape(flat(s))
  const title = p.title.slice(0, 300)
  let url = where
  let label = title
  const meta: string[] = []
  let words = p.said
  switch (p.kind) {
    case 'task': {
      url = `${where}/tasks/${p.number}`
      label = `${p.project_key}-${p.number} ${title}`
      const list = p.list_name ?? (p.done ? 'Done' : null)
      if (list) meta.push(p.done && p.list_icon !== 'stopped' ? `✓ ${list}` : list)
      if (p.people) meta.push(few(p.people))
      if (p.due_on) {
        const late =
          !p.done && new Date(`${String(p.due_on instanceof Date ? p.due_on.toISOString() : p.due_on).slice(0, 10)}T23:59:59Z`) < new Date()
        meta.push(`${late ? 'overdue, due' : 'due'} ${day(p.due_on)}`)
      }
      break
    }
    case 'post':
      url = `${where}/posts/${p.number}`
      if (p.people) meta.push(p.people)
      if (p.at) meta.push(day(p.at))
      break
    case 'file':
      url = `${where}/files/${p.number}`
      if (p.file_kind === 'upload') {
        meta.push(sortOf(p.title, p.content_type))
        if (p.size_bytes !== null) meta.push(size(p.size_bytes))
        words = null
      } else if (p.file_kind === 'link' && p.address) {
        meta.push(`Link to ${p.address.slice(0, 120)}`)
        words = null
      } else {
        meta.push('Doc')
      }
      if (p.people) meta.push(p.people)
      if (p.at) meta.push(`updated ${day(p.at)}`)
      break
    case 'project':
      break
  }
  const quote = words ? excerpt(words, 200) : ''
  /* Slack refuses a section past 3 000 characters, and with it every
     preview of the message; escaping can make a title five times longer. */
  const text = [`*<${url}|${e(label)}>*`, meta.length ? meta.map(e).join(' · ').slice(0, 600) : '', quote ? escape(quote) : '']
    .filter(Boolean)
    .join('\n')
    .slice(0, 2900)
  return {
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text, verbatim: true } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `Tuff · ${e(p.project_name)}`, verbatim: true }] },
    ],
  }
}

/** The previews for one message's addresses, keyed by each address as Slack sent it. */
export function unfurl(token: string, channel: string, ts: string, unfurls: Record<string, { blocks: unknown[] }>): Promise<Answer> {
  return slack('chat.unfurl', { channel, ts, unfurls: JSON.stringify(unfurls) }, token)
}
