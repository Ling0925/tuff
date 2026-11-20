/**
 * The Android app's last hop: Firebase Cloud Messaging.
 *
 * The same notification, composed by `about()` as a browser's and a
 * phone's is — only the sending differs.
 *
 * No new dependency: Google's token is an RS256 JWT traded for an access
 * token, which `jose` already signs, and FCM's v1 API is plain JSON over
 * `fetch`. The service account is `FCM_SERVICE_ACCOUNT`, the JSON file
 * Firebase gives, pasted whole.
 */
import { createPrivateKey } from 'node:crypto'
import { SignJWT } from 'jose'
import type { Told } from './push.js'

type Account = { project_id: string; client_email: string; private_key: string; token_uri?: string }

function account(): Account | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT ?? ''
  if (!raw) return null
  try {
    const a = JSON.parse(raw) as Partial<Account>
    return a.project_id && a.client_email && a.private_key ? (a as Account) : null
  } catch {
    return null
  }
}

export const fcmConfigured = (): boolean => account() !== null

/** What a post to FCM answered: its status, and its error's code when refused. */
export type Answer = { status: number; reason?: string | undefined }

/** One post to FCM, or to Google's token service. A parameter, so a test can be the service. */
export type Send = (url: string, init: { headers: Record<string, string>; body: string }) => Promise<{ status: number; json: unknown }>

const viaFetch: Send = async (url, init) => {
  const r = await fetch(url, { method: 'POST', ...init, signal: AbortSignal.timeout(10_000) })
  return { status: r.status, json: await r.json().catch(() => null) }
}

/**
 * The access token that says the message is from us — an hour long from
 * Google, kept fifty minutes here.
 */
let held: { token: string; at: number; who: string } | null = null
async function bearer(a: Account, send: Send): Promise<string> {
  const now = Date.now()
  if (held && held.who === a.client_email && now - held.at < 50 * 60_000) return held.token
  const audience = a.token_uri ?? 'https://oauth2.googleapis.com/token'
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(a.client_email)
    .setAudience(audience)
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(now / 1000) + 3600)
    .sign(createPrivateKey(a.private_key.replace(/\\n/g, '\n')))
  const answer = await send(audience, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  })
  const token = (answer.json as { access_token?: string } | null)?.access_token
  if (answer.status !== 200 || !token) throw new Error(`FCM: Google refused the service account (${answer.status})`)
  held = { token, at: now, who: a.client_email }
  return token
}

/**
 * One notification to one Android device, as FCM said it.
 *
 * The tag is Android's notification tag: a second notification about the
 * same thing replaces the first on the phone rather than stacking under it,
 * which is what the web's service worker does with its tag. The address it
 * is about travels as data, for the app to open when it is pressed.
 */
export async function askAndroid(token: string, told: Told, send: Send = viaFetch): Promise<Answer> {
  const a = account()
  if (!a) return { status: 0, reason: 'Unconfigured' }
  const answer = await send(`https://fcm.googleapis.com/v1/projects/${a.project_id}/messages:send`, {
    headers: { authorization: `Bearer ${await bearer(a, send)}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: told.title, ...(told.body ? { body: told.body } : {}) },
        data: {
          url: told.url,
          ...(told.tag ? { tag: told.tag } : {}),
          ...(told.reason ? { reason: told.reason } : {}),
          ...(told.unread === undefined ? {} : { unread: String(told.unread) }),
        },
        android: {
          priority: 'high',
          notification: {
            channel_id: 'tuff',
            ...(told.tag ? { tag: told.tag } : {}),
            ...(told.unread === undefined ? {} : { notification_count: told.unread }),
          },
        },
      },
    }),
  })
  const error = (answer.json as { error?: { status?: string; details?: { errorCode?: string }[] } } | null)?.error
  return { status: answer.status, reason: error?.details?.find((d) => d.errorCode)?.errorCode ?? error?.status }
}

/**
 * The same, read as the sender reads a browser's service: an app that was
 * uninstalled, or a token from another Firebase project, is gone — `410`,
 * and the row goes with it.
 */
export async function sendToAndroid(token: string, told: Told, send: Send = viaFetch): Promise<number> {
  const answer = await askAndroid(token, told, send)
  if (answer.status === 404 || answer.reason === 'UNREGISTERED' || answer.reason === 'SENDER_ID_MISMATCH') {
    return 410
  }
  /* Not `INVALID_ARGUMENT`: FCM says that of a token that is not one and of
     a message it cannot read alike, and the second would take every
     Android device off the list for a fault of ours. */
  if (answer.status === 401 || answer.status === 403)
    console.error(`push: FCM refused the service account — ${answer.reason ?? answer.status}`)
  else if (answer.status >= 300) console.error(`push: FCM refused a push — ${answer.status} ${answer.reason ?? ''}`)
  return answer.status
}

/** For tests: forget the access token. */
export function forgetFcmToken(): void {
  held = null
}
