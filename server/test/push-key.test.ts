import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createPublicKey, randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { decodeJwt, jwtVerify } from 'jose'

/*
 * The VAPID pair your own server makes for itself.
 *
 * On a database of its own, as `instance.test.ts` and `first-run.test.ts`
 * are, for the same reason: the settings row is one per database, and
 * marking the shared one a server of one's own would close sign-up for
 * every test file beside this one. The service's edition first; then the
 * community edition put in its place, and the database told it is a
 * server of one's own the way a community server tells it, by
 * `edition.ready`.
 */
const { migrate } = await import('../src/db/migrate.js')
const shared = process.env.DATABASE_URL!
const admin = postgres(shared, { max: 1, onnotice: () => {} })
const DB = `tracker_pushkey_${randomUUID().replace(/-/g, '').slice(0, 12)}`
const at = (url: string) => {
  const u = new URL(url)
  u.pathname = `/${DB}`
  return u.href
}
const ends: (() => Promise<unknown>)[] = []
after(async () => {
  for (const end of ends.reverse()) await end().catch((e: unknown) => console.error('[push-key.test] cleanup', e))
  await admin.unsafe(`drop database if exists ${DB} with (force)`)
  await admin.end()
})
await admin.unsafe(`create database ${DB}`)
await migrate(at(shared))
process.env.DATABASE_URL = at(shared)
process.env.DATABASE_URL_APP = at(process.env.DATABASE_URL_APP ?? shared)
if (process.env.DATABASE_URL_WORKER) process.env.DATABASE_URL_WORKER = at(process.env.DATABASE_URL_WORKER)
if (process.env.DATABASE_URL_AUTH) process.env.DATABASE_URL_AUTH = at(process.env.DATABASE_URL_AUTH)
delete process.env.SETUP_TOKEN
delete process.env.OWNER_EMAIL

const { edition } = await import('../src/edition.js')
const { edition: community } = await import('../src/edition.js')
const { app } = await import('../src/http/routes.js')
const { env } = await import('../src/env.js')
const { keyIdOf, open, seal } = await import('../src/auth/seal.js')
const { forgetSavedMail } = await import('../src/mail.js')
const { SEALED, reseal } = await import('../src/reseal.js')
const { sendTo, vapidSubject, webPushConfigured, vapidPublicKey } = await import('../src/push.js')
const {
  freshPushKey,
  forgetPushKey,
  forgetPushSubject,
  vapidPair,
  makePair,
  pairMatches,
  pushKeyClock,
  compareWithApp,
  fingerprint,
  pushKeyLine,
} = await import('../src/pushKey.js')
const { closeDb, makeOwner } = await import('./helpers.js')

const theCommunity = { ...community, instance: true }
const service = { ...edition, ...(edition.instance ? { instance: false } : {}) }
Object.assign(edition, service)
const asCommunity = () => Object.assign(edition, theCommunity)

/* Nothing from this machine's `.env`: no VAPID keys or subject, no mail. */
const was = {
  vapidPublicKey: env.vapidPublicKey,
  vapidPrivateKey: env.vapidPrivateKey,
  vapidSubject: env.vapidSubject,
  resendApiKey: env.resendApiKey,
  smtp: env.smtp,
  mailFrom: env.mailFrom,
  appUrl: env.appUrl,
}
const bare = () => {
  Object.assign(env as Record<string, unknown>, {
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: '',
    resendApiKey: '',
    smtp: null,
    mailFrom: '',
    /* No address of its own until a test gives it one: the mailto rule is tested first. */
    appUrl: '',
  })
}
bare()

const owner = postgres(at(shared), { max: 1, onnotice: () => {} })
const appUrl = process.env.DATABASE_URL_APP!
ends.push(
  async () => Object.assign(edition, service),
  async () => Object.assign(env as Record<string, unknown>, was),
  () => closeDb(),
  () => owner.end(),
)

type Kept = { public_key: string; private_key_enc: string }
const rows = () => owner<Kept[]>`select public_key, private_key_enc from instance_push_key`

async function quiet<T>(work: () => Promise<T>): Promise<T> {
  const log = console.log
  const error = console.error
  console.log = () => {}
  console.error = () => {}
  try {
    return await work()
  } finally {
    console.log = log
    console.error = error
  }
}

