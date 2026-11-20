import { Hono } from 'hono'
import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import { generateKeyBetween } from 'fractional-indexing'
import { withActor } from '../db.js'
import type { AuthContext } from '../auth/context.js'

/**
 * Where somebody keeps a project or a conversation in their own sidebar.
 *
 * One person's order and nobody else's — `docs/specs/sidebar-order.md`. There
 * is no permission to check beyond being able to see the thing at all, which
 * row-level security has already decided by the time anything here runs: you
 * cannot place what you cannot see, and placing it tells nobody anything.
 */
export const places = new Hono<{ Variables: { ctx: AuthContext } }>()

const Where = z.object({
  /** The id this one should sit behind, or null for the top of the list. */
  after: z.uuid().nullish(),
})

/**
 * The order as it stands on the screen right now.
 *
 * Read in one place because the first drag has to write it down — a key on
 * the moved row alone would send it past everything unplaced, so dragging the
 * third project up one would land it at the top. These two orderings are the
 * ones the list endpoints use, and they have to stay the same two.
 */
async function asShown(
  tx: Parameters<Parameters<typeof withActor>[2]>[0],
  kind: 'project' | 'conversation',
  workspaceId: string,
): Promise<{ id: string; sort_key: string | null; surfaced?: boolean }[]> {
  if (kind === 'project') {
    return tx<{ id: string; sort_key: string | null }[]>`
      select p.id, sp.sort_key
      from project p
      left join sidebar_place sp
        on sp.object_id = p.id and sp.kind = 'project'
       and sp.actor_id = current_actor() and sp.workspace_id = ${workspaceId}
      where p.workspace_id = ${workspaceId} and p.deleted_at is null
        and p.archived_at is null
      /* Exactly as the list orders them (projects.ts), ties and all: the
         seed makes its projects in one moment, and an order that broke the
         tie its own way wrote the first drag over a list nobody was shown. */
      order by coalesce(sp.sort_key, '~') collate "C", p.created_at desc, p.id desc`
  }
  return tx<{ id: string; sort_key: string | null; surfaced: boolean }[]>`
    select c.id, sp.sort_key, (cm.surfaced_at is not null) as surfaced
    from conversation c
    left join sidebar_place sp
      on sp.object_id = c.id and sp.kind = 'conversation'
     and sp.actor_id = current_actor() and sp.workspace_id = ${workspaceId}
    left join conversation_member cm
      on cm.conversation_id = c.id and cm.actor_id = current_actor() and cm.deleted_at is null
    where c.workspace_id = ${workspaceId} and c.deleted_at is null
    order by cm.surfaced_at desc nulls last, sp.sort_key nulls last, c.project_id nulls first, c.created_at`
}

async function place(
  ctx: AuthContext,
  kind: 'project' | 'conversation',
  id: string,
  after: string | null,
): Promise<'ok' | 'missing' | 'invalid'> {
  return withActor(ctx.actorId, ctx.workspaceId, async (tx) => {
    const rows = await asShown(tx, kind, ctx.workspaceId)
    if (!rows.some((r) => r.id === id)) return 'missing' as const
    if (after && !rows.some((r) => r.id === after)) return 'invalid' as const

    /*
     * The first drag writes the whole list down.
     *
     * Everything on the screen gets the key its position already implies, so
     * the move that follows is a move within an order rather than a jump out
     * of one. Done once: after this there is nothing unplaced left to
     * disagree with, and the loop writes nothing.
     */
    /*
     * A room that came back out stands ahead of the keys — sidebar-hide.md.
     * Arranging the list is the reader taking that order over, so the whole
     * list is written down again as it stands and the rooms stop being
     * "came back" and are simply where they are.
     */
    const surfaced = rows.some((r) => r.surfaced)
    let key: string | null = null
    const keyed = new Map<string, string>()
    for (const r of rows) {
      key = generateKeyBetween(key, null)
      keyed.set(r.id, surfaced ? key : (r.sort_key ?? key))
      if (r.sort_key && !surfaced) key = r.sort_key
    }
    if (surfaced) {
      await tx`
        update conversation_member set surfaced_at = null
        where actor_id = ${ctx.actorId} and surfaced_at is not null and deleted_at is null`
      const values = rows.map((r) => ({
        id: uuidv7(),
        workspace_id: ctx.workspaceId,
        actor_id: ctx.actorId,
        kind,
        object_id: r.id,
        sort_key: keyed.get(r.id)!,
      }))
      await tx`
        insert into sidebar_place ${tx(values, 'id', 'workspace_id', 'actor_id', 'kind', 'object_id', 'sort_key')}
        on conflict (actor_id, workspace_id, kind, object_id)
        do update set sort_key = excluded.sort_key, updated_at = now()`
    } else if (rows.some((r) => !r.sort_key)) {
      /* Written in one statement rather than one a row: a sidebar of fifty
         projects is fifty round trips otherwise, on the first drag of the
         day. */
      const values = rows.map((r) => ({
        id: uuidv7(),
        workspace_id: ctx.workspaceId,
        actor_id: ctx.actorId,
        kind,
        object_id: r.id,
        sort_key: keyed.get(r.id)!,
      }))
      await tx`
        insert into sidebar_place ${tx(values, 'id', 'workspace_id', 'actor_id', 'kind', 'object_id', 'sort_key')}
        on conflict (actor_id, workspace_id, kind, object_id) do nothing`
    }

    /* Where it lands: between the row it was dropped behind and the next one,
       with itself left out of the search — a move inside its own list finds
       itself and lands between itself and nothing. */
    const order = rows.map((r) => r.id).filter((x) => x !== id)
    const at = after ? order.indexOf(after) : -1
    const before = at >= 0 ? keyed.get(order[at]!)! : null
    const next = order[at + 1] ? keyed.get(order[at + 1]!)! : null
    const landed = generateKeyBetween(before, next)

    await tx`
      insert into sidebar_place (id, workspace_id, actor_id, kind, object_id, sort_key)
      values (${uuidv7()}, ${ctx.workspaceId}, ${ctx.actorId}, ${kind}::object_kind, ${id}, ${landed})
      on conflict (actor_id, workspace_id, kind, object_id)
      do update set sort_key = excluded.sort_key, updated_at = now()`
    return 'ok' as const
  })
}

for (const [kind, path] of [
  ['project', '/projects/:id/place'],
  ['conversation', '/conversations/:id/place'],
] as const) {
  places.post(path, async (c) => {
    const body = Where.safeParse(await c.req.json().catch(() => ({})))
    if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
    const out = await place(c.get('ctx'), kind, c.req.param('id'), body.data.after ?? null)
    if (out === 'missing') return c.json({ error: { code: 'not_found' } }, 404)
    if (out === 'invalid') {
      return c.json({ error: { code: 'invalid', message: 'Couldn’t move it there. Try again.' } }, 400)
    }
    return c.json({ ok: true })
  })
}
