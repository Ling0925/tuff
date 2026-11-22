import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { asAuth } from '../db.js'
import type { AuthContext } from '../auth/context.js'
import { asksOf, byInbox, emailOf, itIsThem, mailCode, masked, peekLink, sendForApproval, sendToNew } from '../auth/address.js'
import { answerConfirmation, origin } from './access.js'
import { reask } from './limits.js'
import { heard } from '../words.js'

type Vars = { ctx: AuthContext }

/**
 * Changing the address an account signs in with.
 *
 * Never through a token, as presence and the picture are not: an agent
 * acting for somebody does not move their account somewhere else. The
 * logic and the mail are `auth/address.ts`; the links come back through
 * `/auth/verify`.
 */
export const address = new Hono<{ Variables: Vars }>()

const refused = (c: Context) => c.json({ error: { code: 'forbidden', message: 'Connected tools can’t change your email address.' } }, 403)

/** Not more than five links an hour for one account, of either kind. */
async function linksLeft(actorId: string): Promise<boolean> {
  const [n] = await asAuth(
    (tx) => tx<{ n: number }[]>`
      select auth_ticket_recent(${actorId}, 'email') + auth_ticket_recent(${actorId}, 'approve') as n`,
  )
  return (n?.n ?? 0) < 5
}

/** Where the account's mail goes, a change waiting on a link, and what a change asks for. */
address.get('/me/email', async (c) => {
  const ctx = c.get('ctx')
  if (ctx.viaMcp) return refused(c)
  const [now, asks] = await Promise.all([emailOf(ctx.actorId), asksOf(ctx.actorId)])
  return c.json({
    email: now.email,
    pending: now.pending ? { email: now.pending.email, approve: now.pending.kind === 'approve' } : null,
    asks: { ...asks, inbox: byInbox(asks) },
  })
})

const Change = z.object({
  email: z.email().max(254),
  password: z.string().max(1024).optional(),
  code: z.string().max(64).optional(),
})

/**
 * Ask for the change. What signing in asks is asked here — the password,
 * the code — and wrong answers count on the same key, so this is not a
 * second door to guess a password at. An account with neither is asked
 * through its current address instead.
 *
 * The answer is the same for every address: a link is on its way.
 */
