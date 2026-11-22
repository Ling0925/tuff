import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { asAuth, withActorEverywhere } from '../db.js'
import { allow, type AuthContext } from '../auth/context.js'
import { startSession, type Session } from '../auth/flows.js'
import { metaOf } from './limits.js'

/**
 * Workspaces joined before the proof.
 * When an address is proved and the
 * previous holder of the account is put out, each workspace the account was
 * in with somebody else waits (`before_proof_held`, migration 315) and
 * opens nothing until the person answers here: Join or Leave.
 *
 * Answered for a session in a workspace (mounted on `/api` with the rest)
 * and for a session in no workspace (`nowhere.ts`, which calls the same
 * two functions with the person it knows).
 */

type Ctx = Context<{ Variables: { ctx: AuthContext } }>

const forbidden = { error: { code: 'forbidden' } } as const
const missing = { error: { code: 'not_found', message: 'This workspace isn’t waiting for an answer.' } } as const

/**
 * A person, in a session of their own: never a token of any kind, an agent,
 * GitHub or an import speaking as somebody, a board or a feedback page —
 * `can()` holds `workspace.confirm`, and the session is asked for here as
 * well, because the answer may be one.
 */
function inPerson(ctx: AuthContext): boolean {
  if (!ctx.sessionId || ctx.viaMcp || ctx.viaGithub || ctx.viaImport || ctx.agent || ctx.board || ctx.feedbackPage) return false
  return allow(ctx, 'workspace.confirm')
}

export async function unconfirmedList(c: Ctx, ctx: AuthContext): Promise<Response> {
  if (!inPerson(ctx)) return c.json(forbidden, 403)
  const rows = await withActorEverywhere(
    ctx.actorId,
    (tx) => tx<{ workspace_id: string; name: string; role: string }[]>`select * from memberships_unconfirmed()`,
  )
  return c.json({ waiting: rows.map((r) => ({ id: r.workspace_id, name: r.name, role: r.role })) })
}

/**
 * The press. The body says which one — `{ "answer": "join" }` or
 * `{ "answer": "leave" }` — and nothing else answers: not opening the
 * screen, not a link, not a parameter. `then` makes the session a Join in no
 * workspace answers with; a session in a workspace keeps its own.
 */
export async function unconfirmedAnswer(c: Ctx, ctx: AuthContext, then?: (workspaceId: string) => Promise<Session>): Promise<Response> {
  if (!inPerson(ctx)) return c.json(forbidden, 403)
  const id = c.req.param('id') ?? ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return c.json(missing, 404)
  const body = z
    .object({ answer: z.enum(['join', 'leave']) })
    .strict()
    .safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: { code: 'invalid', message: 'Say join or leave.' } }, 400)

  const [r] = await asAuth(
    (tx) => tx<{ said: string }[]>`
      select auth_membership_answer(${ctx.actorId}::uuid, ${id}::uuid, ${body.data.answer === 'join'}) as said`,
  )
  const said = r?.said ?? 'none'
  if (said === 'owner') {
    return c.json({ error: { code: 'owner', message: 'You own this workspace, so you can’t leave it. Join it to hand it over.' } }, 409)
  }
  if (said !== 'joined' && said !== 'left') return c.json(missing, 404)
  const session = said === 'joined' && then ? await then(id) : null
  return c.json({ ok: true, answer: said, ...(session ?? {}) })
}

export const confirming = new Hono<{ Variables: { ctx: AuthContext } }>()

confirming.get('/me/unconfirmed', (c) => unconfirmedList(c, c.get('ctx')))
confirming.post('/me/unconfirmed/:id', (c) => unconfirmedAnswer(c, c.get('ctx')))

/** A Join from a session in no workspace answers a session for the workspace joined, as an invitation taken there does. */
export function sessionFor(c: Context, actorId: string) {
  return (workspaceId: string) => startSession(actorId, workspaceId, metaOf(c), 'confirm')
}
