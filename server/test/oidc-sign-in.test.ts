import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import postgres from 'postgres'

/*
 * Signing in through a server's own OpenID Connect provider.
 *
 * Against a provider written here: an HTTP server on 127.0.0.1 with a
 * discovery document, keys and a token endpoint, and a token signed for
 * each case. Plain http is what it speaks, which the server allows only
 * because it is itself on http://localhost here — and a test below puts it
 * on https to see it refuse.
 */

type Doc = Record<string, unknown>
const fake = {
  /** What the discovery document says, before `doc` changes it. */
  doc: (d: Doc) => d,
  /** `token_endpoint_auth_methods_supported`, or none listed. */
  methods: undefined as string[] | undefined,
  /** Discovery never answers, the token endpoint never answers. */
  hang: false,
  hangToken: false,
  /** Discovery answers with a redirect to a good document. */
  redirect: false,
  /** The keys answer is larger than the server reads. */
  bigKeys: false,
  keys: [] as Record<string, unknown>[],
  /** How the last token request authenticated. */
  lastAuth: '' as '' | 'basic' | 'post' | 'none',
  discoveries: 0,
  keyReads: 0,
}
/* A code is the token it trades for, and the challenge its verifier must meet. */
const codes = new Map<string, { idToken: string; challenge: string; redirect: string }>()
const hanging: ServerResponse[] = []

const CLIENT = 'tuff-client'
const SECRET = 'a-client-secret-with:colon & space'
let base = ''

async function body(req: IncomingMessage): Promise<string> {
  let s = ''
  for await (const chunk of req) s += chunk
  return s
}

