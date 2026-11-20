import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createECDH, createDecipheriv, createHmac, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto'
import { app } from '../src/http/routes.js'
import { sendTo, pushDue, recountDue } from '../src/push.js'
import { sendToPhone, type Post } from '../src/apns.js'
import { trial } from '../src/http/push.js'
import { forgetFcmToken, type Send } from '../src/fcm.js'
import { env } from '../src/env.js'
import { jwtVerify, decodeProtectedHeader } from 'jose'
import postgres from 'postgres'
import { closeDb, withActor, asWorker, uuidv7, makeOwner, makeProject } from './helpers.js'

/*
 * A key pair of this file's own, made here rather than taken from the
 * environment.
 *
 * Without one the endpoint answers `503` and the sender does nothing, which
 * is right for a deployment that has not been given keys and wrong for a
 * test: it passed on the machine where `.env` happened to have a pair and
 * failed in CI, where it did not — and a test that only runs when somebody's
 * environment is set up a particular way is one that is quietly not running
 * most of the time.
 *
 * Assigned into `env` because that is where the sender reads them, and the
 * alternative is a parameter threaded through four functions so that a test
 * can reach it.
 */
{
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pub = publicKey.export({ format: 'jwk' }) as { x: string; y: string }
  env.vapidPublicKey = Buffer.concat([Buffer.from([0x04]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]).toString(
    'base64url',
  )
  env.vapidPrivateKey = (privateKey.export({ format: 'jwk' }) as { d: string }).d
  env.vapidSubject = 'mailto:ci@example.com'
}

/* And a key of its own for Apple's service, for the same reason. */
const apple = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
env.apnsKey = apple.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
env.apnsKeyId = 'TESTKEY123'
env.apnsTeamId = 'TEAM123456'
env.apnsTopic = 'com.usetuff.app'

/* Past row-level security, to age a session as time and other paths would. */
const admin = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

after(async () => {
  await admin.end()
  await closeDb()
})

async function call(path: string, token: string, init: { method?: string; body?: unknown } = {}) {
  const r = await app.request(path, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}

/** A browser's half of the exchange, which is all a subscription really is. */
function aBrowser() {
  const ec = createECDH('prime256v1')
  ec.generateKeys()
  const auth = randomBytes(16)
  return {
    keys: { p256dh: ec.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
    /** What the browser does with what arrives — RFC 8188 and RFC 8291. */
    open(sealed: Buffer): string {
      const salt = sealed.subarray(0, 16)
      const keyLength = sealed.readUInt8(20)
      const theirPub = sealed.subarray(21, 21 + keyLength)
      const body = sealed.subarray(21 + keyLength)

      const shared = ec.computeSecret(theirPub)
      const hkdf = (s: Buffer, ikm: Buffer, info: Buffer, n: number) => {
        const prk = createHmac('sha256', s).update(ikm).digest()
        return createHmac('sha256', prk)
          .update(Buffer.concat([info, Buffer.from([1])]))
          .digest()
          .subarray(0, n)
      }
      const ikm = hkdf(auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), ec.getPublicKey(), theirPub]), 32)
      const key = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
      const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12)

      const tag = body.subarray(body.length - 16)
      const cipher = createDecipheriv('aes-128-gcm', key, nonce)
      cipher.setAuthTag(tag)
      const plain = Buffer.concat([cipher.update(body.subarray(0, body.length - 16)), cipher.final()])
      // The trailing 0x02 says this was the last record.
      assert.equal(plain[plain.length - 1], 0x02)
      return plain.subarray(0, plain.length - 1).toString('utf8')
    },
  }
}

/*
 * The part where a mistake is silent.
 *
 * A push service accepts anything shaped like a message and says 201; only
 * the browser finds out the key was derived wrong, and it says nothing to
 * anybody — the notification simply never appears. So this is a browser,
 * doing what a browser does with what we send it.
 */
