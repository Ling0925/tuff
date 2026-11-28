import { Hono } from 'hono'
import { z } from 'zod'
import { asAuth } from '../db.js'
import type { AuthContext } from '../auth/context.js'
import { asksOf, emailOf, itIsThem } from '../auth/address.js'
import { hashPassword } from '../auth/crypto.js'
import { letter, send } from '../mail.js'
import { origin } from './access.js'
import { reask } from './limits.js'
import { heard, languageFor, say } from '../words.js'

type Vars = { ctx: AuthContext }

/**
 * A new password chosen from Account, by somebody signed in.
 *
 * It asks what signing in asks, as a change of address does: the password
 * there is now, and the code when there is a second factor, with wrong
 * answers counted on signing in's own key. This device stays signed in and
 * every other one is signed out; the address is told, so a change somebody
 * did not make is noticed where they read their mail.
 *
 * An account with no password — made through Google or Apple — sets its
 * first one by the link a forgotten password sends: having a session is
 * not proof enough to add a new way in.
 */
export const password = new Hono<{ Variables: Vars }>()

const Change = z.object({
  current: z.string().max(1024),
  password: z.string().max(1024),
  code: z.string().max(64).optional(),
})

password.post('/me/password', async (c) => {
  const ctx = c.get('ctx')
  if (ctx.viaMcp || !ctx.sessionId) {
    return c.json({ error: { code: 'forbidden', message: 'Connected tools can’t change your password.' } }, 403)
  }
  const body = Change.safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid', message: 'Fill in both passwords.' } }, 400)
  if (body.data.password.length < 12) {
    return c.json({ error: { code: 'invalid', message: 'Use at least 12 characters.' } }, 400)
  }

  const asks = await asksOf(ctx.actorId)
  if (!asks.password) {
    return c.json({ error: { code: 'no_password', message: 'Your account doesn’t have a password yet.' } }, 409)
  }
  const { email } = await emailOf(ctx.actorId)
  /* Counted on a key only somebody signed in as this person can spend: on
     the sign-in key, anybody's guessing at the door locked them out of
     here too. */
  const tries = await reask(ctx.actorId)
  if (!tries.ok) {
    return c.json({ error: { code: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' } }, 429)
  }
  const them = await itIsThem(ctx.actorId, email, asks, { password: body.data.current, code: body.data.code })
  if (!them) {
    /* 403, not 401: a 401 tells the page its session is over, and a
       mistyped password is not a reason to be signed out. */
    const which = asks.code && !body.data.code ? 'totp_required' : 'wrong_password'
    return c.json({ error: { code: which, message: 'That didn’t match. Try again.' } }, 403)
  }
  await tries.right()

  const hash = await hashPassword(body.data.password)
  /* Over the password just checked and no other: one taken or changed while
     the new one was hashed — a reset, the account changing hands — is not
     overwritten (migration 317). */
  const [r] = await asAuth(
    (tx) => tx<{ n: number }[]>`select auth_change_password(${ctx.actorId}, ${hash}, ${ctx.sessionId!}, ${them.hash}) as n`,
  )
  if (!r || r.n < 0) return c.json({ error: { code: 'wrong_password', message: 'That didn’t match. Try again.' } }, 403)
  const language = await languageFor(ctx.actorId, heard(c))
  const w = say(
    {
      subject: ['Your Tuff password was changed', 'Le mot de passe de votre compte Tuff a été modifié', '你的 Tuff 密码已修改'],
      what: [
        'The password for your Tuff account was just changed, and your other devices were signed out.',
        'Le mot de passe de votre compte Tuff vient d’être modifié, et vos autres appareils ont été déconnectés.',
        '你的 Tuff 账户密码刚刚被修改，其他设备已退出登录。',
      ],
      then: [
        'If this wasn’t you, reset your password now and check the devices under Account.',
        'Si ce n’était pas vous, réinitialisez votre mot de passe maintenant et vérifiez les appareils dans Compte.',
        '如果这不是你本人操作，请立即重置密码，并在「账户」中检查设备。',
      ],
      reset: ['Reset password', 'Réinitialiser le mot de passe', '重置密码'],
    },
    language,
  )
  await send({
    to: email,
    subject: w.subject,
    ...letter([w.what, w.then], { label: w.reset, url: `${origin(c)}/forgot` }, language),
  })
  return c.json({ ok: true, signed_out: r?.n ?? 0 })
})
