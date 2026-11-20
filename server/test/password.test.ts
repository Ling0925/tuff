import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { whoIs } from '../src/http/access.js'
import { outbox } from '../src/mail.js'
import { issueApiToken, registerUser, startSession } from '../src/auth/flows.js'
import { closeDb, stamp as fresh, withActor } from './helpers.js'

after(async () => {
  await closeDb()
})

const PASSWORD = 'correct-horse-battery-staple'
const NEXT = 'a-new-one-entirely-for-this'
const post = (path: string, body: unknown, token?: string) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })

async function someone(tag: string) {
  const email = `${tag}${fresh()}@example.com`
  const u = await registerUser({ email, password: PASSWORD, name: 'Pat', workspace_name: `${tag} ${fresh().slice(0, 6)}` })
  return { email, ...u }
}

test('a password is changed with the one there is now, and every other device is signed out', async () => {
  const me = await someone('pw')
  // A second device, signed in before the change.
  const other = await post('/auth/login', { email: me.email, password: PASSWORD })
  const elsewhere = (await other.json()) as { refresh_token: string }

  // Wrong, or too short: nothing changes — and a 403, because a 401 would
  // sign the page out.
  assert.equal((await post('/api/me/password', { current: 'not-it-at-all', password: NEXT }, me.access_token)).status, 403)
  assert.equal((await post('/api/me/password', { current: PASSWORD, password: 'short' }, me.access_token)).status, 400)
  assert.equal((await post('/auth/login', { email: me.email, password: PASSWORD })).status, 200)

  const done = await post('/api/me/password', { current: PASSWORD, password: NEXT }, me.access_token)
  assert.equal(done.status, 200)
  assert.ok(((await done.json()) as { signed_out: number }).signed_out >= 1)

  // The new one signs in and the old one does not.
  assert.equal((await post('/auth/login', { email: me.email, password: NEXT })).status, 200)
  assert.equal((await post('/auth/login', { email: me.email, password: PASSWORD })).status, 401)
  // This device stays; the other one is out.
  assert.equal((await post('/auth/refresh', { refresh_token: me.refresh_token })).status, 200)
  assert.equal((await post('/auth/refresh', { refresh_token: elsewhere.refresh_token })).status, 401)
  // The address is told.
  assert.match(outbox.filter((m) => m.to === me.email).at(-1)!.subject, /password was changed/)
  // And the security log has a line for it, which the owner reads.
  const [logged] = await withActor(
    me.actor_id,
    (tx) => tx<{ n: number }[]>`
      select count(*)::int as n from security_event where actor_id = ${me.actor_id} and kind = 'password_changed'`,
  )
  assert.equal(logged!.n, 1)
})

test('a password link sent before the change stops working', async () => {
  const me = await someone('pwlink')
  assert.equal((await post('/auth/password/forgot', { email: me.email })).status, 200)
  const reset = /\/reset\/([^\s"<]+)/.exec(outbox.filter((m) => m.to === me.email).at(-1)!.text)![1]!
  assert.equal((await post('/api/me/password', { current: PASSWORD, password: NEXT }, me.access_token)).status, 200)
  const used = await post('/auth/password/reset', { token: decodeURIComponent(reset), password: 'and-another-one-again' })
  assert.equal(used.status, 410)
})

test('an account with no password is sent to the link, and a token changes nothing', async () => {
  const s = fresh()
  const made = await whoIs('google', `pw-${s}`, `nopw${s}@example.com`, true, 'Gil')
  assert.ok(made && made !== 'conflict')
  const session = await startSession(made.actorId, made.workspaceId!, {}, null)
  const r = await post('/api/me/password', { current: '', password: NEXT }, session.access_token)
  assert.equal(r.status, 409)
  assert.equal(((await r.json()) as { error: { code: string } }).error.code, 'no_password')

  const me = await someone('pwtoken')
  const token = await issueApiToken(me.actor_id, me.workspace_id, 'agent')
  assert.equal((await post('/api/me/password', { current: PASSWORD, password: NEXT }, token)).status, 403)
  assert.equal((await post('/auth/login', { email: me.email, password: PASSWORD })).status, 200)
})

/* Every other door that asks the password again counted wrong answers;
   turning the second factor off did not, so a session held for a minute
   guessed the password at the person's whole request ceiling. */
test('turning the second factor off counts wrong passwords like every other door', async () => {
  const me = await someone('offguess')
  const off = (password: string) => post('/api/2fa/disable', { password, code: '000000' }, me.access_token)
  for (let i = 0; i < 10; i++) assert.equal((await off(`wrong-guess-${i}`)).status, 403)
  assert.equal((await off(PASSWORD)).status, 429)
})

/* A reset shuts the doors somebody thinks are open; a Google sign-in was
   one of them. */
test('a reset takes away every Google and Apple sign-in', async () => {
  const s = fresh()
  const email = `resetgo${s}@example.com`
  const made = await whoIs('google', `rg-${s}`, email, true, 'Rae')
  assert.ok(made && made !== 'conflict')
  assert.equal((await post('/auth/password/forgot', { email })).status, 200)
  const link = /\/reset\/([^\s"<]+)/.exec(outbox.filter((m) => m.to === email).at(-1)!.text)![1]!
  assert.equal((await post('/auth/password/reset', { token: decodeURIComponent(link), password: NEXT })).status, 200)
  // Google is not asked to vouch: the old sign-in alone no longer opens it.
  assert.equal(await whoIs('google', `rg-${s}`, email, true, 'Rae', false), 'conflict')
  // Vouched for again, it links again.
  const back = await whoIs('google', `rg-${s}`, email, true, 'Rae')
  assert.ok(back && back !== 'conflict')
  assert.equal(back.actorId, made.actorId)
})

/* Google's `email_verified` on an address at somebody else's domain only
   says it was checked once, when the Google account was made: whoever held
   a reused mailbox could keep a Google account under it. */
test('Google opens an existing account by its address only where Google is the authority for it', async () => {
  const me = await someone('hd')
  assert.equal(await whoIs('google', `hd-${fresh()}`, me.email, true, 'Pat', false), 'conflict')
  const owned = await whoIs('google', `hd2-${fresh()}`, me.email, true, 'Pat', true)
  assert.ok(owned && owned !== 'conflict')
  assert.equal(owned.actorId, me.actor_id)
})