/** A start of the server: the community's `ready`, as a fresh process would run it. */
async function start(): Promise<void> {
  forgetPushKey()
  asCommunity()
  await quiet(() => edition.ready(owner))
}

/* Signed up while the server is still the service's — sign-up open — for the endpoint test below. */
const person = await makeOwner()

test('the service never makes, reads or keeps a pair, and the database refuses it one', async () => {
  Object.assign(edition, service)
  forgetPushKey()
  await freshPushKey()
  assert.equal(vapidPair(), null)
  assert.equal(webPushConfigured(), false)
  assert.equal((await rows()).length, 0)

  /* Even asked directly, as the application: not a server of one's own, no row. */
  const a = postgres(appUrl, { max: 1, onnotice: () => {} })
  try {
    const p = makePair()
    const kept = await a<Kept[]>`select * from instance_push_key_keep(${p.publicKey}, ${seal('vapid', p.privateKey)})`
    assert.equal(kept.length, 0)
    assert.equal((await a<Kept[]>`select * from instance_push_key_kept()`).length, 0)
    assert.equal((await a<{ k: unknown }[]>`select instance_push_app_key() as k`)[0]!.k, null)
    /* And the table itself is nobody's but its owner's. */
    await assert.rejects(a`select * from instance_push_key`, /permission denied/)
    await assert.rejects(a`insert into instance_push_key (public_key, private_key_enc) values ('x', 'y')`, /permission denied/)
    /* Nor may the application say which key the app signs with: only the serving start, as the table owner. */
    await assert.rejects(a`select instance_push_app_key_said(${p.publicKey})`, /permission denied/)
  } finally {
    await a.end()
  }
  assert.equal((await rows()).length, 0)
  /* The worker's own role is granted none of it: the worker process reads through the application's connection. */
  const [g] = await owner<{ n: number }[]>`
    select count(*)::int as n from information_schema.routine_privileges
    where grantee = 'tracker_worker' and routine_name like 'instance_push%'`
  assert.equal(g!.n, 0)
})

test('your own server with no keys in the environment makes a pair on its first start, sealed at rest', async () => {
  await start()
  const [row, ...more] = await rows()
  assert.ok(row)
  assert.equal(more.length, 0)
  const pair = vapidPair()
  assert.ok(pair)
  assert.equal(pair.publicKey, row.public_key)
  assert.ok(pairMatches(pair))
  /* Not the scalar, in any spelling: a sealing that opens to it. */
  assert.ok(!row.private_key_enc.includes(pair.privateKey))
  assert.ok(!row.private_key_enc.includes(Buffer.from(pair.privateKey, 'base64url').toString('base64')))
  assert.ok(!row.private_key_enc.includes(Buffer.from(pair.privateKey, 'base64url').toString('hex')))
  assert.equal(open('vapid', row.private_key_enc), pair.privateKey)
  /* Its own sealing: not opened as anything else's. */
  assert.equal(open('mail', row.private_key_enc), null)
  assert.ok(SEALED.some((s) => s.table === 'instance_push_key' && s.column === 'private_key_enc' && s.kind === 'vapid'))
})

test('a second start reads the same pair and never makes another', async () => {
  const [before] = await rows()
  const first = vapidPair()
  await start()
  await start()
  const after = await rows()
  assert.equal(after.length, 1)
  assert.equal(after[0]!.public_key, before!.public_key)
  assert.equal(after[0]!.private_key_enc, before!.private_key_enc)
  assert.deepEqual(vapidPair(), first)
})