test('what is sent is what the browser that subscribed can open, and nobody else', async () => {
  const them = aBrowser()
  let sealed: Buffer | null = null
  let sent: { headers: Record<string, string>; url: string } | null = null

  const status = await sendTo(
    { endpoint: 'https://push.example.com/abc', ...them.keys },
    { title: 'Draft the announcement', body: 'Assigned to you · RED-12', url: '/studio/redesign/tasks/12' },
    (async (url: string, init: { headers: Record<string, string>; body: Buffer }) => {
      sent = { url, headers: init.headers }
      sealed = init.body
      return new Response(null, { status: 201 })
    }) as unknown as typeof fetch,
  )
  assert.equal(status, 201)
  assert.ok(sealed)

  const told = JSON.parse(them.open(sealed!)) as { title: string; url: string }
  assert.equal(told.title, 'Draft the announcement')
  // The address is the point: a notification opens the thing, not "the app".
  assert.equal(told.url, '/studio/redesign/tasks/12')

  // Signed for the push service that will check it, and marked as the
  // encoding it is.
  assert.match(sent!.headers.authorization!, /^vapid t=ey.+, k=.+$/)
  assert.equal(sent!.headers['content-encoding'], 'aes128gcm')

  // Another browser cannot open it, which is the whole of RFC 8291.
  assert.throws(() => aBrowser().open(sealed!))
})

/*
 * The same thing, opened by a different implementation of HKDF.
 *
 * The test above derives its keys the way the sender does, with hand-rolled
 * HMAC — so a misunderstanding shared between the two would pass it and still
 * never reach a browser, which is the one way this can be green and wrong.
 * Node has its own `hkdfSync`. If both land on the same key, the derivation
 * is right and not merely self-consistent.
 */
test('the keys are right, and not merely agreed on with ourselves', async () => {
  const ec = createECDH('prime256v1')
  ec.generateKeys()
  const auth = randomBytes(16)
  let sealed: Buffer | null = null

  await sendTo(
    {
      endpoint: 'https://fcm.googleapis.com/fcm/send/x',
      p256dh: ec.getPublicKey().toString('base64url'),
      auth: auth.toString('base64url'),
    },
    { title: 'Draft the announcement', url: '/ours/tracker/tasks/1', unread: 3 },
    (async (_url: string, init: { body: Buffer }) => {
      sealed = init.body
      return new Response(null, { status: 201 })
    }) as unknown as typeof fetch,
  )
  const body = sealed as unknown as Buffer
  assert.ok(body)

  const salt = body.subarray(0, 16)
  // The framing of RFC 8188: sixteen of salt, the record size, the length of
  // the key that follows, then the key, then one record.
  assert.equal(body.readUInt32BE(16), 4096)
  const idLen = body.readUInt8(20)
  assert.equal(idLen, 65)
  const asPub = body.subarray(21, 21 + idLen)
  const ct = body.subarray(21 + idLen)

  const shared = ec.computeSecret(asPub)
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ec.getPublicKey(), asPub]), 32))
  const key = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))

  const d = createDecipheriv('aes-128-gcm', key, nonce)
  d.setAuthTag(ct.subarray(ct.length - 16))
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()])
  assert.equal(plain[plain.length - 1], 0x02)
  const told = JSON.parse(plain.subarray(0, plain.length - 1).toString('utf8')) as {
    url: string
    unread: number
  }
  assert.equal(told.url, '/ours/tracker/tasks/1')
  // And the number for the icon rides with it, because the app is usually not
  // running when one lands.
  assert.equal(told.unread, 3)
})

/*
 * The queue that was built and never drained. `notification.deliver_after`
 * and `delivered_at` have been here since `004_notifications.sql` with
 * nothing at the end of them.
 */
