import { outward, publicHttps } from '../outbound.js'
import { Hono } from 'hono'
import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import { withActor, type Tx } from '../db.js'
import { allow, type AuthContext } from '../auth/context.js'
import { generateToken } from '../auth/crypto.js'
import { AuthorizationValue, deliverDue } from '../webhooks.js'
import { seal } from '../auth/seal.js'
import { forbidden, missing } from './objects.js'
import { record } from './activity.js'
import { spendOn } from './limits.js'
import { WEBHOOK_EVENTS, WebhookEvent } from '@tracker/shared-schema'

type Vars = { ctx: AuthContext }
export const webhooks = new Hono<{ Variables: Vars }>()

/** Managing where events go is an admin thing, and never a token's. */
function guard(ctx: AuthContext): boolean {
  return !ctx.viaMcp && allow(ctx, 'audit.read')
}

webhooks.get('/webhooks', async (c) => {
  const ctx = c.get('ctx')
  if (!guard(ctx)) return c.json(forbidden, 403)
  const rows = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      // The secret is not in this list and could not be: the column grant was
      // revoked, so the database refuses it.
      tx`select id, url, events, enabled, authorization_set, last_status, last_at, created_at
       from webhook where deleted_at is null and agent_id is null order by created_at desc`,
  )
  return c.json({ webhooks: rows })
})

/* Which events, from the documented list; none is every event. */
const Events = z.array(WebhookEvent).max(WEBHOOK_EVENTS.length)

webhooks.post('/webhooks', async (c) => {
  const ctx = c.get('ctx')
  if (!guard(ctx)) return c.json(forbidden, 403)
  const raw = await c.req.json().catch(() => ({}))
  const keyed = keyOf(raw)
  if (keyed === 'invalid') return c.json(badKey, 400)
  if (keyed !== undefined && !ctx.sessionId) return c.json(forbidden, 403)
  const body = z.object({ url: z.url(), events: Events.default([]) }).safeParse(raw)
  if (!body.success) return c.json({ error: { code: 'invalid', message: 'Choose events from the list.' } }, 400)
  /* https, to an address on the public internet — never this server, its
     database or anything on the private network. Asked again at every
     delivery. `outbound.ts`. */
  if (!(await publicHttps(body.data.url))) {
    return c.json({ error: { code: 'invalid', message: 'Webhooks need a public https URL.' } }, 400)
  }

  const id = uuidv7()
  const secret = generateToken('whs')
  try {
    await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
      await tx`
        insert into webhook (id, workspace_id, url, events, secret_enc, authorization_enc, created_by)
        values (${id}, ${ctx.workspaceId}, ${body.data.url}, ${[...new Set(body.data.events)]},
                ${secret}, ${keyed ? seal('webhook', keyed) : null}, ${ctx.actorId})`
      /* In the audit log by its host alone: the rest of an address can carry
         a key of its own. Whether it holds the
         receiver's key, never the key. */
      await record(tx, ctx, 'webhook.create', {
        meta: { id, host: new URL(body.data.url).host, ...(keyed ? { authorization: 'set' } : {}) },
      })
    })
  } catch (e) {
    /* Twenty of the workspace's own, on or off — each is a copy of every
       event the queue sends (migration 294). */
    if ((e as { constraint_name?: string }).constraint_name === 'webhook_too_many') {
      return c.json(
        {
          error: {
            code: 'too_many_webhooks',
            /* Its number written out, as its French is (`words.ts`). */
            message: 'A workspace can have up to 20 webhooks. Delete one you no longer use first.',
          },
        },
        409,
      )
    }
    throw e
  }
  // Shown once. The receiver needs it to verify, and we need it to sign; after
  // this it is only in the row nobody may select.
  return c.json({ id, secret }, 201)
})

export const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    // A row older than the check on its address says only that one went.
    return ''
  }
}

/**
 * Turning one off and on, and which events it is sent.
 * Off, nothing is queued for it and it keeps its
 * address, its secret and its events, so on again is the same webhook.
 */
webhooks.patch('/webhooks/:id', async (c) => {
  const ctx = c.get('ctx')
  if (!guard(ctx)) return c.json(forbidden, 403)
  const id = c.req.param('id')
  if (!z.uuid().safeParse(id).success) return c.json(missing, 404)
  const raw = await c.req.json().catch(() => ({}))
  const keyed = keyOf(raw)
  if (keyed === 'invalid') return c.json(badKey, 400)
  /* The receiver's key from a signed-in session alone, as connecting an
     agent is: a token that could set it could send the workspace's events
     anywhere it liked with a key of its choosing. */
  if (keyed !== undefined && !ctx.sessionId) return c.json(forbidden, 403)
  const body = z.object({ enabled: z.boolean().optional(), events: Events.optional() }).safeParse(raw)
  if (!body.success) return c.json({ error: { code: 'invalid', message: 'Choose events from the list.' } }, 400)
  const { enabled, events } = body.data
  const done = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [was] = await tx<{ authorization_set: boolean }[]>`
      select authorization_set from webhook where id = ${id} and deleted_at is null and agent_id is null for update`
    if (!was) return false
    const rows = await tx<{ id: string; url: string; enabled: boolean; events: string[] }[]>`
      update webhook set
        enabled = ${enabled === undefined ? tx`enabled` : enabled},
        events = ${events === undefined ? tx`events` : tx`${[...new Set(events)]}::text[]`}
        ${keyed === undefined ? tx`` : tx`, authorization_enc = ${keyed === null ? null : seal('webhook', keyed)}`}
      where id = ${id} and deleted_at is null and agent_id is null returning id, url, enabled, events`
    if (rows[0]) await said(tx, ctx, rows[0], keyChange(was.authorization_set, keyed))
    return rows.length > 0
  })
  return done ? c.json({ ok: true }) : c.json(missing, 404)
})

