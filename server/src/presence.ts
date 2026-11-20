import { withActor } from './db.js'

/**
 * Somebody is looking — `docs/specs/presence.md`.
 *
 * Written at most once a minute per person however often they say so: the
 * shell says it when its socket opens, every minute the tab is visible, and
 * the moment it becomes visible again, and three tabs open is three of each.
 * The state it feeds has a five-minute threshold, so a write a minute is as
 * fine-grained as the answer can be.
 *
 * Never throws at the caller: this is bookkeeping about a dot, and a failed
 * write of it is not a reason for a socket to come down.
 */
const last = new Map<string, number>()

export async function here(actorId: string, workspaceId: string): Promise<void> {
  const at = last.get(actorId) ?? 0
  const now = Date.now()
  if (now - at < 60_000) return
  last.set(actorId, now)
  try {
    await withActor(actorId, workspaceId, (tx) => tx`update actor set seen_at = now() where id = ${actorId}`)
  } catch {
    last.delete(actorId)
  }
}

/**
 * An agent is here while it works — `docs/specs/presence.md`, "Agents".
 *
 * An agent holds no tab and no socket, so `here` never hears from it and
 * every agent read as away while it was answering. Its calls with its
 * token are its being here: the same stamp, at most once a minute, written
 * only when the token's actor is an agent — a person's own token is their
 * tool at work, not them looking.
 */
export async function agentHere(actorId: string, workspaceId: string): Promise<void> {
  const key = `agent:${actorId}`
  const at = last.get(key) ?? 0
  const now = Date.now()
  if (now - at < 60_000) return
  last.set(key, now)
  try {
    await withActor(
      actorId,
      workspaceId,
      (tx) => tx`update actor set seen_at = now()
                 where id = ${actorId} and exists (select 1 from agent g where g.actor_id = ${actorId} and g.deleted_at is null)`,
    )
  } catch {
    last.delete(key)
  }
}

/**
 * And the person says which of the three they want to be.
 *
 * Null is "work it out", which is the default and the only one of the three
 * that can be wrong about somebody — the other two are what they said.
 */
export async function chose(actorId: string, workspaceId: string, what: 'away' | 'busy' | null): Promise<void> {
  await withActor(actorId, workspaceId, (tx) => tx`update actor set presence = ${what}, seen_at = now() where id = ${actorId}`)
  last.set(actorId, Date.now())
}
