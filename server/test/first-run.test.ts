import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import postgres from 'postgres'

/*
 * The first opening of your own server.
 *
 * On a database of its own, as `instance.test.ts` is, for the same reason:
 * the settings row is one per database, and a server armed with a setup
 * token closes sign-up for every test file beside it on the shared one.
 * The service's edition first; then the community edition put in its place
 * in this process, and the database told it is a server of one's own the
 * way a community server tells it, by `edition.ready`.
 */
const { migrate } = await import('../src/db/migrate.js')
const shared = process.env.DATABASE_URL!
const admin = postgres(shared, { max: 1, onnotice: () => {} })
const DB = `tracker_firstrun_${randomUUID().replace(/-/g, '').slice(0, 12)}`
const at = (url: string) => {
  const u = new URL(url)
  u.pathname = `/${DB}`
  return u.href
}
const ends: (() => Promise<unknown>)[] = []
after(async () => {
  for (const end of ends.reverse()) await end().catch((e: unknown) => console.error('[first-run.test] cleanup', e))
  await admin.unsafe(`drop database if exists ${DB} with (force)`)
  await admin.end()
})
await admin.unsafe(`create database ${DB}`)
await migrate(at(shared))
process.env.DATABASE_URL = at(shared)
process.env.DATABASE_URL_APP = at(process.env.DATABASE_URL_APP ?? shared)
if (process.env.DATABASE_URL_WORKER) process.env.DATABASE_URL_WORKER = at(process.env.DATABASE_URL_WORKER)
delete process.env.SETUP_TOKEN
delete process.env.OWNER_EMAIL

const { edition } = await import('../src/edition.js')
const { edition: community } = await import('../src/edition.js')
const { app } = await import('../src/http/routes.js')
const { env, readSmtp, readSetupToken } = await import('../src/env.js')
const { open } = await import('../src/auth/seal.js')
const { forgetSavedMail, savedSmtpOptions, mailOn } = await import('../src/mail.js')
const { sameToken } = await import('../src/http/setup.js')
const { mailHost } = await import('../src/http/mailSettings.js')
const { smtpResolving, mailServerAddress } = await import('../src/outbound.js')
const { send } = await import('../src/mail.js')
const { closeDb } = await import('./helpers.js')

/* Mail servers' names, as this test's DNS answers them — no real lookup. */
const DNS: Record<string, string> = {
  'smtp.example.com': '93.184.216.34',
  'mail.attacker.example': '93.184.216.35',
  'smtp.env.example': '93.184.216.36',
  postfix: '172.18.0.5',
  'inside.example.com': '10.1.2.3',
  'loop.example.com': '127.0.0.1',
  'cgnat.example.com': '100.64.0.9',
  'ula.example.com': 'fd12:3456::1',
  'meta.example.com': '169.254.169.254',
  'meta6.example.com': 'fd00:ec2::254',
}
const realResolve = smtpResolving.resolve
smtpResolving.resolve = (host, done) => {
  const address = DNS[host]
  if (!address) return done(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }), [])
  done(null, [{ address, family: address.includes(':') ? 6 : 4 }])
}

const theCommunity = { ...community, instance: true }
const service = { ...edition, ...(edition.instance ? { instance: false } : {}) }
Object.assign(edition, service)
const asCommunity = () => Object.assign(edition, theCommunity)
/* No mail from the environment unless a test says so: the saved settings
   are what is being tested. */
const envMail = { resendApiKey: env.resendApiKey, smtp: env.smtp }
const noEnvMail = () => {
  ;(env as { resendApiKey: string }).resendApiKey = ''
  ;(env as { smtp: unknown }).smtp = null
}
noEnvMail()

const owner = postgres(at(shared), { max: 1, onnotice: () => {} })
ends.push(
  async () => Object.assign(edition, service),
  async () => Object.assign(env, envMail),
  async () => {
    smtpResolving.resolve = realResolve
    delete process.env.SMTP_ALLOW_PRIVATE
  },
  () => closeDb(),
  () => owner.end(),
)

const TOKEN = randomBytes(32).toString('hex')
let addressN = 0
/** A fresh address for each test, so one test's wrong guesses never count against another. */
const fresh = () => `203.0.113.${(addressN++ % 250) + 1}, 10.0.0.1`

async function call(
  path: string,
  init: { method?: string; token?: string | null; setup?: string | null; body?: unknown; from?: string } = {},
) {
  const r = await app.request(path, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': init.from ?? '198.51.100.7, 10.0.0.1',
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.setup ? { 'x-setup-token': init.setup } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
  const text = await r.text()
  let body: Record<string, any> = {}
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { text }
  }
  return { status: r.status, body, raw: text }
}

/** Back to a fresh server: nobody owns it, no mail saved, and the start run
    again with the environment the test set. */
