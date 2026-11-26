import { createLocalJWKSet, errors, jwtVerify, type JSONWebKeySet, type JWTPayload } from 'jose'
import { env } from '../env.js'

/*
 * A server's own OpenID Connect provider.
 *
 * One for the whole server, named by `OIDC_ISSUER`. Everything it is asked
 * goes through `ask`: no redirect followed, ten seconds, the answer's size
 * capped, and https only unless this server is itself on http://localhost.
 * Nothing it says is taken before its discovery document's `issuer` is the
 * one the owner set, and no token before its signature is an asymmetric one
 * from the keys that document names.
 */

/** On when the issuer, the client and its secret are all set. */
export const oidcOn = (): boolean => Boolean(env.oidcIssuer && env.oidcClientId && env.oidcClientSecret)

/** What the button calls it: `OIDC_NAME`, else "SSO". */
export const oidcName = (): string => env.oidcName

/** The issuer as it is compared and as it begins a subject: one trailing slash aside. */
export const issuerOf = (s: string): string => s.replace(/\/$/, '')

/**
 * How the provider is spoken to. Kept in one object so a test can shorten
 * them; nothing else writes it.
 *
 * - `timeoutMs`: a request, answer read whole included.
 * - `maxBytes`: the largest answer read — a discovery document, a token,
 *   the keys. Entra's keys are a few kilobytes.
 * - `keptMs`: how long the discovery document and the keys are kept.
 * - `downMs`: how long a provider that did not answer is taken as down,
 *   so a run of presses does not wait ten seconds each.
 * - `keysAgainMs`: how soon the keys may be read again for a token signed
 *   with one they did not have — a key rotated in.
 */
export const talking = {
  timeoutMs: 10_000,
  maxBytes: 256 * 1024,
  keptMs: 60 * 60 * 1000,
  downMs: 30_000,
  keysAgainMs: 60_000,
}

/**
 * Whether plain http may be spoken to the provider: only where this server
 * is itself on http://localhost — somebody trying Tuff on a laptop against
 * a Keycloak beside it. Decided from `APP_URL` alone, never from a
 * request, whose `Host` its sender writes; with `APP_URL` unset, no.
 */
export function plainAllowed(appUrl: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?\/?$/i.test(appUrl)
}

/**
 * An address the provider names, if it may be asked: https, or http where
 * `plain`; no credentials in it. Not filtered for private addresses: the
 * owner chose the issuer, often on their own network, and its document
 * is believed only once its `issuer` is that one.
 */
function endpoint(raw: unknown, plain: boolean): string | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.username || u.password) return null
  return u.protocol === 'https:' || (plain && u.protocol === 'http:') ? u.href : null
}

/** One request to the provider, its answer as JSON, or null for none in time. */
async function ask(url: string, init: RequestInit = {}): Promise<{ status: number; body: unknown } | null> {
  const signal = AbortSignal.timeout(talking.timeoutMs)
  try {
    const r = await fetch(url, { ...init, redirect: 'error', signal })
    if (Number(r.headers.get('content-length') ?? 0) > talking.maxBytes) {
      await r.body?.cancel().catch(() => {})
      return null
    }
    /* Read up to the ceiling and no further, under the same ten seconds: a
       body with no length said is not taken whole on its word. */
    const reader = r.body?.getReader()
    const parts: Uint8Array[] = []
    let size = 0
    for (;;) {
      if (!reader) break
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > talking.maxBytes) {
        await reader.cancel().catch(() => {})
        return null
      }
      parts.push(value)
    }
    const text = Buffer.concat(parts).toString('utf8')
    let body: unknown = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = null
    }
    return { status: r.status, body }
  } catch {
    return null
  }
}

const record = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/** The provider as its discovery document described it, checked. */
export type Discovered = {
  /** Exactly as the document says it, which is what a token's `iss` must be. */
  issuer: string
  authorize: string
  token: string
  jwksUri: string
  /** `client_secret_basic`, else `client_secret_post`. */
  basic: boolean
  keys: ReturnType<typeof createLocalJWKSet>
  keysRead: number
  /** What it was read for: the issuer set, and whether plain http was allowed. */
  setting: string
  plain: boolean
  at: number
}

