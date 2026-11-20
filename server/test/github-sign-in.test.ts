import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync } from 'node:crypto'

/* The sign-in's OAuth App, and the GitHub App a person connects in
   Account settings — before anything reads the environment. */
process.env.GITHUB_SIGNIN_CLIENT_ID = 'signin-id'
process.env.GITHUB_SIGNIN_CLIENT_SECRET = 'signin-secret'
process.env.GITHUB_CLIENT_ID = 'app-client'
process.env.GITHUB_CLIENT_SECRET = 'app-secret'
process.env.GOOGLE_CLIENT_ID = 'google-id'
process.env.GOOGLE_CLIENT_SECRET = 'google-secret'
process.env.GITHUB_WEBHOOK_SECRET = 'test-secret'
process.env.GITHUB_APP_ID = '1'
process.env.GITHUB_PRIVATE_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
  type: 'pkcs1',
  format: 'pem',
}) as string

const { app } = await import('../src/http/routes.js')
const { registerUser } = await import('../src/auth/flows.js')
const { closeDb } = await import('./helpers.js')

after(async () => {
  await closeDb()
})

/*
 * A fake GitHub. A code is a GitHub account and its addresses, set by the
 * test; a token is good only for the account its code was; the sign-in's
 * code is refused unless the verifier is the one its challenge was made
 * from. What is revoked is written down.
 */
type Account = { id: number; login: string; name?: string | null; emails: { email: string; primary: boolean; verified: boolean }[] }
const codes = new Map<string, Account>()
const tokens = new Map<string, Account>()
const challenges = new Map<string, string>()
const revoked: string[] = []
let made = 0
const real = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!url.startsWith('https://github.com/') && !url.startsWith('https://api.github.com/')) return real(input, init)
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
  if (url === 'https://github.com/login/oauth/access_token') {
    const raw = String(init?.body ?? '')
    const f: Record<string, string> = raw.startsWith('{') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw))
    const who = codes.get(f.code ?? '')
    const secretOk =
      (f.client_id === 'signin-id' && f.client_secret === 'signin-secret') ||
      (f.client_id === 'app-client' && f.client_secret === 'app-secret')
    if (!who || !secretOk) return json({ error: 'bad_verification_code' })
    if (f.client_id === 'signin-id') {
      const want = challenges.get(f.code!)
      const got = createHash('sha256')
        .update(f.code_verifier ?? '')
        .digest('base64url')
      if (!want || want !== got) return json({ error: 'invalid_grant' })
    }
    codes.delete(f.code!)
    const t = `gho_${++made}`
    tokens.set(t, who)
    return json({ access_token: t, token_type: 'bearer', scope: 'user:email' })
  }
  if (url.startsWith('https://api.github.com/applications/')) {
    revoked.push(String((JSON.parse(String(init?.body ?? '{}')) as { access_token?: string }).access_token))
    return new Response(null, { status: 204 })
  }
  const token = new Headers(init?.headers).get('authorization')?.replace(/^(Bearer|token) /, '') ?? ''
  const who = tokens.get(token)
  if (!who) return json({ message: 'Bad credentials' }, 401)
  if (url === 'https://api.github.com/user') return json({ id: who.id, login: who.login, name: who.name ?? null, avatar_url: null })
  if (url === 'https://api.github.com/user/emails') return json(who.emails)
  return json({ message: 'Not Found' }, 404)
}) as typeof fetch

let nextId = 7_000_000 + Math.floor(Math.random() * 1_000_000)
const account = (email: string | null, more: Partial<Account> = {}): Account => {
  const id = ++nextId
  return { id, login: `octo${id}`, emails: email ? [{ email, primary: true, verified: true }] : [], ...more }
}

/* Out to GitHub and back as a browser does: the start's cookie carried,
   GitHub answering with the account, and where the callback sends it. */
/* The cookie the callback left this browser, which its ticket is good with. */
let browser = ''

