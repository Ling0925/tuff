import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { keyFor, legacyKey, mac, same } from '../auth/keys.js'
import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import { withActor, withoutActor } from '../db.js'
import { allow, allowIn, type AuthContext } from '../auth/context.js'
import { openSecret, sealSecret } from '../github.js'
import { authorizeUrl, channelsOf, letGo, previewsGranted, previewsOn, signedBySlack, slackConfigured, tradeCode } from '../slack.js'
import { record } from './activity.js'
import { forbidden, missing } from './objects.js'

/**
 * Slack. Three doors:
 *
 * - `GET /auth/slack/callback`, where Slack sends the owner back with a
 *   code: on into the app, which is signed in and finishes it.
 * - `/api/slack…`, the workspace's connection and a project's channel.
 * - `POST /hooks/slack`, where Slack says a Tuff address was pasted.
 *   Believed only with its signature, and
 *   all it can do is queue a preview for the worker.
 */

type Vars = { ctx: AuthContext }

/* ------------------------------------------------------- the way back */

/*
 * What the owner is sent to Slack carrying, and brings back: which
 * workspace, who, where to return and until when, with a nonce — signed,
 * so a code somebody else obtained cannot be finished in this session.
 */
type State = { w: string; a: string; s: string; e: number; n: string }

function seal(state: State): string {
  const body = Buffer.from(JSON.stringify(state)).toString('base64url')
  return `${body}.${mac(keyFor('slack-state'), `slack:${body}`, 'base64url')}`
}

function unseal(sealed: string): State | null {
  const [body, sig, more] = sealed.split('.')
  if (!body || !sig || more !== undefined) return null
  let s: State
  try {
    s = JSON.parse(Buffer.from(body, 'base64url').toString()) as State
  } catch {
    return null
  }
  if (!(typeof s.e === 'number' && s.e > Date.now() && typeof s.s === 'string' && /^[a-z0-9-]+$/i.test(s.s))) return null
  /* Its own key — `auth/keys.ts`; or one sealed before the split, for the
     minutes a state lasts. */
  if (same(mac(keyFor('slack-state'), `slack:${body}`, 'base64url'), sig)) return s
  const old = legacyKey(s.e)
  return old && same(mac(old, `slack:${body}`, 'base64url'), sig) ? s : null
}

export const slackReturns = new Hono()

/* Not finished here: the code is carried into the app, which posts it with
   the session it is in, so a link started by somebody else connects
   nothing for whoever opens it. */
slackReturns.get('/auth/slack/callback', (c) => {
  const raw = c.req.query('state') ?? ''
  const state = unseal(raw)
  const code = c.req.query('code') ?? ''
  if (!state) return c.redirect('/', 302)
  if (!code) return c.redirect(`/${state.s}/settings`, 302)
  const q = new URLSearchParams({ slack: 'connected', code, state: raw })
  return c.redirect(`/${state.s}/settings?${q}`, 302)
})

/* ------------------------------------------------------------ the events */

export const slackHooks = new Hono()

type Event = {
  type?: unknown
  challenge?: unknown
  team_id?: unknown
  authorizations?: { team_id?: unknown }[]
  event?: { type?: unknown; channel?: unknown; message_ts?: unknown; user?: unknown; source?: unknown; links?: { url?: unknown }[] }
}

slackHooks.post('/hooks/slack', async (c) => {
  /* Unsigned is refused before the body is read. */
  if (!c.req.header('x-slack-signature') || !previewsOn()) return c.json({ error: { code: 'forbidden' } }, 403)
  const raw = await c.req.text()
  if (!signedBySlack(raw, c.req.header('x-slack-request-timestamp'), c.req.header('x-slack-signature'))) {
    return c.json({ error: { code: 'forbidden' } }, 403)
  }
  let p: Event
  try {
    p = JSON.parse(raw) as Event
  } catch {
    return c.json({ error: { code: 'invalid' } }, 400)
  }
  /* Slack asking, once, whether this address is ours. */
  if (p.type === 'url_verification' && typeof p.challenge === 'string') return c.json({ challenge: p.challenge.slice(0, 200) })
  /* A retry — the first answer was slow or failed — is queued like the
     first: the queue keeps a message once. */
  const e = p.event
  /* A message being written is not in a channel yet: Slack says so again
     once it is posted. */
  if (
    p.type === 'event_callback' &&
    e?.type === 'link_shared' &&
    e.source !== 'composer' &&
    typeof e.channel === 'string' &&
    typeof e.message_ts === 'string'
  ) {
    /* The Slack workspace whose installation this event is for — the one
       the signature vouches Slack sent it to — and not a field of the message. */
    const team = p.authorizations?.[0]?.team_id ?? p.team_id
    const urls = (Array.isArray(e.links) ? e.links : [])
      .map((l) => l?.url)
      .filter((u): u is string => typeof u === 'string')
      .slice(0, 5)
    if (typeof team === 'string' && urls.length) {
      await withoutActor(
        (tx) =>
          tx`select slack_unfurl_put(${team}, ${e.channel as string}, ${e.message_ts as string}, ${typeof e.user === 'string' ? e.user : null}, ${urls}::text[])`,
      )
    }
  }
  return c.body(null, 200)
})