test('a notification due is sent once, and a dead subscription is dropped', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const task = uuidv7()
  await withActor(ctx.actorId, async (tx) => {
    await tx`
      insert into task (id, workspace_id, project_id, author_id, title, sort_key)
      values (${task}, ${workspaceId}, ${project}, ${ctx.actorId}, 'Draft it', 'a0')`
  })

  const them = aBrowser()
  const endpoint = `https://fcm.googleapis.com/fcm/send/${uuidv7()}`
  const made = await call('/api/push', token, {
    method: 'POST',
    body: { endpoint, keys: them.keys, said: 'Safari on Mac' },
  })
  assert.equal(made.status, 201)

  // A notification for this person, due now.
  const note = uuidv7()
  await withActor(ctx.actorId, async (tx) => {
    await tx`
      insert into notification
        (id, workspace_id, actor_id, reason, object_type, object_id)
      values (${note}, ${workspaceId}, ${ctx.actorId}, 'assigned', 'task', ${task})`
  })

  let hits = 0
  const ok = (async () => {
    hits += 1
    return new Response(null, { status: 201 })
  }) as unknown as typeof fetch

  await pushDue(50, ok)
  assert.equal(hits, 1)
  // Said and done with: a second pass finds nothing, however often the worker
  // runs. That is the difference between a queue and a loop.
  await pushDue(50, ok)
  assert.equal(hits, 1)

  // And a subscription the browser has thrown away goes at once: unlike a
  // webhook there is nothing on the other end to come back.
  const note2 = uuidv7()
  await withActor(ctx.actorId, async (tx) => {
    await tx`
      insert into notification
        (id, workspace_id, actor_id, reason, object_type, object_id)
      values (${note2}, ${workspaceId}, ${ctx.actorId}, 'mentioned', 'task', ${task})`
  })
  const gone = (async () => new Response(null, { status: 410 })) as unknown as typeof fetch
  await pushDue(50, gone)

  const left = await call('/api/push', token)
  assert.deepEqual(left.body.devices, [])
})

test('a device belongs to the person who registered it', async () => {
  const mine = await makeOwner()
  const theirs = await makeOwner()
  const them = aBrowser()
  await call('/api/push', mine.token, {
    method: 'POST',
    body: { endpoint: `https://fcm.googleapis.com/fcm/send/${uuidv7()}`, keys: them.keys },
  })
  // Not even an owner reads somebody else's: a subscription is a handle on
  // their phone, and no question the product asks needs one.
  assert.deepEqual((await call('/api/push', theirs.token)).body.devices, [])
})

/*
 * The sender has no actor, and four things in this file have now been written
 * as if it had. This is the fourth: `last_used_at` was a plain update, the
 * update policy is `actor_id = current_actor()`, and it matched nothing and
 * said nothing — every device looked as though it had never been used,
 * including the ones being written to every two seconds.
 */
test('a device that was written to says when', async () => {
  const { ctx, workspaceId, token } = await makeOwner()
  const project = await makeProject(ctx, workspaceId, 'Acme')
  const task = uuidv7()
  await withActor(ctx.actorId, async (tx) => {
    await tx`
      insert into task (id, workspace_id, project_id, author_id, title, sort_key)
      values (${task}, ${workspaceId}, ${project}, ${ctx.actorId}, 'Draft it', 'a0')`
  })
  await call('/api/push', token, {
    method: 'POST',
    body: {
      endpoint: `https://fcm.googleapis.com/fcm/send/${uuidv7()}`,
      keys: aBrowser().keys,
      said: 'Chrome on Mac',
    },
  })
  await withActor(ctx.actorId, async (tx) => {
    await tx`
      insert into notification (id, workspace_id, actor_id, reason, object_type, object_id)
      values (${uuidv7()}, ${workspaceId}, ${ctx.actorId}, 'assigned', 'task', ${task})`
  })

  await pushDue(50, (async () => new Response(null, { status: 201 })) as unknown as typeof fetch)

  const [device] = (await call('/api/push', token)).body.devices as {
    last_used_at: string | null
  }[]
  assert.ok(device?.last_used_at, 'a device written to every two seconds should say so')
})

/* ------------------------------------------------------- the Apple apps */

