import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto'
import type { ScryptOptions } from 'node:crypto'

// promisify loses the overload that takes options, hence the local wrapper.
function scryptAsync(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

/*
 * Eight hashes at once, and the rest wait their turn.
 *
 * scrypt runs on libuv's thread pool, the same few threads that read files
 * and resolve names for the whole process. Signing in is open to anybody, so
 * a burst of logins — each one a hash even for an address with no account,
 * which is what keeps the timing honest — filled the pool and stalled file
 * reads and DNS for everybody. A slot is handed straight to whoever is
 * waiting, so the eight are never nine.
 */
const AT_ONCE = 8
let hashing = 0
const queued: (() => void)[] = []

async function inTurn<T>(work: () => Promise<T>): Promise<T> {
  if (hashing < AT_ONCE) hashing++
  else await new Promise<void>((go) => queued.push(go))
  try {
    return await work()
  } finally {
    const next = queued.shift()
    if (next) next()
    else hashing--
  }
}

/**
 * Password hashing on node:crypto: scrypt is memory-hard and is on the OWASP
 * recommendation list. A separate dependency just for argon2 does not pay off
 * here.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await inTurn(() => scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1 }))
  return `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split('$')
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !key) return false
  const expected = Buffer.from(key, 'base64')
  const actual = await inTurn(() =>
    scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    }),
  )
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/**
 * Tokens are stored as hashes only: leaking the table yields no working tokens.
 * Unsalted SHA-256 is enough here — the token is already 256 bits of randomness,
 * there is nothing to brute-force.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

export function generateToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`
}