address.post('/me/email', async (c) => {
  const ctx = c.get('ctx')
  if (ctx.viaMcp) return refused(c)
  const body = Change.safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) {
    return c.json({ error: { code: 'invalid', message: 'Enter a valid email address.' } }, 400)
  }
  const to = body.data.email.trim().toLowerCase()
  const { email: now } = await emailOf(ctx.actorId)
  if (to === now.toLowerCase()) {
    return c.json({ error: { code: 'invalid', message: 'That’s already your email address.' } }, 400)
  }

  const asks = await asksOf(ctx.actorId)
  /* Counted on a key only somebody signed in as this person can spend: on
     the sign-in key, anybody's guessing at the door locked them out of
     here too. */
  const tries = await reask(ctx.actorId)
  if (!tries.ok) {
    return c.json({ error: { code: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' } }, 429)
  }
  if (!byInbox(asks) && !(await itIsThem(ctx.actorId, now, asks, body.data))) {
    /* 403, not 401: a 401 tells the page its session is over, and a
       mistyped password is not a reason to be signed out. */
    const which = asks.code && !body.data.code ? 'totp_required' : 'wrong_password'
    return c.json({ error: { code: which, message: 'That didn’t match. Try again.' } }, 403)
  }
  await tries.right()
  if (!(await linksLeft(ctx.actorId))) {
    return c.json({ error: { code: 'rate_limited', message: 'Too many links sent this hour. Try again later.' } }, 429)
  }

  // One change at a time: asking again calls off what was waiting.
  await asAuth((tx) => tx`select auth_email_cancel(${ctx.actorId})`)
  if (byInbox(asks)) await sendForApproval(origin(c), ctx.actorId, now, to, heard(c))
  else await sendToNew(origin(c), ctx.actorId, to, heard(c))
  return c.json({ pending: to, inbox: byInbox(asks) }, 202)
})

/**
 * The same link again, to wherever the waiting change sent it. Nothing is
 * asked: the change was asked for properly, and this only repeats it.
 */
address.post('/me/email/again', async (c) => {
  const ctx = c.get('ctx')
  if (ctx.viaMcp) return refused(c)
  const { email: now, pending } = await emailOf(ctx.actorId)
  if (!pending) return c.json({ error: { code: 'not_found', message: 'There’s no pending email change.' } }, 404)
  if (!(await linksLeft(ctx.actorId))) {
    return c.json({ error: { code: 'rate_limited', message: 'Too many links sent this hour. Try again later.' } }, 429)
  }
  await asAuth((tx) => tx`select auth_email_cancel(${ctx.actorId})`)
  if (pending.kind === 'approve') await sendForApproval(origin(c), ctx.actorId, now, pending.email, heard(c))
  else await sendToNew(origin(c), ctx.actorId, pending.email, heard(c))
  return c.json({ pending: pending.email }, 202)
})

const Confirm = z.object({ token: z.string().min(10).max(512), pressed: z.literal(true) })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const notThisAccount = (c: Context) =>
  c.json(
    {
      error: {
        code: 'not_this_account',
        message: 'This link is for another account. Sign in to the account that asked for the change, then confirm.',
      },
    },
    403,
  )

/**
 * The new address confirmed. Only by a press on the page the link
 * opened (`pressed: true`, which nothing but that press sends), and only
 * from a session of the account the change belongs to: the link proves
 * the new inbox, the session proves it is the person who asked. Opening
 * the link changes nothing (`/auth/verify/peek`).
 *
 * A session, not a token of any kind — an agent does not move its owner's
 * account, as it does not ask to — and the database asks again that the
 * session is the account's and live (`auth_email_confirm`, migration 316).
 * Refused, the link is not spent: signing in to the right account and
 * pressing again works. Named, for a session in no workspace too —
 * `nowhere.ts`.
 */
export async function confirmAddress(c: Context<{ Variables: Vars }>) {
  const ctx = c.get('ctx')
  if (ctx.viaMcp || ctx.viaGithub || ctx.viaImport || ctx.feedbackPage || ctx.board) return refused(c)
  const body = Confirm.safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) {
    return c.json({ error: { code: 'invalid', message: 'Open the link from the email and press Confirm.' } }, 400)
  }
  const about = await peekLink(body.data.token)
  if (about?.kind !== 'email') {
    return c.json({ error: { code: 'gone', message: 'This link has already been used or has expired.' } }, 410)
  }
  if (about.actorId !== ctx.actorId || !ctx.sessionId || !UUID.test(ctx.sessionId)) return notThisAccount(c)
  return answerConfirmation(c, body.data.token, ctx.sessionId)
}
address.post('/me/email/confirm', (c) => confirmAddress(c))

/**
 * Six digits to the inbox, for an account with nothing to type, before it
 * is deleted or hands a workspace over.
 */
/* Named, for a session in no workspace too — `nowhere.ts`. */
export async function inboxCode(c: Context<{ Variables: Vars }>, only?: 'leave') {
  const ctx = c.get('ctx')
  if (ctx.viaMcp) return refused(c)
  /* A session in no workspace asks for deleting's code alone — `nowhere.ts`. */
  const asked = only ? { for: only } : ((await c.req.json().catch(() => ({}))) as { for?: unknown })
  const asks = await asksOf(ctx.actorId)
  /* Turning the second factor off, for an account with no password, is the
     one thing an account with a factor is sent six digits for: the factor's
     own code is asked beside them. */
  const offWithoutPassword = asked.for === 'twofa-off' && asks.code && !asks.password
  if (!byInbox(asks) && !offWithoutPassword) {
    return c.json({ error: { code: 'invalid', message: 'Your password is what’s asked for.' } }, 400)
  }
  /* Asked for turning a factor off that is not on: refused rather than
     sent as a code for leaving, whose letter speaks of deleting the
     account. */
  if (asked.for === 'twofa-off' && !offWithoutPassword) {
    return c.json({ error: { code: 'invalid', message: 'There is no second factor to turn off.' } }, 400)
  }
  const purpose = offWithoutPassword
    ? 'twofa-off'
    : asked.for === 'ways' || asked.for === 'twofa' || asked.for === 'mail'
      ? asked.for
      : 'leave'
  const { email } = await emailOf(ctx.actorId)
  if (!(await mailCode(origin(c), ctx.actorId, email, heard(c), purpose))) {
    return c.json({ error: { code: 'rate_limited', message: 'Too many codes sent this hour. Try again later.' } }, 429)
  }
  return c.json({ sent_to: masked(email) }, 202)
}
address.post('/me/inbox-code', (c) => inboxCode(c))

/** Called off: the links already sent stop working. */
address.delete('/me/email', async (c) => {
  const ctx = c.get('ctx')
  if (ctx.viaMcp) return refused(c)
  await asAuth((tx) => tx`select auth_email_cancel(${ctx.actorId})`)
  return c.json({ ok: true })
})
