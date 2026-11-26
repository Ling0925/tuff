import { createHash, randomBytes } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import { withActor, withoutActor } from '../db.js'
import { allow, allowIn, type AuthContext } from '../auth/context.js'
import { forbidden, missing } from './objects.js'
import { record } from './activity.js'
import { origin } from './access.js'
import { clientOf, spendOn } from './limits.js'
import { told } from './chat.js'
import { fromSlack } from '../slackIn.js'
import { oneLine } from '../text.js'

/*
 * Incoming webhooks into a room, in Slack's shape.
 *
 * Two halves. Signed in, a room's settings make, list, turn over and remove
 * its hooks, for whoever `can()` says may (`hook.manage`), never through a
 * token. Outside, `POST /hooks/rooms/:id/:secret` takes Slack's JSON from
 * anybody holding the address and puts a message in the room under the
 * hook's name, written as whoever made the hook.
 */

type Vars = { ctx: AuthContext }

/** The secret: 32 random bytes. Only its SHA-256 is kept. */
const newSecret = () => randomBytes(32).toString('base64url')
const hashOf = (secret: string) => createHash('sha256').update(secret).digest('hex')
const addressOf = (c: Context, id: string, secret: string) => `${origin(c)}/hooks/rooms/${id}/${secret}`

/* --------------------------------------------------------- signed in */

export const roomHooks = new Hono<{ Variables: Vars }>()

type Room = { id: string; project_id: string | null; channel: boolean }

/** The room, if this person can see it — and whether they may manage its hooks. */
async function roomFor(ctx: AuthContext, roomId: string): Promise<{ room: Room; may: boolean } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(roomId)) return null
  const [room] = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) => tx<Room[]>`select id, project_id, channel from conversation where id = ${roomId} and deleted_at is null`,
  )
  if (!room) return null
  return { room, may: room.channel && mayManage(ctx, room.project_id) }
}

/** `hook.manage`, asked of the room's project — or of no project, for a channel outside every one. */
export function mayManage(ctx: AuthContext, projectId: string | null): boolean {
  if (ctx.viaMcp) return false
  return projectId ? allowIn(ctx, 'hook.manage', projectId) : allow(ctx, 'hook.manage', { inProject: false })
}

roomHooks.get('/conversations/:id/hooks', async (c) => {
  const ctx = c.get('ctx')
  const found = await roomFor(ctx, c.req.param('id'))
  if (!found) return c.json(missing, 404)
  if (!found.may) return c.json(forbidden, 403)
  /* No secret, and none could come: the column is not the application's to read. */
  const hooks = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) => tx`
      /* Who answers for it: whoever made it, or last gave it a new URL. And
         whether it is stopped — its maker's account changed hands, and a new
         URL starts it again. */
      select h.id, h.name, h.created_by, a.name as created_by_name, h.created_at, h.turned_at, h.last_used_at,
             h.stopped_at
      from room_hook h join actor a on a.id = h.created_by
      where h.conversation_id = ${found.room.id} and h.deleted_at is null
      order by h.created_at`,
  )
  return c.json({ hooks })
})

const HookName = z.string().max(200).transform(oneLine).pipe(z.string().min(1).max(80))

roomHooks.post('/conversations/:id/hooks', async (c) => {
  const ctx = c.get('ctx')
  const found = await roomFor(ctx, c.req.param('id'))
  if (!found) return c.json(missing, 404)
  if (!found.may) return c.json(forbidden, 403)
  const body = z.object({ name: HookName }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid', message: 'Give the webhook a name.' } }, 400)
  /* Twenty a room — more is somebody looping, not a team — counted by
     `room_hook_make` under a lock on the room. */
  const id = uuidv7()
  const secret = newSecret()
  const made = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [r] = await tx<{ said: 'made' | 'full' | 'no' }[]>`
      select room_hook_make(${id}, ${found.room.id}, ${body.data.name}, ${hashOf(secret)}) as said`
    if (r?.said === 'made') {
      await record(tx, ctx, 'hook.create', { projectId: found.room.project_id, meta: { id, room: found.room.id, name: body.data.name } })
    }
    return r?.said ?? 'no'
  })
  if (made === 'full') return c.json({ error: { code: 'conflict', message: 'A room can have 20 webhooks.' } }, 409)
  if (made !== 'made') return c.json(missing, 404)
  /* The address, once: nothing can show it again. */
  return c.json({ id, name: body.data.name, url: addressOf(c, id, secret) }, 201)
})

/** A hook this person can see, with its room, for turning over or removing. */
async function hookFor(ctx: AuthContext, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const [h] = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) => tx<{ id: string; name: string; conversation_id: string; project_id: string | null; channel: boolean }[]>`
      select h.id, h.name, h.conversation_id, c.project_id, c.channel
      from room_hook h join conversation c on c.id = h.conversation_id
      where h.id = ${id} and h.deleted_at is null and c.deleted_at is null`,
  )
  return h ?? null
}