/** A phone's token: thirty-two bytes, as the system hands them over, in hex. */
const aToken = () => randomBytes(32).toString('hex')

/** Apple's service, as far as a test can be it: what it was sent, and an answer. */
function aService(answer: { status: number; reason?: string } = { status: 200 }) {
  const sent: { endpoint: string; headers: Record<string, string>; body: string }[] = []
  const post: Post = async (endpoint, headers, body) => {
    sent.push({ endpoint, headers, body })
    return answer
  }
  return { sent, post }
}

/*
 * The owner's sessions said to be on one device, as an app's are: it sends
 * `x-device` on every request, and a phone is registered only under one
 * (migration 187).
 */
async function onADevice(actorId: string): Promise<string> {
  const device = `dev-${uuidv7()}`
  await admin`update refresh_session set device = ${device} where actor_id = ${actorId}`
  return device
}

async function aTask() {
  const owner = await makeOwner()
  const device = await onADevice(owner.ctx.actorId)
  const project = await makeProject(owner.ctx, owner.workspaceId, 'Acme')
  const task = uuidv7()
  await withActor(owner.ctx.actorId, async (tx) => {
    await tx`
      insert into task (id, workspace_id, project_id, author_id, title, sort_key)
      values (${task}, ${owner.workspaceId}, ${project}, ${owner.ctx.actorId}, 'Draft it', 'a0')`
  })
  const due = async (reason = 'assigned') =>
    withActor(owner.ctx.actorId, async (tx) => {
      await tx`
        insert into notification (id, workspace_id, actor_id, reason, object_type, object_id)
        values (${uuidv7()}, ${owner.workspaceId}, ${owner.ctx.actorId}, ${reason}, 'task', ${task})`
    })
  return { ...owner, task, due, device }
}

/*
 * The part where a mistake is silent, again: Apple's service refuses a token
 * signed wrong with a 403 nobody reads, and the phone simply never lights.
 * So the signature is checked against the key's public half, as Apple does.
 */
test('what is sent to a phone is signed as the team, and says where it goes', async () => {
  const { sent, post } = aService()
  const status = await sendToPhone(
    'https://api.sandbox.push.apple.com/3/device/abc',
    { title: 'Draft it', body: 'Assigned to you · ACM-1', url: '/ws/acme/tasks/1', tag: 'task-1', reason: 'assigned', unread: 4 },
    post,
  )
  assert.equal(status, 200)
  const [one] = sent
  assert.ok(one)

  const bearer = one.headers.authorization!.replace(/^bearer /, '')
  assert.equal(decodeProtectedHeader(bearer).kid, 'TESTKEY123')
  const { payload } = await jwtVerify(bearer, apple.publicKey, { issuer: 'TEAM123456' })
  assert.ok(payload.iat)
  assert.equal(one.headers['apns-topic'], 'com.usetuff.app')
  assert.equal(one.headers['apns-push-type'], 'alert')

  const body = JSON.parse(one.body) as {
    aps: { alert: { title: string; body: string }; badge: number; 'thread-id': string }
    url: string
  }
  assert.equal(body.aps.alert.title, 'Draft it')
  // The number on the icon rides with it, as a browser's does.
  assert.equal(body.aps.badge, 4)
  // Grouped under the thing, not replaced: the stronger reason is not lost.
  assert.equal(body.aps['thread-id'], 'task-1')
  // And the address, which the app opens as it opens a link.
  assert.equal(body.url, '/ws/acme/tasks/1')
})