async function signIn(
  who: Account,
  opts: { invite?: string; forge?: 'state' | 'cookie' | 'provider'; challenge?: string; sheet?: boolean } = {},
): Promise<string> {
  const q = new URLSearchParams({
    ...(opts.invite ? { invite: opts.invite } : {}),
    ...(opts.challenge ? { app_challenge: opts.challenge } : {}),
  })
  const start = await app.request(`/auth/oauth/${opts.forge === 'provider' ? 'google' : 'github'}/start${q.size ? `?${q}` : ''}`, {
    headers: { 'sec-fetch-site': opts.sheet ? 'none' : 'same-origin' },
  })
  assert.equal(start.status, 302)
  const cookie = (start.headers.get('set-cookie') ?? '').split(';')[0]!
  let state = 'nope'
  if (opts.forge !== 'provider') {
    const to = new URL(start.headers.get('location')!)
    assert.equal(to.origin + to.pathname, 'https://github.com/login/oauth/authorize')
    state = to.searchParams.get('state')!
    const code = `code-${who.id}-${made}`
    codes.set(code, who)
    challenges.set(code, to.searchParams.get('code_challenge')!)
    const back = await app.request(`/auth/oauth/github/callback?code=${code}&state=${opts.forge === 'state' ? 'forged' : state}`, {
      headers: opts.forge === 'cookie' ? {} : { cookie },
    })
    assert.equal(back.status, 302)
    browser = /__Host-tuff_handoff=([^;]+)/.exec(back.headers.get('set-cookie') ?? '')?.[1] ?? ''
    return back.headers.get('location')!
  }
  /* A cookie the Google start made, with its own state, brought to
     GitHub's callback. */
  state = new URL(start.headers.get('location')!).searchParams.get('state')!
  const code = `code-${who.id}-p`
  codes.set(code, who)
  const back = await app.request(`/auth/oauth/github/callback?code=${code}&state=${state}`, { headers: { cookie } })
  return back.headers.get('location')!
}

const ticketIn = (location: string) => {
  const handoff = new URL(location, 'https://usetuff.com').searchParams.get('handoff')
  assert.ok(handoff, `no handoff in ${location}`)
  return handoff
}

/* As the page asks, or, `native`, as an app's own client does: with no
   `Origin` and no `Sec-Fetch-Site`. */
async function exchange(handoff: string, opts: { cookie?: string; verifier?: string; native?: boolean } = {}): Promise<Response> {
  return app.request('/auth/oauth/exchange', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.native ? {} : { origin: 'https://usetuff.com', 'sec-fetch-site': 'same-origin' }),
      ...(opts.cookie ? { cookie: `__Host-tuff_handoff=${opts.cookie}` } : {}),
    },
    body: JSON.stringify({ handoff, ...(opts.verifier ? { verifier: opts.verifier } : {}) }),
  })
}

/* Traded by the browser that signed in, with the cookie it was left. */
async function session(location: string): Promise<{ actor_id: string; access_token: string }> {
  const r = await exchange(ticketIn(location), { cookie: browser })
  assert.equal(r.status, 200)
  return (await r.json()) as { actor_id: string; access_token: string }
}