async function freshServer(opts: { token?: string | null; ownerEmail?: string | null } = {}): Promise<void> {
  await owner`truncate instance_owner, instance_applicant, instance_mail`
  await owner`update instance_setting set claimed_at = null, sign_up_open = false, owner_email = null, setup_token_hash = null`
  await owner`delete from rate_window where key like 'fail:setup:%' or key like 'setup-letter:%'`.catch(() => {})
  if (opts.token === null) delete process.env.SETUP_TOKEN
  else process.env.SETUP_TOKEN = opts.token ?? TOKEN
  if (opts.ownerEmail) process.env.OWNER_EMAIL = opts.ownerEmail
  else delete process.env.OWNER_EMAIL
  asCommunity()
  await quiet(() => edition.ready(owner))
  forgetSavedMail()
}

async function quiet<T>(work: () => Promise<T>): Promise<T> {
  const [log, error] = [console.log, console.error]
  console.log = () => {}
  console.error = () => {}
  try {
    return await work()
  } finally {
    console.log = log
    console.error = error
  }
}

const uid = () => randomUUID().replace(/-/g, '').slice(0, 12)
const owners = async () => (await owner<{ actor_id: string }[]>`select actor_id from instance_owner`).map((r) => r.actor_id)
const PASSWORD = 'a-long-enough-password-42'

/* -------------------------------------------------------- the service */

test('on the service none of it exists: every setup path answers as an unknown address does', async () => {
  Object.assign(edition, service)
  process.env.SETUP_TOKEN = TOKEN
  try {
    const unknown = await call('/auth/no-such-door')
    for (const [method, path] of [
      ['GET', '/auth/setup'],
      ['PUT', '/auth/setup/mail'],
      ['DELETE', '/auth/setup/mail'],
      ['POST', '/auth/setup/mail/test'],
      ['POST', '/auth/setup/owner'],
      ['GET', '/setup'],
    ] as const) {
      const r = await call(path, { method, setup: TOKEN, body: method === 'GET' || method === 'DELETE' ? undefined : {} })
      assert.equal(r.status, 404, `${method} ${path}`)
      assert.equal(r.raw, unknown.raw, `${method} ${path} says what an unknown address says`)
    }
    const p = await call('/auth/providers')
    assert.equal(p.body.no_mail, false, 'the service never says it has no mail')
    assert.equal(p.body.sign_up, true)
    /* And the database was never armed. */
    assert.equal((await owner<{ h: string | null }[]>`select setup_token_hash as h from instance_setting`)[0]!.h, null)
  } finally {
    delete process.env.SETUP_TOKEN
  }
})

/* -------------------------------------------------- your own server */

test('SETUP_TOKEN is a token or nothing; the comparison holds for any lengths', () => {
  assert.equal(readSetupToken(undefined), '')
  assert.equal(readSetupToken('  '), '')
  assert.equal(readSetupToken(TOKEN), TOKEN)
  for (const bad of ['short', 'a'.repeat(31), `${'a'.repeat(40)} b`, `${'a'.repeat(20)}\n${'a'.repeat(20)}`, 'é'.repeat(40)]) {
    assert.throws(() => readSetupToken(bad), /SETUP_TOKEN is not a token/, JSON.stringify(bad))
  }
  assert.equal(sameToken(TOKEN, TOKEN), true)
  assert.equal(sameToken(`${TOKEN}x`, TOKEN), false)
  assert.equal(sameToken('', TOKEN), false)
})

test('without SETUP_TOKEN your own server has no setup screen either', async () => {
  await freshServer({ token: null })
  assert.equal((await call('/auth/setup', { setup: TOKEN })).status, 404)
  assert.equal(
    (await call('/auth/setup/owner', { setup: TOKEN, body: { name: 'A', email: 'a@example.com', password: PASSWORD } })).status,
    404,
  )
  /* And sign-up behaves as before: open on an unclaimed server. */
  assert.equal((await call('/auth/providers')).body.sign_up, true)
})

test('setup is refused without the token and with a wrong one, and guesses run out', async () => {
  await freshServer()
  const from = fresh()
  assert.equal((await call('/auth/setup', { from })).status, 403)
  assert.equal((await call('/auth/setup', { from, setup: 'x' })).body.error.code, 'bad_token')
  assert.equal((await call('/auth/setup', { from, setup: `${TOKEN.slice(0, -1)}${TOKEN.endsWith('0') ? '1' : '0'}` })).status, 403)
  const wrongOwner = await call('/auth/setup/owner', {
    from,
    setup: 'nope'.repeat(10),
    body: { name: 'Mallory', email: `m${uid()}@example.com`, password: PASSWORD },
  })
  assert.equal(wrongOwner.status, 403)
  const wrongMail = await call('/auth/setup/mail', {
    method: 'PUT',
    from,
    setup: 'nope'.repeat(10),
    body: { via: 'resend', key: 're_abcdefgh12345', sender: 'Tuff <t@example.com>' },
  })
  assert.equal(wrongMail.status, 403)
  assert.deepEqual(await owners(), [])
  assert.equal((await owner<{ n: number }[]>`select count(*)::int as n from instance_mail`)[0]!.n, 0)

  /* The right token answers, and is given back: it never counts. */
  const right = await call('/auth/setup', { from, setup: TOKEN })
  assert.equal(right.status, 200)
  assert.equal(right.body.owner_email, null)
  assert.equal(right.body.mail_setup.source, null)

  /* Ten wrong a quarter of an hour from one address, then nothing is checked — the right one neither. */
  for (let i = 0; i < 10; i++) await call('/auth/setup', { from, setup: `wrong-${i}` })
  assert.equal((await call('/auth/setup', { from, setup: 'wrong-again' })).status, 429)
  assert.equal((await call('/auth/setup', { from, setup: TOKEN })).status, 429)
  /* Another address is not held to it. */
  assert.equal((await call('/auth/setup', { from: fresh(), setup: TOKEN })).status, 200)
})