test('a phone registers by its token, and the server says where it posts', async () => {
  const { token, due } = await aTask()
  const phone = aToken()
  const made = await call('/api/push', token, {
    method: 'POST',
    body: { apns: { token: phone, sandbox: true }, said: 'Tuff on iPhone' },
  })
  assert.equal(made.status, 201)
  const listed = await call('/api/push', token)
  assert.equal(listed.body.apns, true)
  assert.deepEqual(
    (listed.body.devices as { kind: string }[]).map((d) => d.kind),
    ['apns'],
  )

  await due()
  const apple = aService()
  await pushDue(50, (async () => new Response(null, { status: 201 })) as unknown as typeof fetch, apple.post)
  assert.equal(apple.sent.length, 1)
  assert.equal(apple.sent[0]!.endpoint, `https://api.sandbox.push.apple.com/3/device/${phone}`)

  // An address in place of a token is refused: the worker posts only where
  // the server built the address.
  const named = await call('/api/push', token, {
    method: 'POST',
    body: { apns: { token: 'https://internal.example/x', sandbox: false } },
  })
  assert.equal(named.status, 400)
})

/*
 * A token from the other service is refused as `BadDeviceToken`, and no
 * retry changes that — so it is gone, as a `410` is.
 */
test('a phone whose token is refused is taken off', async () => {
  const { token, due } = await aTask()
  await call('/api/push', token, { method: 'POST', body: { apns: { token: aToken(), sandbox: false } } })
  await due('mentioned')
  const refused = aService({ status: 400, reason: 'BadDeviceToken' })
  await pushDue(50, (async () => new Response(null, { status: 201 })) as unknown as typeof fetch, refused.post)
  assert.equal(refused.sent.length, 1)
  assert.deepEqual((await call('/api/push', token)).body.devices, [])
})

/*
 * A phone somebody else had registered — a shared one, or one signed out of
 * without a connection — was refused by the unique index for as long as the
 * other person's row stood.
 */
test('a device goes with whoever registers it', async () => {
  const first = await makeOwner()
  const second = await makeOwner()
  await onADevice(first.ctx.actorId)
  await onADevice(second.ctx.actorId)
  const phone = aToken()
  const body = { apns: { token: phone, sandbox: true } }
  assert.equal((await call('/api/push', first.token, { method: 'POST', body })).status, 201)
  assert.equal((await call('/api/push', second.token, { method: 'POST', body })).status, 201)
  assert.deepEqual((await call('/api/push', first.token)).body.devices, [])
  assert.equal(((await call('/api/push', second.token)).body.devices as unknown[]).length, 1)
})

/*
 * A phone that hears nothing is asked, and says why:
 * what Apple answered for each device, and nothing queued.
 */
test('a notification tried on your own devices says what each service answered', async () => {
  const { token } = await aTask()
  // None yet: an empty answer, not an error.
  const none = await call('/api/push/test', token, { method: 'POST', body: {} })
  assert.equal(none.status, 200)
  assert.deepEqual(none.body.devices, [])

  await call('/api/push', token, { method: 'POST', body: { apns: { token: aToken(), sandbox: true }, said: 'Tuff on iPhone' } })
  const refused = aService({ status: 400, reason: 'BadDeviceToken' })
  const was = trial.phones
  trial.phones = () => ({ post: refused.post, close: () => {} })
  try {
    const tried = await call('/api/push/test', token, { method: 'POST', body: {} })
    const [one] = tried.body.devices as { kind: string; said: string; status: number; reason: string }[]
    assert.equal(one?.kind, 'apns')
    assert.equal(one?.said, 'Tuff on iPhone')
    assert.equal(one?.status, 400)
    assert.equal(one?.reason, 'BadDeviceToken')
    assert.equal(refused.sent.length, 1)
  } finally {
    trial.phones = was
  }
})

/*
 * Read on the laptop, and the phone in a pocket hears its number.
 * Once for
 * however many reads there were, and not when it would say what it said.
 */
