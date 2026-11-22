import { Hono, type Context, type Next } from 'hono'
import { DEFAULT_SETTINGS } from '@tracker/shared-schema'
import { authSql, sql, withoutActor } from '../db.js'
import { edition } from '../edition.js'
import { faced } from '../storage.js'
import { allow, type AuthContext } from '../auth/context.js'
import { verifyNowhereToken } from '../auth/tokens.js'
import { startSession, takeInvite } from '../auth/flows.js'
import { PER_PERSON, metaOf, spend } from './limits.js'
import { fullRefusal } from '../ceilings.js'
import { makeWorkspace, workspaceAddress } from './workspaces.js'
import { deleteAccount } from './yourdata.js'
import { inboxCode } from './address.js'
import { joinAsMe } from './invites.js'
import { hashToken } from '../auth/crypto.js'

/**
 * A session in no workspace.
 *
 * Mounted on `/api` before the check every other request goes through. A
 * request whose token is not one of these passes straight on; one whose
 * token is gets the short list below and `403 no_workspace` for anything
 * else. The token itself names no workspace (`issueNowhereToken`), so the
 * check behind this one refuses it too: forgetting a route here closes it,
 * never opens it.
 */

type Who = { actorId: string; sessionId: string; ctx: AuthContext; person: Person }
type Person = { name: string; avatar_key: string | null; email: string; unproved: boolean; instance_owner: boolean }
type Vars = { nowhere?: Who; ctx: AuthContext }

export const NO_WORKSPACE = { error: { code: 'no_workspace', message: 'You’re not in any workspace.' } } as const
/* To a client that cannot show the screen — the apps, today. */
export const NO_WORKSPACE_YET = {
  error: {
    code: 'no_workspace',
    message: 'You’re not in any workspace yet. Sign in on the web to create one or accept an invitation.',
  },
} as const

export const nowhere = new Hono<{ Variables: Vars }>()

nowhere.use('*', async (c, next) => {
  const header = c.req.header('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  /* Not a token at all, or one of the other kinds: not ours to answer. */
  if (!token || token.startsWith('tok_')) return next()
  /* Nor what is answered before anybody signs in. */
  const path = c.req.path
  if (path.startsWith('/api/blob/') || path === '/api/preview/image' || path.startsWith('/api/public/') || path.startsWith('/api/f/')) {
    return next()
  }
  if (edition.openApi(path)) return next()
  const claims = await verifyNowhereToken(token)
  if (!claims) return next()
  const [[alive], [person]] = await Promise.all([
    sql<{ ok: boolean }[]>`select auth_session_alive(${claims.sid}) as ok`,
    sql<Person[]>`select * from auth_nowhere(${claims.sub})`,
  ])
  /* Signed out, ended from elsewhere, or the account gone. */
  if (!alive?.ok || !person) return c.json({ error: { code: 'unauthorized' } }, 401)
  /* The person's ceiling, as every other request of theirs is held to
     (`rateLimit`, which is mounted after this): asked here because these
     are answered before it. A limiter that cannot ask lets it through. */
  if (!(await spend(`a:${claims.sub}`, PER_PERSON, `n:${claims.sub}`, PER_PERSON).catch(() => true))) {
    return c.json({ error: { code: 'rate_limited', message: 'Too many requests. Try again in a minute.' } }, 429)
  }
  const [closed] = edition.instance
    ? await sql<{ closed: boolean }[]>`select instance_sign_up_open() is false as closed`
    : [{ closed: false }]
  c.set('nowhere', {
    actorId: claims.sub,
    sessionId: claims.sid,
    ctx: personOnly(claims.sub, claims.sid, person, closed?.closed === true),
    person,
  })
  return next()
})

/*
 * The person and nothing of a workspace, for the handlers below that were
 * written for a session and read only who is asking: `can()` answers it as
 * a member of nowhere — no workspace, no projects, no rights — so what it
 * may do is what any member may do about themselves, and `workspaceId` is
 * empty for any handler that should never have been handed it.
 */
function personOnly(actorId: string, sessionId: string, p: Person, signUpClosed: boolean): AuthContext {
  return {
    actorId,
    workspaceId: '',
    role: 'member',
    settings: DEFAULT_SETTINGS,
    rights: {},
    mayCreateProjects: false,
    mayCreateChannels: false,
    maySeeMembers: false,
    mayInvitePeople: false,
    mayConnectAgents: false,
    agent: false,
    operator: false,
    instanceOwner: p.instance_owner,
    signUpClosed,
    unproved: p.unproved,
    plan: 'solo',
    viaMcp: false,
    tokenProjectIds: [],
    sessionId,
  }
}

/*
 * Into a workspace — an invitation taken, one made — the session for
 * nowhere ends: the answer carries a session for the workspace, opened
 * with its own line, and the old one's renewal would otherwise become a
 * workspace session later with none.
 */
async function endNowhere(who: Who): Promise<void> {
  await authSql()`select nowhere_session_end(${who.actorId}, ${who.sessionId})`
}
async function thenEnd(who: Who, res: Response): Promise<Response> {
  if (res.status < 300) await endNowhere(who)
  return res
}

/* Each route: a session in no workspace is answered here; anybody else goes on. */
const only =
  (h: (c: Context<{ Variables: Vars }>, who: Who) => Response | Promise<Response>) =>
  async (c: Context<{ Variables: Vars }>, next: Next) => {
    const who = c.get('nowhere')
    if (!who) return next()
    return h(c, who)
  }

nowhere.get(
  '/me',
  only((c, who) =>
    c.json({
      actor: faced({ id: who.actorId, name: who.person.name, avatar_key: who.person.avatar_key }),
      email: who.person.email,
      workspace: null,
      role: null,
      settings: DEFAULT_SETTINGS,
      can: allow(who.ctx, 'workspace.create') ? ['workspace.create'] : [],
      nowhere: true,
    }),
  ),
)

nowhere.get(
  '/me/invitations',
  only(async (c, who) => {
    const rows = await withoutActor(
      (tx) => tx<{ id: string; workspace_name: string }[]>`select id, workspace_name from invites_waiting(${who.actorId})`,
    )
    return c.json({ invitations: rows.map((r) => ({ id: r.id, workspace_name: r.workspace_name })) })
  }),
)

nowhere.post(
  '/me/invitations/:id/accept',
  only(async (c, who) => {
    const id = c.req.param('id') ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: { code: 'not_found', message: 'This invitation is no longer valid.' } }, 404)
    const rows = await withoutActor(
      (tx) => tx<{ token_hash: string }[]>`select token_hash from invites_waiting(${who.actorId}) where id = ${id}::uuid`,
    )
    const row = rows[0]
    if (!row) return c.json({ error: { code: 'not_found', message: 'This invitation is no longer valid.' } }, 404)
    const took = await takeInvite(row.token_hash, who.actorId)
    if (took === 'full') return c.json(fullRefusal('invited'), 413)
    if (typeof took === 'string') return c.json({ error: { code: 'not_found', message: 'This invitation is no longer valid.' } }, 404)
    const session = await startSession(who.actorId, took.workspaceId, metaOf(c), 'invite')
    await endNowhere(who)
    return c.json(session)
  }),
)

