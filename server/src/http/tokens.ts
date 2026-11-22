import { Hono } from 'hono'
import { z } from 'zod'
import { withActor } from '../db.js'
import { allow, type AuthContext } from '../auth/context.js'
import { agentsHeld } from '../ceilings.js'
import { issueOwnToken, MAX_LIVE_TOKENS, revokeApiToken } from '../auth/flows.js'

type Vars = { ctx: AuthContext }
export const tokens = new Hono<{ Variables: Vars }>()

/**
 * Tokens for tools somebody connects.
 *
 * A tool may never mint or revoke a credential, which is why the gate is on
 * the channel rather than on the person: the caller holds the same rights
 * either way.
 */
function guard(ctx: AuthContext): string | null {
  if (ctx.viaMcp || ctx.viaGithub) return 'Connected tools can’t manage tokens.'
  const held = agentsHeld(ctx)
  if (held) return held.error.message
  if (!allow(ctx, 'token.issue.own')) return 'You don’t have permission to manage tokens.'
  return null
}

tokens.get('/tokens', async (c) => {
  const ctx = c.get('ctx')
  const denied = guard(ctx)
  if (denied) return c.json({ error: { code: 'forbidden', message: denied } }, 403)

  const rows = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) =>
      // token_hash is not in this list and could not be: the column grant was
      // revoked, so the database refuses it rather than trusting the select.
      tx`select id, name, project_ids, created_at, last_used_at, expires_at, revoked_at
       from api_token
       where actor_id = ${ctx.actorId} and deleted_at is null
       order by created_at desc`,
  )
  return c.json({ tokens: rows })
})

tokens.post('/tokens', async (c) => {
  const ctx = c.get('ctx')
  const denied = guard(ctx)
  if (denied) return c.json({ error: { code: 'forbidden', message: denied } }, 403)

  const body = z
    .object({
      name: z.string().min(1).max(100),
      project_ids: z.array(z.uuid()).max(50).default([]),
      ttl_days: z.number().int().min(1).max(365).default(90),
    })
    .safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  /*
   * Narrowed to some projects: each one a project this person can open, in
   * this workspace, or the same answer as for one that is not there. Kept
   * to them by the database, not by this list's being stored,
   * migration 191.
   */
  const projects = [...new Set(body.data.project_ids)]
  if (projects.length > 0) {
    const seen = await withActor(
      ctx.actorId,
      ctx.workspaceId,
      (tx) => tx<{ id: string }[]>`
      select id from project where id = any(${projects}::uuid[]) and workspace_id = ${ctx.workspaceId}
        and deleted_at is null`,
    )
    if (seen.length !== projects.length) return c.json({ error: { code: 'not_found' } }, 404)
  }

  // Issuing does not revoke: rotation without downtime means two live tokens
  // while the old one is swapped out.
  const token = await issueOwnToken(ctx.actorId, ctx.workspaceId, body.data.name, projects, body.data.ttl_days, ctx.checkedAt ?? null)
  /* At most `MAX_LIVE_TOKENS` live at once. */
  if (!token) {
    return c.json(
      {
        error: {
          code: 'too_many_tokens',
          message: `You can have ${MAX_LIVE_TOKENS} tokens at a time. Revoke one you don’t use to make another.`,
        },
      },
      409,
    )
  }
  // Shown exactly once — after this only the hash exists.
  return c.json({ token }, 201)
})

tokens.post('/tokens/:id/revoke', async (c) => {
  const ctx = c.get('ctx')
  if (ctx.viaMcp) {
    return c.json({ error: { code: 'forbidden', message: 'Connected tools can’t revoke tokens.' } }, 403)
  }
  const mine = allow(ctx, 'token.issue.own')
  const any = allow(ctx, 'token.revoke.any')
  if (!mine && !any) return c.json({ error: { code: 'forbidden' } }, 403)

  const done = await revokeApiToken(ctx.actorId, ctx.workspaceId, c.req.param('id'), any)
  return done ? c.json({ ok: true }) : c.json({ error: { code: 'not_found' } }, 404)
})
