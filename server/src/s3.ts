import { createHash, createHmac } from 'node:crypto'

/**
 * Talking to an S3-compatible bucket, in about a hundred lines.
 *
 * Not `@aws-sdk/client-s3`, and the reason is arithmetic: that package has
 * fifty-six direct dependencies and adds some twenty megabytes, to carry
 * three verbs. The server has eleven dependencies in total.
 *
 * What it buys for that weight is other people's handling of retries,
 * multipart uploads, streaming and a hundred services this product will
 * never call. What is needed here is PUT, GET and DELETE of whole objects
 * that are already in memory — `put` takes a `Uint8Array` — so almost none
 * of that applies.
 *
 * The one thing that genuinely has to be right is the signature, and the
 * primitive it needs is HMAC-SHA256, which `node:crypto` has and which
 * `storage.ts` already uses to sign its own links. So the trade is: a
 * hundred lines nobody else maintains, against twenty megabytes and
 * fifty-six packages somebody else does. With the signature under test —
 * against the vectors AWS publishes — the first is the smaller risk.
 *
 * **S3 here means the protocol, not the company.** The same code talks to
 * Cloudflare R2, Hetzner Object Storage, Backblaze and Amazon; which one is
 * four environment variables.
 */

export type Bucket = {
  /** `https://<account>.r2.cloudflarestorage.com`, or another provider's. */
  endpoint: string
  bucket: string
  accessKey: string
  secretKey: string
  /** R2 wants `auto`; most others want a real one. Part of the signature. */
  region: string
}

const sha256 = (b: string | Uint8Array): string => createHash('sha256').update(b).digest('hex')

const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest()

/**
 * Every character that is not unreserved, percent-encoded.
 *
 * `encodeURIComponent` leaves `!*'()` alone and AWS does not, so a key with
 * a bracket in it signs one way here and verifies another way there — a
 * failure that looks like bad credentials. The slashes in a path are
 * separators and stay, which is why this takes a flag rather than being
 * applied to the whole path at once.
 */
function uriEncode(s: string, keepSlash: boolean): string {
  let out = ''
  for (const ch of s) {
    if (/[A-Za-z0-9\-._~]/.test(ch) || (keepSlash && ch === '/')) {
      out += ch
      continue
    }
    for (const byte of Buffer.from(ch, 'utf8')) {
      out += '%' + byte.toString(16).toUpperCase().padStart(2, '0')
    }
  }
  return out
}

/**
 * One request, signed with AWS Signature Version 4.
 *
 * The shape of it is fixed by the specification and reads strangely on
 * purpose: a canonical request is hashed, wrapped in a string to sign, and
 * signed with a key derived from the date, the region and the service in
 * that order. Every part of it is compared byte for byte at the other end,
 * so the blank lines and the trailing newlines below are load-bearing.
 */
export async function send(
  b: Bucket,
  method: 'PUT' | 'GET' | 'DELETE',
  key: string,
  body?: Uint8Array,
  /** Sent and not signed — a `Range`, which SigV4 does not require to be
      covered and the bucket honours either way. */
  extra: Record<string, string> = {},
): Promise<Response> {
  const url = new URL(`${b.endpoint.replace(/\/+$/, '')}/${b.bucket}/${key}`)
  const payload = body ?? new Uint8Array()
  const hashed = sha256(payload)

  // `20260101T120000Z` and `20260101`. The second is the signing scope.
  const now = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '')
  const day = now.slice(0, 8)

  /*
   * Host and the payload hash are the minimum AWS requires signed, and both
   * matter: the host stops a signature being replayed against another
   * bucket, and the hash stops the body being swapped under it.
   */
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': hashed,
    'x-amz-date': now,
  }

  const names = Object.keys(headers).sort()
  const canonical = [
    method,
    uriEncode(url.pathname, true),
    '', // No query string on any of the three verbs used here.
    names.map((n) => `${n}:${headers[n]}`).join('\n') + '\n',
    names.join(';'),
    hashed,
  ].join('\n')

  const scope = `${day}/${b.region}/s3/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', now, scope, sha256(canonical)].join('\n')

  // The key is derived in four steps, each one signing the next — which is
  // what makes a leaked daily key useless for another day or region.
  const signing = hmac(hmac(hmac(hmac(`AWS4${b.secretKey}`, day), b.region), 's3'), 'aws4_request')
  const signature = createHmac('sha256', signing).update(toSign).digest('hex')

  return fetch(url, {
    method,
    headers: {
      ...extra,
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${b.accessKey}/${scope}, ` + `SignedHeaders=${names.join(';')}, Signature=${signature}`,
    },
    ...(body ? { body } : {}),
  })
}

/**
 * The bucket this deployment writes to, or null for the local disk.
 *
 * Null is the ordinary state in development: a bucket to run the tests
 * against is a thing to set up before anybody can run them, and the disk
 * driver exists so that nobody has to. Production sets these four and the
 * driver changes underneath without anything above it knowing.
 */
export function configured(): Bucket | null {
  const endpoint = process.env.STORAGE_S3_ENDPOINT
  const bucket = process.env.STORAGE_S3_BUCKET
  const accessKey = process.env.STORAGE_S3_KEY
  const secretKey = process.env.STORAGE_S3_SECRET
  if (!endpoint || !bucket || !accessKey || !secretKey) return null
  return {
    endpoint,
    bucket,
    accessKey,
    secretKey,
    // R2 ignores the region but it is still signed, and `auto` is what
    // their documentation uses. Anything else needs it set properly.
    region: process.env.STORAGE_S3_REGION ?? 'auto',
  }
}
