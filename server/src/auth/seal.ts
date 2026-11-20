import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import { env } from '../env.js'

/**
 * Secrets kept to be read back — a second factor's seed, a GitHub or Slack
 * token, an import's API key — sealed with a key of their own, apart from
 * the one that signs sessions. The security audit spec, the sixth
 * audit, M2.
 *
 * They were sealed with keys derived from `JWT_SECRET`, so the secret that
 * signs every session was also the one that opens every credential at rest:
 * rotating it after a leak signed everybody out *and* turned every second
 * factor and every integration into ciphertext nobody could open. One
 * secret doing two jobs is one that cannot be changed for either.
 *
 * So there are two shapes on disk:
 *
 * - **version 0**, `iv.tag.body`, which is what everything sealed before
 *   this looks like: AES-256-GCM under `HMAC(JWT_SECRET, 'totp-v1')` or
 *   `HMAC(JWT_SECRET, 'github-v1')`. Still opened, for ever, with the
 *   `JWT_SECRET` the server has; and still what is written while
 *   `ENCRYPTION_KEY` is unset, so a deployment that sets nothing new goes
 *   on exactly as before.
 * - **version 1**, `v1.<key id>.iv.tag.body`, under a key derived from
 *   `ENCRYPTION_KEY`, written once it is set. The key id says which key
 *   sealed it, so `ENCRYPTION_KEY_PREVIOUS` can hold the old one while
 *   `pnpm reseal` (`reseal.ts`) moves every row to the new.
 *
 * The id is a few bytes of an HMAC of the key, not the key: it tells two
 * keys apart and says nothing about either.
 */
/** `webhook`: the receiver's own key a webhook sends as `Authorization` (migration 266).
    `mail`: the SMTP password or Resend key Server settings keeps (migration 301).
    `vapid`: the private half of the push key your own server makes for itself (migration 305). */
export type Sealing = 'totp' | 'github' | 'webhook' | 'mail' | 'vapid'

/** The labels version 0 derived its keys under — unchanged, or nothing old opens. */
const V0: Record<Sealing, string> = { totp: 'totp-v1', github: 'github-v1', webhook: 'webhook-v1', mail: 'mail-v1', vapid: 'vapid-v1' }

/** What a sealing can be opened or made with: the session secret, and the keys at rest. */
export type Ring = { jwt: string; current: string; previous: string }

export function envRing(): Ring {
  return { jwt: env.jwtSecret, current: env.encryptionKey, previous: env.encryptionKeyPrevious }
}

const keyId = (root: string): string => createHmac('sha256', root).update('tuff.seal.id').digest('hex').slice(0, 8)
const v1Key = (root: string, kind: Sealing): Buffer => createHmac('sha256', root).update(`tuff.seal.v1/${kind}`).digest()
const v0Key = (jwt: string, kind: Sealing): Buffer => createHmac('sha256', jwt).update(V0[kind]).digest()

function encrypt(key: Buffer, plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), body.toString('base64')].join('.')
}

function decrypt(key: Buffer, iv: string, tag: string, body: string): string | null {
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
    d.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8')
  } catch {
    return null
  }
}

/** Sealed with `ENCRYPTION_KEY` when there is one, as version 0 when there is not. */
export function seal(kind: Sealing, plain: string, ring: Ring = envRing()): string {
  if (!ring.current) return encrypt(v0Key(ring.jwt, kind), plain)
  return `v1.${keyId(ring.current)}.${encrypt(v1Key(ring.current, kind), plain)}`
}

/**
 * Opened with whichever key sealed it, or null — a sealing that will not
 * open is a secret that cannot be used, the same answer as none.
 */
export function open(kind: Sealing, sealed: string | null, ring: Ring = envRing()): string | null {
  if (!sealed) return null
  const parts = sealed.split('.')
  if (parts.length === 3) {
    const [iv, tag, body] = parts as [string, string, string]
    return iv && tag && body ? decrypt(v0Key(ring.jwt, kind), iv, tag, body) : null
  }
  if (parts.length === 5 && parts[0] === 'v1') {
    const [, id, iv, tag, body] = parts as [string, string, string, string, string]
    const root = [ring.current, ring.previous].find((k) => k && keyId(k) === id)
    return root ? decrypt(v1Key(root, kind), iv, tag, body) : null
  }
  return null
}

/**
 * Whether sealing it again would change the key it is under: version 0
 * once `ENCRYPTION_KEY` is set, or version 1 under a key that is no longer
 * the current one. What `reseal.ts` moves.
 */
export function stale(sealed: string, ring: Ring = envRing()): boolean {
  if (!ring.current) return false
  const parts = sealed.split('.')
  return !(parts.length === 5 && parts[0] === 'v1' && parts[1] === keyId(ring.current))
}

/**
 * Which key sealed it, never the key: version 0, under `JWT_SECRET`, or
 * version 1 and the id of the `ENCRYPTION_KEY` — the id says which key and
 * nothing about it. Null for something that is no sealing. For a log line
 * that has to say what to put back.
 */
export function sealedWith(sealed: string): { version: 0 } | { version: 1; keyId: string } | null {
  const parts = sealed.split('.')
  if (parts.length === 3) return { version: 0 }
  if (parts.length === 5 && parts[0] === 'v1') return { version: 1, keyId: parts[1]! }
  return null
}

/** The id `sealedWith` names a key by, for a key this server has; empty for none. */
export const keyIdOf = (root: string): string => (root ? keyId(root) : '')
