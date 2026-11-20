import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { registerUser } from '../src/auth/flows.js'
import { outbox } from '../src/mail.js'
import { closeDb, stamp, withActor } from './helpers.js'

after(async () => {
  await closeDb()
})

/* Migration 115: an ended session ends now. */

const PASSWORD = 'correct-horse-battery-staple'
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const me = (token: string) => app.request('/api/me', { headers: { authorization: `Bearer ${token}` } })

async function someone(tag: string) {
  const email = `${tag}${stamp()}@example.com`
  return { email, ...(await registerUser({ email, password: PASSWORD, name: 'Sam', workspace_name: `${tag} ws` })) }
}
const signIn = async (email: string, device: string) => {
  const r = await post('/auth/login', { email, password: PASSWORD }, { 'x-device': device })
  assert.equal(r.status, 200)
  return (await r.json()) as { access_token: string; refresh_token: string }
}

test('signing out stops the access token at once, and a traded refresh does not', async () => {
  const who = await someone('out')
  const laptop = await signIn(who.email, `laptop-${stamp()}`)
  // Another tab of the same browser trades the refresh token: the access
  // token this tab still holds keeps working.
  const traded = await post('/auth/refresh', { refresh_token: laptop.refresh_token })
  assert.equal(traded.status, 200)
  assert.equal((await me(laptop.access_token)).status, 200)
  const fresh = (await traded.json()) as { access_token: string; refresh_token: string }
  // Signing out ends both, now.
  assert.equal((await post('/auth/logout', { refresh_token: fresh.refresh_token })).status, 200)
  assert.equal((await me(fresh.access_token)).status, 401)
  assert.equal((await me(laptop.access_token)).status, 401)
})

test('ending the other devices from Account stops them, and not this one', async () => {
  const who = await someone('others')
  const here = await signIn(who.email, `here-${stamp()}`)
  const there = await signIn(who.email, `there-${stamp()}`)
  const r = await app.request('/api/sessions', { method: 'DELETE', headers: { authorization: `Bearer ${here.access_token}` } })
  assert.equal(r.status, 200)
  assert.equal((await me(there.access_token)).status, 401)
  assert.equal((await me(here.access_token)).status, 200)
})

/*
 * The device id is what the client says. A copy of the browser's
 * storage — or anybody who read the id — signed in under the same one,
 * and both "sign out other devices" and a password change kept it. What
 * is kept now is the session asking and the refreshes it traded into.
 */
test('a session claiming this browser’s id is signed out with the other devices', async () => {
  const who = await someone('copied')
  const device = `same-${stamp()}`
  const here = await signIn(who.email, device)
  const copy = await signIn(who.email, device)
  // This browser trades its refresh token in another tab before asking.
  const traded = await post('/auth/refresh', { refresh_token: here.refresh_token }, { 'x-device': device })
  assert.equal(traded.status, 200)
  const now = (await traded.json()) as { access_token: string; refresh_token: string }

  const r = await app.request('/api/sessions', { method: 'DELETE', headers: { authorization: `Bearer ${here.access_token}` } })
  assert.equal(r.status, 200)
  assert.equal((await me(copy.access_token)).status, 401, 'the copy is out')
  assert.equal((await post('/auth/refresh', { refresh_token: copy.refresh_token })).status, 401)
  // This one stays — the token in hand, and what it traded into.
  assert.equal((await me(here.access_token)).status, 200)
  assert.equal((await me(now.access_token)).status, 200)
  assert.equal((await post('/auth/refresh', { refresh_token: now.refresh_token }, { 'x-device': device })).status, 200)
})

/*
 * The review's reproduction: a copied access token entered the workspace it
 * was already in, and the session that made was in the asker's line — so
 * neither "sign out other devices" nor a password change ended it. Only a
 * refresh, which needs the refresh token, carries the line on now.
 */
const enterWith = async (access: string, workspaceId: string) => {
  const r = await post(`/api/workspaces/${workspaceId}/enter`, {}, { authorization: `Bearer ${access}`, 'x-device': 'attacker' })
  assert.equal(r.status, 200)
  return (await r.json()) as { access_token: string; refresh_token: string }
}

