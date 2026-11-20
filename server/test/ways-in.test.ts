import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import postgres from 'postgres'

/* The sign-in's OAuth App — before anything reads the environment. */
process.env.GITHUB_SIGNIN_CLIENT_ID = 'signin-id'
process.env.GITHUB_SIGNIN_CLIENT_SECRET = 'signin-secret'
process.env.GOOGLE_CLIENT_ID = 'google-id'
process.env.GOOGLE_CLIENT_SECRET = 'google-secret'

const { app } = await import('../src/http/routes.js')
const { registerUser, issueApiToken } = await import('../src/auth/flows.js')
const { outbox } = await import('../src/mail.js')
const { closeDb, stamp } = await import('./helpers.js')

/* As the tables' owner, for the columns the application may not touch. */
const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

after(async () => {
  await owner.end()
  await closeDb()
})

/*
 * A fake GitHub, as `github-sign-in.test.ts` has: a code is an account,
 * traded only with the verifier its challenge was made from.
 */
type Account = { id: number; login: string; email: string | null }
const codes = new Map<string, Account>()
const tokens = new Map<string, Account>()
const challenges = new Map<string, string>()
let made = 0
const real = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!url.startsWith('https://github.com/') && !url.startsWith('https://api.github.com/')) return real(input, init)
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
  if (url === 'https://github.com/login/oauth/access_token') {
    const f = Object.fromEntries(new URLSearchParams(String(init?.body ?? '')))
    const who = codes.get(f.code ?? '')
    const got = createHash('sha256')
      .update(f.code_verifier ?? '')
      .digest('base64url')
    if (!who || challenges.get(f.code!) !== got) return json({ error: 'bad_verification_code' })
    codes.delete(f.code!)
    const t = `gho_${++made}`
    tokens.set(t, who)
    return json({ access_token: t })
  }
  if (url.startsWith('https://api.github.com/applications/')) return new Response(null, { status: 204 })
  const who = tokens.get(new Headers(init?.headers).get('authorization')?.replace(/^(Bearer|token) /, '') ?? '')
  if (!who) return json({ message: 'Bad credentials' }, 401)
  if (url === 'https://api.github.com/user') return json({ id: who.id, login: who.login, name: null })
  if (url === 'https://api.github.com/user/emails') return json(who.email ? [{ email: who.email, primary: true, verified: true }] : [])
  return json({ message: 'Not Found' }, 404)
}) as typeof fetch

let nextId = 9_000_000 + Math.floor(Math.random() * 1_000_000)
const github = (email: string | null): Account => {
  const id = ++nextId
  return { id, login: `octo${id}`, email }
}

const PASSWORD = 'correct-horse-battery-staple'
async function person() {
  const s = stamp()
  const email = `ways${s}@example.com`
  const session = await registerUser({
    email,
    password: PASSWORD,
    name: 'Way',
    workspace_name: `W ${s.slice(0, 4)}`,
    workspace_slug: `ways-${s}`,
  })
  return { email, token: session.access_token, actorId: session.actor_id, slug: `ways-${s}` }
}

