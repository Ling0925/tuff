/**
 * The key pair a push service checks our signature against.
 *
 * One pair per deployment, made once and kept: changing it invalidates every
 * subscription anybody has ever granted, because the browser stored the
 * public half when it subscribed and the push service checks the signature
 * against exactly that.
 *
 * P-256 and raw, which is the encoding the Push API takes.
 */
import { generateKeyPairSync } from 'node:crypto'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })

/** The uncompressed point, 65 bytes, as the browser wants it. */
const pub = publicKey.export({ format: 'jwk' }) as { x: string; y: string }
const raw = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(pub.x, 'base64url'),
  Buffer.from(pub.y, 'base64url'),
])
const jwk = privateKey.export({ format: 'jwk' })

console.log(`VAPID_PUBLIC_KEY=${raw.toString('base64url')}`)
console.log(`VAPID_PRIVATE_KEY=${jwk.d as string}`)
console.log('VAPID_SUBJECT=mailto:you@example.com')