let kept: Discovered | null = null
let down: { setting: string; plain: boolean; at: number } | null = null
let asking: { setting: string; plain: boolean; work: Promise<Discovered | null> } | null = null

/** For a test: the next ask reads the provider again. */
export function forgetProvider(): void {
  kept = null
  down = null
  asking = null
}

/** The provider's keys, checked as a key set; null when they are not one. */
async function readKeys(uri: string): Promise<ReturnType<typeof createLocalJWKSet> | null> {
  const r = await ask(uri, { headers: { accept: 'application/json' } })
  const set = record(r?.body)
  if (!r || r.status !== 200 || !set || !Array.isArray(set.keys) || set.keys.length > 100) return null
  try {
    return createLocalJWKSet(set as unknown as JSONWebKeySet)
  } catch {
    return null
  }
}

async function readProvider(setting: string, plain: boolean): Promise<Discovered | null> {
  const issuer = issuerOf(setting)
  if (!endpoint(issuer, plain)) {
    console.error('[oidc] OIDC_ISSUER is not an https address, and this server is not on http://localhost')
    return null
  }
  const r = await ask(`${issuer}/.well-known/openid-configuration`, { headers: { accept: 'application/json' } })
  const doc = record(r?.body)
  if (!r || r.status !== 200 || !doc) {
    console.error('[oidc] the provider’s discovery document could not be read')
    return null
  }
  /* The equality that stops a document from naming somebody else's keys. */
  if (typeof doc.issuer !== 'string' || issuerOf(doc.issuer) !== issuer) {
    console.error('[oidc] the discovery document names another issuer than OIDC_ISSUER')
    return null
  }
  const authorize = endpoint(doc.authorization_endpoint, plain)
  const token = endpoint(doc.token_endpoint, plain)
  const jwksUri = endpoint(doc.jwks_uri, plain)
  if (!authorize || !token || !jwksUri) {
    console.error('[oidc] the discovery document is missing an endpoint, or names one that is not https')
    return null
  }
  const methods = doc.token_endpoint_auth_methods_supported
  /* Nothing listed is the standard's default, `client_secret_basic`. */
  const basic = !Array.isArray(methods) || methods.includes('client_secret_basic') || !methods.includes('client_secret_post')
  const keys = await readKeys(jwksUri)
  if (!keys) {
    console.error('[oidc] the provider’s keys could not be read')
    return null
  }
  return { issuer: doc.issuer, authorize, token, jwksUri, basic, keys, keysRead: Date.now(), setting, plain, at: Date.now() }
}

/**
 * The provider, read when first needed and kept for an hour; null when it
 * cannot be read or is not what `OIDC_ISSUER` says — the button then says
 * it could not be reached. One read at a time; a failed one is remembered
 * for half a minute.
 *
 * A re-read after the hour that fails keeps the document that worked: the
 * provider's discovery being down for a moment is no reason to stop
 * signing people in with what it said, and checked, an hour ago. It is
 * read again after the half minute.
 */
export async function provider(): Promise<Discovered | null> {
  if (!oidcOn()) return null
  const setting = env.oidcIssuer
  const plain = plainAllowed(env.appUrl)
  const same = (x: { setting: string; plain: boolean } | null) => x !== null && x.setting === setting && x.plain === plain
  const now = Date.now()
  const stale = same(kept) ? kept : null
  if (stale && now - stale.at < talking.keptMs) return stale
  if (same(down) && now - down!.at < talking.downMs) return stale
  if (!asking || !same(asking)) {
    const mine: { setting: string; plain: boolean; work: Promise<Discovered | null> } = { setting, plain, work: Promise.resolve(null) }
    mine.work = (async () => {
      try {
        const p = await readProvider(setting, plain)
        if (p) {
          kept = p
          down = null
          return p
        }
        down = { setting, plain, at: Date.now() }
        return stale
      } finally {
        if (asking === mine) asking = null
      }
    })()
    asking = mine
  }
  return asking.work
}

/**
 * The code traded for an ID token at the token endpoint, with the PKCE
 * verifier, the client authenticated as the document allows. `unreachable`
 * when the provider did not answer; null when it refused.
 */