test('the owner is made at once: confirmed, owner of the server, signed in — and the token dies with it', async () => {
  await freshServer()
  const email = `owner${uid()}@example.com`
  const r = await call('/auth/setup/owner', { from: fresh(), setup: TOKEN, body: { name: 'Olga Owner', email, password: PASSWORD } })
  assert.equal(r.status, 201, r.raw)
  assert.ok(r.body.access_token && r.body.refresh_token && r.body.workspace_id)
  const actor = r.body.actor_id as string
  assert.deepEqual(await owners(), [actor])
  const [s] = await owner<{ claimed: boolean; hash: string | null }[]>`
    select claimed_at is not null as claimed, setup_token_hash as hash from instance_setting`
  assert.equal(s!.claimed, true)
  assert.equal(s!.hash, null, 'the hash is cleared')
  const [u] = await owner<{ ok: boolean; pw: boolean }[]>`
    select email_verified_at is not null as ok, password_hash is not null as pw from app_user where actor_id = ${actor}`
  assert.deepEqual(u, { ok: true, pw: true })

  /* Signed in: the session opens the app and Server settings. */
  const me = await call('/api/me', { token: r.body.access_token })
  assert.equal(me.status, 200)
  assert.ok((me.body.can as string[]).includes('instance'))
  assert.equal((await call('/api/instance', { token: r.body.access_token })).status, 200)
  /* And the password chosen signs in, with no letter. */
  const login = await call('/auth/login', { body: { email, password: PASSWORD } })
  assert.equal(login.status, 200, login.raw)
  /* The workspace holds as much as the owner likes. */
  const [ws] = await owner<{ plan: string }[]>`select plan from workspace where id = ${r.body.workspace_id}`
  assert.equal(ws!.plan, 'unlimited')

  /* After the owner exists, every setup path is closed — whatever the token. */
  for (const [method, path, body] of [
    ['GET', '/auth/setup', undefined],
    ['PUT', '/auth/setup/mail', { via: 'resend', key: 're_abcdefgh12345', sender: 't@example.com' }],
    ['DELETE', '/auth/setup/mail', undefined],
    ['POST', '/auth/setup/mail/test', { to: 'x@example.com' }],
    ['POST', '/auth/setup/owner', { name: 'Late', email: `late${uid()}@example.com`, password: PASSWORD }],
  ] as const) {
    const late = await call(path, { method, setup: TOKEN, from: fresh(), body })
    assert.equal(late.status, 410, `${method} ${path}`)
    assert.equal(late.body.error.code, 'setup_done')
  }
  /* Even with the hash put back by a restart that still has the variable. */
  await quiet(() => edition.ready(owner))
  assert.equal(
    (
      await call('/auth/setup/owner', {
        setup: TOKEN,
        from: fresh(),
        body: { name: 'Late', email: `l${uid()}@example.com`, password: PASSWORD },
      })
    ).status,
    410,
  )
  /* And the database refuses it whoever calls. */
  await assert.rejects(
    owner`select instance_setup_owner(encode(sha256(${TOKEN}::bytea), 'hex'), ${randomUUID()}, 'X', ${`x${uid()}@example.com`}::citext,
                                      ${'h'.repeat(40)}, ${randomUUID()}, 'X', ${`x-${uid()}`}::citext)`,
    /setup_done/,
  )
  assert.equal((await owners()).length, 1)
})

test('two setups at once make one owner', async () => {
  await freshServer()
  const go = (n: number) =>
    call('/auth/setup/owner', {
      from: fresh(),
      setup: TOKEN,
      body: { name: `Racer ${n}`, email: `racer${n}${uid()}@example.com`, password: PASSWORD },
    })
  const [a, b] = await Promise.all([go(1), go(2)])
  assert.deepEqual([a.status, b.status].sort(), [201, 410])
  assert.equal((await owners()).length, 1)
})

