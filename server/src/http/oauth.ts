import { Hono, type Context } from 'hono'
import { createHash } from 'node:crypto'
import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'
import { origin } from '../publicUrl.js'
import { withActor, withoutActor } from '../db.js'
import { generateToken, hashToken } from '../auth/crypto.js'
import { issueApiToken } from '../auth/flows.js'
import { allow, contextOf, type AuthContext } from '../auth/context.js'
import { agentsHeld } from '../ceilings.js'
import { faced } from '../storage.js'
import { mayManage } from './agents.js'
import { clientOf, onThisMachine, spendOn } from './limits.js'

/**
 * Signing an agent in from somewhere else.
 *
 * OAuth 2.1 with PKCE, and only what an MCP client uses: it finds the
 * server's metadata, registers itself, sends the person to the page that
 * asks them, and trades the code it gets back for a token. The token is an
 * ordinary `tok_…`, so everything a connected tool may not do, this one may
 * not do either.
 */
export const oauth = new Hono()
/** The two questions the page in the app asks, as the person signed in. */
export const oauthApi = new Hono<{ Variables: { ctx: AuthContext } }>()

/* A week, renewed by a refresh token that lasts ninety days from its last
   use — `oauth_token_bind`. */
const ACCESS_DAYS = 7
const SCOPE = 'tuff'

/* The address the world reaches this server at, which is what the metadata
   names: the one function every link reads — `APP_URL` in production, never
   the request (`publicUrl.ts`). This copy trusted any `X-Forwarded-Proto`. */
export { origin }

/* --------------------------------------------------------------- metadata */

/* What `/mcp` is and who signs people in to it (RFC 9728). Asked at the
   bare address and with the resource's path after it, as clients do both. */
const resource = (c: Context) =>
  c.json({
    resource: `${origin(c)}/mcp`,
    authorization_servers: [origin(c)],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Tuff',
  })
oauth.get('/.well-known/oauth-protected-resource', resource)
oauth.get('/.well-known/oauth-protected-resource/mcp', resource)

/* The three doors (RFC 8414), and what each accepts. */
const server = (c: Context) =>
  c.json({
    issuer: origin(c),
    authorization_endpoint: `${origin(c)}/oauth/authorize`,
    token_endpoint: `${origin(c)}/oauth/token`,
    registration_endpoint: `${origin(c)}/oauth/register`,
    scopes_supported: [SCOPE],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  })
oauth.get('/.well-known/oauth-authorization-server', server)
oauth.get('/.well-known/oauth-authorization-server/mcp', server)

/* ----------------------------------------------------------- registration */

/*
 * Where a code may be sent: somewhere on the web over TLS, or back to the
 * person's own machine. Anything else — a page in plain HTTP, a custom
 * scheme, an address with a fragment — is a place a code could be read by
 * somebody who is not the client.
 */
function sendable(uri: string): boolean {
  if (uri.length > 2000) return false
  try {
    const u = new URL(uri)
    if (u.hash) return false
    if (u.protocol === 'https:') return true
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  } catch {
    return false
  }
}

/**
 * A client says who it is and where it may be sent back to (RFC 7591).
 *
 * Public clients only: a secret shipped inside something anybody can run is
 * not one, and PKCE is what proves the code is traded by whoever asked for
 * it. So whatever authentication the client asks for, it is registered as
 * `none`, and the answer says so.
 */
/**
 * The network an address stands for, as a limit keys it: an IPv4 address
 * itself, and an IPv6 address's /64 — the block one line, one house or one
 * server is handed whole, so every address in it is one sender. Keyed by
 * the whole address, a /64 was 2⁶⁴ allowances (the night audit, 13). Anything it cannot read is keyed as it came.
 */