/* In the audit log, by its host alone, as making and deleting one are:
   turned off is a workspace's work no longer reaching where it went
   (migration 265). */
const said = (
  tx: Tx,
  ctx: AuthContext,
  h: { id: string; url: string; enabled: boolean; events: string[] },
  authorization?: 'set' | 'changed' | 'removed' | null,
) =>
  record(tx, ctx, 'webhook.update', {
    meta: { id: h.id, host: hostOf(h.url), enabled: h.enabled, events: h.events, ...(authorization ? { authorization } : {}) },
  })

/**
 * The receiver's own key in a body. Absent is
 * left as it is, null takes it off, a string sets it; anything else that
 * is not one header value is `invalid`.
 */
export function keyOf(raw: unknown): string | null | undefined | 'invalid' {
  if (!raw || typeof raw !== 'object' || !('authorization' in raw)) return undefined
  const v = (raw as { authorization: unknown }).authorization
  if (v === undefined) return undefined
  if (v === null) return null
  const parsed = AuthorizationValue.safeParse(v)
  return parsed.success ? parsed.data : 'invalid'
}
export const badKey = {
  error: { code: 'invalid', message: 'The Authorization header must be one line of plain text, up to 1 KB.' },
} as const

/** What the audit line says happened to the key, never the key. */
export function keyChange(had: boolean, keyed: string | null | undefined): 'set' | 'changed' | 'removed' | null {
  if (keyed === undefined) return null
  if (keyed === null) return had ? 'removed' : null
  return had ? 'changed' : 'set'
}

/** Off, as `PATCH` with `enabled: false` — kept for the clients that call it. It deleted the webhook, and no longer does. */
webhooks.post('/webhooks/:id/disable', async (c) => {
  const ctx = c.get('ctx')
  if (!guard(ctx)) return c.json(forbidden, 403)
  const id = c.req.param('id')
  if (!z.uuid().safeParse(id).success) return c.json(missing, 404)
  const done = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const rows = await tx<{ id: string; url: string; enabled: boolean; events: string[] }[]>`
      update webhook set enabled = false
      where id = ${id} and deleted_at is null and agent_id is null returning id, url, enabled, events`
    if (rows[0]) await said(tx, ctx, rows[0])
    return rows.length > 0
  })
  return done ? c.json({ ok: true }) : c.json(missing, 404)
})

/**
 * Deleting one — after the screen asks. Soft, as everything is; what is
 * still queued for it is never sent (`due_webhook_deliveries` reads live
 * webhooks only), and its secret goes with the row.
 */
webhooks.delete('/webhooks/:id', async (c) => {
  const ctx = c.get('ctx')
  if (!guard(ctx)) return c.json(forbidden, 403)
  const id = c.req.param('id')
  if (!z.uuid().safeParse(id).success) return c.json(missing, 404)
  const done = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const rows = await tx<{ id: string; url: string }[]>`
      update webhook set enabled = false, deleted_at = now()
      where id = ${id} and deleted_at is null and agent_id is null returning id, url`
    if (rows[0]) await record(tx, ctx, 'webhook.remove', { meta: { id: rows[0].id, host: hostOf(rows[0].url) } })
    return rows.length > 0
  })
  return done ? c.json({ ok: true }) : c.json(missing, 404)
})

/**
 * A test sent to it. Queued as any
 * event is, signed and retried the same way, so what the receiver checks
 * is what every delivery carries; its answer lands in `last_status` as
 * every delivery's does. Ten an hour a webhook.
 */
webhooks.post('/webhooks/:id/test', async (c) => {
  const ctx = c.get('ctx')
  if (!guard(ctx)) return c.json(forbidden, 403)
  const id = c.req.param('id')
  if (!z.uuid().safeParse(id).success) return c.json(missing, 404)
  const queued = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [hook] = await tx<{ enabled: boolean }[]>`
      select enabled from webhook where id = ${id} and deleted_at is null and agent_id is null`
    if (!hook) return 'missing' as const
    if (!hook.enabled) return 'off' as const
    /* Ten an hour a webhook, thirty a workspace: each is a request from
       our address to one somebody typed. */
    if (!(await spendOn(`webhook-test:${id}`, 10, 3600))) return 'limited' as const
    if (!(await spendOn(`webhook-test-ws:${ctx.workspaceId}`, 30, 3600))) return 'limited' as const
    const delivery = uuidv7()
    await tx`
      insert into webhook_delivery (id, workspace_id, webhook_id, event, payload)
      values (${delivery}, ${ctx.workspaceId}, ${id}, 'webhook.test',
              ${tx.json({ webhook_id: id, workspace_id: ctx.workspaceId, sent_by: ctx.actorId } as never)})`
    return delivery
  })
  if (queued === 'missing') return c.json(missing, 404)
  if (queued === 'off') return c.json({ error: { code: 'off', message: 'Turn the webhook on to send a test.' } }, 409)
  if (queued === 'limited') return c.json({ error: { code: 'rate_limited', message: 'Too many tests. Try again later.' } }, 429)
  return c.json({ delivery_id: queued }, 202)
})

/** One pass of the queue. What a timer calls; safe to call twice. */
webhooks.post('/webhooks/deliver', async (c) => {
  const ctx = c.get('ctx')
  if (!guard(ctx)) return c.json(forbidden, 403)
  return c.json({ delivered: await deliverDue(50, outward, ctx.workspaceId) })
})