test('a read tells the phone its number, once, and not again when it is the same', async () => {
  const { token, due } = await aTask()
  const phone = aToken()
  await call('/api/push', token, { method: 'POST', body: { apns: { token: phone, sandbox: true } } })
  const mine = (s: { endpoint: string }) => s.endpoint.endsWith(phone)
  const browsers = (async () => new Response(null, { status: 201 })) as unknown as typeof fetch

  await due()
  const first = aService()
  await pushDue(50, browsers, first.post)
  assert.equal((JSON.parse(first.sent.find(mine)!.body) as { aps: { badge: number } }).aps.badge, 1)

  // Read elsewhere, twice before the worker comes round: one push, with the
  // number and nothing to show or sound.
  await call('/api/inbox/read', token, { method: 'POST', body: {} })
  await call('/api/inbox/read', token, { method: 'POST', body: {} })
  const after = aService()
  await recountDue(50, after.post)
  const told = after.sent.filter(mine)
  assert.equal(told.length, 1)
  assert.deepEqual(JSON.parse(told[0]!.body), { aps: { badge: 0 } })
  // Tried once and not kept, so it never takes a waiting mention's place.
  assert.equal(told[0]!.headers['apns-expiration'], '0')

  // Read again with nothing left: the icon already says nought.
  await call('/api/inbox/read', token, { method: 'POST', body: {} })
  const again = aService()
  await recountDue(50, again.post)
  assert.equal(again.sent.filter(mine).length, 0)
})

/*
 * A device signed in nowhere hears nothing — migration 186. Ending
 * a session took its device's rows (139); a session that ran out, or was
 * revoked without being ended, left them written to for good.
 */
test('a phone whose session ran out or was revoked is not written to, and the clear-out takes it', async () => {
  const { ctx, token, due } = await aTask()
  const device = `dev-${uuidv7()}`
  await admin`update refresh_session set device = ${device} where actor_id = ${ctx.actorId}`
  const phone = aToken()
  const made = await call('/api/push', token, { method: 'POST', body: { apns: { token: phone, sandbox: true } } })
  assert.equal(made.status, 201)
  const [row] = await admin<{ device: string | null }[]>`select device from push_subscription where id = ${made.body.id as string}`
  assert.equal(row!.device, device, 'registered under the device its session is')

  const mine = (s: { endpoint: string }) => s.endpoint.endsWith(phone)
  const browsers = (async () => new Response(null, { status: 201 })) as unknown as typeof fetch
  const told = async () => {
    await due()
    const apple = aService()
    await pushDue(50, browsers, apple.post)
    return apple.sent.filter(mine).length
  }
  const session = (set: { revoked?: string; expires?: string }) =>
    admin`
      update refresh_session set
        revoked_at = ${set.revoked ? admin`now() - ${set.revoked}::interval` : null},
        expires_at = ${set.expires ? admin`now() - ${set.expires}::interval` : admin`now() + interval '30 days'`}
      where actor_id = ${ctx.actorId}`

  assert.equal(await told(), 1, 'signed in: written to')

  // Spent a moment ago, its successor not yet written: a refresh in the
  // middle is not a reason to forget the phone.
  await session({ revoked: '1 second' })
  assert.equal(await told(), 1)

  // Revoked a while ago, and nothing since: signed in nowhere.
  await session({ revoked: '2 minutes' })
  assert.equal(await told(), 0)
  // Nor told its number after a read.
  await admin`update push_subscription set recount_at = now() where id = ${made.body.id as string}`
  const counted = aService()
  await recountDue(50, counted.post)
  assert.equal(counted.sent.filter(mine).length, 0)

  // Ran out, never ended.
  await session({ expires: '1 second' })
  assert.equal(await told(), 0)

  // The clear-out takes the row; a row with no device — a browser from
  // before 139 — is left as it was.
  const legacy = uuidv7()
  await admin`
    insert into push_subscription (id, workspace_id, actor_id, endpoint, p256dh, auth)
    values (${legacy}, ${ctx.workspaceId}, ${ctx.actorId}, ${`https://fcm.googleapis.com/fcm/send/${uuidv7()}`}, 'p', 'a')`
  await asWorker((tx) => tx`select push_sweep()`)
  const left = await admin<{ id: string }[]>`select id from push_subscription where actor_id = ${ctx.actorId}`
  assert.deepEqual(
    left.map((r) => r.id),
    [legacy],
  )
})

