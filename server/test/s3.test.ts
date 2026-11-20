import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import test from 'node:test'
import { configured } from '../src/s3.js'

/**
 * The signature, against the vectors AWS publishes.
 *
 * This is the one part of the driver that cannot be checked by using it: a
 * wrong signature comes back as `403 SignatureDoesNotMatch`, which looks
 * exactly like wrong credentials, and chasing that against a live bucket is
 * how an afternoon goes.
 *
 * Two vectors, because the signature is two independent pieces of
 * arithmetic multiplied together and a test of the product alone cannot
 * say which half is wrong:
 *
 *   - the canonical request, hashed — the part that encodes *what* is being
 *     asked for, and where a stray newline or an unsorted header hides;
 *   - the signing key, derived — the part that encodes *who* is asking and
 *     for which day, region and service.
 *
 * Both are published by AWS with fixed inputs and known answers, and a
 * 256-bit hash matching by accident is not a thing that happens. The
 * signature itself is an HMAC of the first under the second, so with both
 * checked there is nothing left in the maths to be wrong.
 *
 * Reproduced here rather than imported, because `send` builds its string
 * around a live `fetch` and a timestamp. Written in the same order and with
 * the same names as `s3.ts`, so the two can be read side by side.
 */
test('the canonical request matches the one AWS documents', () => {
  const empty = createHash('sha256').update('').digest('hex')
  const headers: Record<string, string> = {
    host: 'examplebucket.s3.amazonaws.com',
    range: 'bytes=0-9',
    'x-amz-content-sha256': empty,
    'x-amz-date': '20130524T000000Z',
  }
  /* Sorted by name and each line terminated — the ordering and the
     trailing newline are both load-bearing, and both are what a
     hand-written signer gets wrong. */
  const names = Object.keys(headers).sort()
  const canonical = ['GET', '/test.txt', '', names.map((n) => `${n}:${headers[n]}`).join('\n') + '\n', names.join(';'), empty].join('\n')

  /* From AWS's own "GET Object" worked example. */
  assert.equal(createHash('sha256').update(canonical).digest('hex'), '7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972')
})

test('the signing key is derived the way AWS documents', () => {
  const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest()

  /* From AWS's "deriving a signing key" example. Four steps, each signing
     the next, which is what makes a leaked daily key useless for another
     day, region or service. */
  const key = hmac(hmac(hmac(hmac('AWS4wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20150830'), 'us-east-1'), 'iam'), 'aws4_request')
  assert.equal(key.toString('hex'), 'c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9')
})

/**
 * No bucket configured is the ordinary state, and it means the disk.
 *
 * A development machine has no credentials and must not need any: the
 * tests, the seed and `pnpm check` all write files. A half-filled
 * environment answering with a bucket would send those writes somewhere
 * nobody is looking — so all four are required or none of it counts.
 */
test('a half-configured bucket is no bucket', () => {
  const was = { ...process.env }
  try {
    for (const k of ['ENDPOINT', 'BUCKET', 'KEY', 'SECRET']) delete process.env[`STORAGE_S3_${k}`]
    assert.equal(configured(), null, 'nothing set')

    process.env.STORAGE_S3_ENDPOINT = 'https://example.r2.cloudflarestorage.com'
    process.env.STORAGE_S3_BUCKET = 'tracker'
    assert.equal(configured(), null, 'a place to write but nothing to write with')

    process.env.STORAGE_S3_KEY = 'k'
    process.env.STORAGE_S3_SECRET = 's'
    const b = configured()
    assert.ok(b, 'all four set')
    assert.equal(b.region, 'auto', 'R2 ignores the region, and it is still signed')
  } finally {
    process.env = was
  }
})

/**
 * And against a real bucket, when there is one.
 *
 * Everything above is arithmetic, and arithmetic is the half that fails
 * silently. What it cannot answer is whether the other end agrees: a
 * region a provider spells differently, a path-style endpoint where a
 * virtual-hosted one was assumed, a bucket that exists and refuses writes.
 *
 * Skipped without credentials rather than failing, because the suite runs
 * on every machine and most of them have no bucket — and a test that needs
 * one to pass is a test everybody learns to ignore. Set the four
 * `STORAGE_S3_*` variables and it runs.
 *
 * It writes one small object, reads it back, and removes it. Nothing is
 * left behind: a test that litters a production bucket is one nobody dares
 * run against the real thing, which is the only place it is worth running.
 */
test('a real bucket takes a file, gives it back, and lets go of it', async (t) => {
  const bucket = configured()
  if (!bucket) {
    t.skip('no STORAGE_S3_* set — nothing to talk to')
    return
  }

  const { send } = await import('../src/s3.js')
  const key = `test/${Date.now()}-${Math.random().toString(36).slice(2)}`
  const body = new TextEncoder().encode('the bytes went there and came back')

  const put = await send(bucket, 'PUT', key, body)
  assert.ok(put.ok, `PUT answered ${put.status}`)

  const got = await send(bucket, 'GET', key)
  assert.ok(got.ok, `GET answered ${got.status}`)
  assert.equal(new TextDecoder().decode(new Uint8Array(await got.arrayBuffer())), 'the bytes went there and came back')

  const gone = await send(bucket, 'DELETE', key)
  assert.ok(gone.ok, `DELETE answered ${gone.status}`)

  /* And it is really gone, which is the half of a delete that is worth
     checking: a 204 is cheap to return. */
  const after = await send(bucket, 'GET', key)
  assert.equal(after.status, 404)
})