roomHooks.post('/hooks/:id/turn', async (c) => {
  const ctx = c.get('ctx')
  const h = await hookFor(ctx, c.req.param('id'))
  if (!h) return c.json(missing, 404)
  if (!mayManage(ctx, h.project_id)) return c.json(forbidden, 403)
  const secret = newSecret()
  const ok = await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const [r] = await tx<{ ok: boolean }[]>`select room_hook_turn(${h.id}, ${hashOf(secret)}) as ok`
    if (r?.ok) await record(tx, ctx, 'hook.turn', { projectId: h.project_id, meta: { id: h.id, room: h.conversation_id } })
    return r?.ok === true
  })
  if (!ok) return c.json(missing, 404)
  return c.json({ id: h.id, name: h.name, url: addressOf(c, h.id, secret) })
})

roomHooks.delete('/hooks/:id', async (c) => {
  const ctx = c.get('ctx')
  const h = await hookFor(ctx, c.req.param('id'))
  if (!h) return c.json(missing, 404)
  if (!mayManage(ctx, h.project_id)) return c.json(forbidden, 403)
  await withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    await tx`update room_hook set deleted_at = now() where id = ${h.id} and deleted_at is null`
    await record(tx, ctx, 'hook.remove', { projectId: h.project_id, meta: { id: h.id, room: h.conversation_id } })
  })
  return c.json({ ok: true })
})

/* ----------------------------------------------------------- outside */

export const incomingHooks = new Hono()

/* Slack's answers are plain words, and so are these. */
const say = (c: Context, status: 200 | 400 | 404 | 429, words: string) => {
  c.header('cache-control', 'no-store')
  return c.text(words, status)
}

/** Per hook, per room, per address asking: Slack's one a second, with short bursts. */
export const HOOK_PER_MINUTE = 60
export const ROOM_PER_MINUTE = 120
export const WORKSPACE_PER_MINUTE = 300
/* Generous: Zapier, GitHub Actions and the like post for many companies
   from a few addresses. It only slows guessing; the three above do the
   real work. */
export const SOURCE_PER_MINUTE = 3000

incomingHooks.post('/hooks/rooms/:id/:secret', async (c) => {
  /* Counted before anything is looked up: guessing at addresses is slow
     as well as hopeless. */
  if (!(await spendOn(`hookin:src:${clientOf(c)}`, SOURCE_PER_MINUTE, 60))) {
    c.header('retry-after', '60')
    return say(c, 429, 'rate_limited')
  }
  const id = c.req.param('id')
  const secret = c.req.param('secret')
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[A-Za-z0-9_-]{20,100}$/.test(secret)) return say(c, 404, 'no_service')

  /* The body first, as Slack reads it: JSON, or a form with `payload`. */
  const type = c.req.header('content-type') ?? ''
  let payload: unknown
  try {
    if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
      const form = await c.req.parseBody()
      const raw = form.payload
      if (typeof raw !== 'string') return say(c, 400, 'invalid_payload')
      payload = JSON.parse(raw)
    } else {
      payload = JSON.parse(await c.req.text())
    }
  } catch {
    return say(c, 400, 'invalid_payload')
  }

  /* Then the hook, found only by its hash: an unknown id and a wrong
     secret are the same answer. */
  const [hook] = await withoutActor(
    (tx) => tx<{ workspace_id: string; conversation_id: string; created_by: string; name: string }[]>`
      select * from room_hook_take(${id}, ${hashOf(secret)})`,
  )
  if (!hook) return say(c, 404, 'no_service')
  if (
    !(await spendOn(`hookin:hook:${id}`, HOOK_PER_MINUTE, 60)) ||
    !(await spendOn(`hookin:room:${hook.conversation_id}`, ROOM_PER_MINUTE, 60)) ||
    !(await spendOn(`hookin:ws:${hook.workspace_id}`, WORKSPACE_PER_MINUTE, 60))
  ) {
    c.header('retry-after', '60')
    return say(c, 429, 'rate_limited')
  }

  const made = fromSlack(payload)
  if ('refused' in made) return say(c, 400, made.refused)

  /*
   * Written as whoever made the hook, under their own policies: somebody
   * taken off the project or out of the channel leaves a hook that posts
   * nothing. Under the hook's name, with no face, marked as the hook's —
   * nobody edits it as their own, and nobody is told: no mention node is
   * ever made, so `notify` has nothing to say and is not asked.
   */
  const messageId = uuidv7()
  const written = await withActor(hook.created_by, hook.workspace_id, async (tx) => {
    const [room] = await tx<{ ok: boolean }[]>`select can_see_conversation(${hook.conversation_id}) as ok`
    if (!room?.ok) return false
    await tx`
      insert into message (id, workspace_id, conversation_id, author_id, body, origin, said_as, hook_id)
      values (${messageId}, ${hook.workspace_id}, ${hook.conversation_id}, ${hook.created_by},
              ${tx.json(made.doc as never)}, 'system'::origin_kind, ${hook.name}, ${id})`
    return true
  })
  if (!written) return say(c, 404, 'channel_not_found')
  /* Last used: only a post it took. */
  await withoutActor((tx) => tx`select room_hook_used(${id})`).catch(() => {})
  await told(hook.created_by, hook.workspace_id, hook.conversation_id, messageId, null, null).catch(() => {})
  return say(c, 200, 'ok')
})