test('two starts at once end with one pair: the second waits for the first and reads its pair back', async () => {
  await owner`delete from instance_push_key`
  const a = postgres(appUrl, { max: 1, onnotice: () => {} })
  const b = postgres(appUrl, { max: 1, onnotice: () => {} })
  try {
    const one = makePair()
    const two = makePair()
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    let inserted!: () => void
    const firstIn = new Promise<void>((r) => {
      inserted = r
    })
    /* The first start's insert, not yet committed. */
    const first = a.begin(async (tx) => {
      const r = await tx<Kept[]>`select * from instance_push_key_keep(${one.publicKey}, ${seal('vapid', one.privateKey)})`
      inserted()
      await held
      return r
    })
    await firstIn
    /* The second's, while the first holds the row: it waits on the key. */
    const second = b<Kept[]>`select * from instance_push_key_keep(${two.publicKey}, ${seal('vapid', two.privateKey)})`
    second.then(
      () => {},
      () => {},
    )
    let waiting = false
    for (let i = 0; i < 200 && !waiting; i++) {
      const [w] = await owner<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity
        where datname = ${DB} and wait_event_type = 'Lock' and query like '%instance_push_key_keep%'`
      waiting = w!.n > 0
      if (!waiting) await new Promise((r) => setTimeout(r, 25))
    }
    assert.ok(waiting, 'the second start waited on the first one’s row')
    release()
    const [ra] = await first
    const [rb] = await second
    assert.equal(ra!.public_key, one.publicKey)
    assert.equal(rb!.public_key, one.publicKey, 'the second start reads back the first one’s pair')
    assert.equal(rb!.private_key_enc, ra!.private_key_enc)
    assert.equal((await rows()).length, 1)

    /* And plainly at once, both ways in: one row, one answer. */
    await owner`delete from instance_push_key`
    const [x, y] = await Promise.all(
      [a, b].map(async (db) => {
        const p = makePair()
        return (await db<Kept[]>`select * from instance_push_key_keep(${p.publicKey}, ${seal('vapid', p.privateKey)})`)[0]!
      }),
    )
    assert.equal(x!.public_key, y!.public_key)
    assert.equal((await rows()).length, 1)
  } finally {
    await a.end()
    await b.end()
  }
  /* What a start reads now is that one. */
  await start()
  assert.equal(vapidPair()!.publicKey, (await rows())[0]!.public_key)
})

test('keys in the environment win: the kept pair is neither read nor made', async () => {
  const [kept] = await rows()
  const mine = makePair()
  env.vapidPublicKey = mine.publicKey
  env.vapidPrivateKey = mine.privateKey
  try {
    await start()
    assert.deepEqual(vapidPair(), mine)

    /* On a server with nothing kept, nothing is made either. */
    await owner`delete from instance_push_key`
    await start()
    assert.deepEqual(vapidPair(), mine)
    assert.equal((await rows()).length, 0)

    /* Half a pair is push off, not a kept pair standing in. */
    env.vapidPrivateKey = ''
    await start()
    assert.equal(vapidPair(), null)
    assert.equal(webPushConfigured(), false)
    assert.equal((await rows()).length, 0)
  } finally {
    env.vapidPublicKey = ''
    env.vapidPrivateKey = ''
  }
  /* Put back what was kept, as it was. */
  await owner`insert into instance_push_key (public_key, private_key_enc) values (${kept!.public_key}, ${kept!.private_key_enc})`
  await start()
  assert.equal(vapidPair()!.publicKey, kept!.public_key)
})

test('the subject: VAPID_SUBJECT, else an https APP_URL, else the address mail is sent from, never the owner’s own', async () => {
  await owner`truncate instance_owner, instance_mail`
  forgetSavedMail()
  await start()
  assert.ok(vapidPair())
  assert.equal(vapidSubject(), '')
  assert.equal(webPushConfigured(), false, 'no one to name: push stays off')
  assert.equal(vapidPublicKey(), null)

  /* A confirmed owner is never the subject: a person's email is theirs to give. */
  const boss = `boss-${randomUUID().slice(0, 8)}@example.com`
  const id = randomUUID()
  await owner`insert into actor (id, name) values (${id}, 'Owner')`
  await owner`insert into app_user (actor_id, email, password_hash, email_verified_at)
              values (${id}, ${boss}, ${'x'.repeat(60)}, now())`
  await owner`insert into instance_owner (actor_id) values (${id})`
  forgetPushSubject()
  await freshPushKey()
  assert.equal(vapidSubject(), '')

  /* MAIL_FROM with no mail sent from the environment is no sender either. */
  env.mailFrom = 'Ops <ops@example.net>'
  forgetPushSubject()
  await freshPushKey()
  assert.equal(vapidSubject(), '')

  /* Mail saved in Server settings: the address it is sent from. */
  await owner`insert into instance_mail (via, resend_key_enc, sender)
              values ('resend', ${seal('mail', 're_test_0123456789')}, 'Tuff <tuff@example.org>')`
  forgetSavedMail()
  forgetPushSubject()
  await freshPushKey()
  assert.equal(vapidSubject(), 'mailto:tuff@example.org')
  assert.equal(webPushConfigured(), true)
  assert.equal(vapidPublicKey(), vapidPair()!.publicKey)

  /* Mail sent from the environment: MAIL_FROM, over the saved one. */
  env.resendApiKey = 're_env_0123456789'
  try {
    forgetPushSubject()
    await freshPushKey()
    assert.equal(vapidSubject(), 'mailto:ops@example.net')
  } finally {
    env.resendApiKey = ''
  }
  env.mailFrom = ''
  forgetPushSubject()
  await freshPushKey()
  assert.equal(vapidSubject(), 'mailto:tuff@example.org')

  /* The environment's subject over all of it. */
  env.vapidSubject = 'mailto:push@example.com'
  try {
    assert.equal(vapidSubject(), 'mailto:push@example.com')
  } finally {
    env.vapidSubject = ''
  }

  /* An https APP_URL wins over the mail sender: the server's own origin, nothing after it. */
  env.appUrl = 'https://tuff.example.com/some/path'
  try {
    forgetPushSubject()
    await freshPushKey()
    assert.equal(vapidSubject(), 'https://tuff.example.com')
    assert.equal(webPushConfigured(), true)
    /* And VAPID_SUBJECT still over that. */
    env.vapidSubject = 'mailto:push@example.com'
    assert.equal(vapidSubject(), 'mailto:push@example.com')
    env.vapidSubject = ''
    /* Try mode on localhost: http is no subject, so back to the sender — and still not the owner. */
    env.appUrl = 'http://localhost:3000'
    forgetPushSubject()
    await freshPushKey()
    assert.equal(vapidSubject(), 'mailto:tuff@example.org')
    assert.ok(!vapidSubject().includes(boss))
  } finally {
    env.appUrl = ''
    env.vapidSubject = ''
  }
})

test('a message is signed with the kept pair and the sender’s address, and the endpoint answers only the public half', async () => {
  const pair = vapidPair()!
  let auth = ''
  const status = await sendTo(
    { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', ...browserKeys() },
    { title: 'T', url: '/' },
    async (_url, init) => {
      auth = (init.headers as Record<string, string>).authorization!
      return new Response(null, { status: 201 })
    },
  )
  assert.equal(status, 201)
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(auth)
  assert.ok(m)
  assert.equal(m[2], pair.publicKey)
  const raw = Buffer.from(pair.publicKey, 'base64url')
  const key = createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33, 65).toString('base64url') },
    format: 'jwk',
  })
  await jwtVerify(m[1]!, key)
  assert.equal(decodeJwt(m[1]!).sub, 'mailto:tuff@example.org')

  const r = await app.request('/api/push', { headers: { authorization: `Bearer ${person.token}` } })
  const text = await r.text()
  assert.equal(r.status, 200)
  assert.equal(JSON.parse(text).key, pair.publicKey)
  assert.ok(!text.includes(pair.privateKey))
})

test('a kept key that will not open turns push off, says which key sealed it, is never replaced, and comes back once it opens', async () => {
  const [before] = await rows()
  const plain = open('vapid', before!.private_key_enc)!
  const other = 'q'.repeat(64)
  const elsewhere = seal('vapid', plain, { jwt: 'z'.repeat(40), current: other, previous: '' })
  await owner`update instance_push_key set private_key_enc = ${elsewhere}`
  const said: string[] = []
  const heard: string[] = []
  const error = console.error
  const log = console.log
  console.error = (...a: unknown[]) => said.push(a.map(String).join(' '))
  console.log = (...a: unknown[]) => heard.push(a.map(String).join(' '))
  pushKeyClock.unreadableRetryMs = 0
  try {
    forgetPushKey()
    asCommunity()
    await freshPushKey()
    await freshPushKey()
    await freshPushKey()
    assert.equal(vapidPair(), null)
    assert.equal(webPushConfigured(), false)
    const after = await rows()
    assert.equal(after.length, 1)
    assert.equal(after[0]!.public_key, before!.public_key, 'not replaced')
    assert.equal(after[0]!.private_key_enc, elsewhere)
    /* Once, though asked three times; naming the key by its id and the fix, never the content. */
    const lines = said.filter((l) => l.includes('instance_push_key'))
    assert.equal(lines.length, 1)
    assert.ok(lines[0]!.includes(`ENCRYPTION_KEY with id ${keyIdOf(other)}`))
    assert.ok(lines[0]!.includes('restart both the app and the worker'))
    assert.ok(!said.some((l) => l.includes(plain) || l.includes(elsewhere)))

    /* Sealed under JWT_SECRET, before ENCRYPTION_KEY: said so. */
    said.length = 0
    forgetPushKey()
    await owner`update instance_push_key set private_key_enc = ${seal('vapid', plain, { jwt: 'z'.repeat(40), current: '', previous: '' })}`
    await freshPushKey()
    assert.ok(said.some((l) => l.includes('sealed under JWT_SECRET')))

    /* Put right — `reseal`, from elsewhere — and the next ask finds it, without a restart. */
    await owner`update instance_push_key set private_key_enc = ${before!.private_key_enc}`
    await freshPushKey()
    assert.equal(vapidPair()!.publicKey, before!.public_key)
    assert.ok(heard.some((l) => l.includes('opens now')))
  } finally {
    console.error = error
    console.log = log
    pushKeyClock.unreadableRetryMs = 60_000
  }
})

test('the app says which key it signs with, and the worker says loudly when its own is another', async () => {
  await start()
  const mine = vapidPair()!
  const [said] = await owner<{ k: string | null }[]>`select push_public_key as k from instance_setting`
  assert.equal(said!.k, mine.publicKey)
  assert.ok(pushKeyLine('app')!.includes(fingerprint(mine.publicKey)))
  assert.ok(!pushKeyLine('app')!.includes(mine.privateKey))

  const loud: string[] = []
  const calm: string[] = []
  const error = console.error
  const log = console.log
  console.error = (...a: unknown[]) => loud.push(a.map(String).join(' '))
  console.log = (...a: unknown[]) => calm.push(a.map(String).join(' '))
  pushKeyClock.compareEveryMs = 0
  const other = makePair()
  try {
    /* The same pair: nothing to say. */
    await compareWithApp()
    assert.equal(loud.length, 0)

    /* VAPID_* on the worker only: another pair, said once however often it is asked. */
    env.vapidPublicKey = other.publicKey
    env.vapidPrivateKey = other.privateKey
    await compareWithApp()
    await compareWithApp()
    assert.equal(loud.length, 1)
    assert.ok(loud[0]!.includes(fingerprint(other.publicKey)) && loud[0]!.includes(fingerprint(mine.publicKey)))
    assert.ok(loud[0]!.includes('on both the app and the worker or on neither'))
    assert.ok(!loud[0]!.includes(other.privateKey))

    /* Put right: said that it agrees again. */
    env.vapidPublicKey = ''
    env.vapidPrivateKey = ''
    await compareWithApp()
    assert.ok(calm.some((l) => l.includes('same key now')))
  } finally {
    console.error = error
    console.log = log
    env.vapidPublicKey = ''
    env.vapidPrivateKey = ''
    pushKeyClock.compareEveryMs = 60_000
  }
})

test('reseal moves the kept key to a new ENCRYPTION_KEY, and it opens there', async () => {
  /* Only this row. */
  await owner`truncate instance_mail`
  const [before] = await rows()
  const plain = open('vapid', before!.private_key_enc)!
  const ring = { jwt: env.jwtSecret, current: 'n'.repeat(64), previous: env.encryptionKey }
  const r = await reseal(owner, ring, ['true'])
  assert.equal(r.unreadable, 0)
  const [after] = await rows()
  assert.notEqual(after!.private_key_enc, before!.private_key_enc)
  assert.equal(open('vapid', after!.private_key_enc, ring), plain)
  await owner`update instance_push_key set private_key_enc = ${before!.private_key_enc}`
})

/** A browser's half of a subscription, as the Push API hands it over. */
function browserKeys(): { p256dh: string; auth: string } {
  const p = makePair()
  return { p256dh: p.publicKey, auth: Buffer.from('0123456789abcdef').toString('base64url') }
}