const call = (method: string, path: string, token: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const cookieOf = (r: Response, name: string) => new RegExp(`${name}=([^;]*)`).exec(r.headers.get('set-cookie') ?? '')?.[1] ?? ''

/*
 * Connect, as the page and the browser do: the proof, the cookie it left,
 * the start, GitHub answering with `who`, and where the callback sends it.
 * `elsewhere` finishes in a browser that did not start it.
 */
async function connect(
  token: string,
  who: Account,
  opts: { password?: string; elsewhere?: boolean; before?: () => Promise<unknown> } = {},
): Promise<string> {
  const asked = await call('POST', '/api/me/ways-in/github', token, { password: opts.password ?? PASSWORD })
  assert.equal(asked.status, 200)
  const { url } = (await asked.json()) as { url: string }
  assert.equal(url, '/auth/oauth/github/start?link=1')
  const link = cookieOf(asked, '__Host-tuff_link')
  assert.match(asked.headers.get('set-cookie') ?? '', /__Host-tuff_link=lnk_[^;]+; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax/)
  const start = await app.request(url, { headers: { cookie: `__Host-tuff_link=${link}`, 'sec-fetch-site': 'same-origin' } })
  assert.equal(start.status, 302)
  // The state no other host under the domain can plant.
  assert.match(start.headers.get('set-cookie') ?? '', /__Host-tuff_oauth=[^;]+; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=None/)
  // Only the ticket's hash rides in the signed state, never the ticket.
  const state = JSON.parse(Buffer.from(cookieOf(start, '__Host-tuff_oauth').split('.')[1]!, 'base64url').toString()) as { link?: string }
  assert.ok(state.link && state.link !== link)
  await opts.before?.()
  const to = new URL(start.headers.get('location')!)
  const code = `link-${who.id}-${++made}`
  codes.set(code, who)
  challenges.set(code, to.searchParams.get('code_challenge')!)
  const back = await app.request(`/auth/oauth/github/callback?code=${code}&state=${to.searchParams.get('state')}`, {
    headers: opts.elsewhere ? {} : { cookie: `__Host-tuff_oauth=${cookieOf(start, '__Host-tuff_oauth')}` },
  })
  return back.headers.get('location')!
}

/* Signing in with that GitHub afterwards, as a browser: who it signs in. */
async function signsIn(who: Account): Promise<string | null> {
  const start = await app.request('/auth/oauth/github/start', { headers: { 'sec-fetch-site': 'same-origin' } })
  const to = new URL(start.headers.get('location')!)
  const code = `in-${who.id}-${++made}`
  codes.set(code, who)
  challenges.set(code, to.searchParams.get('code_challenge')!)
  const back = await app.request(`/auth/oauth/github/callback?code=${code}&state=${to.searchParams.get('state')}`, {
    headers: { cookie: `__Host-tuff_oauth=${cookieOf(start, '__Host-tuff_oauth')}` },
  })
  const handoff = new URL(back.headers.get('location')!, 'https://usetuff.com').searchParams.get('handoff')
  if (!handoff) return null
  const r = await app.request('/auth/oauth/exchange', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://usetuff.com',
      cookie: `__Host-tuff_handoff=${cookieOf(back, '__Host-tuff_handoff')}`,
    },
    body: JSON.stringify({ handoff }),
  })
  return r.ok ? ((await r.json()) as { actor_id: string }).actor_id : null
}

type Ways = { offered: string[]; ways: { id: string; provider: string; email: string | null }[]; password: boolean; asks: string }
const ways = async (token: string) => (await (await call('GET', '/api/me/ways-in', token)).json()) as Ways

test('a GitHub is added only with the password, signs in afterwards, and the address is told', async () => {
  const me = await person()
  const before = await ways(me.token)
  assert.deepEqual(before.ways, [])
  assert.ok(before.offered.includes('github'))
  assert.equal(before.asks, 'password')

  // A session alone, or a wrong password, is a laptop left open.
  assert.equal((await call('POST', '/api/me/ways-in/github', me.token, {})).status, 403)
  assert.equal((await call('POST', '/api/me/ways-in/github', me.token, { password: 'not-it-at-all' })).status, 403)
  assert.equal((await call('POST', '/api/me/ways-in/nowhere', me.token, { password: PASSWORD })).status, 404)

  // Whatever its address: the person proved who they are first.
  const mine = github(`elsewhere${stamp()}@example.org`)
  assert.equal(await connect(me.token, mine), `/${me.slug}/account?ways=added`)
  const after = await ways(me.token)
  assert.deepEqual(
    after.ways.map((w) => [w.provider, w.email]),
    [['github', mine.email]],
  )
  assert.equal(await signsIn(mine), me.actorId)
  const told = [...outbox].reverse().find((m) => m.to === me.email)!
  assert.match(told.subject, /GitHub can now sign in to your Tuff account/)
  assert.match(told.text, new RegExp(mine.email!.replace('.', '\\.')))
})

