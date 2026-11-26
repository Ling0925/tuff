import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { asAuth } from '../db.js'
import { confirmed } from '../auth/flows.js'
import type { AuthContext } from '../auth/context.js'
import { asksOf, byInbox, codeFromInbox, emailOf, itIsThem, tellWayIn } from '../auth/address.js'
import { generateToken, hashToken } from '../auth/crypto.js'
import { CHALLENGE, LINK, appLinkKey, finishAppLink, fromBrowser, offeredProviders, origin } from './access.js'
import { reask } from './limits.js'
import { oidcName, provider as ownProvider } from '../auth/oidc.js'

type Vars = { ctx: AuthContext }

/**
 * Ways to sign in, added and taken off from Account settings.
 *
 * A session is not enough for either: what signing in asks is asked again,
 * on the key every re-ask counts on, and the address is told. Never
 * through a connected tool, as the address is not changed through one.
 */
export const waysIn = new Hono<{ Variables: Vars }>()

const refused = (c: Context) => c.json({ error: { code: 'forbidden', message: 'Connected tools can’t change how you sign in.' } }, 403)

const refusedToPage = (c: Context) => c.json({ error: { code: 'forbidden', message: 'Only the Tuff app can do this.' } }, 403)

const Proof = z.object({
  password: z.string().max(1024).optional(),
  code: z.string().max(64).optional(),
  /* An app's, in place of the cookie its sheet would not carry. */
  app_challenge: z.string().regex(CHALLENGE).optional(),
})

/**
 * Whether what was given answers what this account asks: the password and
 * the code, or with neither the six digits its inbox was sent.
 */
