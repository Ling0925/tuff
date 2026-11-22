import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { decodeJwt } from 'jose'
import { app } from '../src/http/routes.js'
import { whoIs } from '../src/http/access.js'
import { outbox } from '../src/mail.js'
import { issueApiToken, registerUser } from '../src/auth/flows.js'
import { hashToken } from '../src/auth/crypto.js'
import { asAuth, asTableOwner, closeDb, stamp as fresh } from './helpers.js'

after(async () => {
  await closeDb()
})

/*
 * A new address is confirmed by the account that asked for it,
 * Migration 316.
 *
 * Mallory, signed in to her own account, asked to change its address to
 * Bob's. The page Bob's link opened confirmed it as it loaded, and kept
 * her password and sessions; Bob's Google sign-in later found a proved
 * account at his address and landed him in it, which she still held.
 */

const PASSWORD = 'correct-horse-battery-staple'
const post = (path: string, body: unknown, token?: string) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
const get = (path: string, token?: string) => app.request(path, { headers: token ? { authorization: `Bearer ${token}` } : {} })
const linkIn = (to: string) => {
  const mail = outbox.filter((m) => m.to === to).at(-1)
  const found = mail && /\/verify\/([^\s"<]+)/.exec(mail.text)
  return found ? decodeURIComponent(found[1]!) : null
}
const confirm = (token: string, session?: string, said: Record<string, unknown> = { pressed: true }) =>
  post('/api/me/email/confirm', { token, ...said }, session)
const code = async (r: Response) => ((await r.json()) as { error?: { code?: string } }).error?.code
const emailOf = async (actorId: string) => {
  const [r] = await asTableOwner()<{ email: string }[]>`select email::text from app_user where actor_id = ${actorId}`
  return r?.email
}
/** Whether the link is still good: read, it answers, and nothing spent it. */
const stillGood = async (token: string) => (await post('/auth/verify/peek', { token })).status === 200
const sessionOf = (accessToken: string) => decodeJwt(accessToken).sid as string

async function someone(stamp: string, tag: string, name = 'Eve') {
  const email = `${tag}${stamp}@example.com`
  const u = await registerUser({ email, password: PASSWORD, name, workspace_name: `${tag} ${stamp}` })
  return { email, ...u }
}

test('Mallory’s change to Bob’s address is not confirmed by Bob’s link, and Bob’s Google sign-in lands in an account of his own', async () => {
  const stamp = fresh()
  const mallory = await someone(stamp, 'mallory', 'Mallory')
  const bob = `bob${stamp}@gmail.com`
  assert.equal((await post('/api/me/email', { email: bob, password: PASSWORD }, mallory.access_token)).status, 202)
  const token = linkIn(bob)
  assert.ok(token, 'the link went to Bob')

  // The page reads what the link is about, and names whose account it is.
  const peeked = await post('/auth/verify/peek', { token })
  assert.equal(peeked.status, 200)
  assert.deepEqual(await peeked.json(), {
    kind: 'email',
    email: bob,
    account: { id: mallory.actor_id, name: 'Mallory', email: 'm…@example.com' },
  })

  // Opened the way the page and the apps used to: refused, nothing moves.
  const opened = await post('/auth/verify', { token })
  assert.equal(opened.status, 403)
  assert.equal(await code(opened), 'confirm_from_account')
  assert.equal((await post('/auth/verify', { token, pressed: true })).status, 403)
  // Pressed with no session at all.
  assert.equal((await confirm(token)).status, 401)
  // Pressed from another account's session — Bob's own, made under another address.
  const other = await someone(stamp, 'bobwork', 'Bob')
  const elsewhere = await confirm(token, other.access_token)
  assert.equal(elsewhere.status, 403)
  assert.equal(await code(elsewhere), 'not_this_account')
  // Through a token of Mallory's, never.
  const tool = await issueApiToken(mallory.actor_id, mallory.workspace_id, 'agent')
  assert.equal((await confirm(token, tool)).status, 403)

  // None of it changed the address or spent the link.
  assert.equal(await emailOf(mallory.actor_id), mallory.email)
  assert.ok(await stillGood(token))
  const login = await post('/auth/login', { email: bob, password: PASSWORD })
  assert.equal(login.status, 401)

  // Bob signs in with Google: an account of his own, not Mallory's.
  const made = await whoIs('google', `bob-${stamp}`, bob, true, 'Bob')
  assert.ok(made && made !== 'conflict')
  assert.notEqual(made.actorId, mallory.actor_id)
  assert.equal(await emailOf(mallory.actor_id), mallory.email)

  // And from then on Mallory's own press cannot move hers onto his.
  const late = await confirm(token, mallory.access_token)
  assert.equal(late.status, 409)
  assert.equal(await emailOf(mallory.actor_id), mallory.email)
})

test('signed in to the account on another device, the press confirms it', async () => {
  const stamp = fresh()
  const me = await someone(stamp, 'twodevices')
  const to = `twodevices-new${stamp}@example.com`
  assert.equal((await post('/api/me/email', { email: to, password: PASSWORD }, me.access_token)).status, 202)
  const token = linkIn(to)!

  // The phone with the letter, signed in to nobody, then signed in with the account's password.
  assert.equal((await confirm(token)).status, 401)
  const signedIn = await post('/auth/login', { email: me.email, password: PASSWORD })
  assert.equal(signedIn.status, 200)
  const phone = ((await signedIn.json()) as { access_token: string }).access_token
  // A press is said in the body; a request without it is not one.
  assert.equal((await confirm(token, phone, {})).status, 400)
  assert.equal((await confirm(token, phone, { pressed: 'yes' })).status, 400)
  assert.ok(await stillGood(token))

  const pressed = await confirm(token, phone)
  assert.equal(pressed.status, 200)
  assert.deepEqual(await pressed.json(), { changed: true, email: to })
  assert.equal(await emailOf(me.actor_id), to)
  // The password and both sessions are the person's, and stay.
  assert.equal((await post('/auth/login', { email: to, password: PASSWORD })).status, 200)
  assert.equal((await get('/api/me', me.access_token)).status, 200)
  assert.equal((await get('/api/me', phone)).status, 200)
  // The old address is told.
  assert.match(outbox.filter((m) => m.to === me.email).at(-1)!.subject, /changed/)
})

test('a session signed out is no press, and a link refused stays good for the right one', async () => {
  const stamp = fresh()
  const me = await someone(stamp, 'signedout')
  const to = `signedout-new${stamp}@example.com`
  assert.equal((await post('/api/me/email', { email: to, password: PASSWORD }, me.access_token)).status, 202)
  const token = linkIn(to)!
  const second = await post('/auth/login', { email: me.email, password: PASSWORD })
  const s = (await second.json()) as { access_token: string; refresh_token: string }
  assert.equal((await post('/auth/logout', { refresh_token: s.refresh_token })).status, 200)
  assert.equal((await confirm(token, s.access_token)).status, 401)
  assert.equal(await emailOf(me.actor_id), me.email)
  assert.equal((await confirm(token, me.access_token)).status, 200)
})

test('the database makes the change only for a live session of the account', async () => {
  const stamp = fresh()
  const me = await someone(stamp, 'definer')
  const other = await someone(stamp, 'definerother')
  const to = `definer-new${stamp}@example.com`
  assert.equal((await post('/api/me/email', { email: to, password: PASSWORD }, me.access_token)).status, 202)
  const hash = hashToken(linkIn(to)!)
  const said = async (session: string | null) => {
    const [r] = await asAuth((tx) => tx<{ said: string }[]>`select said from auth_email_confirm(${hash}, ${session}::uuid)`)
    return r?.said
  }
  assert.equal(await said(null), 'not_this_account')
  assert.equal(await said(sessionOf(other.access_token)), 'not_this_account')
  // Ended: the session the account signed out of.
  const ended = await post('/auth/login', { email: me.email, password: PASSWORD })
  const e = (await ended.json()) as { access_token: string; refresh_token: string }
  await post('/auth/logout', { refresh_token: e.refresh_token })
  assert.equal(await said(sessionOf(e.access_token)), 'not_this_account')
  assert.equal(await emailOf(me.actor_id), me.email)
  assert.equal(await said(sessionOf(me.access_token)), 'changed')
  assert.equal(await emailOf(me.actor_id), to)
  assert.equal(await said(sessionOf(me.access_token)), 'gone')

  // The change itself trusts the actor it is handed, so nobody may run it but the function above.
  const [may] = await asTableOwner()<{ auth: boolean; app: boolean; worker: boolean }[]>`
    select has_function_privilege('tracker_auth', 'auth_email_change(uuid, citext)', 'execute') as auth,
           has_function_privilege('tracker_app', 'auth_email_change(uuid, citext)', 'execute') as app,
           has_function_privilege('tracker_worker', 'auth_email_change(uuid, citext)', 'execute') as worker`
  assert.deepEqual({ ...may }, { auth: false, app: false, worker: false })
})

test('opening the link, by any GET, changes nothing', async () => {
  const stamp = fresh()
  const me = await someone(stamp, 'opened')
  const to = `opened-new${stamp}@example.com`
  assert.equal((await post('/api/me/email', { email: to, password: PASSWORD }, me.access_token)).status, 202)
  const token = linkIn(to)!
  const t = encodeURIComponent(token)
  for (const path of [`/verify/${t}`, `/auth/verify?token=${t}`, `/auth/verify/${t}`, `/auth/verify/peek?token=${t}`]) {
    await get(path)
    await get(path, me.access_token)
  }
  await get(`/api/me/email/confirm?token=${t}&pressed=true`, me.access_token)
  // Read by the page as often as it likes.
  for (let i = 0; i < 3; i++) assert.equal((await post('/auth/verify/peek', { token })).status, 200)
  assert.equal(await emailOf(me.actor_id), me.email)
  assert.ok(await stillGood(token))
  const [ticket] = await asTableOwner()<{ used: Date | null }[]>`
    select used_at as used from auth_ticket where token_hash = ${hashToken(token)}`
  assert.equal(ticket?.used, null)
})

test('the old address’s yes is a press too, and no session is asked for it', async () => {
  const stamp = fresh()
  const email = `yes${stamp}@gmail.com`
  const made = await whoIs('google', `yes-${stamp}`, email, true, 'Yan')
  assert.ok(made && made !== 'conflict')
  const { startSession } = await import('../src/auth/flows.js')
  const session = await startSession(made.actorId, made.workspaceId!, {}, null)
  const to = `yes-new${stamp}@example.com`
  assert.equal((await post('/api/me/email', { email: to }, session.access_token)).status, 202)
  const yes = linkIn(email)!
  // What it is about, read.
  const peeked = (await (await post('/auth/verify/peek', { token: yes })).json()) as { kind: string; email: string }
  assert.deepEqual([peeked.kind, peeked.email], ['approve', to])
  // Opened: nothing sent.
  const opened = await post('/auth/verify', { token: yes })
  assert.equal(opened.status, 403)
  assert.equal(await code(opened), 'press_required')
  assert.equal(linkIn(to), null)
  // An approval is not a confirmation, at either door.
  assert.equal((await confirm(yes, session.access_token)).status, 410)
  // Pressed, from a browser signed in to nobody: the inbox is the account.
  assert.deepEqual(await (await post('/auth/verify', { token: yes, pressed: true })).json(), { approved: true, email: to })
  assert.ok(linkIn(to))
  assert.equal(await emailOf(made.actorId), email)
})