test('OWNER_EMAIL is enforced: the setup screen is told it, and no other address becomes the owner', async () => {
  const named = `named${uid()}@example.com`
  await freshServer({ ownerEmail: named })
  const state = await call('/auth/setup', { setup: TOKEN, from: fresh() })
  assert.equal(state.body.owner_email, named)
  const other = await call('/auth/setup/owner', {
    setup: TOKEN,
    from: fresh(),
    body: { name: 'Someone', email: `someone${uid()}@example.com`, password: PASSWORD },
  })
  assert.equal(other.status, 403)
  assert.equal(other.body.error.code, 'owner_email')
  assert.deepEqual(await owners(), [])
  /* The database says the same to a caller who skipped the route's check. */
  await assert.rejects(
    owner`select instance_setup_owner(encode(sha256(${TOKEN}::bytea), 'hex'), ${randomUUID()}, 'X', ${`x${uid()}@example.com`}::citext,
                                      ${'h'.repeat(40)}, ${randomUUID()}, 'X', ${`x-${uid()}`}::citext)`,
    /owner_email/,
  )
  /* That address, in any case, is the owner. */
  const ok = await call('/auth/setup/owner', {
    setup: TOKEN,
    from: fresh(),
    body: { name: 'Named', email: named.toUpperCase(), password: PASSWORD },
  })
  assert.equal(ok.status, 201, ok.raw)
})

test('an account already at the address is taken back: the password chosen here, every other way in gone', async () => {
  const named = `squat${uid()}@example.com`
  await freshServer({ ownerEmail: named })
  /* A stranger signed up first with the owner's address. */
  assert.equal((await call('/auth/register', { body: { name: 'Squatter', email: named } })).status, 202)
  const [before] = await owner<{ actor_id: string }[]>`select actor_id from app_user where email = ${named}`
  const r = await call('/auth/setup/owner', { setup: TOKEN, from: fresh(), body: { name: 'Real Owner', email: named, password: PASSWORD } })
  assert.equal(r.status, 201, r.raw)
  assert.equal(r.body.actor_id, before!.actor_id, 'the same account, taken back')
  assert.deepEqual(await owners(), [before!.actor_id])
  const [left] = await owner<{ applicant: boolean; ok: boolean }[]>`
    select exists (select 1 from instance_applicant where actor_id = ${before!.actor_id}) as applicant,
           (select email_verified_at is not null from app_user where actor_id = ${before!.actor_id}) as ok`
  assert.deepEqual(left, { applicant: false, ok: true })
  assert.equal((await call('/auth/login', { body: { email: named, password: PASSWORD } })).status, 200)
})

test('armed with nobody named, nobody claims the server by signing up', async () => {
  await freshServer()
  assert.equal((await call('/auth/providers')).body.sign_up, false)
  const r = await call('/auth/register', { body: { name: 'First Comer', email: `first${uid()}@example.com` } })
  assert.equal(r.status, 403)
  assert.equal(r.body.error.code, 'sign_up_closed')
  /* Disarmed — a `.env` with no token — it is the old way, said in the log. */
  await freshServer({ token: null })
  assert.equal((await call('/auth/providers')).body.sign_up, true)
})

/* ------------------------------------------------------------- mail */

const SMTP_PASSWORD = 'Hunter2-very-secret-pw'
const RESEND_KEY = 're_supersecretkey_4242'

/** Nothing secret in it: not the secret, and not what the database keeps of it. */
async function leaksNothing(raw: string, what: string): Promise<void> {
  assert.doesNotMatch(raw, /Hunter2-very-secret-pw/, what)
  assert.doesNotMatch(raw, /re_supersecretkey_4242/, what)
  const sealed = await owner<
    { p: string | null; k: string | null }[]
  >`select smtp_password_enc as p, resend_key_enc as k from instance_mail`
  for (const s of sealed) {
    if (s.p) assert.ok(!raw.includes(s.p), `${what}: the sealed password`)
    if (s.k) assert.ok(!raw.includes(s.k), `${what}: the sealed key`)
  }
  assert.doesNotMatch(raw, /_enc\b/, what)
}

