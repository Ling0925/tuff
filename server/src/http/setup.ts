import { createHash, timingSafeEqual } from 'node:crypto'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'
import { hashPassword } from '../auth/crypto.js'
import { ownWorkspaceName, planNewWorkspace, startSession } from '../auth/flows.js'
import { asAuth } from '../db.js'
import { edition } from '../edition.js'
import { env, PLAIN_ADDRESS } from '../env.js'
import { letter, mailOn, mailSetup, oneLine, send } from '../mail.js'
import { heard, say } from '../words.js'
import { origin } from './access.js'
import { attempt, clientOf, metaOf, spendOn } from './limits.js'
import { clearMail, mailChanged, MailInput, refusalBody, saveMail } from './mailSettings.js'

/*
 * The first opening of your own server.
 *
 * Mail, then the owner's account, behind the one-time token `setup.sh`
 * wrote into `.env` (`SETUP_TOKEN`) and printed as a link. Every path:
 *
 * - is not there at all on the service, nor on your own server without a
 *   token — the same answer as an address nothing serves;
 * - counts a wrong token against the address it came from, ten a quarter
 *   of an hour, and gives a right one back;
 * - is closed for good once the server has an owner (`410 setup_done`);
 * - compares the token in constant time here, and its hash again in the
 *   database function that acts, so a route that forgot could not.
 *
 * The token travels in `x-setup-token`, never in an address.
 */

export const setup = new Hono()

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest()
/** The token's hash as the database keeps it — `instance_setup_armed`. */
export const setupHash = (token: string) => sha256(token).toString('hex')

/** Constant time whatever the lengths: both sides are hashed first. */
export function sameToken(given: string, armed: string): boolean {
  return timingSafeEqual(sha256(given), sha256(armed))
}