async function proven(c: Context, actorId: string, body: z.ZodSafeParseResult<z.infer<typeof Proof>>): Promise<Response | null> {
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const tries = await reask(actorId)
  if (!tries.ok) {
    return c.json({ error: { code: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' } }, 429)
  }
  const asks = await asksOf(actorId)
  const { email } = await emailOf(actorId)
  const yes = byInbox(asks) ? await codeFromInbox(actorId, body.data.code, 'ways') : await itIsThem(actorId, email, asks, body.data)
  if (yes) {
    await tries.right()
    return null
  }
  /* 403, not 401: a mistyped password is not a reason to be signed out. */
  return c.json({ error: { code: 'not_them', message: 'That didn’t match. Try again.' } }, 403)
}

/** What each provider is linked to, what this deployment offers, and what a change asks. */
waysIn.get('/me/ways-in', async (c) => {
  const ctx = c.get('ctx')
  if (ctx.viaMcp || !ctx.sessionId) return refused(c)
  const [rows, asks] = await Promise.all([
    asAuth(
      (tx) => tx<{ id: string; provider: string; email: string | null; created_at: Date }[]>`
        select * from auth_identities_of(${ctx.actorId})`,
    ),
    asksOf(ctx.actorId),
  ])
  const offered = offeredProviders()
  return c.json({
    offered,
    /* What a server's own provider is called here. */
    oidc_name: offered.includes('oidc') ? oidcName() : null,
    ways: rows.map((r) => ({ id: r.id, provider: r.provider, email: r.email, created_at: r.created_at.toISOString() })),
    password: asks.password,
    asks: byInbox(asks) ? 'email' : asks.code ? 'password_and_code' : 'password',
  })
})

/**
 * Adding one: the proof, and then a ticket for this account that only this
 * browser carries to the provider — a cookie no page can read, never an
 * address. The page goes where the answer says.
 *
 * An app's sheet carries no cookie of the app's, so an app sends the
 * SHA-256 of a secret instead, and the ticket is bound to it and found by
 * it; the app finishes with the secret.
 */
waysIn.post('/me/ways-in/:provider', async (c) => {
  const ctx = c.get('ctx')
  if (ctx.viaMcp || !ctx.sessionId) return refused(c)
  const p = c.req.param('provider')
  if (!offeredProviders().includes(p)) {
    return c.json({ error: { code: 'unavailable', message: 'This sign-in method isn’t set up.' } }, 404)
  }
  const body = Proof.safeParse(await c.req.json().catch(() => ({})))
  const challenge = body.success ? body.data.app_challenge : undefined
  /* Only an app's own client: a page has the cookie, and a page sending a
     challenge is building a start for somebody else's browser. */
  if (challenge && fromBrowser(c)) return refusedToPage(c)
  const no = await proven(c, ctx.actorId, body)
  if (no) return no
  /* Not for an address nobody has proved: a way in added then would be
     somebody else's door into its owner's account. Confirming takes it
     anyway (migration 212); refused, there is nothing to take. */
  if (!(await confirmed(ctx.actorId)))
    return c.json({ error: { code: 'email_unverified', message: 'Confirm your email first. Check your inbox for the link.' } }, 403)
  /* A server's own provider that cannot be read is said here, before a
     ticket is made for a trip that would end on the same sentence. */
  if (p === 'oidc' && !(await ownProvider())) {
    return c.json({ error: { code: 'unreachable', message: `Couldn’t reach ${oidcName()}. Try again later.` } }, 503)
  }
  if (challenge) {
    const made = await asAuth(
      (tx) =>
        tx`select auth_ticket_make_bound(${appLinkKey(challenge)}, 'link', ${ctx.actorId}, ${ctx.workspaceId}, interval '10 minutes', ${`${p}:${ctx.sessionId}:app:${challenge}`})`,
    ).then(
      () => true,
      () => false,
    )
    /* A challenge already used: a fresh secret every time. */
    if (!made) return c.json({ error: { code: 'invalid', message: 'Start again.' } }, 400)
    return c.json({ url: `/auth/oauth/${p}/start?link=app&app_challenge=${challenge}` })
  }
  /* For this provider, and for this session: ended by a reset or by
     signing out everywhere, the ticket goes with it. */
  const ticket = generateToken('lnk')
  await asAuth(
    (tx) =>
      tx`select auth_ticket_make_bound(${hashToken(ticket)}, 'link', ${ctx.actorId}, ${ctx.workspaceId}, interval '10 minutes', ${`${p}:${ctx.sessionId}`})`,
  )
  c.header('set-cookie', `${LINK}=${ticket}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`)
  return c.json({ url: `/auth/oauth/${p}/start?link=1` })
})

const Finish = z.object({ linked: z.string().min(10).max(200), verifier: z.string().min(43).max(128) })

/**
 * An app finishing what its sheet brought back: the `linked` ticket from
 * the address, and the secret — over the session that asked, from the
 * app's own client.
 */
waysIn.post('/me/ways-in/:provider/finish', async (c) => {
  const ctx = c.get('ctx')
  if (ctx.viaMcp || !ctx.sessionId) return refused(c)
  if (fromBrowser(c)) return refusedToPage(c)
  const p = c.req.param('provider')
  if (!offeredProviders().includes(p)) {
    return c.json({ error: { code: 'unavailable', message: 'This sign-in method isn’t set up.' } }, 404)
  }
  const body = Finish.safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const done = await finishAppLink(c, ctx.actorId, ctx.sessionId, p, body.data.linked, body.data.verifier)
  if (done === 'refused' || done.outcome === 'failed') {
    return c.json({ error: { code: 'gone', message: 'This took too long. Try again.' } }, 410)
  }
  if (done.outcome === 'taken') {
    return c.json({ error: { code: 'taken', message: 'That account already signs in to another Tuff account.' } }, 409)
  }
  /* The address there, so the app can say which account it connected. */
  return c.json({ provider: p, email: done.email })
})

/** Taking one off, with the same proof; never the last way in. */
waysIn.delete('/me/ways-in/:id', async (c) => {
  const ctx = c.get('ctx')
  if (ctx.viaMcp || !ctx.sessionId) return refused(c)
  const id = c.req.param('id')
  if (!z.uuid().safeParse(id).success) return c.json({ error: { code: 'not_found' } }, 404)
  const no = await proven(c, ctx.actorId, Proof.safeParse(await c.req.json().catch(() => ({}))))
  if (no) return no
  const [r] = await asAuth(
    (tx) => tx<{ outcome: string; provider: string | null; email: string | null }[]>`
      select * from auth_identity_remove(${ctx.actorId}, ${id})`,
  )
  if (r?.outcome === 'last') {
    return c.json({ error: { code: 'last', message: 'This is how you sign in. Set a password before removing it.' } }, 409)
  }
  if (r?.outcome !== 'ok') return c.json({ error: { code: 'not_found' } }, 404)
  await tellWayIn(origin(c), ctx.actorId, 'removed', r.provider ?? '', r.email)
  return c.json({ ok: true })
})