test('mail saved by the setup screen and by the owner never comes back out: every answer says only whether a secret is set', async () => {
  await freshServer()
  const smtp = {
    via: 'smtp',
    host: 'smtp.example.com',
    port: 587,
    security: 'starttls',
    user: 'tuff@example.com',
    password: SMTP_PASSWORD,
    sender: 'Tuff <tuff@example.com>',
  }
  const saved = await call('/auth/setup/mail', { method: 'PUT', setup: TOKEN, from: fresh(), body: smtp })
  assert.equal(saved.status, 200, saved.raw)
  assert.deepEqual(saved.body.mail_setup, {
    source: 'saved',
    via: 'smtp',
    host: 'smtp.example.com',
    port: 587,
    security: 'starttls',
    user: 'tuff@example.com',
    secret_set: true,
    sender: 'Tuff <tuff@example.com>',
  })
  await leaksNothing(saved.raw, 'PUT /auth/setup/mail')
  /* Sealed at rest, and opened only by the server's key. */
  const [row] = await owner<{ p: string }[]>`select smtp_password_enc as p from instance_mail`
  assert.ok(row!.p && !row!.p.includes(SMTP_PASSWORD))
  assert.equal(open('mail', row!.p), SMTP_PASSWORD)
  const state = await call('/auth/setup', { setup: TOKEN, from: fresh() })
  await leaksNothing(state.raw, 'GET /auth/setup')
  assert.equal(await mailOn(), true)
  assert.equal((await call('/auth/providers')).body.no_mail, false)

  /* The owner, made; then Server settings. */
  const made = await call('/auth/setup/owner', {
    setup: TOKEN,
    from: fresh(),
    body: { name: 'Mail Owner', email: `mo${uid()}@example.com`, password: PASSWORD },
  })
  assert.equal(made.status, 201)
  const token = made.body.access_token as string
  const whole = await call('/api/instance', { token })
  assert.equal(whole.status, 200)
  assert.equal(whole.body.mail, true)
  assert.equal(whole.body.mail_setup.secret_set, true)
  await leaksNothing(whole.raw, 'GET /api/instance')
  await leaksNothing((await call('/api/me', { token })).raw, 'GET /api/me')

  /* The same host and user without a password keeps it; another host asks again. */
  const { password: _, ...noPassword } = smtp
  const kept = await call('/api/instance/mail', {
    method: 'PUT',
    token,
    body: { mail: { ...noPassword, sender: 'tuff@example.com' }, password: PASSWORD },
  })
  assert.equal(kept.status, 200, kept.raw)
  assert.equal(kept.body.mail_setup.secret_set, true)
  assert.equal(kept.body.mail_setup.sender, 'tuff@example.com')
  await leaksNothing(kept.raw, 'PUT /api/instance/mail')
  const [still] = await owner<{ p: string }[]>`select smtp_password_enc as p from instance_mail`
  assert.equal(open('mail', still!.p), SMTP_PASSWORD)
  const moved = await call('/api/instance/mail', {
    method: 'PUT',
    token,
    body: { mail: { ...noPassword, host: 'mail.attacker.example' }, password: PASSWORD },
  })
  assert.equal(moved.status, 400)
  assert.equal(moved.body.error.code, 'secret_needed')
  const otherUser = await call('/api/instance/mail', {
    method: 'PUT',
    token,
    body: { mail: { ...noPassword, user: 'someone-else' }, password: PASSWORD },
  })
  assert.equal(otherUser.body.error.code, 'secret_needed')

  /* Resend, with a key; then what sends is what is saved — the key opened, never shown. */
  const resend = await call('/api/instance/mail', {
    method: 'PUT',
    token,
    body: { mail: { via: 'resend', key: RESEND_KEY, sender: 'Tuff <tuff@example.com>' }, password: PASSWORD },
  })
  assert.equal(resend.status, 200, resend.raw)
  assert.deepEqual(
    {
      source: resend.body.mail_setup.source,
      via: resend.body.mail_setup.via,
      secret_set: resend.body.mail_setup.secret_set,
      host: resend.body.mail_setup.host,
    },
    { source: 'saved', via: 'resend', secret_set: true, host: null },
  )
  await leaksNothing(resend.raw, 'PUT /api/instance/mail (resend)')
  const asked: { auth: string; from: string }[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith('https://api.resend.com/')) {
      const h = new Headers(init?.headers)
      asked.push({ auth: h.get('authorization') ?? '', from: JSON.parse(String(init?.body)).from })
      return new Response('{}', { status: 200 })
    }
    return realFetch(url, init)
  }) as typeof fetch
  try {
    const letter = await call('/api/instance/test-letter', { method: 'POST', token, body: {} })
    assert.equal(letter.status, 200)
    assert.deepEqual(letter.body, { sent: true, mail: true })
    await leaksNothing(letter.raw, 'POST /api/instance/test-letter')
  } finally {
    globalThis.fetch = realFetch
  }
  assert.deepEqual(asked, [{ auth: `Bearer ${RESEND_KEY}`, from: 'Tuff <tuff@example.com>' }])

  /* Read by another process — the worker — as the database has it. */
  forgetSavedMail()
  assert.equal(await mailOn(), true)

  /* Disconnected. */
  const gone = await call('/api/instance/mail', { method: 'DELETE', token, body: { password: PASSWORD } })
  assert.equal(gone.status, 200)
  assert.equal(gone.body.mail, false)
  assert.equal(gone.body.mail_setup.source, null)
  assert.equal((await owner<{ n: number }[]>`select count(*)::int as n from instance_mail`)[0]!.n, 0)
  assert.equal((await call('/auth/providers')).body.no_mail, true)
})