/* An invitation link followed while in no workspace: what it is to, and
   joining it as themselves, as a signed-in person's link page does. They
   are in no workspace, so never a member of this one already. */
nowhere.get(
  '/invite/:token',
  only(async (c, who) => {
    const [row] = await withoutActor(
      (tx) => tx<{ workspace_name: string; role: string; email: string | null; state: string }[]>`
        select * from preview_invite(${hashToken(c.req.param('token') ?? '')})`,
    )
    if (!row || row.state === 'revoked') return c.json({ state: 'invalid' })
    return c.json({ ...row, you: { name: who.person.name, email: who.person.email }, member: false })
  }),
)
nowhere.post(
  '/invite/:token/join',
  only(async (c, who) => {
    c.set('ctx', who.ctx)
    return thenEnd(who, await joinAsMe(c as unknown as Context<{ Variables: { ctx: AuthContext } }>))
  }),
)

/* Made by the rules making one always has, then entered as the menu does. */
nowhere.post(
  '/workspaces',
  only(async (c, who) => {
    c.set('ctx', who.ctx)
    return thenEnd(who, await makeWorkspace(c as unknown as Context<{ Variables: { ctx: AuthContext } }>))
  }),
)
nowhere.get(
  '/workspaces/address',
  only((c) => workspaceAddress(c)),
)

/* Deleting the account, and the six digits it asks an account with no password for. */
nowhere.post(
  '/me/delete',
  only((c, who) => {
    c.set('ctx', who.ctx)
    return deleteAccount(c as unknown as Context<{ Variables: { ctx: AuthContext } }>)
  }),
)
nowhere.post(
  '/me/inbox-code',
  only((c, who) => {
    c.set('ctx', who.ctx)
    return inboxCode(c as unknown as Context<{ Variables: { ctx: AuthContext } }>, 'leave')
  }),
)

/* And nothing else. */
nowhere.all(
  '*',
  only((c) => c.json(NO_WORKSPACE, 403)),
)