export async function tradeCode(
  p: Discovered,
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<string | 'unreachable' | null> {
  if (!code || code.length > 4096) return null
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier })
  const headers: Record<string, string> = { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }
  if (p.basic) {
    /* Each form-encoded first, as RFC 6749 §2.3.1 asks. */
    const form = (s: string) => new URLSearchParams([['', s]]).toString().slice(1)
    headers.authorization = `Basic ${Buffer.from(`${form(env.oidcClientId)}:${form(env.oidcClientSecret)}`).toString('base64')}`
  } else {
    body.set('client_id', env.oidcClientId)
    body.set('client_secret', env.oidcClientSecret)
  }
  const r = await ask(p.token, { method: 'POST', headers, body })
  if (!r) return 'unreachable'
  const t = record(r.body)
  if (r.status !== 200 || typeof t?.id_token !== 'string' || t.id_token.length > 16_384) return null
  return t.id_token
}

/* Asymmetric only: a token signed with the client secret (`HS256`) proves
   only that somebody has the client secret, and `none` proves nothing. */
const ALGORITHMS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA', 'Ed25519']

export type IdClaims = JWTPayload & {
  sub: string
  email?: unknown
  email_verified?: unknown
  name?: unknown
  preferred_username?: unknown
  nonce?: unknown
  azp?: unknown
}

/**
 * The ID token, checked: signed by one of the provider's keys with an
 * asymmetric algorithm, for this client, by this issuer, not expired, with
 * the nonce this browser was given. The keys are read again once for a key
 * they did not have, at most once a minute.
 */
export async function checkIdToken(p: Discovered, idToken: string, nonce: string): Promise<IdClaims | null> {
  const options = {
    issuer: p.issuer,
    audience: env.oidcClientId,
    algorithms: ALGORITHMS,
    requiredClaims: ['exp', 'iat', 'sub'],
    /* Two clocks half a minute apart are two clocks, not an attack. */
    clockTolerance: 30,
    /* Issued for this sign-in, not kept from another: a token is traded
       for within seconds of being made. */
    maxTokenAge: '10m',
  }
  let claims: JWTPayload
  try {
    claims = (await jwtVerify(idToken, p.keys, options)).payload
  } catch (e) {
    if (!(e instanceof errors.JWKSNoMatchingKey) || Date.now() - p.keysRead < talking.keysAgainMs) return null
    const keys = await readKeys(p.jwksUri)
    if (!keys) return null
    p.keys = keys
    p.keysRead = Date.now()
    try {
      claims = (await jwtVerify(idToken, p.keys, options)).payload
    } catch {
      return null
    }
  }
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) return null
  if (typeof claims.nonce !== 'string' || claims.nonce !== nonce) return null
  /* A token for several audiences says which of them it was given to. */
  if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== env.oidcClientId) return null
  if (claims.azp !== undefined && claims.azp !== env.oidcClientId) return null
  return claims as IdClaims
}

/**
 * Who the token says this is. The subject carries the issuer, so a server
 * that moves to another provider never hands an old account to whoever the
 * new one gives the same `sub`.
 *
 * `owns` — the provider vouches for the address, which taking an existing
 * account by it needs — only on `email_verified: true`. `verified`, which
 * making a new account needs, is having an address at all: the owner chose
 * this provider and decides who is in it. A token that does not vouch for
 * its address may make an account, never take one, and the account it
 * makes holds its address only weakly (`email_by_hand`, `whoIs`), so the
 * address's real owner proving it later takes it. No address, nothing is
 * made.
 */
export function whoTheTokenSays(claims: IdClaims): { subject: string; email: string; verified: boolean; name: string; owns: boolean } {
  const raw = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : ''
  const email = raw.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw) ? raw : ''
  const vouched = claims.email_verified === true || claims.email_verified === 'true'
  const name =
    (typeof claims.name === 'string' && claims.name.trim()) ||
    (typeof claims.preferred_username === 'string' && claims.preferred_username.trim()) ||
    ''
  return {
    subject: `${issuerOf(env.oidcIssuer)} ${claims.sub}`,
    email,
    verified: Boolean(email),
    name: name.slice(0, 100),
    owns: Boolean(email) && vouched,
  }
}