test('changing mail in Server settings asks the owner to prove it is them; the setup screen does not', async () => {
  await freshServer()
  /* The setup screen: the token is the proof, nothing else is asked. */
  const viaSetup = await call('/auth/setup/mail', {
    method: 'PUT',
    setup: TOKEN,
    from: fresh(),
    body: { via: 'resend', key: RESEND_KEY, sender: 'tuff@example.com' },
  })
  assert.equal(viaSetup.status, 200, viaSetup.raw)
  const made = await call('/auth/setup/owner', {
    setup: TOKEN,
    from: fresh(),
    body: { name: 'Proving Owner', email: `po${uid()}@example.com`, password: PASSWORD },
  })
  const token = made.body.access_token as string
  const mail = {
    via: 'smtp',
    host: 'smtp.example.com',
    port: 465,
    security: 'tls',
    user: 'u',
    password: 'p-p-p-p',
    sender: 'tuff@example.com',
  }
  const row = async () => (await owner<{ via: string | null }[]>`select via from instance_mail`)[0]?.via ?? null

  /* Without the proof, and with a wrong one: refused, nothing changed. */
  for (const body of [{ mail }, { mail, password: 'not-the-password' }, { mail, password: '' }]) {
    const r = await call('/api/instance/mail', { method: 'PUT', token, body })
    assert.equal(r.status, 403, JSON.stringify(body))
    assert.equal(r.body.error.code, 'not_them')
  }
  assert.equal((await call('/api/instance/mail', { method: 'DELETE', token })).status, 403)
  assert.equal((await call('/api/instance/mail', { method: 'DELETE', token, body: { password: 'nope-nope-nope' } })).status, 403)
  assert.equal(await row(), 'resend', 'still what the setup screen saved')
  /* The old flat body is not a way round it. */
  assert.equal((await call('/api/instance/mail', { method: 'PUT', token, body: { ...mail } })).status, 400)

  /* With the password: changed, then disconnected. */
  const ok = await call('/api/instance/mail', { method: 'PUT', token, body: { mail, password: PASSWORD } })
  assert.equal(ok.status, 200, ok.raw)
  assert.equal(await row(), 'smtp')
  assert.equal((await call('/api/instance/mail', { method: 'DELETE', token, body: { password: PASSWORD } })).status, 200)
  assert.equal(await row(), null)

  /* An owner with no password proves it with six digits from the inbox, once. */
  const { registerUser } = await import('../src/auth/flows.js')
  const { outbox } = await import('../src/mail.js')
  const email = `nopw${uid()}@example.com`
  const other = await registerUser({ name: 'No Password', email, password: PASSWORD, workspace_name: 'NP', workspace_slug: `np-${uid()}` })
  await owner`update app_user set password_hash = null where actor_id = ${other.actor_id}`
  await owner`insert into instance_owner (actor_id) values (${other.actor_id})`
  assert.equal((await call('/api/instance/mail', { method: 'PUT', token: other.access_token, body: { mail, code: '000000' } })).status, 403)
  const sent = await call('/api/me/inbox-code', { method: 'POST', token: other.access_token, body: { for: 'mail' } })
  assert.equal(sent.status, 202, sent.raw)
  const letter = [...outbox].reverse().find((m) => m.to === email)
  assert.ok(letter, 'a code was mailed')
  assert.match(letter.text, /change how this server sends email/)
  const code = /\b(\d{6})\b/.exec(letter.subject)![1]!
  const byCode = await call('/api/instance/mail', { method: 'PUT', token: other.access_token, body: { mail, code } })
  assert.equal(byCode.status, 200, byCode.raw)
  /* Spent: the same digits again are no proof. */
  assert.equal((await call('/api/instance/mail', { method: 'DELETE', token: other.access_token, body: { code } })).status, 403)

  /* Ten wrong a quarter of an hour, then nothing is checked. */
  for (let i = 0; i < 10; i++) await call('/api/instance/mail', { method: 'DELETE', token, body: { password: `wrong-${i}-wrong` } })
  const held = await call('/api/instance/mail', { method: 'DELETE', token, body: { password: PASSWORD } })
  assert.equal(held.status, 429)
})

test('only an owner sets mail up: a member, a token and the service are told nothing is there', async () => {
  await freshServer()
  const made = await call('/auth/setup/owner', {
    setup: TOKEN,
    from: fresh(),
    body: { name: 'Only Owner', email: `oo${uid()}@example.com`, password: PASSWORD },
  })
  assert.equal(made.status, 201)
  const { registerUser } = await import('../src/auth/flows.js')
  const member = await registerUser({
    name: 'Mem',
    email: `mem${uid()}@example.com`,
    password: PASSWORD,
    workspace_name: 'Mem',
    workspace_slug: `mem-${uid()}`,
  })
  const body = { mail: { via: 'resend', key: RESEND_KEY, sender: 'tuff@example.com' }, password: PASSWORD }
  assert.equal((await call('/api/instance/mail', { method: 'PUT', token: member.access_token, body })).status, 404)
  assert.equal((await call('/api/instance/mail', { method: 'DELETE', token: member.access_token })).status, 404)
  /* The database refuses the application role with no owner and no token. */
  const [r] = await owner<{ said: string }[]>`
    select instance_mail_write(null, 'resend', null, null, null, null, null, 'sealed', true, 'tuff@example.com') as said`
  assert.equal(r!.said, 'forbidden')
  assert.equal((await owner<{ n: number }[]>`select count(*)::int as n from instance_mail`)[0]!.n, 0)
  Object.assign(edition, service)
  try {
    assert.equal((await call('/api/instance/mail', { method: 'PUT', token: made.body.access_token, body })).status, 404)
  } finally {
    asCommunity()
  }
})

