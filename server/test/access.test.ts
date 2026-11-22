import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/http/routes.js'
import { whoIs } from '../src/http/access.js'
import { outbox } from '../src/mail.js'
import { registerUser } from '../src/auth/flows.js'
import { closeDb } from './helpers.js'
import postgres from 'postgres'
/* The sign-in role's connection: the tickets, links and passwords these
   fixtures make by hand are its definers' alone (migration 308). */
import { asAuth as withoutActor } from '../src/db.js'
import { hashPassword } from '../src/auth/crypto.js'

/* As the tables' owner, for what only a fixture writes or reads. */
const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

after(async () => {
  await owner.end()
  await closeDb()
})

const post = (path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

test('a forgotten password is set again by a link that works once, and signs everything out', async () => {
  const stamp = Date.now().toString(36)
  const email = `forgot${stamp}@example.com`
  const old = await registerUser({ email, password: 'correct-horse-battery-staple', name: 'Ann', workspace_name: `F ${stamp}` })

  // The same answer whether or not there is an account.
  assert.equal((await post('/auth/password/forgot', { email: `nobody${stamp}@example.com` })).status, 200)
  assert.equal(
    outbox.some((m) => m.to === `nobody${stamp}@example.com`),
    false,
  )
  assert.equal((await post('/auth/password/forgot', { email })).status, 200)
  const mail = outbox.filter((m) => m.to === email).at(-1)!
  const token = decodeURIComponent(/\/reset\/([^\s"<]+)/.exec(mail.text)![1]!)

  assert.equal((await post('/auth/password/reset', { token, password: 'a-new-one-entirely' })).status, 200)
  // Once.
  assert.equal((await post('/auth/password/reset', { token, password: 'and-another-again' })).status, 410)
  // The old session is gone and the new password works.
  assert.equal((await post('/auth/refresh', { refresh_token: old.refresh_token })).status, 401)
  assert.equal((await post('/auth/login', { email, password: 'correct-horse-battery-staple' })).status, 401)
  assert.equal((await post('/auth/login', { email, password: 'a-new-one-entirely' })).status, 200)
})

test('a provider account is known again, linked by a vouched email, and never by an unvouched one', async () => {
  const stamp = Date.now().toString(36)
  // New: an account and a workspace of its own.
  const made = await whoIs('google', `g-${stamp}`, `new${stamp}@example.com`, true, 'Gina Grey')
  assert.ok(made && made !== 'conflict')
  // The same subject again is the same person.
  const again = await whoIs('google', `g-${stamp}`, `new${stamp}@example.com`, true, 'Gina Grey')
  assert.deepEqual(again, made)

  // An existing account, by an email the provider vouches for: linked.
  const email = `has${stamp}@example.com`
  const had = await registerUser({ email, password: 'correct-horse-battery-staple', name: 'Hal', workspace_name: `H ${stamp}` })
  const linked = await whoIs('apple', `a-${stamp}`, email, true, '')
  assert.ok(linked && linked !== 'conflict')
  assert.equal(linked.actorId, had.actor_id)

  // The same address unvouched by another provider account: refused.
  assert.equal(await whoIs('google', `g2-${stamp}`, email, false, ''), 'conflict')
})

test('a handoff ticket becomes a session once', async () => {
  const stamp = Date.now().toString(36)
  const who = await whoIs('google', `h-${stamp}`, `hand${stamp}@example.com`, true, 'Hana')
  assert.ok(who && who !== 'conflict')
  // Made the way the callback makes one for an app: bound to its secret.
  const { generateToken, hashToken } = await import('../src/auth/crypto.js')
  const { createHash, randomBytes } = await import('node:crypto')
  const verifier = randomBytes(32).toString('base64url')
  const bound = `app:${createHash('sha256').update(verifier).digest('base64url')}`
  const ticket = generateToken('hof')
  await withoutActor(
    (tx) =>
      tx`select auth_ticket_make_bound(${hashToken(ticket)}, 'handoff', ${who.actorId}, ${who.workspaceId}, interval '2 minutes', ${bound})`,
  )
  const first = await post('/auth/oauth/exchange', { handoff: ticket, verifier })
  assert.equal(first.status, 200)
  assert.ok(((await first.json()) as { access_token?: string }).access_token)
  assert.equal((await post('/auth/oauth/exchange', { handoff: ticket, verifier })).status, 401)
  // One bound to nothing — none is made any more — is nobody's.
  const loose = generateToken('hof')
  await withoutActor(
    (tx) => tx`select auth_ticket_make(${hashToken(loose)}, 'handoff', ${who.actorId}, ${who.workspaceId}, interval '2 minutes')`,
  )
  assert.equal((await post('/auth/oauth/exchange', { handoff: loose })).status, 401)
})

/*
 * An account made through Google or Apple has no password, and no password is
 * no way in by password. It used to compare against a hash of "dummy" made on
 * the spot — so `dummy` signed anybody in as any provider account.
 */
test('an account made through a provider cannot be signed into with any password', async () => {
  const stamp = Date.now().toString(36)
  const email = `nopass${stamp}@example.com`
  const made = await whoIs('google', `np-${stamp}`, email, true, 'Nora')
  assert.ok(made && made !== 'conflict')
  for (const password of ['dummy', '', 'x']) {
    const r = await post('/auth/login', { email, password })
    assert.notEqual(r.status, 200, `signed in with "${password}"`)
  }
})

/* A token is a narrow key: it is not traded for a session in another workspace or its own. */
test('an API token cannot enter a workspace and come away with a session', async () => {
  const { issueApiToken } = await import('../src/auth/flows.js')
  const stamp = Date.now().toString(36)
  const u = await registerUser({
    email: `tok${stamp}@example.com`,
    password: 'correct-horse-battery-staple',
    name: 'Tia',
    workspace_name: `T ${stamp}`,
  })
  const token = await issueApiToken(u.actor_id, u.workspace_id, 'agent')
  const r = await app.request(`/api/workspaces/${u.workspace_id}/enter`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(r.status, 403)
})

const register = (email: string, extra: Record<string, unknown> = {}, cookie?: string) =>
  app.request('/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ email, name: 'Sam Signup', ...extra }),
  })
const linkIn = (to: string, path: 'verify' | 'reset') => {
  const mail = outbox.filter((m) => m.to === to).at(-1)
  const found = mail && new RegExp(`/${path}/([^\\s"<]+)`).exec(mail.text)
  return found ? decodeURIComponent(found[1]!) : null
}
const choose = (token: string, password: string, cookie?: string) =>
  app.request('/auth/password/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ token, password }),
  })
const cookieOf = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0]!
const passwordOf = async (email: string) =>
  (
    await withoutActor((tx) => tx<{ hash: string | null }[]>`select auth_password_hash(actor_id) as hash from auth_lookup_user(${email})`)
  )[0]?.hash ?? null

test('signing up asks for no password: the letter does, and choosing it signs in where the sign-up was', async () => {
  const stamp = Date.now().toString(36)
  const email = `signup${stamp}@example.com`
  const made = await register(email)
  assert.equal(made.status, 202)
  // No session, and the browser that signed up named by its cookie.
  const answer = (await made.json()) as { pending: boolean; access_token?: string }
  assert.equal(answer.pending, true)
  assert.equal(answer.access_token, undefined)
  const bound = cookieOf(made)
  assert.match(bound, /^tuff_bind=/)
  // Nothing is kept to sign in with, and nothing signs in.
  assert.equal(await passwordOf(email), null)
  assert.equal((await post('/auth/login', { email, password: 'correct-horse-battery-staple' })).status, 401)

  // The letter asks for a password, by a link of a day.
  const mail = outbox.filter((m) => m.to === email).at(-1)!
  assert.match(mail.subject, /Confirm your email/)
  assert.match(mail.text, /choose a password/)
  const token = linkIn(email, 'reset')
  assert.ok(token?.startsWith('chs_'), 'a link to choose a password')
  assert.equal(linkIn(email, 'verify'), null)

  // Chosen in the browser that signed up: confirmed, set, and in — the
  // workspace called after the name.
  const chosen = await choose(token!, 'a-password-of-my-own', bound)
  assert.equal(chosen.status, 200)
  const session = (await chosen.json()) as { ok: boolean; access_token?: string; workspace_id?: string }
  assert.equal(session.ok, true)
  assert.ok(session.access_token)
  const [ws] = await owner<{ name: string }[]>`select name from workspace where id = ${session.workspace_id!}`
  assert.equal(ws?.name, 'Sam’s workspace')
  // Once.
  assert.equal((await choose(token!, 'and-another-again', bound)).status, 410)
  // And the password is the way in now.
  assert.equal((await post('/auth/login', { email, password: 'a-password-of-my-own' })).status, 200)
  // No "your password was reset" letter to the inbox that just chose it.
  assert.doesNotMatch(outbox.filter((m) => m.to === email).at(-1)!.subject, /reset/)
})

test('the letter opened anywhere else sets the password and signs nobody in', async () => {
  const stamp = Date.now().toString(36)
  const email = `elsewhere${stamp}@example.com`
  assert.equal((await register(email, { workspace_name: `Named ${stamp}` })).status, 202)
  const chosen = await choose(linkIn(email, 'reset')!, 'chosen-on-the-phone')
  assert.equal(chosen.status, 200)
  assert.deepEqual(await chosen.json(), { ok: true })
  const signedIn = await post('/auth/login', { email, password: 'chosen-on-the-phone' })
  assert.equal(signedIn.status, 200)
  // A workspace name sent is still taken.
  const s = (await signedIn.json()) as { workspace_id: string }
  const [ws] = await owner<{ name: string }[]>`select name from workspace where id = ${s.workspace_id}`
  assert.equal(ws?.name, `Named ${stamp}`)
})

test('an app from before the password came after the proof sends one: no 400, the same letter, and nothing kept', async () => {
  const stamp = Date.now().toString(36)
  const email = `oldapp${stamp}@example.com`
  // What the iPhone and Android builds send — a short one too.
  const made = await register(email, { password: 'correct-horse-battery-staple', workspace_name: `Old ${stamp}` })
  assert.equal(made.status, 202)
  // Decodable as the type those builds read it as: `{ email, approve }`.
  assert.deepEqual(await made.json(), { pending: true, email, approve: false })
  assert.equal((await register(`short${email}`, { password: 'x' })).status, 202)
  assert.equal(await passwordOf(email), null)
  assert.equal((await post('/auth/login', { email, password: 'correct-horse-battery-staple' })).status, 401)
  assert.ok(linkIn(email, 'reset')?.startsWith('chs_'))
})

test('signing up with an address that has an account says the same, and tells the address', async () => {
  const stamp = Date.now().toString(36)
  const email = `twice${stamp}@example.com`
  await registerUser({ email, password: 'correct-horse-battery-staple', name: 'Tia', workspace_name: `T2 ${stamp}` })
  const fresh = await register(`fresh${email}`)
  const again = await register(email, { password: 'somebody-elses-password' })
  // The screen hears what a new address hears, headers and all.
  assert.equal(again.status, 202)
  assert.deepEqual(await again.json(), { pending: true, email, approve: false })
  assert.deepEqual([...again.headers.keys()].sort(), [...fresh.headers.keys()].sort())
  assert.match(cookieOf(again), /^tuff_bind=/)
  const mail = outbox.filter((m) => m.to === email).at(-1)!
  assert.match(mail.subject, /already have/)
  // And nothing about the account changed.
  assert.equal((await post('/auth/login', { email, password: 'correct-horse-battery-staple' })).status, 200)
  assert.equal((await post('/auth/login', { email, password: 'somebody-elses-password' })).status, 401)
})

test('a stranger who signs up with your address never holds a way into it', async () => {
  const stamp = Date.now().toString(36)
  const email = `taken${stamp}@example.com`
  // Somebody else types your address — and, from an old app, a password.
  const theirs = await register(email, { password: 'the-strangers-password', name: 'Stranger' })
  assert.equal(theirs.status, 202)
  const strangersBrowser = cookieOf(theirs)
  // Nothing they typed opens anything, now or after you confirm.
  assert.equal(await passwordOf(email), null)
  assert.equal((await post('/auth/login', { email, password: 'the-strangers-password' })).status, 401)

  // You press the letter you never asked for, and choose a password.
  const token = linkIn(email, 'reset')!
  const chosen = await choose(token, 'your-own-password-here')
  assert.equal(chosen.status, 200)
  assert.equal((await post('/auth/login', { email, password: 'your-own-password-here' })).status, 200)
  assert.equal((await post('/auth/login', { email, password: 'the-strangers-password' })).status, 401)
  // Their browser was named at sign-up, and is still nobody's way in: the
  // token was in your inbox, and the name went with the confirmation.
  assert.equal((await choose(token, 'the-strangers-try', strangersBrowser)).status, 410)
})

test('a sign-up again sends the letter again, and only so many', async () => {
  const stamp = Date.now().toString(36)
  const email = `again${stamp}@example.com`
  assert.equal((await register(email)).status, 202)
  const first = linkIn(email, 'reset')
  // What "Send another" does: the same sign-up.
  assert.equal((await register(email)).status, 202)
  const second = linkIn(email, 'reset')
  assert.ok(first && second && second !== first)
  // Both good until one is used: the account is the same one.
  assert.equal((await choose(first!, 'the-first-one-works')).status, 200)
  // Three letters an hour to a known address, however often it is asked.
  const before = outbox.filter((m) => m.to === email).length
  for (let i = 0; i < 4; i++) await register(email)
  assert.ok(outbox.filter((m) => m.to === email).length - before <= 3)
})

test('a confirmation link from before the password came after the proof takes the old password and asks for a new one', async () => {
  const stamp = Date.now().toString(36)
  const email = `legacy${stamp}@example.com`
  // An account as sign-up made them until now: unconfirmed, with the
  // password typed into the form — and, from a session it never had,
  // a provider sign-in and a ticket, to see that they go too.
  const { generateToken, hashToken } = await import('../src/auth/crypto.js')
  const made = await registerUser({ email, password: 'whoever-typed-this', name: 'Leg', workspace_name: `L ${stamp}` })
  const id = made.actor_id
  await owner`update app_user set email_verified_at = null where actor_id = ${id}`
  const typed = await hashPassword('whoever-typed-this')
  await owner`update app_user set password_hash = ${typed} where actor_id = ${id}`
  await withoutActor((tx) => tx`select auth_identity_link(${id}, 'google', ${`legacy-${stamp}`}, ${email})`)
  const verify = generateToken('vfy')
  const other = generateToken('rst')
  await withoutActor((tx) => tx`select auth_ticket_make(${hashToken(verify)}, 'verify', ${id}, ${null}, interval '1 day')`)
  await withoutActor((tx) => tx`select auth_ticket_make(${hashToken(other)}, 'reset', ${id}, ${null}, interval '1 day')`)

  const followed = await post('/auth/verify', { token: verify })
  assert.equal(followed.status, 200)
  const said = (await followed.json()) as { confirmed?: boolean; choose_password?: string; access_token?: string }
  assert.equal(said.confirmed, true)
  assert.equal(said.access_token, undefined)
  assert.ok(said.choose_password?.startsWith('chs_'))
  // The password from before the proof, the provider sign-in, the session
  // and the open ticket are gone.
  assert.equal(await passwordOf(email), null)
  assert.equal((await post('/auth/login', { email, password: 'whoever-typed-this' })).status, 401)
  const [ways] = await withoutActor((tx) => tx<{ n: number }[]>`select count(*)::int as n from auth_identities_of(${id})`)
  assert.equal(ways?.n, 0)
  assert.equal((await post('/auth/refresh', { refresh_token: made.refresh_token })).status, 401)
  assert.equal((await choose(other, 'not-from-this-ticket')).status, 410)
  // The ticket the answer carried chooses the new one.
  assert.equal((await choose(said.choose_password!, 'the-owners-own-password')).status, 200)
  assert.equal((await post('/auth/login', { email, password: 'the-owners-own-password' })).status, 200)
})

test('signing in with a password from before the proof sends the letter that asks for a new one', async () => {
  const stamp = Date.now().toString(36)
  const email = `legacylogin${stamp}@example.com`
  const made = await registerUser({ email, password: 'typed-before-proof', name: 'Lou', workspace_name: `LL ${stamp}` })
  await owner`update app_user set email_verified_at = null where actor_id = ${made.actor_id}`
  const typed = await hashPassword('typed-before-proof')
  await owner`update app_user set password_hash = ${typed} where actor_id = ${made.actor_id}`
  const tried = await post('/auth/login', { email, password: 'typed-before-proof' })
  assert.equal(tried.status, 403)
  assert.equal(((await tried.json()) as { error: { code: string } }).error.code, 'email_unverified')
  assert.ok(linkIn(email, 'reset')?.startsWith('chs_'))
  assert.equal(linkIn(email, 'verify'), null)
})

test('the database confirms no address and keeps a password set before it', async () => {
  const stamp = Date.now().toString(36)
  const email = `rule${stamp}@example.com`
  const made = await registerUser({ email, password: 'set-before-proof', name: 'Rue', workspace_name: `R ${stamp}` })
  const id = made.actor_id
  await owner`update app_user set email_verified_at = null where actor_id = ${id}`
  const typed = await hashPassword('set-before-proof')
  await owner`update app_user set password_hash = ${typed}, totp_enabled = true, totp_secret_enc = 'sealed' where actor_id = ${id}`
  // Any path that confirms without setting the password: the password goes,
  // and the second factor nobody proved the address for.
  await withoutActor((tx) => tx`select auth_confirm_email(${id})`)
  const [u] = await owner<{ hash: string | null; totp: boolean; at: Date | null }[]>`
    select password_hash as hash, totp_enabled as totp, email_verified_at as at from app_user where actor_id = ${id}`
  assert.equal(u?.hash, null)
  assert.equal(u?.totp, false)
  assert.ok(u?.at)
  // Setting the password in the same update keeps it: a reset by mailed link.
  const email2 = `rule2${stamp}@example.com`
  const made2 = await registerUser({ email: email2, password: 'whatever-it-was', name: 'Rio', workspace_name: `R2 ${stamp}` })
  await owner`update app_user set email_verified_at = null where actor_id = ${made2.actor_id}`
  const chosen = await hashPassword('chosen-with-the-proof')
  await withoutActor((tx) => tx`select auth_set_password(${made2.actor_id}, ${chosen})`)
  assert.equal((await post('/auth/login', { email: email2, password: 'chosen-with-the-proof' })).status, 200)
})

test('a provider vouching for an unconfirmed address takes it from whoever typed it', async () => {
  const stamp = Date.now().toString(36)
  const email = `claimed${stamp}@example.com`
  assert.equal((await register(email, { password: 'the-strangers-password' })).status, 202)
  const claimed = await whoIs('google', `c-${stamp}`, email, true, 'Real Owner')
  assert.ok(claimed && claimed !== 'conflict')
  // The stranger's password no longer opens anything.
  assert.equal((await post('/auth/login', { email, password: 'the-strangers-password' })).status, 401)
  // And a provider that does not vouch makes no account at all.
  assert.equal(await whoIs('google', `u-${stamp}`, `unvouched${stamp}@example.com`, false, 'Nobody'), null)
})

test('a device is one line: a refresh keeps its name, and a browser is one line however many sessions', async () => {
  const stamp = Date.now().toString(36)
  const email = `devices${stamp}@example.com`
  await registerUser({ email, password: 'correct-horse-battery-staple', name: 'Dev', workspace_name: `D ${stamp}` })
  const signIn = async (ua: string, device: string) =>
    (await (
      await app.request('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': ua, 'x-device': device },
        body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }),
      })
    ).json()) as { access_token: string; refresh_token: string }
  const phone = await signIn('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1', 'phone-0001-device')
  const laptop = await signIn('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0 Safari/537.36', 'laptop-0001-browser')
  const LAPTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0 Safari/537.36'
  const as = (token: string, path: string, init: RequestInit = {}) =>
    app.request(`/api${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'x-api-version': '1',
        'content-type': 'application/json',
        'user-agent': LAPTOP,
        'x-device': 'laptop-0001-browser',
      },
    })
  type Line = { id: string; user_agent: string | null; current: boolean }
  const list = async (token: string) => ((await (await as(token, '/sessions')).json()) as { sessions: Line[] }).sessions

  // The phone refreshes: still the phone, and still one line for it.
  const turned = (await (
    await app.request('/auth/refresh', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1',
        'x-device': 'phone-0001-device',
      },
      body: JSON.stringify({ refresh_token: phone.refresh_token }),
    })
  ).json()) as { access_token: string }
  let lines = await list(laptop.access_token)
  assert.equal(lines.length, 3) // the one registering made, the phone, the laptop
  assert.equal(lines.filter((l) => l.user_agent?.includes('iPhone')).length, 1)
  assert.equal(lines.filter((l) => l.current).length, 1)
  assert.ok(lines.find((l) => l.current)!.user_agent!.includes('Macintosh'))

  // A second workspace, made from the laptop: still one line for the laptop,
  // whose other tabs go on using the session it came from.
  const made = await as(laptop.access_token, '/workspaces', { method: 'POST', body: JSON.stringify({ name: `Second ${stamp}` }) })
  const second = (await made.json()) as { access_token: string }
  lines = await list(second.access_token)
  assert.equal(lines.length, 3)
  assert.equal(lines.filter((l) => l.user_agent?.includes('Macintosh')).length, 1)
  assert.equal((await as(laptop.access_token, '/sessions')).status, 200)

  // And every other device, signed out at once.
  const ended = await as(second.access_token, '/sessions', { method: 'DELETE' })
  assert.equal(ended.status, 200)
  lines = await list(second.access_token)
  assert.deepEqual(
    lines.map((l) => l.current),
    [true],
  )
  // The phone's is gone for good.
  assert.equal((await post('/auth/refresh', { refresh_token: (turned as unknown as { refresh_token: string }).refresh_token })).status, 401)
})
