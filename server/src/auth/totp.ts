import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { open as openAs, seal as sealAs } from './seal.js'

/**
 * Time-based one-time passwords, written here rather than taken from a
 * package.
 *
 * RFC 6238 is a counter, an HMAC and a modulo. A dependency for that is a
 * supply chain for that, in the one part of the system where a compromised
 * package reads the second factor of every account.
 */

const DIGITS = 6
const STEP = 30
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/*
 * Thirty-two characters: twenty bytes, whole, which is what RFC 4226 asks
 * for. It was twenty characters — twelve and a half bytes — and Google
 * Authenticator refuses a key that does not end on a byte, so its camera
 * said it could not read the code at all.
 */
export function generateSecret(): string {
  let out = ''
  for (const b of randomBytes(32)) out += B32[b % 32]
  return out
}

function fromBase32(s: string): Buffer {
  let bits = ''
  for (const ch of s.toUpperCase().replace(/=+$/, '')) {
    const i = B32.indexOf(ch)
    if (i < 0) continue
    bits += i.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

function at(secret: string, counter: number): string {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const mac = createHmac('sha1', fromBase32(secret)).update(buf).digest()
  const offset = mac[mac.length - 1]! & 0x0f
  const code = mac.readUInt32BE(offset) & 0x7fffffff
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0')
}

/**
 * One step either side of now.
 *
 * Clocks drift and people finish typing late. Wider than that starts to be a
 * replay window rather than a courtesy.
 */
export function verifyTotp(secret: string, code: string): boolean {
  return totpStep(secret, code) !== null
}

/**
 * The time step a code is good for, or null — what is kept so that a code
 * is taken once (RFC 6238 §5.2). Within the window a code was good for up
 * to ninety seconds, as often as anybody typed it; the caller spends the
 * step (`auth_totp_spend`) and refuses one at or below the last it took.
 */
export function totpStep(secret: string, code: string): number | null {
  const given = code.replace(/\D/g, '')
  if (given.length !== DIGITS) return null
  const now = Math.floor(Date.now() / 1000 / STEP)
  let matched: number | null = null
  for (const c of [now - 1, now, now + 1]) {
    const expected = at(secret, c)
    // Constant time, because a comparison that returns early tells you how
    // much of the code was right — and every step is tried, whichever matched.
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(given)) && matched === null) matched = c
  }
  return matched
}

export function otpauthUrl(secret: string, email: string, issuer = 'Tuff'): string {
  // The colon between them as itself, as the key URI format writes it.
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=${DIGITS}&period=${STEP}`
}

/* ------------------------------------------------------ at rest */

/**
 * The secret is encrypted, not hashed: it has to be read back to check a code.
 *
 * That makes it the one credential in the system a database dump alone does
 * not give up — the key lives in the environment. Hashing would be stronger
 * and would also make the feature impossible. Under `ENCRYPTION_KEY` when
 * there is one, so rotating `JWT_SECRET` no longer locks anybody out of
 * their own second factor — `seal.ts`.
 */
export function seal(secret: string): string {
  return sealAs('totp', secret)
}

export function open(sealed: string): string | null {
  return openAs('totp', sealed)
}

/**
 * Recovery codes, because a lost phone must not be a lost account.
 *
 * Ten of them, shown once, stored hashed and single use — the same rules as a
 * password, because that is what they are.
 */
export function generateRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () =>
    randomBytes(5)
      .toString('hex')
      .replace(/(.{5})/, '$1-'),
  )
}