export function networkOf(address: string): string {
  const a = (
    address
      .trim()
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .split('%')[0] ?? ''
  ).trim()
  if (!a.includes(':')) return a
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a)
  if (mapped) return mapped[1]!
  const halves = a.split('::')
  if (halves.length > 2) return a
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const groups = halves.length === 2 ? [...head, ...new Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail] : head
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return a
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`
}

oauth.post('/oauth/register', async (c) => {
  /* Not on this machine, as signing up is not: every run of the suites
     would otherwise share one hour's thirty. By the network, not the
     address: an IPv6 sender holds a /64 of them. */
  const from = clientOf(c)
  if (!onThisMachine(from) && !(await spendOn(`oauth:register:${networkOf(from)}`, 30, 3600))) {
    return c.json({ error: 'slow_down', error_description: 'Too many registrations. Try again later.' }, 429)
  }
  const body = z
    .object({
      client_name: z.string().trim().min(1).max(100).optional(),
      redirect_uris: z.array(z.string()).min(1).max(10),
    })
    .safeParse(await c.req.json().catch(() => null))
  if (!body.success) {
    return c.json({ error: 'invalid_client_metadata', error_description: 'redirect_uris is required.' }, 400)
  }
  const uris = body.data.redirect_uris
  if (!uris.every(sendable)) {
    return c.json({ error: 'invalid_redirect_uri', error_description: 'Each address must be https, or http on localhost.' }, 400)
  }
  const id = uuidv7()
  const name = body.data.client_name ?? 'An agent'
  await withoutActor((tx) => tx`select oauth_client_register(${id}, ${name}, ${uris})`)
  return c.json(
    {
      client_id: id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    201,
  )
})

async function clientNamed(id: string): Promise<{ name: string; redirect_uris: string[] } | null> {
  if (!z.uuid().safeParse(id).success) return null
  const [row] = await withoutActor((tx) => tx<{ name: string; redirect_uris: string[] }[]>`select * from oauth_client_read(${id})`)
  return row ?? null
}

/* ------------------------------------------------------ the page that asks */

/*
 * Only a person at the screen may connect something: a token cannot hand
 * itself onward, and the permission to make tokens is the permission to
 * connect an agent, since that is what connecting makes.
 */
function refused(ctx: AuthContext): { code: string; message: string } | null {
  if (ctx.viaMcp || !ctx.sessionId) return { code: 'forbidden', message: 'Only you can connect an agent, signed in here.' }
  /* Held back by the edition — a plan's, on the service — said as it says it. */
  const held = agentsHeld(ctx)
  if (held) return held.error
  if (!allow(ctx, 'token.issue.own')) return { code: 'forbidden', message: 'You don’t have permission to connect agents.' }
  return null
}

/**
 * The agents this person may sign a connection in as — those they manage
 * (`agent.manage`: whoever connected it, not the owner), asked of `can()`
 * one by one.
 */
async function managed(ctx: AuthContext): Promise<{ id: string; name: string; avatar_url: string | null }[]> {
  const rows = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) => tx<{ id: string; name: string; avatar_key: string | null; created_by: string }[]>`
      select g.actor_id as id, a.name, a.avatar_key, g.created_by
      from agent g join actor a on a.id = g.actor_id
      where g.workspace_id = ${ctx.workspaceId} and g.deleted_at is null
      order by a.name`,
  )
  return rows
    .filter((r) => allow(ctx, 'agent.manage', { connectedIt: r.created_by === ctx.actorId }))
    .map(({ created_by: _, ...r }) => faced(r))
}

/**
 * Who is asking, as it named itself — and whether it may be sent where it
 * asked; with the agents the person may sign it in as instead of themselves.
 */
oauthApi.get('/oauth/client', async (c) => {
  const ctx = c.get('ctx')
  const no = refused(ctx)
  if (no) return c.json({ error: no }, 403)
  const client = await clientNamed(c.req.query('client_id') ?? '')
  if (!client || !client.redirect_uris.includes(c.req.query('redirect_uri') ?? '')) {
    return c.json({ error: { code: 'invalid', message: 'This connection link isn’t valid.' } }, 400)
  }
  return c.json({ name: client.name, agents: await managed(ctx) })
})

/** Allowed: a one-time code for ten minutes, and where to send the browser with it. */
oauthApi.post('/oauth/authorize', async (c) => {
  const ctx = c.get('ctx')
  const no = refused(ctx)
  if (no) return c.json({ error: no }, 403)
  const body = z
    .object({
      client_id: z.string(),
      redirect_uri: z.string(),
      code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
      code_challenge_method: z.literal('S256'),
      state: z.string().max(2000).optional(),
      /* Whom the token is for: the person (absent or null), or an agent
         they manage — chosen on the page and sent only by its Allow. A
         `login_hint` in the address may preselect one there; it is never
         read here. */
      agent_id: z.uuid().nullable().optional(),
    })
    .safeParse(await c.req.json().catch(() => null))
  if (!body.success) {
    return c.json({ error: { code: 'invalid', message: 'This connection link isn’t valid.' } }, 400)
  }
  const d = body.data
  const client = await clientNamed(d.client_id)
  if (!client || !client.redirect_uris.includes(d.redirect_uri)) {
    return c.json({ error: { code: 'invalid', message: 'This connection link isn’t valid.' } }, 400)
  }
  const agentId = d.agent_id ?? null
  if (agentId) {
    /* `can()` first, and again on the rows by `oauth_code_make`. */
    const may = await mayManage(ctx, agentId)
    if (may !== 'yes') return c.json({ error: { code: 'forbidden', message: 'You don’t manage this agent.' } }, 403)
  }
  const code = generateToken('code')
  const [made] = await withoutActor(
    (tx) => tx<{ ok: boolean }[]>`
      select oauth_code_make(${hashToken(code)}, ${ctx.workspaceId}, ${d.client_id},
                             ${ctx.actorId}, ${d.redirect_uri}, ${d.code_challenge}, ${agentId}) as ok`,
  )
  if (!made?.ok) return c.json({ error: { code: 'forbidden' } }, 403)
  if (agentId) {
    /* Who linked which client to which agent — never a code or a token. */
    await withoutActor(
      (tx) => tx`
        insert into security_event (id, workspace_id, actor_id, kind, meta)
        values (${uuidv7()}, ${ctx.workspaceId}, ${ctx.actorId}, 'agent_linked',
                ${tx.json({ actor_id: agentId, agent_id: agentId, client_id: d.client_id, client: client.name } as never)})`,
    )
  }
  const back = new URL(d.redirect_uri)
  back.searchParams.set('code', code)
  if (d.state !== undefined) back.searchParams.set('state', d.state)
  back.searchParams.set('iss', origin(c))
  return c.json({ redirect: back.toString() })
})

/* ------------------------------------------------------------- the trade */

const grantError = (c: Context, error: string, description: string, status: 400 | 401 = 400) => {
  c.header('cache-control', 'no-store')
  return c.json({ error, error_description: description }, status)
}

/** Whether the verifier is the one the challenge was made from (RFC 7636, S256). */
function answers(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false
  return createHash('sha256').update(verifier).digest('base64url') === challenge
}

/* A token and the refresh token that renews it, issued as one. */
/* `grant` ties every pair one connection makes, so a refresh spent twice
   ends them all — migration 152. */
async function pair(actorId: string, workspaceId: string, clientId: string, name: string, grant: string, linkedBy: string | null) {
  /* Not for somebody no longer in the workspace: a code taken or a refresh
     spent after they were removed minted them a fresh token every time —
     `docs/specs/removing-someone.md`. */
  const [alive] = await withoutActor((tx) => tx<{ ok: boolean }[]>`select member_alive(${actorId}, ${workspaceId}) as ok`)
  if (!alive?.ok) return null
  /* An agent's: whoever linked it still manages it, asked of `can()` as
     they stand now — not as they stood when they pressed Allow. */
  if (linkedBy && !(await stillManages(linkedBy, actorId, workspaceId))) return null
  const access = await issueApiToken(actorId, workspaceId, name, [], ACCESS_DAYS)
  const refresh = generateToken('ref')
  await withoutActor((tx) => tx`select oauth_token_bind(${hashToken(access)}, ${clientId}, ${hashToken(refresh)}, ${grant})`)
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: ACCESS_DAYS * 86400,
    refresh_token: refresh,
    scope: SCOPE,
  }
}

/** Whether this person, as they stand now in the workspace, may manage this live agent — `can()`. */
async function stillManages(person: string, agent: string, workspaceId: string): Promise<boolean> {
  const ctx = await contextOf(person, workspaceId)
  return ctx !== null && !ctx.agent && (await mayManage(ctx, agent)) === 'yes'
}

/**
 * A code and its verifier for a token, or a refresh token for a new pair.
 *
 * Form-encoded, as the standard has it; JSON is read too, because some
 * clients send it and refusing them would be pedantry at a door that is
 * already checked three ways.
 */
oauth.post('/oauth/token', async (c) => {
  /* A ceiling per address after all, generous enough for every ChatGPT user
     arriving from the same few of OpenAI's: without one the door was a
     query and two writes for anybody, as often as they liked. */
  const from = clientOf(c)
  if (!onThisMachine(from) && !(await spendOn(`oauth:token:${from}`, 1200, 60))) {
    return c.json({ error: 'slow_down', error_description: 'Too many requests. Try again in a minute.' }, 429)
  }
  const type = c.req.header('content-type') ?? ''
  const raw = type.includes('application/json')
    ? ((await c.req.json().catch(() => ({}))) as Record<string, unknown>)
    : ((await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>)
  const p = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : '')
  const clientId = p('client_id')
  const client = await clientNamed(clientId)
  if (!client) return grantError(c, 'invalid_client', 'Unknown client.', 401)

  c.header('cache-control', 'no-store')
  if (p('grant_type') === 'authorization_code') {
    const [code] = await withoutActor(
      (tx) =>
        tx<
          {
            workspace_id: string
            client_id: string
            actor_id: string
            redirect_uri: string
            challenge: string
            agent_id: string | null
          }[]
        >`select * from oauth_code_take(${hashToken(p('code'))})`,
    )
    if (!code || code.client_id !== clientId || code.redirect_uri !== p('redirect_uri') || !answers(p('code_verifier'), code.challenge)) {
      return grantError(c, 'invalid_grant', 'The code is spent, expired, or not for this client.')
    }
    const grant = uuidv7()
    /* For an agent: its token, its rights, its places — `actor_id` the
       agent; who pressed Allow is remembered beside the connection. */
    const as = code.agent_id ?? code.actor_id
    const linkedBy = code.agent_id ? code.actor_id : null
    /* The link first: a token of an agent's with no link beside it is
       refused at its refresh, so a crash between the two ends nothing
       worse than this one connection. */
    if (code.agent_id) {
      await withoutActor(
        (tx) => tx`select oauth_agent_link(${grant}, ${code.workspace_id}, ${code.agent_id}, ${clientId}, ${code.actor_id})`,
      )
    }
    const made = await pair(as, code.workspace_id, clientId, client.name, grant, linkedBy)
    return made ? c.json(made) : grantError(c, 'invalid_grant', 'You are no longer in this workspace.')
  }

  if (p('grant_type') === 'refresh_token') {
    const [was] = await withoutActor(
      (tx) => tx<{ actor_id: string; workspace_id: string; name: string; grant_id: string }[]>`
        select * from oauth_refresh_take(${hashToken(p('refresh_token'))}, ${clientId})`,
    )
    /* A refresh already spent ends the whole connection on the way to this
       answer: whoever presented it second is either the thief or the one
       robbed, and either way the chain is not to be trusted. */
    if (!was) return grantError(c, 'invalid_grant', 'The refresh token is spent, revoked or expired.')
    /* An agent's connection stays the agent's, and is asked again. */
    const [link] = await withoutActor(
      (tx) => tx<{ agent_id: string | null; linked_by: string | null; actor_is_agent: boolean }[]>`
        select * from oauth_agent_linked_by(${was.grant_id}, ${was.actor_id})`,
    )
    /* An agent's token renews only through its link, and only as that agent. */
    const linked = link?.agent_id ? link : null
    if ((link?.actor_is_agent && !linked) || (linked && linked.agent_id !== was.actor_id)) {
      return grantError(c, 'invalid_grant', 'The refresh token is spent, revoked or expired.')
    }
    const made = await pair(was.actor_id, was.workspace_id, clientId, was.name, was.grant_id, linked?.linked_by ?? null)
    return made ? c.json(made) : grantError(c, 'invalid_grant', 'You are no longer in this workspace.')
  }

  return grantError(c, 'unsupported_grant_type', 'Only authorization_code and refresh_token.')
})
