import { Hono } from 'hono'
import { z } from 'zod'
import { withActor } from '../db.js'
import { edition } from '../edition.js'
import { allow, type AuthContext } from '../auth/context.js'
import { asksOf, byInbox, codeFromInbox, emailOf, itIsThem } from '../auth/address.js'
import { letter, mailOn, mailSetup, send } from '../mail.js'
import { clearMail, mailChanged, MailInput, refusalBody, saveMail } from './mailSettings.js'
import { heard, languageFor, say } from '../words.js'
import { reask, spendOn } from './limits.js'
import { origin } from './access.js'
import { serverVersion } from '../updates.js'

/*
 * Your own server's owner screen, `/:ws/instance`.
 *
 * Whether anybody may sign up, who owns the server, and whether mail
 * leaves it. Every path answers 404 on the service (`edition.instance`
 * false) and to anybody who is not an owner, and each reads or writes
 * through a definer function that asks `is_instance_owner()` itself.
 */

type Vars = { ctx: AuthContext }

export const instanceApi = new Hono<{ Variables: Vars }>()

const hidden = { error: { code: 'not_found' } } as const

/**
 * Who may: an instance owner, signed in as a person, on an edition that
 * has them. `can()` decides from `instanceOwner`, which is false wherever
 * the edition has no owners and refuses tokens and agents. Everybody
 * else is told what a wrong address is told — that the screen exists is
 * the server's to say to its owners only.
 */
function mayNot(ctx: AuthContext): boolean {
  return !edition.instance || !allow(ctx, 'instance')
}

type Whole = {
  sign_up_open: boolean
  owners: { actor_id: string; name: string; email: string | null; added_at: string }[]
}

async function whole(ctx: AuthContext): Promise<Whole | null> {
  const [r] = await withActor(ctx.actorId, ctx.workspaceId, (tx) => tx<{ w: Whole | null }[]>`select instance_read() as w`)
  return r?.w ?? null
}

/** The screen's whole, as every path answers it: the switch, the owners,
    whether mail leaves and how it is set up — never its password or key —
    and the version it runs with a newer one when there is — `updates.ts`, */
async function answer(ctx: AuthContext, w: Whole) {
  return {
    ...w,
    mail: await mailOn(),
    mail_setup: await mailSetup(),
    version: await serverVersion(ctx.actorId, ctx.workspaceId),
  }
}

instanceApi.get('/instance', async (c) => {
  const ctx = c.get('ctx')
  if (mayNot(ctx)) return c.json(hidden, 404)
  const w = await whole(ctx)
  if (!w) return c.json(hidden, 404)
  return c.json(await answer(ctx, w))
})

instanceApi.patch('/instance', async (c) => {
  const ctx = c.get('ctx')
  if (mayNot(ctx)) return c.json(hidden, 404)
  const body = z
    .object({ sign_up_open: z.boolean() })
    .strict()
    .safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const [r] = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) => tx<{ ok: boolean }[]>`select instance_set_sign_up(${body.data.sign_up_open}) as ok`,
  )
  if (!r?.ok) return c.json(hidden, 404)
  const w = await whole(ctx)
  return w ? c.json(await answer(ctx, w)) : c.json(hidden, 404)
})

instanceApi.post('/instance/owners', async (c) => {
  const ctx = c.get('ctx')
  if (mayNot(ctx)) return c.json(hidden, 404)
  const body = z.object({ email: z.email().max(254) }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid' } }, 400)
  const [r] = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) => tx<{ said: string }[]>`select instance_add_owner(${body.data.email.toLowerCase()}::citext) as said`,
  )
  if (r?.said === 'forbidden') return c.json(hidden, 404)
  if (r?.said === 'not_found') {
    return c.json({ error: { code: 'not_found', message: 'No account has that email.' } }, 404)
  }
  if (r?.said === 'unconfirmed') {
    return c.json({ error: { code: 'unconfirmed', message: 'That account hasn’t confirmed its email yet.' } }, 409)
  }
  const w = await whole(ctx)
  return w ? c.json(await answer(ctx, w), r?.said === 'added' ? 201 : 200) : c.json(hidden, 404)
})

instanceApi.delete('/instance/owners/:actorId', async (c) => {
  const ctx = c.get('ctx')
  if (mayNot(ctx)) return c.json(hidden, 404)
  const id = z.uuid().safeParse(c.req.param('actorId'))
  if (!id.success) return c.json(hidden, 404)
  const [r] = await withActor(
    ctx.actorId,
    ctx.workspaceId,
    (tx) => tx<{ said: string }[]>`select instance_remove_owner(${id.data}) as said`,
  )
  if (r?.said === 'forbidden' || r?.said === 'not_found') return c.json(hidden, 404)
  if (r?.said === 'last') {
    return c.json({ error: { code: 'last_owner', message: 'The server needs at least one owner.' } }, 409)
  }
  const w = await whole(ctx)
  /* Taken off themselves: nothing more of the screen is theirs to read. */
  return w ? c.json(await answer(ctx, w)) : c.body(null, 204)
})

