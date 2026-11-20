import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { closeDb, makeOwner, bearerFor, stamp, asTableOwner } from './helpers.js'
import { app } from '../src/http/routes.js'
import { whoIs } from '../src/http/access.js'
import { outbox } from '../src/mail.js'
import { registerUser, startSession } from '../src/auth/flows.js'

after(async () => {
  await closeDb()
})

const PASSWORD = 'correct-horse-battery-staple'

/** The same maths the verifier uses, written out — `totp.test.ts`. */
function code(secret: string, step = 0): string {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of secret) bits += B32.indexOf(ch).toString(2).padStart(5, '0')
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30) + step))
  const mac = createHmac('sha1', Buffer.from(bytes)).update(buf).digest()
  const offset = mac[mac.length - 1]! & 0x0f
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

const call = async (token: string, path: string, body?: unknown) => {
  const r = await app.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, body: (await r.json()) as Record<string, unknown> }
}
const plain = (path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const codeMailedTo = (to: string) => {
  const mail = outbox.filter((m) => m.to === to).at(-1)
  return mail ? (/\b(\d{6})\b/.exec(mail.subject)?.[1] ?? null) : null
}

/*
 * Turned on, it says it is on — and beginning again over it is refused.
 *
 * The state was read as nobody from a table only its own person may read,
 * so it said off whatever it was: the screen offered "Set up" beside the
 * recovery codes it had just been given, and a session could begin over a
 * factor that was on and switch it off without the password.
 */
test('a second factor turned on says it is on, and is not begun over', async () => {
  const { token } = await makeOwner()

  assert.deepEqual((await call(token, '/api/2fa')).body, {
    enabled: false,
    recovery_left: 0,
    proof: 'password',
  })
  const begun = await call(token, '/api/2fa/begin', { password: PASSWORD })
  assert.equal(begun.status, 200)
  const enabled = await call(token, '/api/2fa/enable', { code: code(begun.body.secret as string) })
  assert.equal(enabled.status, 200)
  assert.equal((enabled.body.recovery_codes as string[]).length > 0, true)

  const now = (await call(token, '/api/2fa')).body
  assert.equal(now.enabled, true)
  assert.equal(now.recovery_left, (enabled.body.recovery_codes as string[]).length)
  assert.equal((await call(token, '/api/2fa/begin', { password: PASSWORD })).status, 409)
})

/*
 * A session alone does not turn the factor on. It took a
 * provider's account whole — the code became the only proof a change of
 * address asks — and locked a password account out for good, since a
 * reset kept the factor.
 */
test('beginning asks for the password of an account that has one', async () => {
  const { token } = await makeOwner()
  const bare = await call(token, '/api/2fa/begin', {})
  assert.equal(bare.status, 403)
  assert.equal((bare.body.error as { code: string }).code, 'password_required')
  const wrong = await call(token, '/api/2fa/begin', { password: 'not-it-at-all' })
  assert.equal(wrong.status, 403)
  assert.equal((wrong.body.error as { code: string }).code, 'wrong_password')
  const begun = await call(token, '/api/2fa/begin', { password: PASSWORD })
  assert.equal(begun.status, 200)
  assert.equal(typeof begun.body.secret, 'string')
})

test('an account with no password is asked six digits from its inbox, sent for this', async () => {
  const s = stamp()
  const email = `gwen${s}@gmail.com`
  const made = await whoIs('google', `tf-${s}`, email, true, 'Gwen')
  assert.ok(made && made !== 'conflict')
  const { access_token: token } = await startSession(made.actorId, made.workspaceId!, {}, null)
  assert.equal((await call(token, '/api/2fa')).body.proof, 'email')
  const bare = await call(token, '/api/2fa/begin', {})
  assert.equal(bare.status, 403)
  assert.equal((bare.body.error as { code: string }).code, 'code_required')

  // A code sent for something else is not this yes.
  assert.equal((await call(token, '/api/me/inbox-code', {})).status, 202)
  assert.equal((await call(token, '/api/2fa/begin', { code: codeMailedTo(email) })).status, 403)

  assert.equal((await call(token, '/api/me/inbox-code', { for: 'twofa' })).status, 202)
  assert.match(outbox.filter((m) => m.to === email).at(-1)!.text, /two-factor/)
  const mailed = codeMailedTo(email)
  const begun = await call(token, '/api/2fa/begin', { code: mailed })
  assert.equal(begun.status, 200)
  // Once: the same six digits do not begin it again.
  assert.equal((await call(token, '/api/2fa/begin', { code: mailed })).status, 403)
})

/*
 * Turned on with the password by somebody who had learned it, the factor
 * stood between the owner and their account after the owner took the
 * password back by mail. A factor turned on in the last seven days goes
 * with a reset, and the mail saying it was turned on says so.
 */
test('a reset by mail takes off a factor turned on this week, and not an older one', async () => {
  const s = stamp()
  const email = `rescue${s}@example.com`
  const me = await registerUser({ email, password: PASSWORD, name: 'Ro', workspace_name: `rescue ${s.slice(0, 6)}` })
  const begun = await call(me.access_token, '/api/2fa/begin', { password: PASSWORD })
  assert.equal((await call(me.access_token, '/api/2fa/enable', { code: code(begun.body.secret as string) })).status, 200)
  const told = outbox.filter((m) => m.to === email).at(-1)!
  assert.match(told.subject, /Two-factor authentication is on/)
  assert.match(told.text, /reset your password/)

  const reset = async (password: string) => {
    assert.equal((await plain('/auth/password/forgot', { email })).status, 200)
    const link = /\/reset\/([^\s"<]+)/.exec(outbox.filter((m) => m.to === email).at(-1)!.text)![1]!
    assert.equal((await plain('/auth/password/reset', { token: decodeURIComponent(link), password })).status, 200)
    return plain('/auth/login', { email, password })
  }
  // Recent: the reset takes it off, and the password alone signs in.
  const back = await reset('a-new-one-entirely-1')
  assert.equal(back.status, 200)

  // Older than a week: the reset keeps it.
  const { access_token: token } = (await back.json()) as { access_token: string }
  const begun2 = await call(token, '/api/2fa/begin', { password: 'a-new-one-entirely-1' })
  assert.equal((await call(token, '/api/2fa/enable', { code: code(begun2.body.secret as string) })).status, 200)
  await asTableOwner()`update app_user set totp_enabled_at = now() - interval '8 days' where actor_id = ${me.actor_id}`
  const kept = await reset('a-new-one-entirely-2')
  assert.equal(kept.status, 401)
  assert.equal(((await kept.json()) as { error: { code: string } }).error.code, 'totp_required')
})

/*
 * Enabling answered over a factor already on, dealt new recovery codes
 * for a right guess, and counted no guess at all.
 */
test('wrong codes on the way to turning it on are counted', async () => {
  const { token } = await makeOwner()
  const begun = await call(token, '/api/2fa/begin', { password: PASSWORD })
  const secret = begun.body.secret as string
  // `begin` asked the password and spent one try on the same key, and gave it back.
  for (let i = 0; i < 10; i++) assert.equal((await call(token, '/api/2fa/enable', { code: '000000' })).status, 400)
  assert.equal((await call(token, '/api/2fa/enable', { code: code(secret) })).status, 429)
})

test('a factor that is on is not enabled again, and deals no new recovery codes', async () => {
  const { token } = await makeOwner()
  const begun = await call(token, '/api/2fa/begin', { password: PASSWORD })
  const secret = begun.body.secret as string
  assert.equal((await call(token, '/api/2fa/enable', { code: code(secret) })).status, 200)
  const left = (await call(token, '/api/2fa')).body.recovery_left
  const again = await call(token, '/api/2fa/enable', { code: code(secret, 1) })
  assert.equal(again.status, 409)
  assert.equal(again.body.recovery_codes, undefined)
  assert.equal((await call(token, '/api/2fa')).body.recovery_left, left)
})

/* -------------------------------------------, the review's round */

/* A secret begun and left — or begun before the proof was asked — was
   enabled forever after with a code from it and nothing else. */
test('a secret begun more than a quarter of an hour ago is not turned on', async () => {
  const { ctx, token } = await makeOwner()
  const begun = await call(token, '/api/2fa/begin', { password: PASSWORD })
  await asTableOwner()`update app_user set totp_begun_at = now() - interval '16 minutes' where actor_id = ${ctx.actorId}`
  const late = await call(token, '/api/2fa/enable', { code: code(begun.body.secret as string) })
  assert.equal(late.status, 400)
  assert.equal((late.body.error as { code: string }).code, 'expired')
  assert.equal((await call(token, '/api/2fa')).body.enabled, false)
})

/* Only a session of the person's own: a token for a tool, GitHub's or an
   import's never begins, enables or turns it off. */
test('a token that is not a session neither begins nor turns the factor on or off', async () => {
  const { ctx, workspaceId } = await makeOwner()
  const bare = await bearerFor(ctx.actorId, workspaceId)
  assert.equal((await call(bare, '/api/2fa/begin', { password: PASSWORD })).status, 403)
  assert.equal((await call(bare, '/api/2fa/enable', { code: '000000' })).status, 403)
  assert.equal((await call(bare, '/api/2fa/disable', { password: PASSWORD, code: '000000' })).status, 403)
})

/* An app from before the proof sends `{}`: it is told where to set it up,
   and is never let through on the session. */
test('an app that sends no proof is told where to set it up', async () => {
  const { token } = await makeOwner()
  const r = await call(token, '/api/2fa/begin', {})
  assert.equal(r.status, 403)
  assert.equal((r.body.error as { code: string }).code, 'password_required')
  assert.match((r.body.error as { message: string }).message, /in your browser, or update the app/)
})

/* Begun over a factor that went on in between: refused, and the factor
   stays as it is. */
test('beginning over a factor turned on in between is refused', async () => {
  const { ctx, token } = await makeOwner()
  const begun = await call(token, '/api/2fa/begin', { password: PASSWORD })
  // The check before beginning saw it off; the factor goes on before the write.
  await call(token, '/api/2fa/enable', { code: code(begun.body.secret as string) })
  const { beginTotp } = await import('../src/auth/flows.js')
  assert.equal(await beginTotp(ctx.actorId, 'x@example.com'), null)
  assert.equal((await call(token, '/api/2fa')).body.enabled, true)
})

/* An account with no password turned the factor on and could never turn it
   off: turning off asked a password it did not have. It asks a code from
   the factor and six digits from the inbox, sent for this. */
test('an account with no password turns the factor off with its code and its inbox', async () => {
  const s = stamp()
  const email = `nopw${s}@gmail.com`
  const made = await whoIs('google', `off-${s}`, email, true, 'Noa')
  assert.ok(made && made !== 'conflict')
  const { access_token: token } = await startSession(made.actorId, made.workspaceId!, {}, null)
  assert.equal((await call(token, '/api/me/inbox-code', { for: 'twofa' })).status, 202)
  const begun = await call(token, '/api/2fa/begin', { code: codeMailedTo(email) })
  const secret = begun.body.secret as string
  assert.equal((await call(token, '/api/2fa/enable', { code: code(secret) })).status, 200)
  assert.equal((await call(token, '/api/2fa')).body.proof, 'email')

  // The factor's code alone is not enough, nor an inbox code sent for turning it on.
  assert.equal((await call(token, '/api/2fa/disable', { code: code(secret) })).status, 403)
  assert.equal((await call(token, '/api/me/inbox-code', { for: 'twofa' })).status, 400)
  assert.equal((await call(token, '/api/me/inbox-code', { for: 'twofa-off' })).status, 202)
  assert.equal((await call(token, '/api/2fa/disable', { email_code: codeMailedTo(email), code: '000000' })).status, 403)
  assert.equal((await call(token, '/api/me/inbox-code', { for: 'twofa-off' })).status, 202)
  // The next code: the one that turned it on was taken.
  const off = await call(token, '/api/2fa/disable', { email_code: codeMailedTo(email), code: code(secret, 1) })
  assert.equal(off.status, 200)
  assert.equal((await call(token, '/api/2fa')).body.enabled, false)
})
