import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { generateSecret, verifyTotp, seal, open, generateRecoveryCodes } from '../src/auth/totp.js'

process.env.JWT_SECRET ??= 'test-secret-for-totp'

/** The same maths the verifier uses, written out, so the test is not the code. */
function code(secret: string, when: number): string {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of secret) bits += B32.indexOf(ch).toString(2).padStart(5, '0')
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(Math.floor(when / 30)))
  const mac = createHmac('sha1', Buffer.from(bytes)).update(buf).digest()
  const offset = mac[mac.length - 1]! & 0x0f
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

test('a code from the secret is accepted and a neighbour is not', () => {
  const secret = generateSecret()
  const now = Math.floor(Date.now() / 1000)
  assert.equal(verifyTotp(secret, code(secret, now)), true)
  // One step either side, for clocks that drift and people who type slowly.
  assert.equal(verifyTotp(secret, code(secret, now - 30)), true)
  assert.equal(verifyTotp(secret, code(secret, now + 30)), true)
  // Two steps is a replay window rather than a courtesy.
  assert.equal(verifyTotp(secret, code(secret, now - 120)), false)
})

test('anything that is not the code is refused', () => {
  const secret = generateSecret()
  // The defect this replaces: any string was accepted because nothing read
  // the secret at all.
  for (const attempt of ['', '000000', '12345', 'abcdef', code(generateSecret(), Date.now() / 1000)]) {
    assert.equal(verifyTotp(secret, attempt), false, `accepted ${JSON.stringify(attempt)}`)
  }
})

test('the secret survives a round trip and a tampered one does not open', () => {
  const secret = generateSecret()
  const sealed = seal(secret)
  assert.notEqual(sealed, secret)
  assert.equal(open(sealed), secret)

  const parts = sealed.split('.')
  const tampered = [parts[0], parts[1], Buffer.from('nonsense').toString('base64')].join('.')
  assert.equal(open(tampered), null)
  assert.equal(open('not-sealed-at-all'), null)
})

test('recovery codes are distinct and shaped to be typed', () => {
  const codes = generateRecoveryCodes()
  assert.equal(codes.length, 10)
  assert.equal(new Set(codes).size, 10)
  for (const c of codes) assert.match(c, /^[0-9a-f]{5}-[0-9a-f]{5}$/)
})