/*
 * The notice after an update, dismissed for every owner.
 * It only hides the line: the
 * backup it named stays where it is until its retention runs out.
 */
instanceApi.delete('/instance/update', async (c) => {
  const ctx = c.get('ctx')
  if (mayNot(ctx)) return c.json(hidden, 404)
  const [r] = await withActor(ctx.actorId, ctx.workspaceId, (tx) => tx<{ ok: boolean }[]>`select instance_update_dismiss() as ok`)
  if (!r?.ok) return c.json(hidden, 404)
  const w = await whole(ctx)
  return w ? c.json(await answer(ctx, w)) : c.json(hidden, 404)
})

/*
 * A letter to the owner who pressed, and nobody else: the address is the
 * account's own, never one typed here, so this cannot be made to mail a
 * stranger. Five a quarter of an hour.
 */
instanceApi.post('/instance/test-letter', async (c) => {
  const ctx = c.get('ctx')
  if (mayNot(ctx)) return c.json(hidden, 404)
  if (!(await spendOn(`instance-letter:${ctx.actorId}`, 5, 900))) {
    return c.json({ error: { code: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' } }, 429)
  }
  const { email } = await emailOf(ctx.actorId)
  if (!email) return c.json({ error: { code: 'invalid', message: 'Your account has no email.' } }, 400)
  const language = await languageFor(ctx.actorId, heard(c))
  const w = say(
    {
      subject: ['A test letter from Tuff', 'Un e-mail de test de Tuff'],
      line: [
        'Mail from your Tuff server works. You asked for this letter in Server settings.',
        'L’envoi d’e-mails de votre serveur Tuff fonctionne. Vous avez demandé cet e-mail depuis les paramètres du serveur.',
      ],
      open: ['Open Tuff', 'Ouvrir Tuff'],
    },
    language,
  )
  const sent = await send({ to: email, subject: w.subject, ...letter([w.line], { label: w.open, url: origin(c) }, language) })
  return c.json({ sent, mail: await mailOn() })
})

/*
 * Mail, set up from this screen. Connected or
 * changed, and disconnected. The database asks `is_instance_owner()`
 * itself; while the environment sends, both answer 409 and change nothing.
 *
 * Both ask the owner to prove it is them first, as handing a workspace
 * over and deleting an account do: the password, the authenticator's code
 * when there is one, or six digits from the inbox for an account with
 * neither. Whoever sets the mail server reads every reset link the server
 * sends, so an open laptop is not enough. Not on the setup screen, where
 * the token is the proof.
 */
const Proof = { password: z.string().max(1024).optional(), code: z.string().max(64).optional() }
const MailChange = z.object({ mail: MailInput, ...Proof }).strict()
const MailOff = z.object(Proof).strict()

/** Null when it is them; otherwise the answer to give. */
async function notThem(ctx: AuthContext, given: { password?: string | undefined; code?: string | undefined }) {
  const tries = await reask(ctx.actorId)
  if (!tries.ok)
    return { body: { error: { code: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' } }, status: 429 as const }
  const asks = await asksOf(ctx.actorId)
  const { email } = await emailOf(ctx.actorId)
  const yes = byInbox(asks) ? await codeFromInbox(ctx.actorId, given.code, 'mail') : await itIsThem(ctx.actorId, email, asks, given)
  if (!yes) {
    /* 403, not 401: a 401 tells the page its session is over. */
    const which = asks.code && !given.code ? 'totp_required' : 'not_them'
    return { body: { error: { code: which, message: 'That didn’t match. Try again.' } }, status: 403 as const }
  }
  await tries.right()
  return null
}

instanceApi.put('/instance/mail', async (c) => {
  const ctx = c.get('ctx')
  if (mayNot(ctx)) return c.json(hidden, 404)
  const body = MailChange.safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid', message: 'Fill in every field.' } }, 400)
  const refused = await notThem(ctx, body.data)
  if (refused) return c.json(refused.body, refused.status)
  const said = await withActor(ctx.actorId, ctx.workspaceId, (tx) => saveMail(tx, body.data.mail, null))
  if (said !== 'saved') {
    if (said.code === 'forbidden') return c.json(hidden, 404)
    return c.json(refusalBody(said), said.status)
  }
  await mailChanged()
  const w = await whole(ctx)
  return w ? c.json(await answer(ctx, w)) : c.json(hidden, 404)
})

instanceApi.delete('/instance/mail', async (c) => {
  const ctx = c.get('ctx')
  if (mayNot(ctx)) return c.json(hidden, 404)
  const body = MailOff.safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid', message: 'Fill in every field.' } }, 400)
  const refused = await notThem(ctx, body.data)
  if (refused) return c.json(refused.body, refused.status)
  const said = await withActor(ctx.actorId, ctx.workspaceId, (tx) => clearMail(tx, null))
  if (said === false) return c.json(hidden, 404)
  if (said !== true) return c.json(refusalBody(said), said.status)
  await mailChanged()
  const w = await whole(ctx)
  return w ? c.json(await answer(ctx, w)) : c.json(hidden, 404)
})
