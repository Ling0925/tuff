import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { SignJWT } from 'jose'
import { env } from '../src/env.js'
import { LEGACY_UNTIL, keyFor, legacyKey } from '../src/auth/keys.js'
import { issueAccessToken, verifyAccessToken } from '../src/auth/tokens.js'
import { fileCookie, linkForReader, readFileCookie, signKey, verifyKey, verifyKeyFor } from '../src/storage.js'
import { digestOffLink, digestOffValid } from '../src/digest.js'

/*
 * One secret for every kind of token,
 * `auth/keys.ts`. Each attack below is a signature made for one purpose
 * presented as another.
 */
const raw = env.jwtSecret
const hex = (key: string | Buffer, m: string) => createHmac('sha256', key).update(m).digest('hex')
const ws = '01900000-0000-7000-8000-000000000001'
const me = '01900000-0000-7000-8000-000000000002'
/* Whether anything signed before the split is still taken today. */
const oldStillTaken = Date.now() < LEGACY_UNTIL

test('every purpose has its own key, none of them the secret', () => {
  const keys = (
    ['access', 'oauth-state', 'files', 'files-reader', 'file-cookie', 'digest-off', 'github-state', 'slack-state'] as const
  ).map((p) => keyFor(p).toString('hex'))
  assert.equal(new Set(keys).size, keys.length)
  assert.ok(!keys.includes(Buffer.from(raw).toString('hex')))
  // And none is a key the secret already made for something else.
  for (const label of ['totp-v1', 'github-v1', 'tuff:preview-picture'])
    assert.ok(!keys.includes(createHmac('sha256', raw).update(label).digest('hex')), label)
})

test('a digest’s stop link is not a file link that never runs out', () => {
  // Before: HMAC(secret, `digest.off.<id>`) was, read as `<expiry>.<sig>`,
  // a link for the key `digest.off` whose expiry — not a number — was
  // never in the past.
  const sig = new URL(digestOffLink(me), 'https://x').searchParams.get('t')!
  assert.equal(digestOffValid(me, sig), true)
  assert.equal(verifyKey('digest.off', `${me}.${sig}`), false)
  const before = hex(raw, `digest.off.${me}`)
  assert.equal(verifyKey('digest.off', `${me}.${before}`), false, 'not even signed with the secret itself')
  // An expiry is a whole number of seconds and nothing else.
  const good = signKey('w/k', 60)
  const [exp, s] = good.split('.')
  assert.equal(verifyKey('w/k', good), true)
  assert.equal(verifyKey('w/k', `${exp}x.${s}`), false)
  assert.equal(verifyKey('w/k', `${good}.more`), false)
})

test('one kind of file signature is not taken as another', () => {
  // A reader's link signs `<key>.<reader>`; it is not a link for anybody
  // to the key `<key>.<reader>`, nor the other way round.
  const link = new URL(linkForReader('w/k', me, 600), 'https://x')
  const token = link.searchParams.get('token')!
  assert.equal(verifyKeyFor('w/k', me, token), true)
  assert.equal(verifyKey(`w/k.${me}`, token), false)
  assert.equal(verifyKeyFor('w/k', me, signKey(`w/k.${me}`, 600)), false)
  // The file cookie signs `files.<actor>.<expiry>`, which read as a file
  // link was one for the key `files.<actor>`.
  const cookie = fileCookie(me)
  const [, cexp, csig] = cookie.split('.')
  assert.ok(readFileCookie(cookie))
  assert.equal(verifyKey(`files.${me}`, `${cexp}.${csig}`), false)
})

test('a token made for one door is not a session at another', async () => {
  // Shaped exactly like a session, signed with another purpose's key or
  // with the provider sign-in's — refused.
  for (const key of [keyFor('oauth-state'), keyFor('files'), keyFor('github-state')]) {
    const forged = await new SignJWT({ workspace_id: ws })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(me)
      .setIssuer('tracker')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key)
    assert.equal(await verifyAccessToken(forged), null)
  }
  const real = await issueAccessToken({ sub: me, workspace_id: ws })
  assert.equal((await verifyAccessToken(real))?.sub, me)
})

