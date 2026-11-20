/**
 * The Apple apps' last hop: Apple's push service.
 *
 * The same notification, composed by `about()` and counted for the icon as a
 * browser's is — only the sending differs.
 *
 * No new dependency: the token is an ES256 JWT, which `jose` already signs,
 * and Apple's service speaks only HTTP/2, which is `node:http2`. Node's
 * `fetch` does not speak it without one.
 */
import { connect, constants, type ClientHttp2Session } from 'node:http2'
import { createPrivateKey } from 'node:crypto'
import { SignJWT } from 'jose'
import { env } from './env.js'
import { edition } from './edition.js'
import type { Told } from './push.js'

/** The bundle the notifications are for: `APNS_TOPIC`, else the service's apps'. None on your own server unless it is set. */
export const apnsTopic = (): string => env.apnsTopic || edition.vendor?.apnsTopic || ''

export const apnsConfigured = (): boolean => Boolean(env.apnsKey && env.apnsKeyId && env.apnsTeamId && apnsTopic())

const SERVICE = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
}

/**
 * Where the worker posts for this device — built here from the token, so an
 * app never names an address for the server to call. A build from Xcode is
 * given its token by the sandbox, TestFlight and the App Store by
 * production, and a token is refused by the other.
 */
export function apnsEndpoint(token: string, sandbox: boolean): string {
  return `${sandbox ? SERVICE.sandbox : SERVICE.production}/3/device/${token.toLowerCase()}`
}

/**
 * The token that says the message is from us.
 *
 * Kept forty minutes: Apple refuses one older than an hour, and one renewed
 * more often than every twenty minutes (`TooManyProviderTokenUpdates`).
 */
let signed: { token: string; at: number; key: string } | null = null
async function bearer(): Promise<string> {
  const now = Date.now()
  if (signed && signed.key === env.apnsKeyId && now - signed.at < 40 * 60_000) return signed.token
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: env.apnsKeyId })
    .setIssuer(env.apnsTeamId)
    .setIssuedAt(Math.floor(now / 1000))
    .sign(createPrivateKey(env.apnsKey))
  signed = { token, at: now, key: env.apnsKeyId }
  return token
}

/** What a post to the service answered: its status, and its reason when refused. */
export type Answer = { status: number; reason?: string | undefined }

/** One post to Apple's service. A parameter, so a test can be the service. */
export type Post = (endpoint: string, headers: Record<string, string>, body: string) => Promise<Answer>

/**
 * Posts over one HTTP/2 connection per service, for a pass of the worker.
 *
 * Opened when the first phone is written to and closed when the pass is
 * done: notifications come in ones and twos, and a connection held open
 * between them is one more thing to notice has gone stale.
 */
export function phones(): { post: Post; close: () => void } {
  const open = new Map<string, ClientHttp2Session>()
  const session = (origin: string) => {
    let s = open.get(origin)
    if (!s || s.closed || s.destroyed) {
      s = connect(origin)
      // A connection that fails takes its streams with it; the next post
      // opens another.
      s.on('error', () => open.delete(origin))
      open.set(origin, s)
    }
    return s
  }
  const post: Post = (endpoint, headers, body) =>
    new Promise((resolve, reject) => {
      const url = new URL(endpoint)
      const stream = session(url.origin).request({
        ':method': 'POST',
        ':path': url.pathname,
        'content-type': 'application/json',
        ...headers,
      })
      let status = 0
      let said = ''
      let done = false
      const finish = (answer: Answer | Error) => {
        if (done) return
        done = true
        if (answer instanceof Error) reject(answer)
        else resolve(answer)
      }
      // Ten seconds, as a browser's push service is given — `outbound.ts`.
      stream.setTimeout(10_000, () => stream.close(constants.NGHTTP2_CANCEL))
      stream.on('response', (h) => {
        status = Number(h[':status'] ?? 0)
      })
      stream.setEncoding('utf8')
      stream.on('data', (chunk: string) => {
        said += chunk
      })
      stream.on('end', () => {
        let reason: string | undefined
        try {
          reason = (JSON.parse(said) as { reason?: string }).reason
        } catch {
          // A 200 has no body at all.
        }
        finish({ status, reason })
      })
      stream.on('error', (e) => finish(e))
      stream.on('close', () => finish({ status }))
      stream.end(body)
    })
  return {
    post,
    close: () => {
      for (const s of open.values()) s.close()
      open.clear()
    },
  }
}

/**
 * One notification to one phone, answered with a status the sender reads
 * as it reads a browser's.
 *
 * `410` is an app that was deleted. `400 BadDeviceToken` and
 * `DeviceTokenNotForTopic` are a token from the other service or another
 * app, which no retry will change — so they are answered as `410` too, and
 * the row goes.
 *
 * The tag is the `thread-id`, not a replacement: the web keeps the stronger
 * of two reasons in its service worker, and an app could only decide that
 * in an extension. Grouped, "given to you" is not lost to "somebody
 * mentioned you".
 */
export async function sendToPhone(endpoint: string, told: Told, post: Post): Promise<number> {
  return heard(await askPhone(endpoint, told, post))
}

/**
 * The number on the icon and nothing else, after a read on another device.
 * It shows
 * nothing and makes no sound.
 *
 * Tried once and not kept (`apns-expiration: 0`): Apple holds one push for a
 * phone that is away, and a number arriving after a mention would take the
 * mention's place. A phone that missed it hears the right number with the
 * next notification, or counts for itself when it is opened.
 */
export async function countToPhone(endpoint: string, unread: number, post: Post): Promise<number> {
  return heard(
    await post(
      endpoint,
      {
        authorization: `bearer ${await bearer()}`,
        'apns-topic': apnsTopic(),
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-expiration': '0',
      },
      JSON.stringify({ aps: { badge: unread } }),
    ),
  )
}

/** What Apple answered, read as the sender reads a browser's service. */
function heard(answer: Answer): number {
  if (answer.status === 400 && (answer.reason === 'BadDeviceToken' || answer.reason === 'DeviceTokenNotForTopic')) {
    /* Said, because the row goes with it and the phone hears nothing: a
       token from the other service — an Xcode build's said to be the App
       Store's — looked like nothing at all from outside. */
    console.error(`push: Apple refused a device's token — ${answer.reason}`)
    return 410
  }
  /* A key that is wrong is wrong for every phone, and nothing in the
     product would say so: the worker's log is the one place it can. */
  if (answer.status === 403) console.error(`push: Apple refused the key — ${answer.reason ?? 'no reason given'}`)
  else if (answer.status >= 300) console.error(`push: Apple refused a push — ${answer.status} ${answer.reason ?? 'no reason given'}`)
  return answer.status
}

/** What Apple answered for one phone, as it said it — the worker's sending and a trial's. */
export async function askPhone(endpoint: string, told: Told, post: Post): Promise<Answer> {
  const body = JSON.stringify({
    aps: {
      alert: { title: told.title, ...(told.body ? { body: told.body } : {}) },
      ...(told.unread === undefined ? {} : { badge: told.unread }),
      sound: 'default',
      ...(told.tag ? { 'thread-id': told.tag } : {}),
    },
    url: told.url,
    ...(told.reason ? { reason: told.reason } : {}),
  })
  return post(
    endpoint,
    {
      authorization: `bearer ${await bearer()}`,
      'apns-topic': apnsTopic(),
      'apns-push-type': 'alert',
      'apns-priority': '10',
      // A day, as a browser's: a phone asleep for a weekend still hears
      // about Friday.
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 86_400),
    },
    body,
  )
}