test('what the form takes: SMTP ports, no plain text with a password or far away, no link-local or metadata host', async () => {
  await freshServer()
  const put = (body: Record<string, unknown>) => call('/auth/setup/mail', { method: 'PUT', setup: TOKEN, from: fresh(), body })
  const base = {
    via: 'smtp',
    host: 'smtp.example.com',
    port: 465,
    security: 'tls',
    user: 'u',
    password: 'p-p-p-p',
    sender: 'tuff@example.com',
  }
  assert.equal((await put({ ...base, port: 5432 })).body.error.code, 'bad_port')
  assert.equal((await put({ ...base, port: 80 })).body.error.code, 'bad_port')
  assert.equal((await put({ ...base, host: 'smtp://smtp.example.com' })).body.error.code, 'bad_host')
  assert.equal((await put({ ...base, host: 'smtp.example.com:25' })).body.error.code, 'bad_host')
  assert.equal((await put({ ...base, host: '169.254.169.254' })).body.error.code, 'bad_host')
  assert.equal((await put({ ...base, host: 'metadata.google.internal' })).body.error.code, 'bad_host')
  assert.equal((await put({ ...base, security: 'none' })).body.error.code, 'plain_not_allowed')
  assert.equal((await put({ ...base, security: 'none', user: null, password: null })).body.error.code, 'plain_not_allowed', 'far away')
  assert.equal((await put({ ...base, sender: 'Tuff <a@example.com>, b@example.com' })).body.error.code, 'bad_sender')
  assert.equal((await put({ ...base, sender: 'x@example.com\r\nBcc: y@example.com' })).body.error.code, 'bad_sender')
  assert.equal((await put({ ...base, extra: 1 })).status, 400)
  assert.equal(mailHost('SMTP.Example.COM.'), 'smtp.example.com')
  assert.equal(mailHost('[fe80::1]'), null)
  /* And what is sent with: TLS from the first byte, STARTTLS demanded, plain only nearby with nobody to sign in. */
  const from = { name: 'Tuff', address: 'tuff@example.com' }
  const o = (security: 'tls' | 'starttls' | 'none', host = 'smtp.example.com', user: string | null = 'u') =>
    savedSmtpOptions({ via: 'smtp', host, port: 587, security, user, password: user ? 'p' : null, from })
  assert.deepEqual([o('tls').secure, o('tls').requireTLS], [true, false])
  assert.deepEqual([o('starttls').secure, o('starttls').requireTLS], [false, true])
  assert.equal(o('none', 'postfix', null).requireTLS, false)
  assert.equal(o('none', 'smtp.example.com', null).requireTLS, true, 'plain to far away is refused again when sending')
  assert.equal(o('none', 'postfix', 'u').requireTLS, true, 'a password never crosses in the clear')
})

test('a mail server on the server’s own network is refused at save and at every letter, and the socket goes to the address checked', async () => {
  delete process.env.SMTP_ALLOW_PRIVATE
  await freshServer()
  const put = (body: Record<string, unknown>) => call('/auth/setup/mail', { method: 'PUT', setup: TOKEN, from: fresh(), body })
  const base = {
    via: 'smtp',
    host: 'smtp.example.com',
    port: 587,
    security: 'starttls',
    user: 'u',
    password: 'p-p-p-p',
    sender: 'tuff@example.com',
  }
  for (const host of [
    'inside.example.com',
    'loop.example.com',
    'cgnat.example.com',
    'ula.example.com',
    'meta.example.com',
    'meta6.example.com',
    'postfix',
    '10.0.0.5',
    '127.0.0.1',
    '100.64.0.1',
    '[fd12::1]',
    '[::1]',
    'localhost',
    'mail.local',
  ]) {
    const r = await put({ ...base, host })
    assert.equal(r.status, 400, host)
    assert.equal(r.body.error.code, 'private_host', host)
  }
  assert.equal((await put({ ...base, host: 'nowhere.example.com' })).body.error.code, 'unknown_host')
  assert.equal((await owner<{ n: number }[]>`select count(*)::int as n from instance_mail`)[0]!.n, 0)

  /* Saved while it pointed outside; then the name is pointed inside. The next letter does not go. */
  assert.equal((await put(base)).status, 200)
  forgetSavedMail()
  DNS['smtp.example.com'] = '127.0.0.1'
  const said: string[] = []
  const was = console.error
  console.error = (...a: unknown[]) => void said.push(a.map(String).join(' '))
  try {
    assert.equal(await send({ to: 'reader@example.com', subject: 's', text: 't', html: 'h' }), false)
  } finally {
    console.error = was
    DNS['smtp.example.com'] = '93.184.216.34'
  }
  assert.ok(
    said.some((l) => /saved mail server is at a private address/.test(l)),
    said.join('\n'),
  )

  /* Pinned: the socket is given the address that was checked, the name only for TLS. */
  const at = await mailServerAddress('smtp.example.com', false)
  assert.deepEqual(at, { address: '93.184.216.34', family: 4 })
  const pinned = savedSmtpOptions(
    {
      via: 'smtp',
      host: 'smtp.example.com',
      port: 587,
      security: 'starttls',
      user: 'u',
      password: 'p',
      from: { name: '', address: 'tuff@example.com' },
    },
    '93.184.216.34',
  )
  assert.equal(pinned.host, '93.184.216.34')
  assert.equal(pinned.servername, 'smtp.example.com')
  /* A name with one public and one private address is refused whole. */
  const one = smtpResolving.resolve
  smtpResolving.resolve = (host, done) =>
    host === 'split.example.com'
      ? done(null, [
          { address: '93.184.216.40', family: 4 },
          { address: '10.0.0.40', family: 4 },
        ])
      : one(host, done)
  try {
    assert.equal(await mailServerAddress('split.example.com', false), 'private')
  } finally {
    smtpResolving.resolve = one
  }
})