test('what was signed before the split works for its lifetime, and no longer', async () => {
  // A session signed with the secret itself, as every one was until now:
  // taken while such tokens may still be about — nobody is signed out.
  const old = await new SignJWT({ workspace_id: ws })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(me)
    .setIssuer('tracker')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(new TextEncoder().encode(raw))
  assert.equal((await verifyAccessToken(old))?.sub ?? null, oldStillTaken ? me : null)
  // One claiming to outlast the old key was not made by this server.
  const long = await new SignJWT({ workspace_id: ws })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(me)
    .setIssuer('tracker')
    .setExpirationTime(Math.floor(LEGACY_UNTIL / 1000) + 60)
    .sign(new TextEncoder().encode(raw))
  assert.equal(await verifyAccessToken(long), null)
  // An old file link for its hour.
  const exp = Math.floor(Date.now() / 1000) + 3600
  const stored = `${ws}/${me}`
  assert.equal(verifyKey(stored, `${exp}.${hex(raw, `${stored}.${exp}`)}`), oldStillTaken)
  assert.equal(verifyKeyFor(stored, me, `${exp}.${hex(raw, `${stored}.${me}.${exp}`)}`), oldStillTaken)
  // The old key only for a message shaped as the purpose's own: an old
  // reader's link is not an old link for anybody to `<key>.<reader>`, and
  // nothing old is a link for `digest.off`.
  assert.equal(verifyKey(`${stored}.${me}`, `${exp}.${hex(raw, `${stored}.${me}.${exp}`)}`), false)
  assert.equal(verifyKey('digest.off', `${exp}.${hex(raw, `digest.off.${exp}`)}`), false)
  assert.equal(readFileCookie(`x.${exp}.${hex(raw, `files.x.${exp}`)}`), null)
  // An old file cookie is taken and said to be nearly done, so the next
  // answer sets one under the new key.
  const cexp = Math.floor(Date.now() / 1000) + 3 * 86_400
  const oldCookie = readFileCookie(`${me}.${cexp}.${hex(raw, `files.${me}.${cexp}`)}`)
  assert.equal(oldCookie !== null, oldStillTaken)
  if (oldCookie) assert.ok(oldCookie.left <= 86_400)
  // An old digest link, which has no end of its own, keeps working: a stop
  // link in a mail (RFC 8058's one-click) has to for as long as the mail is kept.
  assert.equal(digestOffValid(me, hex(raw, `digest.off.${me}`)), true)

  // And after the date: nothing old is taken but the digest's stop link.
  const real = Date.now
  Date.now = () => LEGACY_UNTIL + 30 * 86_400_000
  try {
    assert.equal(await verifyAccessToken(old), null)
    const later = Math.floor(Date.now() / 1000) + 3600
    assert.equal(verifyKey(stored, `${later}.${hex(raw, `${stored}.${later}`)}`), false)
    assert.equal(readFileCookie(`${me}.${later}.${hex(raw, `files.${me}.${later}`)}`), null)
    assert.equal(digestOffValid(me, hex(raw, `digest.off.${me}`)), true)
    assert.equal(digestOffValid(me, hex(raw, `digest.off.${ws}`)), false, 'only for the person it names')
    assert.equal(verifyKey(stored, signKey(stored, 60)), true, 'what is signed now still works')
  } finally {
    Date.now = real
  }

  // The date itself: before it the old key; at it and after, nothing.
  assert.ok(legacyKey(LEGACY_UNTIL - 1000, LEGACY_UNTIL - 2000))
  assert.ok(legacyKey(null, LEGACY_UNTIL - 2000))
  assert.equal(legacyKey(LEGACY_UNTIL + 1000, LEGACY_UNTIL - 2000), null)
  assert.equal(legacyKey(null, LEGACY_UNTIL), null)
  assert.equal(legacyKey(LEGACY_UNTIL - 1000, LEGACY_UNTIL + 1), null)
})
