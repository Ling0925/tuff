import { pushService } from '../outbound.js'
import { Hono } from 'hono'
import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import { withActor } from '../db.js'
import { type AuthContext } from '../auth/context.js'
import { env } from '../env.js'
import { reachable, sendTo, webPushConfigured, type DeviceKind } from '../push.js'
import { apnsConfigured, apnsEndpoint, askPhone, phones } from '../apns.js'
import { askAndroid, fcmConfigured } from '../fcm.js'
import { heard, languageFor, say } from '../words.js'

type Vars = { ctx: AuthContext }
export const push = new Hono<{ Variables: Vars }>()

/**
 * A device saying it will take notifications for this person.
 *
 * Per workspace, like everything else: somebody in two workspaces subscribes
 * in each, and a notification from one never reaches a device through the
 * other's row.
 */
const Sub = z.object({
  /* A browser's push service and nothing else — the worker posts to this,
     and any address at all was a way to make the server call inside its own
     network. `outbound.ts`. */
  endpoint: z.url().refine(pushService, 'Not a push service'),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  /** What said it, so a person can recognise their own machine in a list. */
  said: z.string().max(200).nullish(),
})

/**
 * One of the Apple apps saying the same.
 * A token and which of Apple's services gave it; the address the
 * worker posts to is built from them here, never sent.
 */
const Phone = z.object({
  apns: z.object({ token: z.string().regex(/^[0-9a-fA-F]{64,200}$/), sandbox: z.boolean() }),
  said: z.string().max(200).nullish(),
})

/**
 * The Android app saying the same.
 * The registration token FCM gave it; the worker posts to FCM's one
 * address with it, so nothing here is an address the server would call.
 */
const Android = z.object({
  fcm: z.object({ token: z.string().regex(/^[A-Za-z0-9_:\-]{20,4096}$/) }),
  said: z.string().max(200).nullish(),
})

/** The row a registration writes, from any kind of body. */
type Device = { kind: DeviceKind; endpoint: string; p256dh: string | null; auth: string | null; said: string | null }

function aBrowser(raw: unknown): Device | null {
  const b = Sub.safeParse(raw)
  if (!b.success) return null
  return { kind: 'web', endpoint: b.data.endpoint, p256dh: b.data.keys.p256dh, auth: b.data.keys.auth, said: b.data.said ?? null }
}

function aPhone(raw: unknown): Device | null {
  const p = Phone.safeParse(raw)
  if (!p.success) return null
  return {
    kind: 'apns',
    endpoint: apnsEndpoint(p.data.apns.token, p.data.apns.sandbox),
    p256dh: null,
    auth: null,
    said: p.data.said ?? null,
  }
}

function anAndroid(raw: unknown): Device | null {
  const p = Android.safeParse(raw)
  if (!p.success) return null
  return { kind: 'fcm', endpoint: p.data.fcm.token, p256dh: null, auth: null, said: p.data.said ?? null }
}

/**
 * The public key, and whether this browser is already on the list.
 *
 * Both in one answer because the switch needs both to draw itself, and two
 * requests for one switch is the second spinner this product keeps removing.
 */
push.get('/push', async (c) => {
  const ctx = c.get('ctx')
  const rows = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      tx<{ id: string; kind: DeviceKind; said: string | null; created_at: string; last_used_at: string | null }[]>`
      select id, kind, said, created_at, last_used_at from push_subscription
      where workspace_id = ${ctx.workspaceId} and actor_id = ${ctx.actorId}
        and deleted_at is null
      order by created_at`,
  )
  return c.json({
    // Empty means the deployment has no keys, which the switch says out loud
    // rather than failing when somebody presses it.
    key: webPushConfigured() ? env.vapidPublicKey : null,
    // Whether the Apple apps can be, which their switch says the same way.
    apns: apnsConfigured(),
    // And the Android app.
    fcm: fcmConfigured(),
    devices: rows,
  })
})

