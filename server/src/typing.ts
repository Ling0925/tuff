import type { AuthContext } from './auth/context.js'
import { mayListen } from './listening.js'
import { publish } from './realtime.js'

/*
 * Who is typing.
 *
 * A word said on a room's socket and passed on to everybody listening to
 * that room. Nothing is stored: the last time each person was passed on is
 * kept in this process for the throttle, and forgotten as it goes stale.
 */

/** At most one word per person per room in this long. */
export const TYPING_EVERY = 2000

const last = new Map<string, number>()
let swept = 0

/** What the browser says on the socket: `typing`, or `typing <thread id>`. */
const FRAME = /^typing(?: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?$/i

/**
 * One word from a room's socket. Answers whether it was passed on, for the
 * tests: a frame of another shape, one inside the throttle, or one from
 * somebody who may no longer read the room is dropped.
 */
export async function typed(ctx: AuthContext, conversationId: string, frame: string, now = Date.now()): Promise<boolean> {
  const said = FRAME.exec(frame)
  if (!said) return false
  const key = `${ctx.workspaceId}:${conversationId}:${ctx.actorId}`
  const was = last.get(key)
  if (was !== undefined && now - was < TYPING_EVERY) return false
  last.set(key, now)
  /* The map does not grow for ever: a room nobody has typed in for a
     minute has nothing worth keeping. Swept once a minute at most, so a
     busy server does not walk the whole map on every word. */
  if (now - swept > 60_000) {
    swept = now
    for (const [k, at] of last) if (now - at > 60_000) last.delete(k)
  }
  /* Asked again, not trusted from when the socket opened: somebody taken
     off the project a moment ago is not heard in its room. */
  if (!(await mayListen(ctx, conversationId))) return false
  await publish(`conversation:${conversationId}`, 'typing', {
    conversation_id: conversationId,
    actor_id: ctx.actorId,
    thread: said[1]?.toLowerCase() ?? null,
  })
  return true
}