/* ------------------------------------------------------------- the api */

export const slackApi = new Hono<{ Vars: Vars; Variables: Vars }>()

/** Connecting is the owner's, as the webhooks and GitHub are, and never a token's. */
const byHand = (ctx: AuthContext) => !ctx.viaMcp && !ctx.viaGithub && !ctx.viaImport
const owns = (ctx: AuthContext) => byHand(ctx) && allow(ctx, 'audit.read')

type Connection = { id: string; team_id: string; team_name: string; broken_at: string | null; broken: string | null; scopes: string }

async function connection(ctx: AuthContext): Promise<Connection | null> {
  const [row] = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      tx<Connection[]>`
      select id, team_id, team_name, broken_at, broken, scopes from slack_connection
      where workspace_id = ${ctx.workspaceId} and deleted_at is null`,
  )
  return row ?? null
}

async function token(ctx: AuthContext): Promise<string | null> {
  const [row] = await withActor(ctx.actorId, ctx.workspaceId, (tx) => tx<{ token_enc: string }[]>`select token_enc from slack_token()`)
  return openSecret(row?.token_enc ?? null)
}

slackApi.get('/slack', async (c) => {
  const ctx = c.get('ctx')
  const row = await connection(ctx)
  return c.json({
    configured: slackConfigured(),
    /* `previews`: whether this connection was granted what previews need,
       so one made before them is told to connect again. */
    connection: row
      ? { team_name: row.team_name, broken: Boolean(row.broken_at), previews: !previewsOn() || previewsGranted(row.scopes) }
      : null,
    can_connect: owns(ctx),
  })
})

/** Where the owner goes to add the app to their Slack, carrying who asked. */
slackApi.post('/slack/start', async (c) => {
  const ctx = c.get('ctx')
  if (!owns(ctx)) return c.json(forbidden, 403)
  if (!slackConfigured()) return c.json({ error: { code: 'unavailable', message: 'Slack isn’t set up on this server.' } }, 503)
  const [w] = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) => tx<{ slug: string }[]>`select slug from workspace where id = ${ctx.workspaceId}`,
  )
  if (!w) return c.json(missing, 404)
  const n = randomBytes(18).toString('base64url')
  await withActor(ctx.actorId, ctx.workspaceId, (tx) => tx`select slack_state_make(${n})`)
  const state = seal({ w: ctx.workspaceId, a: ctx.actorId, s: w.slug, e: Date.now() + 10 * 60_000, n })
  return c.json({ url: authorizeUrl(state) })
})

/** Finishing it, from the app, as the person and workspace the state was made for. */
slackApi.post('/slack', async (c) => {
  const ctx = c.get('ctx')
  if (!owns(ctx)) return c.json(forbidden, 403)
  if (!slackConfigured()) return c.json({ error: { code: 'unavailable', message: 'Slack isn’t set up on this server.' } }, 503)
  const body = z.object({ code: z.string().min(1).max(500), state: z.string().max(2000) }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const state = unseal(body.data.state)
  /* And spent: the first return finishes it, and a copy of the address
     finishes nothing after. */
  const spent =
    state && state.w === ctx.workspaceId && state.a === ctx.actorId && typeof state.n === 'string'
      ? (await withActor(ctx.actorId, ctx.workspaceId, (tx) => tx<{ ok: boolean }[]>`select slack_state_take(${state.n}) as ok`))[0]?.ok
      : false
  if (!spent) {
    return c.json({ error: { code: 'invalid', message: 'That link has run out. Connect Slack again.' } }, 400)
  }
  const got = await tradeCode(body.data.code).catch(() => null)
  if (!got) return c.json({ error: { code: 'invalid', message: 'Slack didn’t confirm it. Try again.' } }, 400)
  const { said, old } = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [r] = await tx<{ said: string; old_token: string | null }[]>`
      select * from slack_connect(${got.teamId}, ${got.teamName}, ${sealSecret(got.token)}, ${ctx.actorId}, ${got.scopes}, ${got.botUser})`
    if (r?.said === 'ok') await record(tx, ctx, 'slack.connect', { meta: { team: got.teamName } })
    return { said: r?.said ?? 'forbidden', old: r?.old_token ?? null }
  })
  /*
   * Not revoked: Slack gives an app one bot token a Slack workspace, so the
   * token in hand is the one the other Tuff workspace is posting with, and
   * revoking it here would switch that one off for whoever pressed this.
   */
  if (said === 'taken')
    return c.json({ error: { code: 'conflict', message: 'That Slack workspace is connected to another Tuff workspace.' } }, 409)
  if (said !== 'ok') return c.json(forbidden, 403)
  /* Moved to another Slack: the one left behind no longer has Tuff in it. */
  await letGo(openSecret(old))
  return c.json({ team_name: got.teamName }, 201)
})

/** Every project's channel goes with it, and the token is revoked at Slack. */
slackApi.delete('/slack', async (c) => {
  const ctx = c.get('ctx')
  if (!owns(ctx)) return c.json(forbidden, 403)
  const sealed = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [r] = await tx<{ t: string | null }[]>`select slack_disconnect() as t`
    if (r?.t) await record(tx, ctx, 'slack.disconnect')
    return r?.t ?? null
  })
  await letGo(openSecret(sealed))
  return c.body(null, 204)
})