push.post('/push', async (c) => {
  const ctx = c.get('ctx')
  /* A device is a browser or an app somebody signed in on. Through a token
     it was a way to go on hearing who wrote to them after the token was
     revoked: nothing revoking it touches this row. */
  if (ctx.viaMcp) return c.json({ error: { code: 'forbidden', message: 'Connected tools can’t turn on notifications.' } }, 403)
  const raw: unknown = await c.req.json().catch(() => ({}))
  const kind: DeviceKind = typeof raw === 'object' && raw !== null ? ('apns' in raw ? 'apns' : 'fcm' in raw ? 'fcm' : 'web') : 'web'
  if (!reachable(kind)) return c.json({ error: { code: 'unavailable' } }, 503)
  const device = kind === 'apns' ? aPhone(raw) : kind === 'fcm' ? anAndroid(raw) : aBrowser(raw)
  if (!device) return c.json({ error: { code: 'invalid' } }, 400)

  const id = uuidv7()
  const made = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    /* A phone follows the session it registered from, and goes when that
       device is signed in nowhere (migrations 139, 186, 187). Both apps say
       which device they are on every request; one that did not would leave
       a row nothing ever takes away, written to after its session is gone. */
    if (device.kind !== 'web') {
      const [s] = await tx<{ device: string | null }[]>`select auth_session_device(${ctx.sessionId ?? null}::uuid) as device`
      if (!s?.device) return 'no_device' as const
    }
    /*
     * The endpoint is the identity of the device, so resubscribing replaces
     * the row rather than growing a second one — a browser that has
     * re-granted permission would otherwise be told everything twice, and
     * nothing in the product would say why.
     *
     * Whoever's row it was: through a definer function, because row-level
     * security showed this only the person's own, and somebody signing in
     * where somebody else had registered was refused by the unique index
     * for as long as the other's row stood.
     *
     * Raised by hand rather than with `on conflict`: the unique index is
     * partial, over the rows that are not deleted, and a partial index is not
     * an arbiter.
     */
    await tx`select push_claim(${device.endpoint})`
    await tx`
      insert into push_subscription
        (id, workspace_id, actor_id, kind, endpoint, p256dh, auth, said, device)
      values (${id}, ${ctx.workspaceId}, ${ctx.actorId}, ${device.kind}, ${device.endpoint},
              ${device.p256dh}, ${device.auth}, ${device.said},
              auth_session_device(${ctx.sessionId ?? null}::uuid))`
    return true
  })
  if (made === 'no_device')
    return c.json({ error: { code: 'no_device', message: 'Sign in again to turn on notifications on this device.' } }, 400)
  return made ? c.json({ id }, 201) : c.json({ error: { code: 'invalid' } }, 400)
})

/**
 * A notification to this person's own devices here, now, and what each
 * service answered.
 *
 * A phone that heard nothing could not be told why: the worker stamps a
 * notification done whatever was answered, a token Apple refuses takes the
 * row with it, and a registration refused for want of a key was swallowed
 * by the app. This asks while somebody watches, and says.
 *
 * Not through the queue and not into the inbox: it is a question about
 * the devices, not something that happened.
 */
export const trial: { phones: typeof phones; android?: import('../fcm.js').Send } = { phones }

push.post('/push/test', async (c) => {
  const ctx = c.get('ctx')
  if (ctx.viaMcp) return c.json({ error: { code: 'forbidden', message: 'Connected tools can’t send notifications.' } }, 403)
  const rows = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      tx<{ id: string; kind: DeviceKind; endpoint: string; p256dh: string | null; auth: string | null; said: string | null }[]>`
      select id, kind, endpoint, p256dh, auth, said from push_subscription
      where workspace_id = ${ctx.workspaceId} and actor_id = ${ctx.actorId}
        and deleted_at is null
      order by created_at`,
  )
  /* Asked for from a screen, so its language when the account never said. */
  const { reach } = say(
    { reach: ['Notifications reach this device.', 'Les notifications arrivent sur cet appareil.'] },
    await languageFor(ctx.actorId, heard(c)),
  )
  const told = { title: 'Tuff', body: reach, url: '/' }
  const apple = trial.phones()
  try {
    const devices = []
    for (const row of rows) {
      let status = 0
      let reason: string | null = null
      if (!reachable(row.kind)) {
        reason = 'Unconfigured'
      } else {
        try {
          if (row.kind === 'apns' || row.kind === 'fcm') {
            const answer =
              row.kind === 'apns' ? await askPhone(row.endpoint, told, apple.post) : await askAndroid(row.endpoint, told, trial.android)
            status = answer.status
            reason = answer.reason ?? null
          } else {
            status = await sendTo({ endpoint: row.endpoint, p256dh: row.p256dh ?? '', auth: row.auth ?? '' }, told)
          }
        } catch {
          reason = 'Unreachable'
        }
      }
      devices.push({ id: row.id, kind: row.kind, said: row.said, status, reason })
    }
    return c.json({ devices })
  } finally {
    apple.close()
  }
})

/**
 * Taking a device off.
 *
 * By id for a row in the list, or by endpoint for the browser turning itself
 * off — which knows its endpoint and not our id for it.
 */
push.delete('/push/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      tx`update push_subscription set deleted_at = now(), updated_at = now()
       where id = ${id} and actor_id = ${ctx.actorId} and deleted_at is null`,
  )
  return c.json({ ok: true })
})

push.post('/push/off', async (c) => {
  const ctx = c.get('ctx')
  const body = z.object({ endpoint: z.url() }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      tx`update push_subscription set deleted_at = now(), updated_at = now()
       where endpoint = ${body.data.endpoint} and actor_id = ${ctx.actorId}
         and deleted_at is null`,
  )
  return c.json({ ok: true })
})