test('GitHub is offered, asks for the addresses only, and with PKCE and the account picker', async () => {
  const offered = (await (await app.request('/auth/providers')).json()) as { github: boolean }
  assert.equal(offered.github, true)
  const start = await app.request('/auth/oauth/github/start')
  const to = new URL(start.headers.get('location')!)
  assert.equal(to.searchParams.get('client_id'), 'signin-id')
  assert.equal(to.searchParams.get('scope'), 'user:email')
  assert.equal(to.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(to.searchParams.get('prompt'), 'select_account')
  assert.equal(to.searchParams.get('redirect_uri')?.endsWith('/auth/oauth/github/callback'), true)
  assert.match(start.headers.get('set-cookie') ?? '', /HttpOnly; Secure/)
})

test('a new GitHub account makes an account, is the same person next time, and keeps no token', async () => {
  const stamp = Date.now().toString(36)
  const who = account(`gh${stamp}@example.com`, { name: 'Octo Cat' })
  const before = revoked.length
  const first = await session(await signIn(who))
  const second = await session(await signIn(who))
  assert.equal(second.actor_id, first.actor_id)
  // Every token GitHub gave was given back.
  assert.equal(revoked.length - before, 2)
  // And each sign-in is a line in the audit log of the workspace it opened
  // in, saying how.
  /* As the tables' owner: the security record is nobody's to read but a
     workspace owner's. */
  const { default: postgres } = await import('postgres')
  const db = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
  const lines = await db<{ workspace_id: string }[]>`
    select workspace_id from security_event
    where actor_id = ${first.actor_id} and kind = 'login' and meta->>'method' = 'provider'`
  await db.end()
  assert.equal(lines.length, 2)
  assert.ok(lines.every((l) => l.workspace_id === (second as unknown as { workspace_id: string }).workspace_id))
})

test('an address with an account here is never handed to a GitHub account', async () => {
  const stamp = Date.now().toString(36)
  const email = `taken${stamp}@example.com`
  await registerUser({ email, password: 'correct-horse-battery-staple', name: 'Owner', workspace_name: `T ${stamp}` })
  // Verified on GitHub, primary, the same address: still refused, with the way to link it.
  assert.equal(await signIn(account(email)), '/signin?oauth=github')
  // And it did not quietly become theirs for next time either.
  assert.equal(await signIn(account(email.toUpperCase())), '/signin?oauth=github')
})

test('no verified address, or only GitHub’s noreply one, makes nothing', async () => {
  const stamp = Date.now().toString(36)
  assert.equal(await signIn(account(null)), '/signin?oauth=noemail')
  assert.equal(
    await signIn(account(null, { emails: [{ email: `x${stamp}@example.com`, primary: true, verified: false }] })),
    '/signin?oauth=noemail',
  )
  assert.equal(
    await signIn(account(null, { emails: [{ email: `1+octo${stamp}@users.noreply.github.com`, primary: true, verified: true }] })),
    '/signin?oauth=noemail',
  )
})

test('a callback this browser did not start is refused', async () => {
  const who = account(`forge${Date.now().toString(36)}@example.com`)
  assert.equal(await signIn(who, { forge: 'state' }), '/signin?oauth=failed')
  assert.equal(await signIn(who, { forge: 'cookie' }), '/signin?oauth=expired')
  assert.equal(await signIn(who, { forge: 'provider' }), '/signin?oauth=failed')
})

/* Connecting GitHub in Account settings, as the GitHub App, signed in. */
async function connect(bearer: string, who: Account): Promise<Response> {
  const start = await app.request('/api/github/me/start', { method: 'POST', headers: { authorization: `Bearer ${bearer}` } })
  assert.equal(start.status, 200)
  const state = new URL(((await start.json()) as { url: string }).url).searchParams.get('state')!
  const code = `app-${who.id}-${made}`
  codes.set(code, who)
  return app.request('/api/github/me', {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify({ code, state }),
  })
}

test('GitHub connected in Account settings is not a way into the account', async () => {
  const stamp = Date.now().toString(36)
  const email = `linked${stamp}@example.com`
  const had = await registerUser({ email, password: 'correct-horse-battery-staple', name: 'Lin', workspace_name: `L ${stamp}` })
  const who = account(email)
  assert.equal((await connect(had.access_token, who)).status, 201)
  // Whoever held the session for a moment could have connected their own:
  // it does not sign anybody in, by the address or otherwise.
  assert.equal(await signIn(who), '/signin?oauth=github')
  assert.equal(await signIn({ ...who, emails: [] }), '/signin?oauth=noemail')
})

test('an account made with GitHub cannot be taken by connecting that GitHub elsewhere', async () => {
  const stamp = Date.now().toString(36)
  const who = account(`own${stamp}@example.com`)
  const mine = await session(await signIn(who))
  const other = await registerUser({
    email: `else${stamp}@example.com`,
    password: 'correct-horse-battery-staple',
    name: 'E',
    workspace_name: `E ${stamp}`,
  })
  assert.equal((await connect(other.access_token, who)).status, 409)
  // Its owner connecting it is fine: it is already theirs.
  assert.equal((await connect(mine.access_token, who)).status, 201)
})

test('the ticket is good only in the browser that signed in', async () => {
  const stamp = Date.now().toString(36)
  const who = account(`bound${stamp}@example.com`)
  await session(await signIn(who))
  const ticket = ticketIn(await signIn(who))
  const mine = browser
  // Sent to somebody else: their browser has the address and not the cookie.
  assert.equal((await exchange(ticket)).status, 401)
  // Nor does a cookie from another sign-in of their own fit it.
  ticketIn(await signIn(account(`other${stamp}@example.com`)))
  assert.equal((await exchange(ticket, { cookie: browser })).status, 401)
  // Nor a secret, which is the apps' proof and not the browser's.
  assert.equal((await exchange(ticket, { verifier: 'x'.repeat(43) })).status, 401)
  // None of that spent it: the browser it belongs to still signs in.
  assert.equal((await exchange(ticket, { cookie: mine })).status, 200)
})

test('an app’s ticket is good only with the secret it sent the SHA-256 of', async () => {
  const stamp = Date.now().toString(36)
  const who = account(`app${stamp}@example.com`)
  await session(await signIn(who))
  const verifier = createHash('sha256').update(`secret-${stamp}`).digest('base64url') + 'abc'
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const ticket = ticketIn(await signIn(who, { challenge, sheet: true }))
  assert.equal(browser, '')
  assert.equal((await exchange(ticket, { native: true })).status, 401)
  assert.equal((await exchange(ticket, { native: true, verifier: verifier.replace(/.$/, 'z') })).status, 401)
  assert.equal((await exchange(ticket, { native: true, verifier })).status, 200)
})

test('a page never trades an app’s ticket, and one brought by a page is spent', async () => {
  const stamp = Date.now().toString(36)
  const who = account(`page${stamp}@example.com`)
  await session(await signIn(who))
  const verifier = createHash('sha256').update(`page-${stamp}`).digest('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  // A page's link with somebody else's challenge in it: the ticket is the browser's.
  ticketIn(await signIn(who, { challenge }))
  assert.notEqual(browser, '')
  // The app's ticket opened in a page: refused, and good to nobody after.
  const ticket = ticketIn(await signIn(who, { challenge, sheet: true }))
  assert.equal((await exchange(ticket, { verifier })).status, 401)
  assert.equal((await exchange(ticket, { native: true, verifier })).status, 401)
  // A challenge that is not one is refused rather than ignored.
  const bad = await app.request('/auth/oauth/github/start?app_challenge=abc%3D', { headers: { 'sec-fetch-site': 'none' } })
  assert.equal(bad.headers.get('location'), '/signin?oauth=failed')
})

test('a sheet that sends no challenge gets a ticket bound to its browser, which no app can trade', async () => {
  const stamp = Date.now().toString(36)
  const who = account(`sheet${stamp}@example.com`)
  await session(await signIn(who))
  // No build of either app starts without a challenge. A start that says
  // no page sent it and carries none — somebody's own, typed or opened
  // from elsewhere — is a browser's: its ticket is good only with that
  // browser's cookie, never to an app an App Link handed it to.
  const own = ticketIn(await signIn(who, { sheet: true }))
  assert.match(browser, /^hob_/)
  assert.equal((await exchange(own, { native: true })).status, 401)
  assert.equal((await exchange(own, { native: true, verifier: 'v'.repeat(43) })).status, 401)
  const typed = ticketIn(await signIn(who, { sheet: true }))
  assert.equal((await exchange(typed, { cookie: browser })).status, 200)
  // A start without the browser's word is the web's, and bound.
  const start = await app.request('/auth/oauth/github/start')
  const to = new URL(start.headers.get('location')!)
  const code = `code-${who.id}-bare`
  codes.set(code, who)
  challenges.set(code, to.searchParams.get('code_challenge')!)
  const back = await app.request(`/auth/oauth/github/callback?code=${code}&state=${to.searchParams.get('state')}`, {
    headers: { cookie: (start.headers.get('set-cookie') ?? '').split(';')[0]! },
  })
  assert.match(back.headers.get('set-cookie') ?? '', /__Host-tuff_handoff=hob_[^;]+; Path=\/; Max-Age=120; HttpOnly; Secure; SameSite=Lax/)
  assert.equal((await exchange(ticketIn(back.headers.get('location')!))).status, 401)
})