test('a session made with a copied access token is signed out with the other devices', async () => {
  const who = await someone('copiedtok')
  const device = `own-${stamp()}`
  const here = await signIn(who.email, device)
  const stolen = await enterWith(here.access_token, who.workspace_id)
  const r = await app.request('/api/sessions', { method: 'DELETE', headers: { authorization: `Bearer ${here.access_token}` } })
  assert.equal(r.status, 200)
  assert.equal((await me(stolen.access_token)).status, 401)
  assert.equal((await post('/auth/refresh', { refresh_token: stolen.refresh_token })).status, 401)
  assert.equal((await me(here.access_token)).status, 200)
})

test('a session made with a copied access token is signed out by a password change', async () => {
  const who = await someone('copiedtokpw')
  const here = await signIn(who.email, `own-${stamp()}`)
  const stolen = await enterWith(here.access_token, who.workspace_id)
  const made = await post(
    '/api/workspaces',
    { name: 'Elsewhere' },
    { authorization: `Bearer ${here.access_token}`, 'x-device': 'attacker' },
  )
  assert.equal(made.status, 201)
  const fromMade = (await made.json()) as { access_token: string; refresh_token: string }
  const r = await post(
    '/api/me/password',
    { current: PASSWORD, password: 'a-new-one-entirely-for-this' },
    { authorization: `Bearer ${here.access_token}` },
  )
  assert.equal(r.status, 200)
  assert.equal((await me(stolen.access_token)).status, 401)
  assert.equal((await post('/auth/refresh', { refresh_token: stolen.refresh_token })).status, 401)
  assert.equal((await me(fromMade.access_token)).status, 401)
  assert.equal((await post('/auth/refresh', { refresh_token: fromMade.refresh_token })).status, 401)
  assert.equal((await me(here.access_token)).status, 200)
})

test('a password change signs out a session claiming this browser’s id', async () => {
  const who = await someone('copiedpw')
  const device = `same-${stamp()}`
  const here = await signIn(who.email, device)
  const copy = await signIn(who.email, device)
  const r = await post(
    '/api/me/password',
    { current: PASSWORD, password: 'a-new-one-entirely-for-this' },
    { authorization: `Bearer ${here.access_token}` },
  )
  assert.equal(r.status, 200)
  assert.equal((await me(copy.access_token)).status, 401)
  assert.equal((await post('/auth/refresh', { refresh_token: copy.refresh_token })).status, 401)
  assert.equal((await me(here.access_token)).status, 200)
  assert.equal((await post('/auth/refresh', { refresh_token: here.refresh_token })).status, 200)
})

test('a reset ends every session and every tool’s token, writes it down and says so', async () => {
  const who = await someone('reset')
  // On a paid plan, where a token can be made.
  await withActor(who.actor_id, (tx) => tx`update workspace set plan = 'team' where id = ${who.workspace_id}`)
  const stolen = await signIn(who.email, `stolen-${stamp()}`)
  // A token made while somebody else was in the account.
  const made = await app.request('/api/tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${stolen.access_token}` },
    body: JSON.stringify({ name: 'mine now' }),
  })
  assert.equal(made.status, 201)
  const { token } = (await made.json()) as { token: string }
  assert.equal((await me(token)).status, 200)

  assert.equal((await post('/auth/password/forgot', { email: who.email })).status, 200)
  const link = /\/reset\/([^\s"<]+)/.exec(outbox.filter((m) => m.to === who.email).at(-1)!.text)![1]!
  assert.equal((await post('/auth/password/reset', { token: decodeURIComponent(link), password: 'a-new-one-entirely' })).status, 200)

  assert.equal((await me(stolen.access_token)).status, 401, 'the session in hand stops')
  assert.equal((await me(token)).status, 401, 'and so does the token made with it')
  assert.match(outbox.filter((m) => m.to === who.email).at(-1)!.subject, /password was reset/)
  const [logged] = await withActor(
    who.actor_id,
    (tx) => tx<{ n: number }[]>`
      select count(*)::int as n from security_event where actor_id = ${who.actor_id} and kind = 'password_reset'`,
  )
  assert.equal(logged!.n, 1)
})