/* ------------------------------------------------------------ the Android app */

/*
 * A service account of this file's own, as the browser's and Apple's keys
 * are, and Google played by a function: the token service answers a token
 * for a properly signed assertion, FCM a message name.
 */
const google = generateKeyPairSync('rsa', { modulusLength: 2048 })
process.env.FCM_SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'tuff-test',
  client_email: 'push@tuff-test.iam.gserviceaccount.com',
  private_key: google.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  token_uri: 'https://oauth2.googleapis.com/token',
})

function aGoogle(answer: { status: number; json: unknown } = { status: 200, json: { name: 'projects/tuff-test/messages/1' } }) {
  const sent: { url: string; headers: Record<string, string>; body: string }[] = []
  const send: Send = async (url, init) => {
    sent.push({ url, ...init })
    if (url === 'https://oauth2.googleapis.com/token') {
      const assertion = new URLSearchParams(init.body).get('assertion') ?? ''
      const { payload } = await jwtVerify(assertion, google.publicKey, { audience: url })
      assert.equal(payload.iss, 'push@tuff-test.iam.gserviceaccount.com')
      assert.equal(payload.scope, 'https://www.googleapis.com/auth/firebase.messaging')
      return { status: 200, json: { access_token: 'ya29.test', expires_in: 3600 } }
    }
    return answer
  }
  return { sent, send, messages: () => sent.filter((s) => s.url.includes('fcm.googleapis.com')) }
}

const anFcmToken = () => `${randomBytes(16).toString('base64url')}:APA91b${randomBytes(48).toString('base64url')}`

test('an Android phone registers by its FCM token, and is told through Google', async () => {
  forgetFcmToken()
  const { token, due } = await aTask()
  const phone = anFcmToken()
  const made = await call('/api/push', token, { method: 'POST', body: { fcm: { token: phone }, said: 'Tuff on Pixel 9' } })
  assert.equal(made.status, 201)
  const listed = await call('/api/push', token)
  assert.equal(listed.body.fcm, true)
  assert.deepEqual(
    (listed.body.devices as { kind: string }[]).map((d) => d.kind),
    ['fcm'],
  )

  await due()
  const g = aGoogle()
  await pushDue(50, (async () => new Response(null, { status: 201 })) as unknown as typeof fetch, aService().post, g.send)
  const [one] = g.messages()
  assert.equal(one?.url, 'https://fcm.googleapis.com/v1/projects/tuff-test/messages:send')
  assert.equal(one?.headers.authorization, 'Bearer ya29.test')
  const message = (
    JSON.parse(one!.body) as {
      message: { token: string; notification: { title: string }; data: { url: string }; android: { notification: { channel_id: string } } }
    }
  ).message
  assert.equal(message.token, phone)
  assert.ok(message.notification.title)
  assert.match(message.data.url, /^\//)
  assert.equal(message.android.notification.channel_id, 'tuff')

  // Not a token: refused, so nothing but a token is ever posted to Google.
  const named = await call('/api/push', token, { method: 'POST', body: { fcm: { token: 'https://internal.example/x' } } })
  assert.equal(named.status, 400)
})

test('an Android phone FCM no longer knows is taken off, and one it cannot read is kept', async () => {
  forgetFcmToken()
  const { token, due } = await aTask()
  await call('/api/push', token, { method: 'POST', body: { fcm: { token: anFcmToken() } } })

  await due('mentioned')
  const unreadable = aGoogle({ status: 400, json: { error: { status: 'INVALID_ARGUMENT' } } })
  await pushDue(50, (async () => new Response(null, { status: 201 })) as unknown as typeof fetch, aService().post, unreadable.send)
  assert.equal(unreadable.messages().length, 1)
  assert.equal(((await call('/api/push', token)).body.devices as unknown[]).length, 1)

  await due('assigned')
  const gone = aGoogle({ status: 404, json: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } })
  await pushDue(50, (async () => new Response(null, { status: 201 })) as unknown as typeof fetch, aService().post, gone.send)
  assert.deepEqual((await call('/api/push', token)).body.devices, [])
})