test('the ticket goes nowhere without its cookie, and finishes only in the browser that started', async () => {
  const me = await person()
  // An address someone was sent, without the cookie: nothing to carry.
  const bare = await app.request('/auth/oauth/github/start?link=1', { headers: { 'sec-fetch-site': 'same-origin' } })
  assert.equal(bare.headers.get('location'), '/')
  assert.equal(bare.headers.get('set-cookie')?.includes('tuff_oauth='), undefined)
  // A cookie that is not a ticket.
  const forged = await app.request('/auth/oauth/github/start?link=1', { headers: { cookie: '__Host-tuff_link=lnk_forged' } })
  assert.equal(forged.headers.get('location'), '/')
  // Started here, finished in another browser: refused, and nothing added.
  const theirs = github(null)
  assert.equal(await connect(me.token, theirs, { elsewhere: true }), '/signin?oauth=expired')
  assert.deepEqual((await ways(me.token)).ways, [])
  // A ticket for one provider starts no other.
  const asked = await call('POST', '/api/me/ways-in/github', me.token, { password: PASSWORD })
  const other = await app.request('/auth/oauth/google/start?link=1', {
    headers: { cookie: `__Host-tuff_link=${cookieOf(asked, '__Host-tuff_link')}` },
  })
  assert.equal(other.headers.get('location'), '/')
  // The session that asked, ended on the way — a reset, signing out
  // everywhere — takes the way in it was adding with it.
  const late = github(null)
  const ended = await connect(me.token, late, {
    before: () => owner`update refresh_session set ended_at = now() where actor_id = ${me.actorId}`,
  })
  assert.equal(ended, `/${me.slug}/account?ways=failed`)
  assert.equal(await signsIn(late), null)
})

test('a GitHub that is somebody else’s is never moved to whoever connects it', async () => {
  const one = await person()
  const two = await person()
  const shared = github(null)
  assert.equal(await connect(one.token, shared), `/${one.slug}/account?ways=added`)
  assert.equal(await connect(two.token, shared), `/${two.slug}/account?ways=taken`)
  assert.equal(await signsIn(shared), one.actorId)
  // Nor one connected in Account settings by somebody else, as the GitHub App.
  const connected = github(null)
  await owner`insert into github_person (actor_id, github_id, login) values (${one.actorId}, ${connected.id}, ${connected.login})`
  assert.equal(await connect(two.token, connected), `/${two.slug}/account?ways=taken`)
  assert.deepEqual((await ways(two.token)).ways, [])
})

test('one is removed only with the proof, never the last, and the address is told', async () => {
  const me = await person()
  const first = github(null)
  await connect(me.token, first)
  const [way] = (await ways(me.token)).ways
  assert.equal((await call('DELETE', `/api/me/ways-in/${way!.id}`, me.token, {})).status, 403)
  // Somebody else's id is nobody's here.
  const other = await person()
  assert.equal((await call('DELETE', `/api/me/ways-in/${way!.id}`, other.token, { password: PASSWORD })).status, 404)

  // With no password, the one provider left is how they sign in.
  await owner`update app_user set password_hash = null where actor_id = ${me.actorId}`
  const asked = await ways(me.token)
  assert.equal(asked.password, false)
  assert.equal(asked.asks, 'email')
  // A code sent for leaving — deleting, handing over — does not change a way in.
  assert.equal((await call('POST', '/api/me/inbox-code', me.token, {})).status, 202)
  const leaving = /(\d{6}) is your Tuff code/.exec([...outbox].reverse().find((m) => m.to === me.email)!.subject)![1]!
  assert.equal((await call('DELETE', `/api/me/ways-in/${way!.id}`, me.token, { code: leaving })).status, 403)
  assert.equal((await call('POST', '/api/me/inbox-code', me.token, { for: 'ways' })).status, 202)
  const mail = [...outbox].reverse().find((m) => m.to === me.email)!
  assert.match(mail.text, /add or remove a way to sign in/)
  const code = /(\d{6}) is your Tuff code/.exec(mail.subject)![1]!
  const last = await call('DELETE', `/api/me/ways-in/${way!.id}`, me.token, { code })
  assert.equal(last.status, 409)
  assert.equal((await ways(me.token)).ways.length, 1)

  // With a password again, it can go, and the address hears of it.
  const { hashPassword } = await import('../src/auth/crypto.js')
  await owner`update app_user set password_hash = ${await hashPassword(PASSWORD)} where actor_id = ${me.actorId}`
  assert.equal((await call('DELETE', `/api/me/ways-in/${way!.id}`, me.token, { password: 'not-it-at-all' })).status, 403)
  assert.equal((await call('DELETE', `/api/me/ways-in/${way!.id}`, me.token, { password: PASSWORD })).status, 200)
  assert.deepEqual((await ways(me.token)).ways, [])
  assert.equal(await signsIn(first), null)
  const told = [...outbox].reverse().find((m) => m.to === me.email)!
  assert.match(told.subject, /GitHub was removed from your Tuff account/)
})

