import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createHmac, randomBytes } from 'node:crypto'
import postgres from 'postgres'
import { closeDb, makeOwner } from './helpers.js'
import { open, type Ring, seal, stale } from '../src/auth/seal.js'
import { beginTotp, enableTotp, secondFactor } from '../src/auth/flows.js'
import { reseal } from '../src/reseal.js'

/*
 * Secrets at rest under a key apart from the one that signs sessions —
 * `auth/seal.ts`, the sixth audit's M2.
 */
const owner = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })

after(async () => {
  await owner.end()
  await closeDb()
})

const JWT = 'j'.repeat(40)
const A = 'a'.repeat(64)
const B = 'b'.repeat(64)

/* What the server wrote before this, byte for byte: `iv.tag.body` under
   `HMAC(JWT_SECRET, 'totp-v1' | 'github-v1')`. */
function legacy(jwt: string, label: string, plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', createHmac('sha256', jwt).update(label).digest(), iv)
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), body.toString('base64')].join('.')
}

test('what was sealed before still opens, and with no ENCRYPTION_KEY the same shape is written', () => {
  const ring: Ring = { jwt: JWT, current: '', previous: '' }
  assert.equal(open('totp', legacy(JWT, 'totp-v1', 'SEED'), ring), 'SEED')
  assert.equal(open('github', legacy(JWT, 'github-v1', 'gho_x'), ring), 'gho_x')
  // Each under its own label: a token's sealing is not a seed's.
  assert.equal(open('totp', legacy(JWT, 'github-v1', 'gho_x'), ring), null)

  const written = seal('totp', 'SEED', ring)
  assert.equal(written.split('.').length, 3)
  assert.equal(open('totp', written, ring), 'SEED')
  assert.equal(stale(written, ring), false)
})

test('under ENCRYPTION_KEY, changing JWT_SECRET no longer loses a thing', () => {
  const before: Ring = { jwt: JWT, current: A, previous: '' }
  const sealed = seal('github', 'xoxb-1', before)
  assert.match(sealed, /^v1\.[0-9a-f]{8}\./)
  assert.equal(open('github', sealed, { ...before, jwt: 'k'.repeat(40) }), 'xoxb-1')
  assert.equal(open('totp', sealed, before), null)
})

test('a rotated key opens through ENCRYPTION_KEY_PREVIOUS, and not once that is gone', () => {
  const sealed = seal('totp', 'SEED', { jwt: JWT, current: A, previous: '' })
  const rotating: Ring = { jwt: JWT, current: B, previous: A }
  assert.equal(open('totp', sealed, rotating), 'SEED')
  assert.equal(stale(sealed, rotating), true)
  const again = seal('totp', open('totp', sealed, rotating)!, rotating)
  assert.equal(stale(again, rotating), false)
  assert.equal(open('totp', again, { jwt: JWT, current: B, previous: '' }), 'SEED')
  assert.equal(open('totp', sealed, { jwt: JWT, current: B, previous: '' }), null)
  // Something that is no sealing at all is not a secret.
  assert.equal(open('totp', 'v1.zz.a.b', rotating), null)
  assert.equal(open('totp', 'plain', rotating), null)
})

test('the reseal moves a row from the old sealing to the new, and leaves what will not open', async () => {
  const { ctx } = await makeOwner()
  const id = ctx.actorId
  const now: Ring = { jwt: process.env.JWT_SECRET!, current: '', previous: '' }
  const put = (v: string) => owner`update app_user set totp_secret_enc = ${v} where actor_id = ${id}`
  const read = async () => (await owner<{ v: string }[]>`select totp_secret_enc as v from app_user where actor_id = ${id}`)[0]!.v

  // Version 0, as production holds it today; then ENCRYPTION_KEY is set.
  await put(seal('totp', 'SEED', now))
  const withKey: Ring = { ...now, current: A }
  assert.deepEqual(await reseal(owner, withKey, [id]), { moved: 1, unreadable: 0, which: [] })
  assert.equal(open('totp', await read(), withKey), 'SEED')
  assert.equal(open('totp', await read(), { ...withKey, jwt: 'k'.repeat(40) }), 'SEED')
  assert.deepEqual(await reseal(owner, withKey, [id]), { moved: 0, unreadable: 0, which: [] })

  // ENCRYPTION_KEY changed, the old one kept as the previous.
  const rotated: Ring = { ...now, current: B, previous: A }
  assert.deepEqual(await reseal(owner, rotated, [id]), { moved: 1, unreadable: 0, which: [] })
  assert.equal(open('totp', await read(), { ...now, current: B }), 'SEED')

  // A key nobody has any more: counted, and the row left as it was.
  const lost = seal('totp', 'SEED', { ...now, current: 'c'.repeat(64) })
  await put(lost)
  assert.deepEqual(await reseal(owner, rotated, [id]), {
    moved: 0,
    unreadable: 1,
    which: [`app_user.totp_secret_enc actor_id=${id}`],
  })
  assert.equal(await read(), lost)
})

/** The same maths the verifier uses, written out — `totp.test.ts`. */
function code(secret: string, step = 0): string {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of secret) bits += B32.indexOf(ch).toString(2).padStart(5, '0')
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30) + step))
  const mac = createHmac('sha1', Buffer.from(bytes)).update(buf).digest()
  const offset = mac[mac.length - 1]! & 0x0f
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

test('a second factor whose secret will not open still takes a recovery code, once', async () => {
  const { ctx } = await makeOwner()
  const email = (await owner<{ email: string }[]>`select email::text from app_user where actor_id = ${ctx.actorId}`)[0]!.email
  const { secret } = (await beginTotp(ctx.actorId, email))!
  const codes = await enableTotp(ctx.actorId, code(secret))
  assert.ok(codes && codes.length > 0)
  // The next code: the one that turned it on was taken.
  assert.equal(await secondFactor(ctx.actorId, email, code(secret, 1)), true)

  // Sealed under a key this server does not have — a secret rotated away.
  await owner`update app_user set totp_secret_enc = ${seal('totp', secret, { jwt: 'x'.repeat(40), current: '', previous: '' })}
              where actor_id = ${ctx.actorId}`
  assert.equal(await secondFactor(ctx.actorId, email, code(secret)), false)
  assert.equal(await secondFactor(ctx.actorId, email, codes[0]!), true)
  assert.equal(await secondFactor(ctx.actorId, email, codes[0]!), false)
})