test('SMTP_ALLOW_PRIVATE=1 lets a relay of one’s own through — never link-local or a metadata address', async () => {
  process.env.SMTP_ALLOW_PRIVATE = '1'
  try {
    await freshServer()
    const put = (body: Record<string, unknown>) => call('/auth/setup/mail', { method: 'PUT', setup: TOKEN, from: fresh(), body })
    const relay = await put({
      via: 'smtp',
      host: 'postfix',
      port: 25,
      security: 'none',
      user: null,
      password: null,
      sender: 'tuff@example.com',
    })
    assert.equal(relay.status, 200, relay.raw)
    assert.equal(relay.body.mail_setup.security, 'none')
    assert.equal(relay.body.mail_setup.secret_set, false)
    const inside = await put({
      via: 'smtp',
      host: 'inside.example.com',
      port: 587,
      security: 'starttls',
      user: 'u',
      password: 'p-p-p-p',
      sender: 'tuff@example.com',
    })
    assert.equal(inside.status, 200, inside.raw)
    for (const host of ['meta.example.com', 'meta6.example.com']) {
      const r = await put({
        via: 'smtp',
        host,
        port: 587,
        security: 'starttls',
        user: 'u',
        password: 'p-p-p-p',
        sender: 'tuff@example.com',
      })
      assert.equal(r.body.error.code, 'private_host', host)
    }
    assert.equal(await mailServerAddress('169.254.169.254', true), 'private')
    assert.equal(await mailServerAddress('100.100.100.200', true), 'private')
    assert.equal(await mailServerAddress('[fe80::1]', true), 'private')
    assert.deepEqual(await mailServerAddress('postfix', true), { address: '172.18.0.5', family: 4 })
  } finally {
    delete process.env.SMTP_ALLOW_PRIVATE
  }
})

test('the environment wins: shown as set there, read-only, and never its password', async () => {
  await freshServer()
  const made = await call('/auth/setup/owner', {
    setup: TOKEN,
    from: fresh(),
    body: { name: 'Env Owner', email: `eo${uid()}@example.com`, password: PASSWORD },
  })
  const token = made.body.access_token as string
  try {
    ;(env as { smtp: unknown }).smtp = readSmtp(`smtps://mailer:${SMTP_PASSWORD}@smtp.env.example:465`, 'Tuff <tuff@env.example>')
    const whole = await call('/api/instance', { token })
    assert.deepEqual(whole.body.mail_setup, {
      source: 'env',
      via: 'smtp',
      host: 'smtp.env.example',
      port: 465,
      security: 'tls',
      user: 'mailer',
      secret_set: true,
      sender: 'Tuff <tuff@env.example>',
    })
    await leaksNothing(whole.raw, 'GET /api/instance with SMTP_URL')
    const put = await call('/api/instance/mail', {
      method: 'PUT',
      token,
      body: { mail: { via: 'resend', key: RESEND_KEY, sender: 'tuff@example.com' }, password: PASSWORD },
    })
    assert.equal(put.status, 409)
    assert.equal(put.body.error.code, 'mail_from_env')
    assert.equal((await call('/api/instance/mail', { method: 'DELETE', token, body: { password: PASSWORD } })).status, 409)
    assert.equal((await owner<{ n: number }[]>`select count(*)::int as n from instance_mail`)[0]!.n, 0)

    ;(env as { smtp: unknown }).smtp = null
    ;(env as { resendApiKey: string }).resendApiKey = RESEND_KEY
    process.env.MAIL_FROM = 'Tuff <tuff@env.example>'
    const resend = await call('/api/instance', { token })
    assert.equal(resend.body.mail_setup.source, 'env')
    assert.equal(resend.body.mail_setup.via, 'resend')
    assert.equal(resend.body.mail_setup.secret_set, true)
    await leaksNothing(resend.raw, 'GET /api/instance with RESEND_API_KEY')
  } finally {
    noEnvMail()
    delete process.env.MAIL_FROM
  }
})
