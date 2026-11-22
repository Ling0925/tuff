import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { app } from '../src/http/routes.js'
import { whoIs } from '../src/http/access.js'
import { outbox } from '../src/mail.js'
import { issueApiToken, registerUser } from '../src/auth/flows.js'
import { asAuth } from '../src/db.js'
import { closeDb, stamp as fresh, withActor } from './helpers.js'

after(async () => {
  await closeDb()
})

const PASSWORD = 'correct-horse-battery-staple'
const post = (path: string, body: unknown, token?: string) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
const as = (token: string, path: string, init: RequestInit = {}) =>
  app.request(path, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...init.headers } })
const linkIn = (to: string) => {
  const mail = outbox.filter((m) => m.to === to).at(-1)
  const found = mail && /\/verify\/([^\s"<]+)/.exec(mail.text)
  return found ? decodeURIComponent(found[1]!) : null
}
const mailTo = (to: string) => outbox.filter((m) => m.to === to)
/* The new address's link, confirmed by the press on its page from the
   account's own session. */
const confirm = (token: string | null, session: string) => post('/api/me/email/confirm', { token, pressed: true }, session)
/* The old address's yes, pressed. */
const approve = (token: string | null) => post('/auth/verify', { token, pressed: true })

/** The same maths the verifier uses, written out — `totp.test.ts`. */
function code(secret: string, when: number): string {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of secret) bits += B32.indexOf(ch).toString(2).padStart(5, '0')
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(Math.floor(when / 30)))
  const mac = createHmac('sha1', Buffer.from(bytes)).update(buf).digest()
  const offset = mac[mac.length - 1]! & 0x0f
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

async function someone(stamp: string, tag: string) {
  const email = `${tag}${stamp}@example.com`
  const u = await registerUser({ email, password: PASSWORD, name: 'Eve', workspace_name: `${tag} ${stamp}` })
  return { email, ...u }
}

test('the address changes when the new one confirms it, the password having been asked first', async () => {
  const stamp = fresh()
  const me = await someone(stamp, 'mover')
  const to = `moved${stamp}@example.com`

  // What the screen is told: where mail goes now, and what a change asks.
  const shown = (await (await as(me.access_token, '/api/me/email')).json()) as {
    email: string
    pending: unknown
    asks: { password: boolean; code: boolean; inbox: boolean }
  }
  assert.equal(shown.email, me.email)
  assert.equal(shown.pending, null)
  assert.deepEqual(shown.asks, { password: true, code: false, inbox: false })

  // Without the password, or with a wrong one: nothing is sent — and a 403,
  // because a 401 would sign the page out.
  assert.equal((await post('/api/me/email', { email: to }, me.access_token)).status, 403)
  assert.equal((await post('/api/me/email', { email: to, password: 'not-it-at-all' }, me.access_token)).status, 403)
  assert.equal(mailTo(to).length, 0)
  // The same address it has is not a change.
  assert.equal((await post('/api/me/email', { email: me.email, password: PASSWORD }, me.access_token)).status, 400)

  const asked = await post('/api/me/email', { email: to, password: PASSWORD }, me.access_token)
  assert.equal(asked.status, 202)
  const waiting = (await (await as(me.access_token, '/api/me/email')).json()) as { pending: { email: string } | null }
  assert.equal(waiting.pending?.email, to)

  // Until the link is followed, nothing has changed.
  assert.equal((await post('/auth/login', { email: me.email, password: PASSWORD })).status, 200)
  const token = linkIn(to)
  assert.ok(token, 'a link went to the new address')

  // What the link is about, read before the press: the account, masked.
  const peeked = await post('/auth/verify/peek', { token })
  assert.equal(peeked.status, 200)
  assert.deepEqual(await peeked.json(), {
    kind: 'email',
    email: to,
    account: { id: me.actor_id, name: 'Eve', email: `m…@example.com` },
    needs_session: true,
  })
  const followed = await confirm(token, me.access_token)
  assert.equal(followed.status, 200)
  assert.deepEqual(await followed.json(), { changed: true, email: to })
  // Once.
  assert.equal((await confirm(token, me.access_token)).status, 410)
  assert.equal((await post('/auth/verify/peek', { token })).status, 410)

  // The new address signs in; the old one does not.
  assert.equal((await post('/auth/login', { email: to, password: PASSWORD })).status, 200)
  assert.equal((await post('/auth/login', { email: me.email, password: PASSWORD })).status, 401)
  // The session already open stays open.
  assert.equal((await as(me.access_token, '/api/me')).status, 200)
  // The old address is told, without being handed the new one whole.
  const told = mailTo(me.email).at(-1)!
  assert.match(told.subject, /changed/)
  assert.ok(!told.text.includes(to), 'the note to the old address masks the new one')
  // And the workspace's security log has a line for it, which its owner reads.
  const [logged] = await withActor(
    me.actor_id,
    (tx) => tx<{ n: number }[]>`
      select count(*)::int as n from security_event where actor_id = ${me.actor_id} and kind = 'email_changed'`,
  )
  assert.equal(logged!.n, 1)
})

test('a password link sent to the old address stops working when the address changes', async () => {
  const stamp = fresh()
  const me = await someone(stamp, 'stale')
  const to = `fresh${stamp}@example.com`
  assert.equal((await post('/auth/password/forgot', { email: me.email })).status, 200)
  const reset = /\/reset\/([^\s"<]+)/.exec(mailTo(me.email).at(-1)!.text)![1]!
  await post('/api/me/email', { email: to, password: PASSWORD }, me.access_token)
  assert.equal((await confirm(linkIn(to), me.access_token)).status, 200)
  const used = await post('/auth/password/reset', { token: decodeURIComponent(reset), password: 'a-new-one-entirely' })
  assert.equal(used.status, 410)
})

test('an address that already has an account is told so in its inbox, and the screen says what it says for any', async () => {
  const stamp = fresh()
  const me = await someone(stamp, 'want')
  const other = await someone(stamp, 'owner')
  const asked = await post('/api/me/email', { email: other.email, password: PASSWORD }, me.access_token)
  assert.equal(asked.status, 202)
  // The screen goes on saying a link is waiting there.
  const waiting = (await (await as(me.access_token, '/api/me/email')).json()) as { pending: { email: string } | null }
  assert.equal(waiting.pending?.email, other.email)
  // The address is told; no link that could change anything went to it.
  const note = mailTo(other.email).at(-1)!
  assert.match(note.text, /already has an account/)
  assert.equal(/\/verify\//.test(note.text), false)
  // And nothing moved.
  assert.equal((await post('/auth/login', { email: me.email, password: PASSWORD })).status, 200)
})

test('a second factor is asked for too, and a wrong code counts like a wrong password', async () => {
  const stamp = fresh()
  const me = await someone(stamp, 'twofa')
  const { generateSecret, seal } = await import('../src/auth/totp.js')
  const secret = generateSecret()
  await asAuth(async (tx) => {
    await tx`select auth_totp_begin(${me.actor_id}, ${seal(secret)})`
    await tx`select auth_totp_enable(${me.actor_id})`
  })
  const shown = (await (await as(me.access_token, '/api/me/email')).json()) as { asks: { code: boolean } }
  assert.equal(shown.asks.code, true)
  const to = `twofa-new${stamp}@example.com`
  const r = await post('/api/me/email', { email: to, password: PASSWORD }, me.access_token)
  assert.equal(r.status, 403)
  assert.equal(((await r.json()) as { error: { code: string } }).error.code, 'totp_required')
  assert.equal((await post('/api/me/email', { email: to, password: PASSWORD, code: '000000' }, me.access_token)).status, 403)
  // The code the authenticator shows now.
  const now = code(secret, Math.floor(Date.now() / 1000))
  assert.equal((await post('/api/me/email', { email: to, password: PASSWORD, code: now }, me.access_token)).status, 202)
})

test('an account with no password is asked through its current address first', async () => {
  const stamp = fresh()
  const email = `gus${stamp}@gmail.com`
  const made = await whoIs('google', `ch-${stamp}`, email, true, 'Gus')
  assert.ok(made && made !== 'conflict')
  const { startSession } = await import('../src/auth/flows.js')
  const session = await startSession(made.actorId, made.workspaceId!, {}, null)
  const shown = (await (await as(session.access_token, '/api/me/email')).json()) as {
    asks: { password: boolean; code: boolean; inbox: boolean }
  }
  assert.deepEqual(shown.asks, { password: false, code: false, inbox: true })

  const to = `elsewhere${stamp}@example.com`
  const asked = await post('/api/me/email', { email: to }, session.access_token)
  assert.equal(asked.status, 202)
  // Nothing to the new address yet: the current one says yes first.
  assert.equal(linkIn(to), null)
  const yes = linkIn(email)
  assert.ok(yes)
  // Opening it is not the yes: only the press, which says so.
  assert.equal((await post('/auth/verify', { token: yes })).status, 403)
  assert.equal(linkIn(to), null)
  const approved = await approve(yes)
  assert.deepEqual(await approved.json(), { approved: true, email: to })
  // Then the new address confirms it, as any change does.
  const link = linkIn(to)
  assert.ok(link)
  assert.deepEqual(await (await confirm(link, session.access_token)).json(), { changed: true, email: to })
  // Google still knows the account by its own id: a gmail.com address is
  // Google's, and nobody else is ever handed it.
  const again = await whoIs('google', `ch-${stamp}`, email, true, 'Gus')
  assert.ok(again && again !== 'conflict')
  assert.equal(again.actorId, made.actorId)
})

/* Somebody leaves a company and moves their account to a personal address;
   the company gives the old Google account to the next person. That person
   signing in with Google found the account that left. */
test('a Google sign-in under a company address goes when the address changes', async () => {
  const stamp = fresh()
  const email = `left${stamp}@example.com`
  const made = await whoIs('google', `co-${stamp}`, email, true, 'Lee')
  assert.ok(made && made !== 'conflict')
  const { startSession } = await import('../src/auth/flows.js')
  const session = await startSession(made.actorId, made.workspaceId!, {}, null)
  const to = `mine${stamp}@example.com`
  assert.equal((await post('/api/me/email', { email: to }, session.access_token)).status, 202)
  await approve(linkIn(email))
  assert.deepEqual(await (await confirm(linkIn(to), session.access_token)).json(), { changed: true, email: to })
  const next = await whoIs('google', `co-${stamp}`, email, true, 'Somebody else')
  assert.ok(next && next !== 'conflict')
  assert.notEqual(next.actorId, made.actorId)
})

test('a waiting change can be sent again and called off', async () => {
  const stamp = fresh()
  const me = await someone(stamp, 'off')
  const to = `offto${stamp}@example.com`
  await post('/api/me/email', { email: to, password: PASSWORD }, me.access_token)
  const first = linkIn(to)!
  assert.equal((await post('/api/me/email/again', {}, me.access_token)).status, 202)
  const second = linkIn(to)!
  assert.notEqual(first, second)
  // Sending again calls off the link before it.
  assert.equal((await confirm(first, me.access_token)).status, 410)
  assert.equal((await as(me.access_token, '/api/me/email', { method: 'DELETE' })).status, 200)
  assert.equal((await confirm(second, me.access_token)).status, 410)
  const shown = (await (await as(me.access_token, '/api/me/email')).json()) as { pending: unknown }
  assert.equal(shown.pending, null)
  assert.equal((await post('/api/me/email/again', {}, me.access_token)).status, 404)
})

test('a name is changed by its owner, and neither a name nor an address through a token', async () => {
  const stamp = fresh()
  const me = await someone(stamp, 'named')
  const r = await as(me.access_token, '/api/me', { method: 'PATCH', body: JSON.stringify({ name: '  Eve Adams  ' }) })
  assert.equal(r.status, 200)
  const shown = (await (await as(me.access_token, '/api/me')).json()) as { actor: { name: string } }
  assert.equal(shown.actor.name, 'Eve Adams')
  // Not empty.
  assert.equal((await as(me.access_token, '/api/me', { method: 'PATCH', body: JSON.stringify({ name: '   ' }) })).status, 400)
  // The title alone still works as it did.
  assert.equal((await as(me.access_token, '/api/me', { method: 'PATCH', body: JSON.stringify({ title: 'Designer' }) })).status, 200)

  const token = await issueApiToken(me.actor_id, me.workspace_id, 'agent')
  assert.equal((await as(token, '/api/me', { method: 'PATCH', body: JSON.stringify({ name: 'Mallory' }) })).status, 403)
  assert.equal((await post('/api/me/email', { email: `agent${stamp}@example.com`, password: PASSWORD }, token)).status, 403)
  assert.equal((await as(token, '/api/me/email')).status, 403)
})

/* With the password alone, whoever had learned it took the factor off and
   needed nothing else after: the factor is asked for its own code too. */
test('the second factor is turned off with the password and a code from it', async () => {
  const stamp = fresh()
  const me = await someone(stamp, 'factoroff')
  const { generateSecret, seal } = await import('../src/auth/totp.js')
  const secret = generateSecret()
  await asAuth(async (tx) => {
    await tx`select auth_totp_begin(${me.actor_id}, ${seal(secret)})`
    await tx`select auth_totp_enable(${me.actor_id})`
  })
  const off = async (body: unknown) => {
    const r = await post('/api/2fa/disable', body, me.access_token)
    return [r.status, ((await r.json()) as { error?: { code: string } }).error?.code ?? 'ok']
  }
  assert.deepEqual(await off({ password: PASSWORD }), [403, 'totp_required'])
  assert.deepEqual(await off({ password: PASSWORD, code: '000000' }), [403, 'wrong_code'])
  assert.deepEqual(await off({ password: 'not the password', code: code(secret, Math.floor(Date.now() / 1000)) }), [403, 'wrong_password'])
  assert.deepEqual(await off({ password: PASSWORD, code: code(secret, Math.floor(Date.now() / 1000)) }), [200, 'ok'])
})