/** Whether somebody may choose a project's channel: the owner, or whoever may change some project's tools. */
const choosesAny = (ctx: AuthContext) => byHand(ctx) && (owns(ctx) || Object.keys(ctx.rights).some((p) => allowIn(ctx, 'project.tools', p)))

/** The channels a project may choose, as Slack lists them for this workspace's token now. */
slackApi.get('/slack/channels', async (c) => {
  const ctx = c.get('ctx')
  if (!choosesAny(ctx)) return c.json(forbidden, 403)
  const t = await token(ctx)
  if (!t) return c.json({ channels: [] })
  const channels = await channelsOf(t).catch(() => null)
  if (!channels) return c.json({ error: { code: 'unavailable', message: 'Slack didn’t answer. Try again in a moment.' } }, 502)
  return c.json({ channels: visibleTo(ctx, channels) })
})

/* A private channel's name is for the owner, who connected the app it was
   added to: a project's admin may not be in that channel, or in Slack. */
const visibleTo = <T extends { private: boolean }>(ctx: AuthContext, all: T[]) => (owns(ctx) ? all : all.filter((ch) => !ch.private))

type LinkRow = {
  channel_id: string
  channel_name: string
  private: boolean
  linked_by_name: string
  stopped_at: string | null
  stopped: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

slackApi.get('/projects/:id/slack', async (c) => {
  const ctx = c.get('ctx')
  if (!UUID.test(c.req.param('id'))) return c.json(missing, 404)
  const [link] = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      tx<LinkRow[]>`
      select l.channel_id, l.channel_name, l.private, a.name as linked_by_name, l.stopped_at, l.stopped
      from slack_link l join actor a on a.id = l.linked_by
      where l.project_id = ${c.req.param('id')} and l.deleted_at is null`,
  )
  /* A private channel's name, as in the list, is the owner's. */
  if (link?.private && !owns(ctx)) link.channel_name = ''
  return c.json({ link: link ?? null })
})

/**
 * A channel for this project, by whoever may change its tools. The id is
 * a request, and the list Slack gives for this workspace's token is the
 * fact: a channel of another Slack, or one the app cannot post in, is not
 * in it.
 */
slackApi.put('/projects/:id/slack', async (c) => {
  const ctx = c.get('ctx')
  const projectId = c.req.param('id')
  if (!UUID.test(projectId)) return c.json(missing, 404)
  if (!byHand(ctx) || !allowIn(ctx, 'project.tools', projectId)) return c.json(forbidden, 403)
  const body = z.object({ channel_id: z.string().regex(/^[CG][A-Z0-9]{2,30}$/) }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const row = await connection(ctx)
  if (!row) return c.json({ error: { code: 'invalid', message: 'Connect Slack in the workspace’s settings first.' } }, 400)
  if (row.broken_at)
    return c.json({ error: { code: 'invalid', message: 'Slack stopped accepting Tuff. The owner connects it again in Settings.' } }, 400)
  const t = await token(ctx)
  const channels = t ? await channelsOf(t).catch(() => null) : null
  if (!channels) return c.json({ error: { code: 'unavailable', message: 'Slack didn’t answer. Try again in a moment.' } }, 502)
  const channel = visibleTo(ctx, channels).find((ch) => ch.id === body.data.channel_id)
  if (!channel)
    return c.json({ error: { code: 'invalid', message: 'Tuff can’t post in that channel. In a private channel, add the app first.' } }, 400)
  const done = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [p] = await tx`select 1 from project where id = ${projectId} and deleted_at is null`
    if (!p) return false
    await tx`update slack_link set deleted_at = now() where project_id = ${projectId} and deleted_at is null`
    await tx`
      insert into slack_link (id, workspace_id, project_id, connection_id, channel_id, channel_name, private, linked_by)
      values (${uuidv7()}, ${ctx.workspaceId}, ${projectId}, ${row.id}, ${channel.id}, ${channel.name}, ${channel.private}, ${ctx.actorId})`
    /* The feed, and every webhook, names a public channel only. */
    await record(tx, ctx, 'project.slack', {
      projectId,
      objectType: 'project',
      objectId: projectId,
      meta: channel.private ? {} : { channel: channel.name },
    })
    return true
  })
  if (!done) return c.json(missing, 404)
  return c.json({ channel_name: channel.name })
})

slackApi.delete('/projects/:id/slack', async (c) => {
  const ctx = c.get('ctx')
  const projectId = c.req.param('id')
  if (!UUID.test(projectId)) return c.json(missing, 404)
  if (!byHand(ctx) || !allowIn(ctx, 'project.tools', projectId)) return c.json(forbidden, 403)
  await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const gone = await tx`update slack_link set deleted_at = now() where project_id = ${projectId} and deleted_at is null returning 1`
    if (gone.length) await record(tx, ctx, 'project.slack.stop', { projectId, objectType: 'project', objectId: projectId })
  })
  return c.body(null, 204)
})