/*
 * A phone that does not say which device it is has no session to follow,
 * and would be written to for good — refused (migration 187).
 */
test('a phone registered from a session with no device is refused', async () => {
  const { token } = await makeOwner()
  const r = await call('/api/push', token, { method: 'POST', body: { apns: { token: aToken(), sandbox: true } } })
  assert.equal(r.status, 400)
  assert.equal((r.body.error as { code: string }).code, 'no_device')
  const android = await call('/api/push', token, { method: 'POST', body: { fcm: { token: anFcmToken() } } })
  assert.equal(android.status, 400)
})

/*
 * The other side of the same rule: a device still signed in goes on
 * hearing, through a real refresh, and is neither kept alive by somebody
 * else's session on the same device name nor swept with the ones that
 * are signed in nowhere.
 */
test('a phone signed in hears through a refresh, and only its own person’s session keeps it', async () => {
  const { ctx, due } = await aTask()
  const [u] = await admin<{ email: string }[]>`select email::text from app_user where actor_id = ${ctx.actorId}`
  const device = `dev-${uuidv7()}`
  const signIn = await app.request('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device': device },
    body: JSON.stringify({ email: u!.email, password: 'correct-horse-battery-staple' }),
  })
  assert.equal(signIn.status, 200)
  const session = (await signIn.json()) as { access_token: string; refresh_token: string }
  const phone = aToken()
  const made = await call('/api/push', session.access_token, { method: 'POST', body: { apns: { token: phone, sandbox: true } } })
  assert.equal(made.status, 201)
  const row = made.body.id as string
  // Every session of this person but the one just made was on another device.
  await admin`update refresh_session set revoked_at = now() - interval '1 hour' where actor_id = ${ctx.actorId} and device is distinct from ${device}`

  const mine = (s: { endpoint: string }) => s.endpoint.endsWith(phone)
  const browsers = (async () => new Response(null, { status: 201 })) as unknown as typeof fetch
  const told = async () => {
    await due()
    const apple = aService()
    await pushDue(50, browsers, apple.post)
    return apple.sent.filter(mine).length
  }

  // Signed in: its number after a read is told too.
  await admin`update push_subscription set recount_at = now(), told_unread = 99 where id = ${row}`
  const counted = aService()
  await recountDue(50, counted.post)
  assert.equal(counted.sent.filter(mine).length, 1)

  // A real refresh, the spent session aged well past the minute: the
  // successor on the same device keeps the phone.
  const renewed = await app.request('/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device': device },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  })
  assert.equal(renewed.status, 200)
  await admin`update refresh_session set revoked_at = now() - interval '5 minutes' where actor_id = ${ctx.actorId} and device = ${device} and revoked_at is not null`
  assert.equal(await told(), 1)

  // Somebody else signed in on a device of the same name keeps nothing of
  // this person's alive.
  const other = await makeOwner()
  await admin`update refresh_session set device = ${device} where actor_id = ${other.ctx.actorId}`
  const theirPhone = uuidv7()
  await admin`
    insert into push_subscription (id, workspace_id, actor_id, kind, endpoint, device)
    values (${theirPhone}, ${other.workspaceId}, ${other.ctx.actorId}, 'apns',
            ${`https://api.sandbox.push.apple.com/3/device/${aToken()}`}, ${device})`
  await admin`update refresh_session set revoked_at = now() - interval '1 hour' where actor_id = ${ctx.actorId}`
  assert.equal(await told(), 0)

  // The clear-out takes this person's phone and leaves the other's, whose
  // device is signed in.
  await asWorker((tx) => tx`select push_sweep()`)
  const left = await admin<{ id: string }[]>`select id from push_subscription where id in (${row}, ${theirPhone})`
  assert.deepEqual(
    left.map((r) => r.id),
    [theirPhone],
  )
})
