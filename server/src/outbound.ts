import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'

/**
 * The server asking an address somebody else gave it.
 *
 * A webhook's URL and a browser's push endpoint are written by people, and
 * the worker posts to them. Any address at all meant a member could point
 * the server at itself, at Postgres, at another service on Railway's private
 * network or at the cloud's metadata address, and read the answer's status
 * back off the webhook's row. And nothing timed out: one endpoint that never
 * answered held up every delivery behind it, for every workspace.
 */

/* An IPv6 address as its eight sixteen-bit words, whatever shorthand it
   was written in — `::`, a zone, or an IPv4 address dotted on the end. */
function words(v6: string): number[] | null {
  let s = v6.toLowerCase().split('%')[0]!
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s)
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number]
    s = `${s.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const [head, tail] = s.split('::') as [string, string | undefined]
  const front = head ? head.split(':') : []
  const back = tail === undefined ? null : tail ? tail.split(':') : []
  const all = back === null ? front : [...front, ...Array<string>(8 - front.length - back.length).fill('0'), ...back]
  if (all.length !== 8) return null
  const out = all.map((w) => parseInt(w, 16))
  return out.every((w) => Number.isInteger(w) && w >= 0 && w <= 0xffff) ? out : null
}

/** Whether an address is one of the private, loopback or reserved ranges. */
export function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    /*
     * Public only inside 2000::/3, the global unicast range, and refused
     * everywhere else. This was a list of the private forms instead, and a
     * list of forms is one somebody can find a form missing from: the
     * IPv4-compatible `::7f00:1`, an address the URL parser had written in
     * a shorthand nobody listed.
     */
    const w = words(ip)
    if (!w) return true
    /* An IPv4 address carried inside — mapped, `::ffff:a.b.c.d`, or the
       old compatible `::a.b.c.d` — is as private as the address it carries. */
    if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0)) {
      return privateAddress(`${w[6]! >> 8}.${w[6]! & 255}.${w[7]! >> 8}.${w[7]! & 255}`)
    }
    if ((w[0]! & 0xe000) !== 0x2000) return true
    /* Inside it: Teredo, benchmarking and the other protocol blocks
       (2001::/23), documentation (2001:db8::/32), and 6to4, which is an
       IPv4 address in other clothes (2002::/16). */
    if (w[0] === 0x2001 && (w[1]! < 0x200 || w[1] === 0xdb8)) return true
    if (w[0] === 0x2002) return true
    return false
  }
  const [a, b, c] = ip.split('.').map(Number) as [number, number, number]
  return (
    /* The 6to4 relay, and the two documentation blocks left after 192.0.2. */
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

/** What may be asked at all, before any name is looked up: https, no
    credentials in the address, no name that is ours by its ending, and an
    address written as one only if it is public. */
function shapeOf(raw: string): URL | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (/\.(internal|local|localhost)$/i.test(host) || host === 'localhost') return null
  if (isIP(host) && privateAddress(host)) return null
  return url
}

/** https, a public name, and every address it resolves to public. Asked
    when a webhook is saved, so a wrong address is said at once; delivery
    does not rely on this answer — `outward` checks at the socket. */
export async function publicHttps(raw: string): Promise<boolean> {
  const url = shapeOf(raw)
  if (!url) return false
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) return true
  try {
    const found = await lookup(host, { all: true })
    return found.length > 0 && found.every((f) => !privateAddress(f.address))
  } catch {
    return false
  }
}

/** How a name becomes addresses — `node:dns`'s, or a test's. */
export type Resolve = (host: string, done: (err: Error | null, found: LookupAddress[]) => void) => void
const system: Resolve = (host, done) => dnsLookup(host, { all: true }, (err, found) => done(err, err ? [] : found))

/**
 * A lookup for a socket that refuses to hand it a private address.
 *
 * The check and the connection are one step: the addresses checked are the
 * addresses the socket is given, and nothing looks the name up a second
 * time. Checked first and connected to after — `publicHttps`, then
 * `fetch` — was two lookups, and a name whose server answers a public
 * address the first time and `127.0.0.1` the second (DNS rebinding, with a
 * time to live of zero) walked through the check into the server's own
 * network. Link previews have connected this way since they were made;
 * webhooks do now too.
 */
export function guardedLookup(resolve: Resolve = system) {
  return (
    host: string,
    options: { all?: boolean } | number | undefined,
    done: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
  ): void => {
    resolve(host, (err, list) => {
      if (err) return done(err, '')
      if (list.length === 0 || list.some((a) => privateAddress(a.address))) {
        return done(Object.assign(new Error('refused: a private address'), { code: 'EPRIVATE' }), '')
      }
      if (typeof options === 'object' && options?.all) return done(null, list)
      return done(null, list[0]!.address, list[0]!.family)
    })
  }
}

/** The push services a browser subscribes through — nothing else is a push endpoint. */
const PUSH = [
  /(^|\.)fcm\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
]
export function pushService(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && PUSH.some((r) => r.test(url.hostname))
  } catch {
    return false
  }
}

/**
 * A POST to an address people wrote: refused unless it is a public https
 * address at the moment the socket connects (a name can be pointed
 * somewhere else after it was saved, or between one lookup and the next),
 * never following a redirect, and given ten seconds. Only the status comes
 * back; nothing else of the answer is read.
 */
export function outward(
  raw: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  opts: { resolve?: Resolve; timeoutMs?: number } = {},
): Promise<{ status: number }> {
  const url = shapeOf(raw)
  if (!url) return Promise.reject(new Error('refused: not a public https address'))
  return new Promise((done, fail) => {
    const req = httpsRequest(
      url,
      {
        method: init.method ?? 'POST',
        headers: init.headers ?? {},
        lookup: guardedLookup(opts.resolve) as never,
        /* A connection of its own every time: a socket kept alive would
           carry the next delivery to the same name with no lookup at all. */
        agent: false,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      },
      (res) => {
        res.resume()
        done({ status: res.statusCode ?? 0 })
      },
    )
    req.on('error', fail)
    req.end(init.body ?? '')
  })
}

/*
 * A mail server somebody typed into Server settings.
 *
 * The same list of addresses the server never asks (`privateAddress`), for
 * a socket that is not https: the name is resolved here, every address it
 * gives must pass, and the connection is made to the address checked, by
 * number, with the name kept only for TLS — so a name that answers a
 * public address now and `127.0.0.1` a moment later (DNS rebinding) never
 * moves the socket. A mail relay of one's own on a private network — a
 * `postfix` container beside the app — is let through only where the
 * machine says so (`SMTP_ALLOW_PRIVATE=1`); link-local addresses and the
 * clouds' metadata addresses never are.
 */

/** Never a mail server, whatever the environment allows: unspecified,
    link-local, multicast and broadcast, and the clouds' metadata addresses. */
export function neverAsked(ip: string): boolean {
  if (isIP(ip) === 6) {
    const w = words(ip)
    if (!w) return true
    if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0) && (w[6] || w[7])) {
      return neverAsked(`${w[6]! >> 8}.${w[6]! & 255}.${w[7]! >> 8}.${w[7]! & 255}`)
    }
    if (w.every((x) => x === 0)) return true
    if ((w[0]! & 0xffc0) === 0xfe80) return true
    if ((w[0]! & 0xff00) === 0xff00) return true
    /* AWS's metadata address over IPv6, fd00:ec2::254. */
    if (w[0] === 0xfd00 && w[1] === 0x0ec2 && w.slice(2, 7).every((x) => x === 0) && w[7] === 0x254) return true
    return false
  }
  const [a, b, c, d] = ip.split('.').map(Number) as [number, number, number, number]
  return a === 0 || (a === 169 && b === 254) || a >= 224 || (a === 100 && b === 100 && c === 100 && d === 200)
}

/** Whether a mail server may be at this address: public, or private where
    the machine allows it — never one of `neverAsked`. */
export function mailAddressAllowed(ip: string, allowPrivate: boolean): boolean {
  if (neverAsked(ip)) return false
  return allowPrivate || !privateAddress(ip)
}

/** How a mail server's name is looked up — `node:dns`'s, or a test's. */
export const smtpResolving: { resolve: Resolve } = { resolve: system }

/**
 * The address to connect to for a mail server's name, checked: every
 * address the name has must be allowed, or none is used. `unknown` when
 * the name does not resolve, `private` when an address is not allowed.
 */
export function mailServerAddress(host: string, allowPrivate: boolean): Promise<LookupAddress | 'unknown' | 'private'> {
  const bare = host.replace(/^\[|\]$/g, '')
  if (isIP(bare)) {
    return Promise.resolve(mailAddressAllowed(bare, allowPrivate) ? { address: bare, family: isIP(bare) } : 'private')
  }
  if (!allowPrivate && (bare === 'localhost' || /\.(internal|local|localhost)$/i.test(bare))) return Promise.resolve('private')
  return new Promise((done) => {
    smtpResolving.resolve(bare, (err, list) => {
      if (err || list.length === 0) return done('unknown')
      if (list.some((a) => !mailAddressAllowed(a.address, allowPrivate))) return done('private')
      done(list[0]!)
    })
  })
}