test('a connected tool can neither see nor change how somebody signs in', async () => {
  const me = await person()
  const [ws] = await owner<{ id: string }[]>`select workspace_id as id from membership where actor_id = ${me.actorId} limit 1`
  const tool = await issueApiToken(me.actorId, ws!.id, 'agent')
  assert.equal((await call('GET', '/api/me/ways-in', tool)).status, 403)
  assert.equal((await call('POST', '/api/me/ways-in/github', tool, { password: PASSWORD })).status, 403)
})

/*
 * From an app. The app's own client sends
 * neither `Origin` nor `Sec-Fetch-Site`; its sheet opens the start with
 * `Sec-Fetch-Site: none` and carries none of the app's cookies.
 */
const { randomBytes } = await import('node:crypto')
const { startSession } = await import('../src/auth/flows.js')

const secretPair = () => {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

/* A sheet — or any browser somebody types the address into — through the
   start and GitHub answering with `who`: where the callback sends it. */
async function through(url: string, who: Account, before?: () => Promise<unknown>): Promise<string> {
  const start = await app.request(url, { headers: { 'sec-fetch-site': 'none' } })
  assert.equal(start.status, 302)
  const to = new URL(start.headers.get('location')!, 'https://usetuff.com')
  if (to.hostname !== 'github.com') return start.headers.get('location')!
  const state = JSON.parse(Buffer.from(cookieOf(start, '__Host-tuff_oauth').split('.')[1]!, 'base64url').toString()) as { link?: string }
  // The ticket's key rides in the signed state, never the challenge itself.
  assert.ok(state.link && !url.includes(state.link))
  await before?.()
  const code = `app-${who.id}-${++made}`
  codes.set(code, who)
  challenges.set(code, to.searchParams.get('code_challenge')!)
  const back = await app.request(`/auth/oauth/github/callback?code=${code}&state=${to.searchParams.get('state')}`, {
    headers: { cookie: `__Host-tuff_oauth=${cookieOf(start, '__Host-tuff_oauth')}` },
  })
  return back.headers.get('location')!
}

/* The app asks with its challenge, and its sheet goes through. */
async function sheet(token: string, who: Account, before?: () => Promise<unknown>) {
  const pair = secretPair()
  const asked = await call('POST', '/api/me/ways-in/github', token, { password: PASSWORD, app_challenge: pair.challenge })
  assert.equal(asked.status, 200)
  // No cookie: the sheet would not carry it.
  assert.doesNotMatch(asked.headers.get('set-cookie') ?? '', /tuff_link/)
  const { url } = (await asked.json()) as { url: string }
  assert.equal(url, `/auth/oauth/github/start?link=app&app_challenge=${pair.challenge}`)
  const handedBack = await through(url, who, before)
  return { ...pair, url, handedBack, linked: new URL(handedBack, 'https://usetuff.com').searchParams.get('linked') }
}

const finish = (token: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request('/api/me/ways-in/github/finish', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify(body),
  })

test('an app adds a way in with its secret, over the session that asked', async () => {
  const me = await person()
  const mine = github(`app${stamp()}@example.org`)
  const s = await sheet(me.token, mine)
  assert.match(s.handedBack, /^\/signin\?linked=lkd_/)
  // The sheet itself links nothing.
  assert.deepEqual((await ways(me.token)).ways, [])
  const done = await finish(me.token, { linked: s.linked, verifier: s.verifier })
  assert.equal(done.status, 200)
  // With the address there, so the app can say which account it connected.
  assert.deepEqual(await done.json(), { provider: 'github', email: mine.email })
  assert.deepEqual(
    (await ways(me.token)).ways.map((w) => [w.provider, w.email]),
    [['github', mine.email]],
  )
  assert.equal(await signsIn(mine), me.actorId)
  const told = [...outbox].reverse().find((m) => m.to === me.email)!
  assert.match(told.subject, /GitHub can now sign in to your Tuff account/)
  // Once: the same address and secret again are refused.
  assert.equal((await finish(me.token, { linked: s.linked, verifier: s.verifier })).status, 410)
})

test('the app’s address is nothing without its secret and its session', async () => {
  const me = await person()
  const other = await person()
  const [ws] = await owner<{ id: string }[]>`select workspace_id as id from membership where actor_id = ${me.actorId} limit 1`
  const second = (await startSession(me.actorId, ws!.id, {}, null)).access_token
  const mine = github(null)
  const s = await sheet(me.token, mine)
  const wrong = secretPair().verifier

  // No secret, a wrong one, another account, another session of the same
  // account, a page, a connected tool: refused, and nothing spent.
  assert.equal((await finish(me.token, { linked: s.linked })).status, 400)
  assert.equal((await finish(me.token, { linked: s.linked, verifier: wrong })).status, 410)
  assert.equal((await finish(other.token, { linked: s.linked, verifier: s.verifier })).status, 410)
  assert.equal((await finish(second, { linked: s.linked, verifier: s.verifier })).status, 410)
  const asPage = { origin: 'https://usetuff.com', 'sec-fetch-site': 'same-origin' }
  assert.equal((await finish(me.token, { linked: s.linked, verifier: s.verifier }, asPage)).status, 403)
  const tool = await issueApiToken(me.actorId, ws!.id, 'agent')
  assert.equal((await finish(tool, { linked: s.linked, verifier: s.verifier })).status, 403)
  assert.deepEqual((await ways(me.token)).ways, [])

  // The start's address replayed in another browser, with somebody else's
  // GitHub, after the sheet had opened it: refused at the start.
  const theirs = github(null)
  assert.equal(await through(s.url, theirs), '/signin?ways=failed')

  assert.equal((await finish(me.token, { linked: s.linked, verifier: s.verifier })).status, 200)
  assert.equal(await signsIn(mine), me.actorId)
  assert.equal(await signsIn(theirs), null)
})

test('an app’s start is good once: whoever comes second is refused, and the real one fails where it is seen', async () => {
  const me = await person()
  const { verifier, challenge } = secretPair()
  const asked = await call('POST', '/api/me/ways-in/github', me.token, { password: PASSWORD, app_challenge: challenge })
  const { url } = (await asked.json()) as { url: string }
  // Somebody who read the address races the sheet and gets there first.
  const theirs = github(null)
  const raced = new URL(await through(url, theirs), 'https://usetuff.com').searchParams.get('linked')!
  assert.ok(raced)
  // The person's own sheet is then refused, so the app says it failed and
  // forgets the secret, rather than finishing somebody else's link.
  assert.equal(await through(url, github(null)), '/signin?ways=failed')
  // A third start, a fourth: refused too.
  assert.equal(await through(url, theirs), '/signin?ways=failed')
  // Without the secret and the session, what the race left is nothing.
  const other = await person()
  assert.equal((await finish(other.token, { linked: raced, verifier })).status, 410)
  assert.equal((await finish(me.token, { linked: raced, verifier: secretPair().verifier })).status, 410)
  assert.equal(await signsIn(theirs), null)
})

test('an app’s link is bound to the start that produced it', async () => {
  const me = await person()
  const s = await sheet(me.token, github(null))
  // A different start on record for the ticket — the one that produced
  // this `linked` is not the one the ticket allowed.
  await owner`update auth_ticket set started = 'another-start' where actor_id = ${me.actorId} and kind = 'link'`
  assert.equal((await finish(me.token, { linked: s.linked, verifier: s.verifier })).status, 410)
})

test('a sign-in from an app starts once per challenge, and the doors that carry a ticket send no referrer', async () => {
  const { challenge } = secretPair()
  const first = await app.request(`/auth/oauth/github/start?app_challenge=${challenge}`, { headers: { 'sec-fetch-site': 'none' } })
  assert.match(first.headers.get('location') ?? '', /^https:\/\/github\.com\//)
  assert.equal(first.headers.get('referrer-policy'), 'no-referrer')
  // Replayed by whoever read the address: refused.
  const again = await app.request(`/auth/oauth/github/start?app_challenge=${challenge}`, { headers: { 'sec-fetch-site': 'none' } })
  assert.equal(again.headers.get('location'), '/signin?oauth=failed')
  // A page's link with the same challenge is the browser's, as before, and spends nothing.
  const page = await app.request(`/auth/oauth/github/start?app_challenge=${challenge}`, { headers: { 'sec-fetch-site': 'same-origin' } })
  assert.match(page.headers.get('location') ?? '', /^https:\/\/github\.com\//)
  assert.equal((await app.request('/signin')).headers.get('referrer-policy'), 'no-referrer')
})

test('a page cannot take the app’s path, nor a cookie an app’s ticket', async () => {
  const me = await person()
  const { challenge } = secretPair()
  // A challenge from a page is a start built for somebody else's browser.
  const page = await app.request('/api/me/ways-in/github', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${me.token}`,
      origin: 'https://usetuff.com',
      'sec-fetch-site': 'same-origin',
    },
    body: JSON.stringify({ password: PASSWORD, app_challenge: challenge }),
  })
  assert.equal(page.status, 403)
  assert.equal((await call('POST', '/api/me/ways-in/github', me.token, { password: PASSWORD, app_challenge: 'short' })).status, 400)

  const asked = await call('POST', '/api/me/ways-in/github', me.token, { password: PASSWORD, app_challenge: challenge })
  const { url } = (await asked.json()) as { url: string }
  // The same challenge twice: a fresh secret every time.
  assert.equal((await call('POST', '/api/me/ways-in/github', me.token, { password: PASSWORD, app_challenge: challenge })).status, 400)
  // Followed from a page's link, the start is nothing.
  assert.equal((await app.request(url, { headers: { 'sec-fetch-site': 'cross-site' } })).headers.get('location'), '/signin?ways=failed')
  // Without the challenge, with one nobody asked for, or for another provider.
  const sheetOpens = async (u: string) => (await app.request(u, { headers: { 'sec-fetch-site': 'none' } })).headers.get('location')
  assert.equal(await sheetOpens('/auth/oauth/github/start?link=app'), '/signin?ways=failed')
  assert.equal(await sheetOpens(`/auth/oauth/github/start?link=app&app_challenge=${secretPair().challenge}`), '/signin?ways=failed')
  assert.equal(await sheetOpens(`/auth/oauth/google/start?link=app&app_challenge=${challenge}`), '/signin?ways=failed')
  // The challenge is in the address, so whoever reads it can write a
  // cookie the web's start hashes to the app's ticket: the web's path
  // never takes a ticket made for an app.
  const forged = await app.request('/auth/oauth/github/start?link=1', {
    headers: { cookie: `__Host-tuff_link=app-link:${challenge}`, 'sec-fetch-site': 'same-origin' },
  })
  assert.equal(forged.headers.get('location'), '/')
})

test('an app’s link runs out, and dies with the session that asked', async () => {
  const me = await person()
  // The address handed back, finished too late.
  const late = await sheet(me.token, github(null))
  await owner`update auth_ticket set expires_at = now() - interval '1 second' where actor_id = ${me.actorId} and kind = 'linked'`
  assert.equal((await finish(me.token, { linked: late.linked, verifier: late.verifier })).status, 410)
  // The link ticket, run out before the sheet came back.
  const slow = await sheet(
    me.token,
    github(null),
    () => owner`update auth_ticket set expires_at = now() - interval '1 second' where actor_id = ${me.actorId} and kind = 'link'`,
  )
  assert.equal(slow.handedBack, '/signin?ways=failed')
  // Handed back, and then the session ended — a reset, signing out everywhere.
  const left = await sheet(me.token, github(null))
  await owner`update refresh_session set ended_at = now() where actor_id = ${me.actorId}`
  assert.equal((await finish(me.token, { linked: left.linked, verifier: left.verifier })).status, 401)
})

test('the sheet comes back with nothing when the session ended on the way', async () => {
  const me = await person()
  const ended = await sheet(me.token, github(null), () => owner`update refresh_session set ended_at = now() where actor_id = ${me.actorId}`)
  assert.equal(ended.handedBack, '/signin?ways=failed')
})

test('an app never links a GitHub that is somebody else’s', async () => {
  const one = await person()
  const two = await person()
  const shared = github(null)
  assert.equal(await connect(one.token, shared), `/${one.slug}/account?ways=added`)
  const s = await sheet(two.token, shared)
  const r = await finish(two.token, { linked: s.linked, verifier: s.verifier })
  assert.equal(r.status, 409)
  assert.equal(((await r.json()) as { error: { code: string } }).error.code, 'taken')
  assert.deepEqual((await ways(two.token)).ways, [])
  assert.equal(await signsIn(shared), one.actorId)
})

test('a network is an IPv4 address, or an IPv6 address’s /64', async () => {
  const { networkOf } = await import('../src/http/access.js')
  assert.equal(networkOf('203.0.113.7'), '203.0.113.7')
  assert.equal(networkOf('::ffff:203.0.113.7'), '203.0.113.7')
  assert.equal(networkOf('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64')
  assert.equal(networkOf('2001:0db8:0001:0002:aaaa::1'), '2001:db8:1:2::/64')
  assert.equal(networkOf('2001:db8::1'), '2001:db8:0:0::/64')
  assert.equal(networkOf('2001:DB8:1:2::'), '2001:db8:1:2::/64')
})

test('an app’s sign-in start is held to a ceiling per address, and its challenges are kept an hour, cleared by the worker', async () => {
  // Each start with a challenge writes a row, so one network gets 120 in
  // ten minutes, not the doors' six hundred a minute. An IPv6 address
  // counts by its /64: every address in it is one subscriber's.
  const net = Array.from({ length: 4 }, () => Math.floor(Math.random() * 0xffff).toString(16)).join(':')
  const host = () => Array.from({ length: 4 }, () => Math.floor(Math.random() * 0xffff).toString(16)).join(':')
  const start = (challenge: string, extra = '') =>
    app.request(`/auth/oauth/github/start?app_challenge=${challenge}${extra}`, {
      headers: { 'sec-fetch-site': 'none', 'x-forwarded-for': `${net}:${host()}, 10.0.0.1` },
    })
  // Junk refused before the row — a start for Connect with no ticket behind
  // it — counts for nothing, so it cannot use up a shared address.
  for (let i = 0; i < 130; i++)
    assert.equal((await start(secretPair().challenge, '&link=app')).headers.get('location'), '/signin?ways=failed')
  for (let i = 0; i < 120; i++)
    assert.match((await start(secretPair().challenge)).headers.get('location') ?? '', /^https:\/\/github\.com\//)
  // The 121st, from another address in the same /64: refused.
  assert.equal((await start(secretPair().challenge)).headers.get('location'), '/signin?oauth=failed')
  // Another network is its own.
  const elsewhere = await app.request(`/auth/oauth/github/start?app_challenge=${secretPair().challenge}`, {
    headers: { 'sec-fetch-site': 'none', 'x-forwarded-for': `${host()}:${host()}, 10.0.0.1` },
  })
  assert.match(elsewhere.headers.get('location') ?? '', /^https:\/\/github\.com\//)

  // A challenge used more than an hour ago is past any app's trading.
  const { challenge } = secretPair()
  await owner`insert into auth_app_start (challenge, created_at) values (${challenge}, now() - interval '2 hours')`
  const again = await app.request(`/auth/oauth/github/start?app_challenge=${challenge}`, { headers: { 'sec-fetch-site': 'none' } })
  assert.match(again.headers.get('location') ?? '', /^https:\/\/github\.com\//)
  // And the worker's clear-out takes what is past its hour, nothing newer.
  const old = secretPair().challenge
  await owner`insert into auth_app_start (challenge, created_at) values (${old}, now() - interval '2 hours')`
  const [r] = await owner<{ n: number }[]>`select auth_app_start_clear() as n`
  assert.ok(r!.n >= 1)
  const left = await owner<{ challenge: string }[]>`select challenge from auth_app_start where challenge in (${old}, ${challenge})`
  assert.deepEqual(
    left.map((x) => x.challenge),
    [challenge],
  )
})

/* An address nobody has proved adds no
   way in — a session from a link with no address, followed with somebody's. */
test('an account whose address nobody proved adds no way in', async () => {
  const s = stamp()
  const email = `unproved${s}@example.com`
  const made = await registerUser({ email, password: 'correct-horse-battery-staple', name: 'Una', workspace_name: `U ${s}` })
  await owner`update app_user set email_verified_at = null where actor_id = ${made.actor_id}`
  const r = await app.request('/api/me/ways-in/github', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${made.access_token}`,
      'x-api-version': '1',
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
    },
    body: JSON.stringify({ password: 'correct-horse-battery-staple' }),
  })
  assert.equal(r.status, 403)
  assert.equal(((await r.json()) as { error: { code: string } }).error.code, 'email_unverified')
})
