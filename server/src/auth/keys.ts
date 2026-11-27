import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../env.js'

/**
 * A key for each kind of thing the server signs,
 * *One secret for every kind of token*.
 *
 * `JWT_SECRET` signed the access tokens, the provider sign-in's state, the
 * file links, the file cookie, the digest's "stop" link and the GitHub and
 * Slack round trips, each with the secret itself. A signature made for one
 * of them was then a signature the others would check against the same
 * key, and only the shape of what was signed kept them apart: a digest's
 * link, for one, passed as a file link for the key `digest.off`, because
 * an expiry that was not a number was never in the past.
 *
 * Each is signed now with its own key, derived from the one secret by
 * name, so nothing that signs for one purpose can sign for another and no
 * new variable has to be set anywhere for the change to go live. The
 * derivations already made from it — the second factor's and GitHub's
 * keys at rest, a card picture's — keep the names they have; changing
 * those means sealing everything again.
 */
export type Purpose =
  | 'access'
  | 'oauth-state'
  | 'files'
  | 'files-reader'
  | 'file-cookie'
  | 'digest-off'
  | 'github-state'
  | 'slack-state'
  /* Not a signature: what a refresh's successor token is made from, so it
     can be made again for the same request asked twice. */
  | 'refresh-successor'
  /* A provider's start sealed on a workspace's own domain for usetuff.com
     to open. */
  | 'host-handoff'

const made = new Map<Purpose, Buffer>()

export function keyFor(purpose: Purpose): Buffer {
  let k = made.get(purpose)
  if (!k) {
    /* A label no earlier use of the secret signed, so nobody can have been
       handed this key as a signature: `totp-v1`, `github-v1`,
       `tuff:preview-picture`, `digest.off.<id>`, `github:…`, `slack:…`,
       `<key>.<expiry>`, and a JWT's `eyJ…`. */
    k = createHmac('sha256', env.jwtSecret).update(`tuff.key.v1/${purpose}`).digest()
    made.set(purpose, k)
  }
  return k
}

/**
 * Until when something signed with the secret itself, before the split, is
 * still taken — so the change signs nobody out and no link in flight stops
 * working: an access token runs out in fifteen minutes, a provider's state
 * in ten, a file link in two hours, the file cookie in seven days. (A
 * digest's stop link has no end of its own and keeps the old check with
 * no date — `rootSecret`.)
 *
 * Taken only if it also ends by then: the server no longer signs anything
 * with the old key, so every honest one does, and one that claims to last
 * longer was not made by this server before the split. After the date
 * nothing old is taken and this goes, with the fallbacks that ask it.
 */
export const LEGACY_UNTIL = Date.parse('2026-12-15T00:00:00Z')

export function legacyKey(endsAtMs: number | null, now = Date.now()): Buffer | null {
  if (!(now < LEGACY_UNTIL)) return null
  if (endsAtMs !== null && !(endsAtMs <= LEGACY_UNTIL)) return null
  return Buffer.from(env.jwtSecret, 'utf8')
}

/**
 * The secret itself, for the one check that keeps it with no end date: a
 * digest's stop link mailed before the split (`digest.ts`). Nothing signs
 * with it.
 */
export function rootSecret(): Buffer {
  return Buffer.from(env.jwtSecret, 'utf8')
}

export function mac(key: Buffer, message: string, encoding: 'hex' | 'base64url'): string {
  return createHmac('sha256', key).update(message).digest(encoding)
}

/** Two signatures compared in time that does not depend on where they differ. */
export function same(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8')
  const y = Buffer.from(b, 'utf8')
  return x.length === y.length && timingSafeEqual(x, y)
}
