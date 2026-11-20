import { SignJWT, decodeJwt, jwtVerify, type JWTPayload } from 'jose'
import { keyFor, legacyKey } from './keys.js'

/* Its own key, not `JWT_SECRET` itself — `keys.ts`. */
const secret = keyFor('access')
const ISSUER = 'tracker'

/**
 * Tokens, not session cookies: a native client will not
 * swallow cookies, and reworking the server later costs more than a little
 * extra work on the web now.
 */
export const ACCESS_TTL_SECONDS = 15 * 60
export const REFRESH_TTL_DAYS = 30

export type AccessClaims = {
  sub: string
  workspace_id: string
  /** The sign-in this was issued under, so a request can say which of the
      person's devices it is. */
  sid?: string | undefined
  /** Made by the server for a change GitHub caused, as the person who
      linked the repository. Signed like the rest,
      so nobody else can claim it. */
  via?: 'github' | 'import' | 'feedback' | undefined
  /** The import a `via: 'import'` token writes for. */
  imp?: string | undefined
}

export async function issueAccessToken(claims: AccessClaims): Promise<string> {
  return (
    new SignJWT({
      workspace_id: claims.workspace_id,
      ...(claims.sid ? { sid: claims.sid } : {}),
      ...(claims.via ? { via: claims.via } : {}),
      ...(claims.imp ? { imp: claims.imp } : {}),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setIssuedAt()
      /* One made for a change GitHub caused is spent at once, inside this
       process; two minutes is all it needs to be worth anything. */
      .setExpirationTime(`${claims.via ? 120 : ACCESS_TTL_SECONDS}s`)
      .sign(secret)
  )
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const payload = await signedBy(token)
    if (!payload?.sub || typeof payload.workspace_id !== 'string') return null
    return {
      sub: payload.sub,
      workspace_id: payload.workspace_id,
      sid: typeof payload.sid === 'string' ? payload.sid : undefined,
      via: payload.via === 'github' || payload.via === 'import' || payload.via === 'feedback' ? payload.via : undefined,
      imp: typeof payload.imp === 'string' ? payload.imp : undefined,
    }
  } catch {
    return null
  }
}

/**
 * A session in no workspace.
 *
 * Its own shape: no `workspace_id` at all and `nowhere: true`, so
 * `verifyAccessToken` above refuses it and no workspace route can be
 * reached with it, and this refuses every token that names a workspace.
 */
export async function issueNowhereToken(claims: { sub: string; sid: string }): Promise<string> {
  return new SignJWT({ nowhere: true, sid: claims.sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(secret)
}

export async function verifyNowhereToken(token: string): Promise<{ sub: string; sid: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER })
    if (payload.nowhere !== true || !payload.sub || typeof payload.sid !== 'string' || 'workspace_id' in payload || 'via' in payload) {
      return null
    }
    return { sub: payload.sub, sid: payload.sid }
  } catch {
    return null
  }
}

/* Ours, under the access key; or one signed before the split, under the
   secret itself, while those may still be about — `keys.ts`. */
async function signedBy(token: string): Promise<JWTPayload | null> {
  try {
    return (await jwtVerify(token, secret, { issuer: ISSUER })).payload
  } catch {
    let exp: number | undefined
    try {
      exp = decodeJwt(token).exp
    } catch {
      return null
    }
    const old = typeof exp === 'number' ? legacyKey(exp * 1000) : null
    if (!old) return null
    try {
      return (await jwtVerify(token, old, { issuer: ISSUER })).payload
    } catch {
      return null
    }
  }
}