const provider = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', base)
  const json = (b: unknown, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(b))
  }
  if (url.pathname === '/realms/acme/.well-known/openid-configuration') {
    fake.discoveries++
    if (fake.hang) return void hanging.push(res)
    if (fake.redirect) {
      res.writeHead(302, { location: `${base}/good/.well-known/openid-configuration` })
      return void res.end()
    }
    return json(
      fake.doc({
        issuer: `${base}/realms/acme`,
        authorization_endpoint: `${base}/realms/acme/auth?kc_idp_hint=`,
        token_endpoint: `${base}/realms/acme/token`,
        jwks_uri: `${base}/realms/acme/keys`,
        ...(fake.methods ? { token_endpoint_auth_methods_supported: fake.methods } : {}),
      }),
    )
  }
  if (url.pathname === '/good/.well-known/openid-configuration') {
    return json({ issuer: `${base}/realms/acme`, authorization_endpoint: `${base}/a`, token_endpoint: `${base}/t`, jwks_uri: `${base}/k` })
  }
  if (url.pathname === '/realms/acme/keys') {
    fake.keyReads++
    if (fake.bigKeys) return json({ keys: fake.keys, padding: 'x'.repeat(300 * 1024) })
    return json({ keys: fake.keys })
  }
  if (url.pathname === '/realms/acme/token' && req.method === 'POST') {
    if (fake.hangToken) return void hanging.push(res)
    const f = Object.fromEntries(new URLSearchParams(await body(req)))
    const auth = req.headers.authorization ?? ''
    const form = (s: string) => new URLSearchParams([['', s]]).toString().slice(1)
    if (auth) {
      fake.lastAuth = 'basic'
      if (auth !== `Basic ${Buffer.from(`${form(CLIENT)}:${form(SECRET)}`).toString('base64')}`)
        return json({ error: 'invalid_client' }, 401)
    } else if (f.client_secret) {
      fake.lastAuth = 'post'
      if (f.client_id !== CLIENT || f.client_secret !== SECRET) return json({ error: 'invalid_client' }, 401)
    } else {
      fake.lastAuth = 'none'
      return json({ error: 'invalid_client' }, 401)
    }
    const c = codes.get(f.code ?? '')
    const got = createHash('sha256')
      .update(f.code_verifier ?? '')
      .digest('base64url')
    if (f.grant_type !== 'authorization_code' || !c || c.challenge !== got || c.redirect !== f.redirect_uri) {
      return json({ error: 'invalid_grant' }, 400)
    }
    codes.delete(f.code!)
    return json({ access_token: 'at', token_type: 'Bearer', id_token: c.idToken })
  }
  json({ error: 'not_found' }, 404)
})
await new Promise<void>((done) => provider.listen(0, '127.0.0.1', done))
base = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`
const ISSUER = `${base}/realms/acme`

/* Before anything reads the environment. */
process.env.OIDC_ISSUER = ISSUER
process.env.OIDC_CLIENT_ID = CLIENT
process.env.OIDC_CLIENT_SECRET = SECRET
delete process.env.OIDC_NAME
/* Plain http to the provider only because this server's own address is
   http://localhost — said in `APP_URL`, never taken from a request. */
process.env.APP_URL = 'http://localhost'

const { app } = await import('../src/http/routes.js')
const { offeredProviders, providersMeta, whoIs } = await import('../src/http/access.js')
const { forgetProvider, talking } = await import('../src/auth/oidc.js')
const { env, readOidcName } = await import('../src/env.js')
const { registerUser } = await import('../src/auth/flows.js')
const { outbox } = await import('../src/mail.js')
const { asAuth, closeDb, makeOwner, makeProject, stamp } = await import('./helpers.js')

/* As the tables' owner, to read what was stored. */
const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
const kept = { ...talking }
const PASSWORD = 'correct-horse-battery-staple'

after(async () => {
  for (const r of hanging) r.destroy()
  provider.closeAllConnections()
  await new Promise((done) => provider.close(done))
  await owner.end()
  await closeDb()
})

/* The provider's signing keys: one it lists, one it rotates to later. */
const one = await generateKeyPair('RS256')
const two = await generateKeyPair('ES256')
const JWK_ONE = { ...(await exportJWK(one.publicKey)), kid: 'one', alg: 'RS256', use: 'sig' }
const JWK_TWO = { ...(await exportJWK(two.publicKey)), kid: 'two', alg: 'ES256', use: 'sig' }

/* Every test starts from a provider that answers, as the server first finds it. */
function reset() {
  fake.doc = (d) => d
  fake.methods = undefined
  fake.hang = false
  fake.hangToken = false
  fake.redirect = false
  fake.bigKeys = false
  fake.keys = [JWK_ONE]
  Object.assign(talking, kept)
  process.env.OIDC_ISSUER = ISSUER
  forgetProvider()
}
reset()

const now = () => Math.floor(Date.now() / 1000)
type Claims = Record<string, unknown>
const claimsFor = (nonce: string, more: Claims = {}): Claims => ({
  iss: ISSUER,
  aud: CLIENT,
  sub: `u-${stamp()}`,
  iat: now(),
  exp: now() + 300,
  nonce,
  email_verified: true,
  name: 'Kim Key',
  ...more,
})
const sign = (claims: Claims, key = one.privateKey, header: { alg: string; kid: string } = { alg: 'RS256', kid: 'one' }) =>
  new SignJWT(claims).setProtectedHeader(header).sign(key)

const cookieOf = (r: Response, name: string) => new RegExp(`${name}=([^;]*)`).exec(r.headers.get('set-cookie') ?? '')?.[1] ?? ''

/**
 * Out to the provider and back as a browser goes: the start's cookie
 * carried, the provider answering with the token `make` signs for the
 * nonce it was sent, and where the callback sends the browser.
 */
async function signIn(
  make: (nonce: string) => Promise<string> | string,
  opts: { invite?: string; link?: string } = {},
): Promise<{ location: string; browser: string }> {
  const q = opts.invite ? `?invite=${encodeURIComponent(opts.invite)}` : opts.link ? '?link=1' : ''
  const start = await app.request(`/auth/oauth/oidc/start${q}`, {
    headers: { 'sec-fetch-site': 'same-origin', ...(opts.link ? { cookie: `__Host-tuff_link=${opts.link}` } : {}) },
  })
  assert.equal(start.status, 302)
  const location = start.headers.get('location')!
  if (!location.startsWith(base)) return { location, browser: '' }
  const to = new URL(location)
  const code = `code-${randomBytes(8).toString('hex')}`
  codes.set(code, {
    idToken: await make(to.searchParams.get('nonce')!),
    challenge: to.searchParams.get('code_challenge')!,
    redirect: to.searchParams.get('redirect_uri')!,
  })
  const back = await app.request(`/auth/oauth/oidc/callback?code=${code}&state=${to.searchParams.get('state')}`, {
    headers: { cookie: `__Host-tuff_oauth=${cookieOf(start, '__Host-tuff_oauth')}` },
  })
  assert.equal(back.status, 302)
  return { location: back.headers.get('location')!, browser: cookieOf(back, '__Host-tuff_handoff') }
}

/* Who a sign-in signed in, traded as the page trades it; null for none. */
async function who(got: { location: string; browser: string }): Promise<{ actor_id: string; workspace_id: string } | null> {
  const handoff = new URL(got.location, 'http://localhost').searchParams.get('handoff')
  if (!handoff) return null
  const r = await app.request('/auth/oauth/exchange', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
      'sec-fetch-site': 'same-origin',
      cookie: `__Host-tuff_handoff=${got.browser}`,
    },
    body: JSON.stringify({ handoff }),
  })
  assert.equal(r.status, 200, await r.clone().text())
  return (await r.json()) as { actor_id: string; workspace_id: string }
}

const accountOf = async (email: string) =>
  (await owner<{ actor_id: string }[]>`select actor_id from app_user where email = ${email}`)[0]?.actor_id ?? null
/* How an account holds its address: confirmed at all, and only weakly (`email_by_hand`). */
const proof = async (actorId: string) =>
  (
    await owner<{ confirmed: boolean; weak: boolean }[]>`
      select email_verified_at is not null as confirmed, email_by_hand as weak from app_user where actor_id = ${actorId}`
  )[0]
const providersOf = async (actorId: string) =>
  (await owner<{ provider: string }[]>`select provider from auth_identity where actor_id = ${actorId} order by provider`).map(
    (r) => r.provider,
  )

test('it is offered only with the issuer, the client and its secret, and the page names it', async () => {
  reset()
  const providers = async () => (await (await app.request('/auth/providers')).json()) as { oidc: boolean; oidc_name: string | null }
  assert.deepEqual(await providers().then((p) => [p.oidc, p.oidc_name]), [true, 'SSO'])
  assert.ok(offeredProviders().includes('oidc'))
  assert.match(providersMeta(offeredProviders()), /<meta name="tuff-providers" content="[^"]*\boidc\b[^"]*" \/>/)
  assert.match(providersMeta(offeredProviders()), /<meta name="tuff-oidc-name" content="SSO" \/>/)

  /* Its name, as text in an attribute and never as markup. */
  process.env.OIDC_NAME = 'Acme "SSO" <b>&'
  try {
    assert.equal((await providers()).oidc_name, 'Acme "SSO" <b>&')
    assert.match(providersMeta(offeredProviders()), /content="Acme &quot;SSO&quot; &lt;b&gt;&amp;"/)
  } finally {
    delete process.env.OIDC_NAME
  }

  for (const missing of ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET']) {
    const was = process.env[missing]
    delete process.env[missing]
    try {
      const p = await providers()
      assert.deepEqual([p.oidc, p.oidc_name], [false, null], missing)
      assert.ok(!offeredProviders().includes('oidc'), missing)
      assert.doesNotMatch(providersMeta(offeredProviders()), /oidc/, missing)
      const start = await app.request('/auth/oauth/oidc/start')
      assert.equal(start.headers.get('location'), '/signin?oauth=off', missing)
    } finally {
      process.env[missing] = was
    }
  }
})

test('OIDC_NAME is plain text on one line, at most 40 characters', () => {
  assert.equal(readOidcName(undefined), 'SSO')
  assert.equal(readOidcName('   '), 'SSO')
  assert.equal(readOidcName(' Keycloak '), 'Keycloak')
  assert.equal(readOidcName('é'.repeat(40)), 'é'.repeat(40))
  assert.throws(() => readOidcName('x'.repeat(41)), /at most 40/)
  assert.throws(() => readOidcName('Acme\nSSO'), /one line/)
  assert.throws(() => readOidcName('Acme\u0000'), /one line/)
  /* A right-to-left override, and a zero-width joiner: words read other than written. */
  assert.throws(() => readOidcName('‮emcA'), /one line/)
  assert.throws(() => readOidcName('Ac‍me'), /one line/)
})

test('the start sends a code flow with PKCE, a state and a nonce, onto the endpoint’s own query', async () => {
  reset()
  const start = await app.request('/auth/oauth/oidc/start', { headers: { 'sec-fetch-site': 'same-origin' } })
  const to = new URL(start.headers.get('location')!)
  assert.equal(to.origin + to.pathname, `${ISSUER}/auth`)
  assert.equal(to.searchParams.get('kc_idp_hint'), '')
  assert.equal(to.searchParams.get('client_id'), CLIENT)
  assert.equal(to.searchParams.get('response_type'), 'code')
  assert.equal(to.searchParams.get('scope'), 'openid email profile')
  assert.equal(to.searchParams.get('code_challenge_method'), 'S256')
  assert.match(to.searchParams.get('code_challenge') ?? '', /^[\w-]{43}$/)
  assert.ok(to.searchParams.get('state') && to.searchParams.get('nonce'))
  assert.equal(to.searchParams.get('redirect_uri'), 'http://localhost/auth/oauth/oidc/callback')
  assert.match(start.headers.get('set-cookie') ?? '', /__Host-tuff_oauth=[^;]+; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=None/)
  /* Read once and kept: a second start asks the provider nothing. */
  const asked = fake.discoveries
  await app.request('/auth/oauth/oidc/start')
  assert.equal(fake.discoveries, asked)
})

test('a new account is made, is the same person next time, and its subject carries the issuer', async () => {
  reset()
  const s = stamp()
  const email = `kim${s}@example.com`
  const sub = `kim-${s}`
  const first = await who(await signIn((n) => sign(claimsFor(n, { sub, email: email.toUpperCase() }))))
  assert.ok(first)
  const again = await who(await signIn((n) => sign(claimsFor(n, { sub, email }))))
  assert.equal(again?.actor_id, first.actor_id)
  const [row] = await owner<{ provider: string; subject: string; name: string }[]>`
    select i.provider, i.subject, a.name from auth_identity i join actor a on a.id = i.actor_id where i.actor_id = ${first.actor_id}`
  assert.deepEqual(row, { provider: 'oidc', subject: `${ISSUER} ${sub}`, name: 'Kim Key' })
  assert.equal(await accountOf(email), first.actor_id)

  /* The name: `name`, else `preferred_username`, else the address's own part. */
  const byUsername = await who(
    await signIn((n) => sign(claimsFor(n, { email: `pu${s}@example.com`, name: undefined, preferred_username: 'kimk' }))),
  )
  const [u] = await owner<{ name: string }[]>`select name from actor where id = ${byUsername!.actor_id}`
  assert.equal(u?.name, 'kimk')
  const byAddress = await who(await signIn((n) => sign(claimsFor(n, { email: `local${s}@example.com`, name: '  ' }))))
  const [l] = await owner<{ name: string }[]>`select name from actor where id = ${byAddress!.actor_id}`
  assert.equal(l?.name, `local${s}`)

  /* An issuer written with its trailing slash is the same provider, and the same people. */
  process.env.OIDC_ISSUER = `${ISSUER}/`
  forgetProvider()
  const slashed = await who(await signIn((n) => sign(claimsFor(n, { sub, email }))))
  assert.equal(slashed?.actor_id, first.actor_id)
})

test('a token for another audience, another nonce, another issuer, or expired, signs nobody in', async () => {
  reset()
  const s = stamp()
  const refused = async (more: Claims) => {
    const email = `bad${stamp()}@example.com`
    const got = await signIn((n) => sign(claimsFor(n, { email, ...more })))
    assert.equal(got.location, '/signin?oauth=failed', JSON.stringify(more))
    assert.equal(await accountOf(email), null)
  }
  await refused({ aud: 'somebody-else' })
  await refused({ aud: ['somebody-else', 'another'] })
  /* Several audiences, ours among them, given to somebody else. */
  await refused({ aud: [CLIENT, 'another'], azp: 'another' })
  await refused({ nonce: 'not-the-one-sent' })
  await refused({ iss: `${base}/realms/other` })
  await refused({ exp: now() - 120 })
  await refused({ exp: undefined })
  /* Made a quarter of an hour ago, still unexpired: not this sign-in's. */
  await refused({ iat: now() - 900, exp: now() + 3600 })
  await refused({ sub: '' })
  /* Our audience among several, given to us: fine. */
  const fine = await signIn((n) => sign(claimsFor(n, { email: `many${s}@example.com`, aud: [CLIENT, 'another'], azp: CLIENT })))
  assert.ok(await who(fine))
})

test('a token signed with the client secret, or not signed, is refused, even with an HMAC key listed', async () => {
  reset()
  /* A provider that lists the secret as a key: still not a signature anybody but the client could not make. */
  fake.keys = [JWK_ONE, { kty: 'oct', kid: 'hs', alg: 'HS256', k: Buffer.from(SECRET).toString('base64url') }]
  forgetProvider()
  const email = `hs${stamp()}@example.com`
  const hs = await signIn((n) => sign(claimsFor(n, { email }), new TextEncoder().encode(SECRET) as never, { alg: 'HS256', kid: 'hs' }))
  assert.equal(hs.location, '/signin?oauth=failed')
  const none = await signIn((n) => {
    const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    return `${part({ alg: 'none', kid: 'one' })}.${part(claimsFor(n, { email }))}.`
  })
  assert.equal(none.location, '/signin?oauth=failed')
  /* Signed with a key the provider does not list. */
  const stranger = await generateKeyPair('RS256')
  const forged = await signIn((n) => sign(claimsFor(n, { email }), stranger.privateKey))
  assert.equal(forged.location, '/signin?oauth=failed')
  assert.equal(await accountOf(email), null)
})

test('a key the provider rotated in is read again, but not more than once a minute', async () => {
  reset()
  /* The keys as they were when first read: only the first. */
  await app.request('/auth/oauth/oidc/start')
  fake.keys = [JWK_ONE, JWK_TWO]
  const rotated = (n: string) => sign(claimsFor(n, { email: `rot${stamp()}@example.com` }), two.privateKey, { alg: 'ES256', kid: 'two' })
  /* Just read: not again yet. */
  assert.equal((await signIn(rotated)).location, '/signin?oauth=failed')
  talking.keysAgainMs = 0
  const reads = fake.keyReads
  assert.ok(await who(await signIn(rotated)))
  assert.equal(fake.keyReads, reads + 1)
})

test('a discovery document naming another issuer, plain http on a server on https, or a redirect is not used', async () => {
  reset()
  fake.doc = (d) => ({ ...d, issuer: `${base}/realms/evil` })
  assert.equal((await signIn(() => '')).location, '/signin?oauth=unreachable')

  reset()
  fake.doc = (d) => ({ ...d, token_endpoint: 'ftp://127.0.0.1/token' })
  assert.equal((await signIn(() => '')).location, '/signin?oauth=unreachable')

  reset()
  fake.redirect = true
  assert.equal((await signIn(() => '')).location, '/signin?oauth=unreachable')

  reset()
  fake.bigKeys = true
  assert.equal((await signIn(() => '')).location, '/signin?oauth=unreachable')

  /* The same provider, with this server on https, or with no address of
     its own said — whatever the request's own Host is: plain http is refused. */
  const was = env.appUrl
  try {
    for (const appUrl of ['https://tuff.test', '', 'http://localhost.example.com', 'http://192.168.1.4']) {
      reset()
      env.appUrl = appUrl
      const start = await app.request('http://localhost/auth/oauth/oidc/start', { headers: { host: 'localhost' } })
      assert.equal(start.headers.get('location'), '/signin?oauth=unreachable', appUrl)
    }
  } finally {
    env.appUrl = was
  }
})

test('a re-read after the hour that fails keeps the document that worked', async () => {
  reset()
  assert.ok(await who(await signIn((n) => sign(claimsFor(n, { email: `kept${stamp()}@example.com` })))))
  /* The hour is up, and the provider's discovery does not answer. */
  talking.keptMs = 0
  talking.timeoutMs = 300
  fake.hang = true
  const asked = fake.discoveries
  assert.ok(await who(await signIn((n) => sign(claimsFor(n, { email: `stale${stamp()}@example.com` })))))
  assert.equal(fake.discoveries, asked + 1)
  /* And again while it is remembered as down: the same document, nothing asked. */
  assert.ok(await who(await signIn((n) => sign(claimsFor(n, { email: `stale2${stamp()}@example.com` })))))
  assert.equal(fake.discoveries, asked + 1)
  /* Back up, read again once the half minute is over. */
  fake.hang = false
  talking.downMs = 0
  assert.ok(await who(await signIn((n) => sign(claimsFor(n, { email: `fresh${stamp()}@example.com` })))))
  /* Read again — at every ask here, the hour being set to nothing. */
  assert.ok(fake.discoveries > asked + 1)
  reset()
})

test('the client authenticates as the document allows: basic when listed or nothing is, else post', async () => {
  for (const [methods, said] of [
    [undefined, 'basic'],
    [['client_secret_basic', 'client_secret_post'], 'basic'],
    [['client_secret_post'], 'post'],
  ] as const) {
    reset()
    fake.methods = methods ? [...methods] : undefined
    forgetProvider()
    const got = await signIn((n) => sign(claimsFor(n, { email: `auth${stamp()}@example.com` })))
    assert.ok(await who(got), String(methods))
    assert.equal(fake.lastAuth, said, String(methods))
  }
})

test('an unverified address never takes an account, a verified one does, and no address makes nothing', async () => {
  reset()
  const s = stamp()
  const email = `has${s}@example.com`
  const had = await registerUser({ email, password: 'correct-horse-battery-staple', name: 'Has', workspace_name: `H ${s.slice(0, 4)}` })
  await owner`update app_user set email_verified_at = now() where actor_id = ${had.actor_id}`
  /* Without the claim, or with it false: refused, and not linked for next time. */
  for (const verified of [undefined, false, 'false']) {
    const got = await signIn((n) => sign(claimsFor(n, { sub: `has-${s}`, email, email_verified: verified })))
    assert.equal(got.location, '/signin?oauth=conflict', String(verified))
  }
  assert.equal((await owner`select 1 from auth_identity where actor_id = ${had.actor_id}`).length, 0)
  /* With it — true, or the string some providers send — the account is theirs. */
  const lettersTo = () => outbox.filter((m) => m.to === email && /can now sign in to your Tuff account/.test(m.subject))
  assert.equal(lettersTo().length, 0)
  const taken = await who(await signIn((n) => sign(claimsFor(n, { sub: `has-${s}`, email, email_verified: 'true' }))))
  assert.equal(taken?.actor_id, had.actor_id)
  /* A new way into an account found by its address: the address is told,
     as it is when one is added from Account — once, not at every sign-in.
     The letter is sent, not waited for: looked for until it is there. */
  for (let i = 0; i < 50 && lettersTo().length === 0; i++) await new Promise((r) => setTimeout(r, 20))
  assert.equal(lettersTo().length, 1)
  assert.match(lettersTo()[0]!.subject, /^SSO can now sign in to your Tuff account$/)
  assert.match(lettersTo()[0]!.text, new RegExp(`SSO \\(${email.replace(/\./g, '\\.')}\\) was added as a way to sign in`))
  await who(await signIn((n) => sign(claimsFor(n, { sub: `has-${s}`, email, email_verified: true }))))
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(lettersTo().length, 1)

  /* A new address it does not vouch for may make an account — held weakly;
     one it vouches for, strongly. */
  const fresh = `fresh${s}@example.com`
  const made = await who(await signIn((n) => sign(claimsFor(n, { email: fresh, email_verified: false }))))
  assert.equal(made?.actor_id, await accountOf(fresh))
  assert.deepEqual(await proof(made!.actor_id), { confirmed: true, weak: true })
  const sure = `sure${s}@example.com`
  const strong = await who(await signIn((n) => sign(claimsFor(n, { email: sure }))))
  assert.deepEqual(await proof(strong!.actor_id), { confirmed: true, weak: false })

  /* No address: told so, nothing made. Asked by the two subjects rather
     than by counting every account: the other test files make accounts in
     the same database while this one runs, and the count moved under it. */
  const none = await signIn((n) => sign(claimsFor(n, { sub: `none-${s}` })))
  assert.equal(none.location, '/signin?oauth=noaddress')
  const junk = await signIn((n) => sign(claimsFor(n, { sub: `junk-${s}`, email: 'not an address' })))
  assert.equal(junk.location, '/signin?oauth=noaddress')
  const madeFor = await owner`
    select 1 from auth_identity where provider = 'oidc' and subject in (${`${ISSUER} none-${s}`}, ${`${ISSUER} junk-${s}`})`
  assert.equal(madeFor.length, 0)
})

test('a provider that does not answer is said to be unreachable, in time, and nothing is spent', async () => {
  reset()
  talking.timeoutMs = 300
  fake.hang = true
  const began = Date.now()
  assert.equal((await signIn(() => '')).location, '/signin?oauth=unreachable')
  assert.ok(Date.now() - began < 5_000)
  /* Remembered as down for a moment: the next press does not wait again. */
  const asked = fake.discoveries
  assert.equal((await signIn(() => '')).location, '/signin?oauth=unreachable')
  assert.equal(fake.discoveries, asked)
  /* On the way to an invitation, back to the invitation. */
  const inv = await app.request('/auth/oauth/oidc/start?invite=abc123')
  assert.equal(inv.headers.get('location'), '/invite/abc123?oauth=unreachable')

  /* Read, and then the token endpoint does not answer. */
  reset()
  talking.timeoutMs = 300
  fake.hangToken = true
  const got = await signIn((n) => sign(claimsFor(n, { email: `slow${stamp()}@example.com` })))
  assert.equal(got.location, '/signin?oauth=unreachable')

  /* And once it answers again, it signs people in again. */
  reset()
  assert.ok(await who(await signIn((n) => sign(claimsFor(n, { email: `back${stamp()}@example.com` })))))
})

test('an invitation makes the account in the workspace that asked', async () => {
  reset()
  const boss = await makeOwner()
  const project = await makeProject(boss.ctx, boss.workspaceId, 'Keys')
  const made = await app.request('/api/invites', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${boss.token}` },
    body: JSON.stringify({ role: 'member', project_ids: [project] }),
  })
  assert.ok(made.status < 300)
  const token = ((await made.json()) as { token: string }).token
  const email = `inv${stamp()}@example.com`
  const joined = await who(await signIn((n) => sign(claimsFor(n, { email })), { invite: token }))
  assert.equal(joined?.workspace_id, boss.workspaceId)
  assert.equal(joined?.actor_id, await accountOf(email))
  assert.deepEqual(await proof(joined!.actor_id), { confirmed: true, weak: false })

  /* On an address the provider does not vouch for, the invitation's account is weak too. */
  const again = await app.request('/api/invites', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${boss.token}` },
    body: JSON.stringify({ role: 'member', project_ids: [project] }),
  })
  const second = ((await again.json()) as { token: string }).token
  const unsure = `invweak${stamp()}@example.com`
  const weakly = await who(await signIn((n) => sign(claimsFor(n, { email: unsure, email_verified: false })), { invite: second }))
  assert.equal(weakly?.workspace_id, boss.workspaceId)
  assert.deepEqual(await proof(weakly!.actor_id), { confirmed: true, weak: true })
})

/*
 * The review's case: an account made through the provider on somebody
 * else's address, which the provider never checked. The address's real
 * owner arriving through Google, which owns gmail.com, takes it, and
 * whoever made it is put out — its way in through the provider with it.
 */
test('an account made on an unvouched address is taken by the address’s real proof, and its maker put out', async () => {
  reset()
  const s = stamp()
  const victim = `victim${s}@gmail.com`
  const attacker = `attacker-${s}`
  const made = await who(await signIn((n) => sign(claimsFor(n, { sub: attacker, email: victim, email_verified: false }))))
  assert.ok(made)
  assert.deepEqual(await proof(made.actor_id), { confirmed: true, weak: true })
  /* The maker signs in again through the provider meanwhile: still them. */
  const back = await who(await signIn((n) => sign(claimsFor(n, { sub: attacker, email: victim, email_verified: false }))))
  assert.equal(back?.actor_id, made.actor_id)

  /* The victim, through Google — what Google's callback calls. */
  const seen = { claimed: false }
  const g = await whoIs('google', `g-${s}`, victim, true, 'Victim', true, seen)
  assert.ok(g && g !== 'conflict')
  assert.equal(g.actorId, made.actor_id)
  assert.equal(seen.claimed, true)
  assert.deepEqual(await proof(made.actor_id), { confirmed: true, weak: false })
  assert.deepEqual(await providersOf(made.actor_id), ['google'])
  const [ended] = await owner<{ n: number }[]>`
    select count(*)::int as n from refresh_session where actor_id = ${made.actor_id} and ended_at is null`
  assert.equal(ended?.n, 0)
  /* And the maker, through the provider again, is nobody's account here. */
  const after = await signIn((n) => sign(claimsFor(n, { sub: attacker, email: victim, email_verified: false })))
  assert.equal(after.location, '/signin?oauth=conflict')
})

test('the provider vouching later for the account’s own address is the proof it lacked', async () => {
  reset()
  const s = stamp()
  const email = `later${s}@example.com`
  const sub = `later-${s}`
  const made = await who(await signIn((n) => sign(claimsFor(n, { sub, email, email_verified: false }))))
  assert.deepEqual(await proof(made!.actor_id), { confirmed: true, weak: true })
  /* Vouching for another address than the account's proves nothing about it. */
  await who(await signIn((n) => sign(claimsFor(n, { sub, email: `other${s}@example.com`, email_verified: true }))))
  assert.deepEqual(await proof(made!.actor_id), { confirmed: true, weak: true })
  const vouched = await who(await signIn((n) => sign(claimsFor(n, { sub, email, email_verified: true }))))
  assert.equal(vouched?.actor_id, made!.actor_id)
  assert.deepEqual(await proof(made!.actor_id), { confirmed: true, weak: false })
  assert.deepEqual(await providersOf(made!.actor_id), ['oidc'])
})

test('weakening is only for an account made in the same transaction', async () => {
  const s = stamp()
  const had = await registerUser({ email: `old${s}@example.com`, password: PASSWORD, name: 'Old', workspace_name: `O ${s.slice(0, 4)}` })
  const [r] = await asAuth((tx) => tx<{ ok: boolean }[]>`select auth_email_weak(${had.actor_id}) as ok`)
  assert.equal(r?.ok, false)
  assert.deepEqual(await proof(had.actor_id), { confirmed: true, weak: false })
})

test('a change of address forgets the provider’s sign-in made under the old one, as Google’s, and keeps Apple’s', async () => {
  const s = stamp()
  const old = `moving${s}@example.com`
  const had = await registerUser({ email: old, password: PASSWORD, name: 'Mo', workspace_name: `M ${s.slice(0, 4)}` })
  await asAuth(async (tx) => {
    await tx`select auth_identity_link(${had.actor_id}, 'oidc', ${`${ISSUER} mo-${s}`}, ${old})`
    await tx`select auth_identity_link(${had.actor_id}, 'oidc', ${`${ISSUER} elsewhere-${s}`}, ${`mo${s}@acme.example`})`
    await tx`select auth_identity_link(${had.actor_id}, 'apple', ${`a-mo-${s}`}, ${old})`
  })
  /* What confirming the new address runs with the old one (`address.ts`). */
  await asAuth((tx) => tx`select auth_identity_forget(${had.actor_id}, ${old})`)
  const left = await owner<{ provider: string; email: string }[]>`
    select provider, email::text as email from auth_identity where actor_id = ${had.actor_id} order by provider, email`
  assert.deepEqual(
    left.map((r) => [r.provider, r.email]),
    [
      ['apple', old],
      ['oidc', `mo${s}@acme.example`],
    ],
  )
})

/* Account → ways in. */
const call = (method: string, path: string, token: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

test('it is added from Account with the password, signs in afterwards, and is removed the same way', async () => {
  reset()
  const s = stamp()
  const email = `ways${s}@example.com`
  const me = await registerUser({
    email,
    password: PASSWORD,
    name: 'Way',
    workspace_name: `W ${s.slice(0, 4)}`,
    workspace_slug: `oidc-${s}`,
  })
  const listed = (await (await call('GET', '/api/me/ways-in', me.access_token)).json()) as { offered: string[]; oidc_name: string | null }
  assert.ok(listed.offered.includes('oidc'))
  assert.equal(listed.oidc_name, 'SSO')

  assert.equal((await call('POST', '/api/me/ways-in/oidc', me.access_token, { password: 'not-it-at-all' })).status, 403)
  const asked = await call('POST', '/api/me/ways-in/oidc', me.access_token, { password: PASSWORD })
  assert.equal(asked.status, 200)
  assert.equal(((await asked.json()) as { url: string }).url, '/auth/oauth/oidc/start?link=1')
  /* Whatever its address, unvouched even: the person proved who they are first. */
  const sub = `way-${s}`
  const there = `elsewhere${s}@example.org`
  const linked = await signIn((n) => sign(claimsFor(n, { sub, email: there, email_verified: false })), {
    link: cookieOf(asked, '__Host-tuff_link'),
  })
  assert.equal(linked.location, `/oidc-${s}/account?ways=added`)
  const told = [...outbox].reverse().find((m) => m.to === email)!
  assert.match(told.subject, /SSO can now sign in to your Tuff account/)
  assert.equal((await who(await signIn((n) => sign(claimsFor(n, { sub, email: there })))))?.actor_id, me.actor_id)

  const ways = (await (await call('GET', '/api/me/ways-in', me.access_token)).json()) as { ways: { id: string; provider: string }[] }
  const way = ways.ways.find((w) => w.provider === 'oidc')!
  assert.equal((await call('DELETE', `/api/me/ways-in/${way.id}`, me.access_token, { password: PASSWORD })).status, 200)
  assert.match([...outbox].reverse().find((m) => m.to === email)!.subject, /SSO was removed from your Tuff account/)
  /* Not them any more: that provider account is somebody new here now. */
  const after = await who(await signIn((n) => sign(claimsFor(n, { sub, email: there }))))
  assert.notEqual(after?.actor_id, me.actor_id)

  /* A provider that cannot be read is said before any ticket is made. */
  reset()
  talking.timeoutMs = 300
  fake.hang = true
  const down = await call('POST', '/api/me/ways-in/oidc', me.access_token, { password: PASSWORD })
  assert.equal(down.status, 503)
  assert.equal(((await down.json()) as { error: { code: string } }).error.code, 'unreachable')
  assert.equal(cookieOf(down, '__Host-tuff_link'), '')
  reset()
})