const tooMany = { error: { code: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' } }
const badToken = { error: { code: 'bad_token', message: 'This setup link doesn’t work. Use the link from the server’s log or setup.sh.' } }
const done = { error: { code: 'setup_done', message: 'This server already has an owner. Sign in.' } }

type Admitted = { hash: string } | { answer: Response }

/** Whether this request may set the server up, and the armed token's hash when it may. */
async function admit(c: Context): Promise<Admitted> {
  if (!edition.instance) return { answer: await c.notFound() }
  const armed = env.setupToken
  if (!armed) return { answer: await c.notFound() }
  const tried = await attempt(`fail:setup:${clientOf(c)}`, 10, 900)
  if (!tried.ok) return { answer: c.json(tooMany, 429) }
  const [state] = await asAuth((tx) => tx<{ s: { claimed: boolean } }[]>`select instance_setup_state() as s`)
  if (state?.s.claimed) {
    await tried.right()
    return { answer: c.json(done, 410) }
  }
  const given = c.req.header('x-setup-token') ?? ''
  if (!given || !sameToken(given, armed)) return { answer: c.json(badToken, 403) }
  await tried.right()
  /* The hash of what the caller sent, so the database's own comparison is
     of the request against what was armed, not of the armed token with
     itself — a route that forgot `sameToken` would still be refused. */
  return { hash: setupHash(given) }
}

/* What the screen opens with: the address the owner must use, when one is
   named, and how mail stands — never a password or key. */
setup.get('/setup', async (c) => {
  const a = await admit(c)
  if ('answer' in a) return a.answer
  return c.json({ owner_email: env.ownerEmail, mail_setup: await mailSetup() })
})

setup.put('/setup/mail', async (c) => {
  const a = await admit(c)
  if ('answer' in a) return a.answer
  const body = MailInput.safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) return c.json({ error: { code: 'invalid', message: 'Fill in every field.' } }, 400)
  const said = await asAuth((tx) => saveMail(tx, body.data, a.hash))
  if (said !== 'saved') {
    /* The database's refusal: the server was claimed, or the token changed, between the two. */
    if (said.code === 'forbidden') return c.json(badToken, 403)
    return c.json(refusalBody(said), said.status)
  }
  await mailChanged()
  return c.json({ mail_setup: await mailSetup() })
})

setup.delete('/setup/mail', async (c) => {
  const a = await admit(c)
  if ('answer' in a) return a.answer
  const said = await asAuth((tx) => clearMail(tx, a.hash))
  if (said === false) return c.json(badToken, 403)
  if (said !== true) return c.json(refusalBody(said), said.status)
  await mailChanged()
  return c.json({ mail_setup: await mailSetup() })
})

/*
 * A test letter to the address typed — there is no account yet to send it
 * to. Five a quarter of an hour from one address: whoever holds the token
 * holds the machine, but a form that sends mail is still one.
 */
setup.post('/setup/mail/test', async (c) => {
  const a = await admit(c)
  if ('answer' in a) return a.answer
  const body = z.object({ to: z.email().max(254) }).safeParse(await c.req.json().catch(() => ({})))
  if (!body.success || !PLAIN_ADDRESS.test(body.data.to)) {
    return c.json({ error: { code: 'invalid', message: 'Enter an email address to send it to.' } }, 400)
  }
  if (!(await spendOn(`setup-letter:${clientOf(c)}`, 5, 900))) return c.json(tooMany, 429)
  const w = say(
    {
      subject: ['A test email from Tuff', 'Un e-mail de test de Tuff', '来自 Tuff 的测试邮件'],
      line: [
        'Email from your Tuff server works. You sent this from the setup screen.',
        'L’envoi d’e-mails de votre serveur Tuff fonctionne. Vous l’avez envoyé depuis l’écran de configuration.',
        '你的 Tuff 服务器可以正常发送邮件。这封邮件是从设置界面发送的。',
      ],
      open: ['Open Tuff', 'Ouvrir Tuff', '打开 Tuff'],
    },
    heard(c),
  )
  const sent = await send({
    to: body.data.to.toLowerCase(),
    subject: w.subject,
    ...letter([w.line], { label: w.open, url: origin(c) }, heard(c)),
  })
  return c.json({ sent, mail: await mailOn() })
})

const Owner = z.object({
  name: z.string().max(200).transform(oneLine).pipe(z.string().min(1)),
  email: z.email().max(254),
  password: z.string().min(12).max(1024),
})

/*
 * The owner: made, confirmed, owner of the server and signed in, in one
 * press — `instance_setup_owner`, under the settings row's lock. With
 * `OWNER_EMAIL` set, only that address, here and in the database.
 */
setup.post('/setup/owner', async (c) => {
  const a = await admit(c)
  if ('answer' in a) return a.answer
  const body = Owner.safeParse(await c.req.json().catch(() => ({})))
  if (!body.success) {
    return c.json({ error: { code: 'invalid', message: 'Enter your name, your email and a password of at least 12 characters.' } }, 400)
  }
  const email = body.data.email.toLowerCase()
  const named = env.ownerEmail
  if (named && email !== named) {
    return c.json({ error: { code: 'owner_email', message: 'This server is set up for another email. Use the one in OWNER_EMAIL.' } }, 403)
  }
  const passwordHash = await hashPassword(body.data.password)
  const wsName = ownWorkspaceName(body.data.name)
  let made: { actor_id: string; workspace_id: string; made: boolean; workspace_made: boolean }
  try {
    made = await asAuth(async (tx) => {
      const [free] = await tx<{ slug: string }[]>`select free_workspace_slug(${wsName}) as slug`
      const [r] = await tx<{ r: typeof made }[]>`
        select instance_setup_owner(${a.hash}, ${uuidv7()}, ${body.data.name}, ${email}, ${passwordHash},
                                    ${uuidv7()}, ${wsName}, ${free!.slug}) as r`
      return r!.r
    })
  } catch (e) {
    const code = /\b(bad_token|setup_done|owner_email|dev_account)\b/.exec(String((e as Error).message))?.[1]
    if (code === 'setup_done') return c.json(done, 410)
    if (code === 'bad_token') return c.json(badToken, 403)
    if (code === 'owner_email') {
      return c.json(
        { error: { code: 'owner_email', message: 'This server is set up for another email. Use the one in OWNER_EMAIL.' } },
        403,
      )
    }
    if (code === 'dev_account') {
      return c.json({ error: { code: 'dev_account', message: 'That’s the development account. Use your own email.' } }, 403)
    }
    throw e
  }
  if (made.workspace_made) await planNewWorkspace(made.actor_id, made.workspace_id)
  /* A new account wrote its own line (`register`); an account taken back is signing in. */
  const session = await startSession(made.actor_id, made.workspace_id, metaOf(c), made.made ? null : 'password')
  return c.json(session, 201)
})
